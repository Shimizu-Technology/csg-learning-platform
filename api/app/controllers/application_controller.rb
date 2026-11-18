class ApplicationController < ActionController::API
  include ClerkAuthenticatable

  # Before authentication: bound bootstrap and public catalog abuse. All other
  # authenticated traffic shares allowances by user, never by campus/NAT IP.
  ApiRateLimits::PUBLIC.each do |name, policy|
    rate_limit(**policy, name: name.to_s, scope: "public-api",
      store: ApiRateLimits::STORE, by: -> { request.remote_ip },
      if: -> { ENV.fetch("RATE_LIMIT_PUBLIC_BUCKETS", "on") != "off" && ApiRateLimits.applies?(name, controller_path, action_name) },
      with: -> { render_rate_limit(policy[:within]) })
  end

  around_action :cache_school_settings
  before_action :capture_learning_request_started_at

  rescue_from Enrollment::StaleLearningWrite do |error|
    body = { error: error.message }
    # Older clients read only `error`; content_moved lets newer ones reload.
    body[:code] = error.code if error.code == "content_moved"
    render json: body, status: :conflict
  end

  # Permissive but strict-enough video MIME validator: matches `video/<subtype>`
  # for any valid subtype token, rejects everything else (image/, application/,
  # text/, blank, etc.). Used by every presign action so a forged content_type
  # can't be slipped into our S3 bucket as something the player won't render.
  VIDEO_MIME_PATTERN = /\Avideo\/[a-z0-9][a-z0-9.\-+]*\z/i

  private

  def render_rate_limit(window)
    # A full window is conservative even if the counter is about to expire.
    response.set_header("Retry-After", window.to_i.to_s)
    response.set_header("Cache-Control", "no-store")
    render json: { error: "Too many requests", retry_after: window.to_i }, status: :too_many_requests
  end

  def cache_school_settings(&block)
    SchoolSetting::RequestCache.set(enabled: true, school_setting: nil, &block)
  end

  def require_feature!(key, cohort = nil)
    return if current_user.staff? || FeatureSwitches.for(cohort: cohort)[key]

    render json: { error: "This feature is disabled for this course", code: "feature_disabled", feature: key }, status: :forbidden
  end

  def require_cohort_access!(cohort, teacher: false)
    allowed = teacher ? current_user.can_teach_cohort?(cohort) : current_user.can_access_cohort?(cohort)
    return true if allowed

    render_forbidden("Cannot access this cohort")
    false
  end

  def video_stream_expiry_for(enrollment)
    expiry = S3Service::VIDEO_STREAM_EXPIRY
    expiry = [ expiry, (enrollment.access_expires_at - Time.current).floor ].min if enrollment&.access_expires_at
    return expiry if expiry.positive?

    render_forbidden("Course access has expired")
    nil
  end

  def capture_learning_request_started_at
    @learning_request_started_at = Time.current
  end

  def require_current_resource_version!(record, parameter: :base_updated_at)
    requested = params[parameter].presence
    raise ActiveRecord::StaleObjectError.new(record, "update") if requested.blank?
    raise ActiveRecord::StaleObjectError.new(record, "update") unless Time.iso8601(requested) == record.updated_at
  rescue ArgumentError
    raise ActiveRecord::StaleObjectError.new(record, "update")
  end

  def render_stale_resource(label)
    render json: {
      error: "#{label} changed after this screen was opened. Refresh the latest version before saving.",
      code: "stale_resource"
    }, status: :conflict
  end

  def require_community_terms!
    return if CommunityPolicy.accepted?(current_user)

    render json: {
      error: "Accept the current Community Guidelines and Terms before sharing content",
      code: "community_terms_required",
      community_policy: CommunityPolicy.as_json(current_user)
    }, status: :forbidden
  end

  def with_learning_write_guard(enrollment, &)
    return yield unless enrollment

    enrollment.with_learning_write_guard(request_started_at: @learning_request_started_at, &)
  end

  # Returns the validated, lowercased MIME if it matches `video/<subtype>`,
  # otherwise renders 422 and returns nil so the caller can `return if nil`.
  def validated_video_content_type(content_type)
    ct = content_type.to_s.strip
    if ct.match?(VIDEO_MIME_PATTERN)
      ct.downcase
    else
      render json: { error: "content_type must be a video/* MIME type" }, status: :unprocessable_entity
      nil
    end
  end

  def authorize_content_block_write!(content_block)
    return if current_user.staff?

    lesson = content_block.lesson
    enrollment = active_enrollment_for_lesson(lesson)

    unless enrollment
      # The learner's cohort moved to its own copy (CurriculumCopyForCohort)
      # after the request resolved the block: refuse as stale, so the client
      # reloads and saves on the copy, rather than as a lost permission.
      raise_if_content_moved!("ContentBlock", content_block.id)
      render_forbidden("Not enrolled in this curriculum")
      return
    end

    @learning_write_enrollment = enrollment
    assignment = enrollment.module_assignments.find { |ma| ma.module_id == lesson.module_id }
    lesson_assignment = enrollment.lesson_assignments.find { |la| la.lesson_id == lesson.id }
    denial = content_block_write_denial(enrollment, lesson, assignment, lesson_assignment)
    render_forbidden(denial) if denial
  end

  # The check above runs before the write takes its block lock. A lesson move
  # (LessonMove) or a day change (LessonBlockEditor) holds the lesson's blocks
  # FOR UPDATE while it counts learner work, so a learner write that arrives
  # meanwhile waits on that lock and would then save work on a lesson the
  # learner may no longer open. Call this first inside the learning write
  # guard: it takes the block lock (held to commit), then decides again from
  # fresh rows. Renders 403 and returns false when access is gone.
  def recheck_content_block_write!(content_block, enrollment)
    return true if current_user.staff? || enrollment.nil?

    denial = ActiveRecord::Base.uncached do
      ContentBlock.lock_for_learner_write!(content_block.id)
      lesson = Lesson.includes(:curriculum_module).find(ContentBlock.where(id: content_block.id).pick(:lesson_id))
      assignment = ModuleAssignment.find_by(enrollment_id: enrollment.id, module_id: lesson.module_id)
      lesson_assignment = LessonAssignment.find_by(enrollment_id: enrollment.id, lesson_id: lesson.id)
      content_block_write_denial(enrollment, lesson, assignment, lesson_assignment)
    end
    return true unless denial
    # The block moved to this cohort's own copy (CurriculumCopyForCohort)
    # while the write waited: refuse it as stale, so the client reloads and
    # saves against the copy, rather than as a lost permission.
    if ContentRedirect.exists?(cohort_id: enrollment.cohort_id, record_type: "ContentBlock", old_id: content_block.id)
      raise Enrollment::StaleLearningWrite.new(Enrollment::CONTENT_MOVED_MESSAGE, code: "content_moved")
    end

    render_forbidden(denial)
    false
  end

  # Staff writes that name a cohort and one of its modules (submission
  # windows, module access). The module was resolved from the cohort's
  # curriculum before the transaction, and "Make a copy for this cohort"
  # (CurriculumCopyForCohort) may have moved the cohort to its copy since.
  # Inside the caller's transaction: take the cohort FOR NO KEY UPDATE (lock
  # order step 3: it waits for a copy in progress, and doesn't conflict with
  # learner inserts' foreign key checks), reload it, and refuse with
  # content_moved (409) when the module is no longer on its curriculum. A
  # write that takes the lock first finishes on the shared ids, and the copy,
  # waiting on the same lock, then moves its rows.
  def lock_cohort_for_module_write!(cohort, curriculum_module)
    cohort.lock!("FOR NO KEY UPDATE")
    return if cohort.curriculum_id == curriculum_module.curriculum_id

    raise Enrollment::StaleLearningWrite.new(Cohort::CONTENT_MOVED_MESSAGE, code: "content_moved")
  end

  # Raises content_moved (409) when one of the learner's active cohorts (the
  # request's, when it names one) has a redirect for this record.
  def raise_if_content_moved!(record_type, id)
    cohorts = current_user.enrollments.active.select(:cohort_id)
    cohorts = cohorts.where(cohort_id: params[:cohort_id]) if params[:cohort_id].present?
    return unless ContentRedirect.where(cohort_id: cohorts, record_type: record_type, old_id: id).exists?

    raise Enrollment::StaleLearningWrite.new(Enrollment::CONTENT_MOVED_MESSAGE, code: "content_moved")
  end

  # A content id from a learner request, after "Make a copy for this cohort"
  # moved it (MovedContent). Unchanged unless the learner (or the cohort the
  # request names) can no longer reach the original.
  def moved_content_id(record_type, id, cohort_id: params[:cohort_id])
    MovedContent.id_for(current_user, record_type, id, cohort_id: cohort_id)
  end

  def content_block_write_denial(enrollment, lesson, assignment, lesson_assignment)
    return "Module is not accessible" unless assignment&.accessible?(enrollment.cohort) || lesson_assignment.present?

    "Lesson is not unlocked yet" unless lesson.available?(enrollment.cohort, assignment, lesson_assignment)
  end

  def authorize_submission_window_open!(content_block, enrollment: nil, fresh: false)
    return if current_user.staff?

    lesson = content_block.lesson
    enrollment ||= active_enrollment_for_lesson(lesson)
    return unless enrollment

    if fresh
      enrollment.association(:learner_extensions).reset
      enrollment.association(:learning_plan).reset
      enrollment.cohort.cohort_module_submission_windows.reload
    end
    status = SubmissionWindowStatus.for_lesson(cohort: enrollment.cohort, lesson: lesson, enrollment: enrollment)
    return unless status[:submissions_closed]

    render_forbidden("Submissions for Week #{status[:week_number]} are closed")
  end

  def active_enrollment_for_lesson(lesson)
    curriculum_id = lesson.curriculum_module.curriculum_id
    cache_key = [ current_user.id, curriculum_id, params[:cohort_id] ]
    @active_enrollment_for_lesson_cache ||= {}
    return @active_enrollment_for_lesson_cache[cache_key] if @active_enrollment_for_lesson_cache.key?(cache_key)

    scope = current_user.enrollments
      .active
      .joins(:cohort)
      .includes(:module_assignments, :lesson_assignments, cohort: [ :cohort_module_schedules, :cohort_module_submission_windows ])
      .where(cohorts: { curriculum_id: curriculum_id })
    scope = scope.where(cohort_id: params[:cohort_id]) if params[:cohort_id].present?
    @active_enrollment_for_lesson_cache[cache_key] = scope.order(enrolled_at: :desc, id: :desc).first
  end
end
