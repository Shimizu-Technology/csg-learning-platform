# The few facts a peek card shows about a record (L-0.5): an identity line,
# four facts and what the viewer may do next. Built for one viewer; nil when
# the viewer may not open the record, so the controller answers 404 and never
# confirms the record exists.
#
# Who sees what:
# - Students peek only at lessons they can open, and only their own progress.
#   They never get a summary of a learner or a cohort's roster.
# - Staff peek at learners and cohorts in cohorts they can access (admins: all),
#   and at lessons, with counts limited to those cohorts.
class RecordSummary
  TYPES = %w[student lesson cohort].freeze

  def self.for(viewer:, type:, id:, cohort_id: nil, now: Time.current)
    new(viewer: viewer, type: type, id: id, cohort_id: cohort_id, now: now).call
  end

  def initialize(viewer:, type:, id:, cohort_id:, now:)
    @viewer = viewer
    @type = type.to_s
    @id = positive_id(id)
    @cohort_id = cohort_id.presence && positive_id(cohort_id)
    @invalid_cohort = cohort_id.present? && @cohort_id.nil?
    @now = now
  end

  def call
    return nil if @viewer.nil? || @viewer.archived? || @id.nil? || @invalid_cohort
    return nil unless TYPES.include?(@type)

    case @type
    when "student" then student_summary
    when "lesson" then lesson_summary
    when "cohort" then cohort_summary
    end
  end

  private

  # --- Learners (staff only) -------------------------------------------------

  def student_summary
    return nil unless @viewer.staff?

    enrollment = staff_enrollment_for(@id)
    return nil unless enrollment

    row = AttentionProjection.new(now: @now, enrollment_scope: Enrollment.where(id: enrollment.id)).call[:enrollments].first
    return nil unless row

    user = enrollment.user
    {
      type: "student",
      id: user.id,
      title: user.full_name,
      handle: user.handle,
      avatar_url: user.avatar_url,
      cohort_id: enrollment.cohort_id,
      cohort_name: enrollment.cohort.name,
      subtitle: enrollment.cohort.name,
      last_active_at: row[:last_activity_at],
      facts: [
        fact("progress", "lessons done", row[:total_lessons].positive? ? "#{row[:completed_lessons]} / #{row[:total_lessons]}" : "None assigned"),
        fact("waiting_review", "waiting for review", row[:ungraded_count], attention: row[:ungraded_count].positive?),
        fact("open_help", "open help", row[:help_request_count], attention: row[:help_request_count].positive?),
        fact("status", "status", row[:status_label], attention: row[:needs_attention])
      ]
    }
  end

  def staff_enrollment_for(user_id)
    enrollments = Enrollment.joins(:user).merge(User.where(role: :student)).where(user_id: user_id)
      .includes(:user, :cohort)
    if @cohort_id
      cohort = Cohort.find_by(id: @cohort_id)
      return nil unless @viewer.can_access_cohort?(cohort)

      enrollments.find_by(cohort_id: cohort.id)
    else
      enrollments.where(cohort_id: @viewer.accessible_cohorts.select(:id))
        .order(Arel.sql("CASE WHEN enrollments.status = #{Enrollment.statuses.fetch('active')} THEN 0 ELSE 1 END"), enrolled_at: :desc, id: :desc)
        .first
    end
  end

  # --- Lessons ---------------------------------------------------------------

  # Authorizes before loading anything a peek shows, so a lesson the viewer may
  # not open costs at most one query more than one that doesn't exist. Staff
  # can read every lesson, so theirs loads first and is then checked against
  # the cohorts they may count. A learner's access is decided from the lesson's
  # schedule columns alone (LessonReadAccess.lookup).
  def lesson_summary
    # An old id from before "Make a copy for this cohort" (MovedContent).
    @id = MovedContent.id_for(@viewer, "Lesson", @id, cohort_id: @cohort_id)
    if @viewer.staff?
      lesson = Lesson.eager_load(:curriculum_module).find_by(id: @id)
      return nil unless lesson&.curriculum_module

      cohorts = staff_lesson_cohorts(lesson)
      return nil unless cohorts

      preload_lesson(lesson)
      staff_lesson_summary(lesson, cohorts)
    else
      access = LessonReadAccess.lookup(@viewer, @id, cohort_id: @cohort_id)
      return nil unless access&.allowed? && access.enrollment

      lesson = Lesson.eager_load(:curriculum_module).find_by(id: @id)
      enrollment = Enrollment.includes(*LessonReadAccess::ENROLLMENT_INCLUDES).find_by(id: access.enrollment.id)
      return nil unless lesson&.curriculum_module && enrollment

      preload_lesson(lesson)
      learner_lesson_summary(lesson, enrollment)
    end
  end

  def preload_lesson(lesson)
    ActiveRecord::Associations::Preloader.new(records: [ lesson ], associations: [ :content_blocks, { curriculum_module: :curriculum } ]).call
  end

  # Cohorts on the lesson's curriculum the staff viewer may count, or nil when
  # they asked about a cohort they can't access.
  def staff_lesson_cohorts(lesson)
    curriculum_id = lesson.curriculum_module.curriculum_id
    return @viewer.accessible_cohorts.where(curriculum_id: curriculum_id) unless @cohort_id

    cohort = Cohort.find_by(id: @cohort_id)
    return nil unless @viewer.can_access_cohort?(cohort)

    Cohort.where(id: cohort.id, curriculum_id: curriculum_id)
  end

  def staff_lesson_summary(lesson, cohorts)
    cohort_ids = cohorts.pluck(:id)
    enrollments = Enrollment.with_read_access.where(cohort_id: cohort_ids).to_a
    enrollment_ids = enrollments.map(&:id)

    work_ids = lesson.content_blocks.select(&:gradable_work_block?).map(&:id)
    latest = latest_grades(enrollment_ids, work_ids)
    completion_ids = lesson.completion_block_ids
    finished = completion_ids.any? ? finished_count(enrollments, lesson) : 0
    help = lesson_help_scope(lesson, cohort_ids).count
    single = cohorts.first if @cohort_id

    {
      type: "lesson",
      id: lesson.id,
      title: lesson.title,
      subtitle: lesson_subtitle(lesson),
      module_id: lesson.module_id,
      module_name: lesson.curriculum_module.name,
      cohort_id: single&.id,
      cohort_name: single&.name,
      archived: lesson.archived?,
      facts: [
        fact("waiting_review", "waiting for review", latest.count(&:nil?), attention: latest.any?(&:nil?)),
        fact("redo_open", "redo open", latest.count("R")),
        fact("open_help", "open help", help, attention: help.positive?),
        fact("finished", "learners finished", completion_ids.any? ? "#{finished} / #{enrollment_ids.size}" : "Nothing to finish")
      ]
    }
  end

  # The learner's own standing in the lesson, exactly as Learn and the lesson
  # page show it (LearnerProgress).
  def learner_lesson_summary(lesson, enrollment)
    progress = LearnerProgress.for_all([ enrollment ], now: @now).fetch(enrollment.id)
    assigned = progress.lessons.find { |candidate| candidate.id == lesson.id }
    entry = assigned && progress.lesson_progress(assigned)
    review = entry&.review_status

    {
      type: "lesson",
      id: lesson.id,
      title: lesson.title,
      subtitle: lesson_subtitle(lesson),
      module_id: lesson.module_id,
      module_name: lesson.curriculum_module.name,
      cohort_id: enrollment.cohort_id,
      cohort_name: enrollment.cohort.name,
      archived: false,
      facts: [
        fact("lesson_type", "type", lesson.lesson_type.humanize),
        fact("progress", "steps done", entry&.total_blocks&.positive? ? "#{entry.completed_blocks} / #{entry.total_blocks}" : "Nothing to finish"),
        fact("review", "your work", review ? review.humanize : "Nothing submitted", attention: review == LessonReviewStatus::REDO_REQUESTED),
        fact("required", "in your plan", (entry ? entry.required : lesson.required?) ? "Required" : "Optional")
      ]
    }
  end

  def lesson_subtitle(lesson)
    [ lesson.curriculum_module.name, lesson.curriculum_module.curriculum&.name, (lesson.archived? ? "Archived" : nil) ].compact.join(" · ")
  end

  # Grades of each learner's latest attempt on the lesson's gradable work (nil = waiting).
  def latest_grades(enrollment_ids, block_ids)
    return [] if enrollment_ids.empty? || block_ids.empty?

    latest_ids = Submission.where(enrollment_id: enrollment_ids, content_block_id: block_ids)
      .select("DISTINCT ON (enrollment_id, user_id, content_block_id) id")
      .order(:enrollment_id, :user_id, :content_block_id, created_at: :desc, id: :desc)
    Submission.where(id: latest_ids).pluck(:grade)
  end

  # Learners whose every step in the lesson is handed in, by the learner's own
  # definition (LearnerProgress): a redo is not finished even when an old
  # progress row says completed.
  def finished_count(enrollments, lesson)
    LearnerProgress.for_all(enrollments, now: @now).values.count do |progress|
      assigned = progress.lessons.find { |candidate| candidate.id == lesson.id }
      assigned && progress.lesson_progress(assigned).completed
    end
  end

  def lesson_help_scope(lesson, cohort_ids)
    block_ids = lesson.content_blocks.map(&:id)
    scope = HelpRequest.active_queue.where(cohort_id: cohort_ids)
    scope.where(context_type: :lesson, context_id: lesson.id)
      .or(scope.where(context_type: :exercise, context_id: block_ids))
  end

  # --- Cohorts (staff only) --------------------------------------------------

  def cohort_summary
    return nil unless @viewer.staff?

    cohort = Cohort.includes(:curriculum).find_by(id: @id)
    return nil unless cohort && @viewer.can_access_cohort?(cohort)

    projection = AttentionProjection.new(now: @now, enrollment_scope: Enrollment.active.where(cohort_id: cohort.id)).call
    rows = projection[:enrollments]
    next_event = OfficeHourSerializer.upcoming(OfficeHourSerializer.active_for(cohort), limit: 1).first

    {
      type: "cohort",
      id: cohort.id,
      title: cohort.name,
      subtitle: cohort_subtitle(cohort),
      status: cohort.status,
      facts: [
        fact("students", "active students", rows.size),
        fact("needs_attention", "need attention", projection.dig(:summary, :student_count), attention: projection.dig(:summary, :student_count).positive?),
        fact("waiting_review", "to grade", projection.dig(:summary, :ungraded_count)),
        next_event ? fact("next_event", next_event[:title].presence || "next session", next_event[:starts_at], kind: "time") : fact("next_event", "next session", "None scheduled")
      ]
    }
  end

  def cohort_subtitle(cohort)
    week = cohort_week(cohort)
    delivery = cohort.self_paced? ? "Self-paced" : cohort.status.humanize
    [ cohort.curriculum&.name, delivery, week ].compact.join(" · ")
  end

  def cohort_week(cohort)
    return nil unless cohort.active? && cohort.start_date && !cohort.self_paced?

    today = LearningCalendar.today(at: @now)
    return nil if today < cohort.start_date

    week = ((today - cohort.start_date).to_i / 7) + 1
    total = cohort.end_date && (((cohort.end_date - cohort.start_date).to_i / 7) + 1)
    total && week <= total ? "Week #{week} of #{total}" : "Week #{week}"
  end

  # --- Helpers ---------------------------------------------------------------

  def fact(key, label, value, attention: false, kind: nil)
    { key: key, label: label, value: value, kind: kind || (value.is_a?(Numeric) ? "count" : "text"), attention: attention }
  end

  def positive_id(value)
    id = Integer(value.to_s, 10, exception: false)
    id if id&.positive?
  end
end
