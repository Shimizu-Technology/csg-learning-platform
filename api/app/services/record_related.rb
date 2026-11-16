# What a record page's related panel shows (L-0.4): the records connected to
# this one, each with a count or a short value, plus the names a record header
# needs for its breadcrumb. One request per record page, built for one viewer.
#
# Like RecordSummary (L-0.5), it answers nil when the viewer may not open the
# record, so the controller returns 404 and never confirms the record exists.
# Each record is authorized from its cohort id alone (a learner's lesson from
# its schedule columns alone) before anything else loads, so a record the
# viewer can't open costs at most one query more than one that doesn't exist.
# Rows carry ids and counts only, never message text, answers or feedback.
# Every count stays inside the record's cohort (or, for an unscoped staff
# lesson, the cohorts the viewer can access). A row whose feature is switched
# off for the cohort is left out; aggregate rows count only cohorts that have
# the feature on.
#
# Who sees what:
# - Staff: submissions, help requests, follow-up plans (interventions),
#   student workspaces and cohorts in cohorts they can access (admins: all),
#   and lessons, with counts limited to those cohorts.
# - Students: lessons they can open, with only their own work and help.
class RecordRelated
  TYPES = %w[submission help_request intervention lesson student cohort].freeze

  def self.for(viewer:, type:, id:, cohort_id: nil, student_id: nil)
    new(viewer: viewer, type: type, id: id, cohort_id: cohort_id, student_id: student_id).call
  end

  def initialize(viewer:, type:, id:, cohort_id:, student_id:)
    @viewer = viewer
    @type = type.to_s
    @id = positive_id(id)
    @cohort_id = cohort_id.presence && positive_id(cohort_id)
    @student_id = student_id.presence && positive_id(student_id)
    @invalid = (cohort_id.present? && @cohort_id.nil?) || (student_id.present? && @student_id.nil?)
  end

  def call
    return nil if @viewer.nil? || @viewer.archived? || @id.nil? || @invalid
    return nil unless TYPES.include?(@type)

    send("#{@type}_related")
  end

  private

  # --- Submissions (staff) ---------------------------------------------------

  def submission_related
    return nil unless @viewer.staff?

    return nil unless cohort_access?(Submission.joins(:enrollment).where(id: @id).pick("enrollments.cohort_id"))

    submission = Submission.includes(:user, enrollment: :cohort, content_block: { lesson: :curriculum_module }).find(@id)
    enrollment = submission.enrollment
    cohort = enrollment.cohort
    block = submission.content_block
    lesson = block.lesson
    features = FeatureSwitches.for(cohort: cohort)
    student = submission.user

    items = [
      item("lesson", value: lesson.title, lesson_id: lesson.id),
      item("module_grid", value: lesson.curriculum_module.name, cohort_id: cohort.id, module_id: lesson.module_id)
    ]
    items << item("rubric", count: block.rubric.rubric_criteria.size, value: block.rubric.title) if block.rubric
    # This enrollment only: the same learner's attempts in another cohort aren't this cohort's to show.
    attempts = Submission.where(enrollment_id: enrollment.id, user_id: student.id, content_block_id: block.id).where.not(id: submission.id)
    items << item("other_attempts", count: attempts.count)
    if features["help_requests"]
      help = student_help(student, cohort).where(context_type: :exercise, context_id: block.id)
        .or(student_help(student, cohort).where(context_type: :lesson, context_id: lesson.id))
      items << help_item("help", help, cohort)
    end
    items << conversation_item(cohort, student)

    result("submission", submission.id, items, cohort: cohort, student: student, lesson: lesson)
  end

  # --- Help requests (staff) -------------------------------------------------

  def help_request_related
    return nil unless @viewer.staff?

    return nil unless cohort_access?(HelpRequest.where(id: @id).pick(:cohort_id))

    request = HelpRequest.includes(:student, :cohort).find(@id)
    cohort = request.cohort
    student = request.student
    features = FeatureSwitches.for(cohort: cohort)
    lesson = help_request_lesson(request, cohort)

    items = []
    if lesson
      items << item("lesson", value: lesson.title, lesson_id: lesson.id)
    elsif request.context_type_recording? && features["recordings"] && cohort.recordings.exists?(id: request.context_id)
      items << item("recording", recording_id: request.context_id, cohort_id: cohort.id)
    end
    if features["interventions"]
      plans = Intervention.joins(:enrollment).where(help_request_id: request.id, enrollments: { cohort_id: cohort.id })
      latest = plans.order(created_at: :desc, id: :desc).pick(:id)
      items << item("follow_up", count: plans.count, intervention_id: latest)
    end
    items << conversation_item(cohort, student)
    if features["help_requests"]
      items << item("other_requests", count: student_help(student, cohort).where.not(id: request.id).count, cohort_id: cohort.id, user_id: student.id)
    end

    result("help_request", request.id, items, cohort: cohort, student: student, lesson: lesson)
  end

  # The lesson the request was asked from, only when it's on the cohort's curriculum.
  def help_request_lesson(request, cohort)
    lesson = case request.context_type
    when "lesson" then Lesson.includes(:curriculum_module).find_by(id: request.context_id)
    when "exercise" then ContentBlock.includes(lesson: :curriculum_module).find_by(id: request.context_id)&.lesson
    end
    lesson if lesson&.curriculum_module&.curriculum_id == cohort.curriculum_id
  end

  # --- Follow-up plans, stored as interventions (staff) ---------------------

  def intervention_related
    return nil unless @viewer.staff?

    return nil unless cohort_access?(Intervention.joins(:enrollment).where(id: @id).pick("enrollments.cohort_id"))

    intervention = Intervention.includes(enrollment: [ :user, :cohort ]).find(@id)
    enrollment = intervention.enrollment
    cohort = enrollment.cohort
    student = enrollment.user
    features = FeatureSwitches.for(cohort: cohort)
    plan = RecoveryPlan.where(intervention_id: intervention.id).order(created_at: :desc, id: :desc).first

    items = [
      item("evidence", count: (intervention.evidence_snapshot || {}).size),
      item("recovery_plan", count: plan ? 1 : 0, value: plan&.status&.humanize)
    ]
    if features["help_requests"]
      linked = intervention.help_request_id && HelpRequest.where(id: intervention.help_request_id, cohort_id: cohort.id).pick(:id)
      items << item("help_request", count: linked ? 1 : 0, help_request_id: linked)
    end
    items << conversation_item(cohort, student)

    result("intervention", intervention.id, items, cohort: cohort, student: student)
  end

  # --- Lessons ---------------------------------------------------------------

  # The asked-for cohort and learner are checked before the lesson loads. A
  # learner's access is decided from the lesson's schedule columns alone
  # (LessonReadAccess.lookup); its title and module name load only once allowed.
  def lesson_related
    if @viewer.staff?
      return nil if @cohort_id && !cohort_access?(@cohort_id)
      return nil if @student_id && !@cohort_id

      @id = moved_lesson_id
      lesson = Lesson.eager_load(:curriculum_module).find_by(id: @id)
      return nil unless lesson&.curriculum_module

      @student_id ? previewed_lesson_related(lesson) : staff_lesson_related(lesson)
    else
      return nil if @student_id && @student_id != @viewer.id

      @id = moved_lesson_id

      access = LessonReadAccess.lookup(@viewer, @id, cohort_id: @cohort_id)
      return nil unless access&.allowed? && access.enrollment

      lesson = Lesson.eager_load(:curriculum_module).find_by(id: @id)
      enrollment = Enrollment.includes(*LessonReadAccess::ENROLLMENT_INCLUDES).find_by(id: access.enrollment.id)
      return nil unless lesson&.curriculum_module && enrollment

      learner_lesson_related(lesson, enrollment)
    end
  end

  # An old id from before "Make a copy for this cohort" (MovedContent).
  def moved_lesson_id
    MovedContent.id_for(@viewer, "Lesson", @id, cohort_id: @cohort_id)
  end

  # Staff previewing the learner view as one enrolled student see that
  # student's rows, but only in a cohort they can access (checked in lesson_related).
  def previewed_lesson_related(lesson)
    cohort = Cohort.find_by(id: @cohort_id)
    return nil unless cohort && cohort.curriculum_id == lesson.curriculum_module.curriculum_id

    enrollment = Enrollment.with_read_access.includes(:cohort).find_by(cohort_id: cohort.id, user_id: @student_id)
    return nil unless enrollment

    learner_lesson_related(lesson, enrollment)
  end

  def learner_lesson_related(lesson, enrollment)
    cohort = enrollment.cohort
    features = FeatureSwitches.for(cohort: cohort)
    capabilities = EnrollmentCapabilities.for(enrollment, features: features)
    blocks = lesson.content_blocks.order(:position).to_a
    work_blocks = blocks.select(&:gradable_work_block?)
    latest = latest_submissions(enrollment, blocks.map(&:id))
    review = LessonReviewStatus.for(lesson, latest)

    items = [
      item("your_work", count: latest.size, value: review, content_block_id: work_blocks.first&.id, work_count: work_blocks.size)
    ]
    if capabilities[:support_mode] != "none"
      help = HelpRequest.where(student_id: enrollment.user_id, cohort_id: cohort.id)
      help = help.where(context_type: :lesson, context_id: lesson.id).or(help.where(context_type: :exercise, context_id: blocks.map(&:id)))
      items << help_item("help", help, cohort)
    end
    if features["recordings"] && !cohort.self_paced?
      items << item("recordings", count: cohort.recordings.student_visible.count, cohort_id: cohort.id)
    end

    result("lesson", lesson.id, items, cohort: cohort, lesson: lesson, view: "learner")
  end

  def staff_lesson_related(lesson)
    curriculum_id = lesson.curriculum_module.curriculum_id
    if @cohort_id
      cohort = Cohort.find_by(id: @cohort_id)
      return nil unless cohort && cohort.curriculum_id == curriculum_id

      cohorts = [ cohort ]
    else
      cohort = nil
      cohorts = @viewer.accessible_cohorts.where(curriculum_id: curriculum_id).to_a
    end

    cohort_ids = cohorts.map(&:id)
    block_ids = lesson.content_blocks.pluck(:id)
    work_ids = lesson.content_blocks.select(&:gradable_work_block?).map(&:id)
    enrollment_ids = Enrollment.with_read_access.where(cohort_id: cohort_ids).pluck(:id)
    # Each cohort's own switches: help counts only where help is on.
    school = FeatureSwitches.school
    help_cohort_ids = cohorts.select { |each| FeatureSwitches.for(cohort: each, school: school)["help_requests"] }.map(&:id)

    items = [
      item("waiting_review", count: waiting_count(enrollment_ids, work_ids), cohort_id: cohort&.id)
    ]
    if help_cohort_ids.any?
      help = HelpRequest.active_queue.where(cohort_id: help_cohort_ids)
      help = help.where(context_type: :lesson, context_id: lesson.id).or(help.where(context_type: :exercise, context_id: block_ids))
      items << item("open_help", count: help.count, cohort_id: cohort&.id)
    end
    if cohort && FeatureSwitches.for(cohort: cohort, school: school)["recordings"]
      items << item("recordings", count: cohort.recordings.student_visible.count, cohort_id: cohort.id)
    end
    items << item("used_in", count: cohort_ids.size) unless cohort

    result("lesson", lesson.id, items, cohort: cohort, lesson: lesson, view: "staff")
  end

  # --- Student workspaces: one learner in one cohort (staff) ---------------

  def student_related
    return nil unless @viewer.staff? && cohort_access?(@cohort_id)

    cohort = Cohort.find_by(id: @cohort_id)
    return nil unless cohort

    enrollment = Enrollment.joins(:user).merge(User.where(role: :student)).includes(:user).find_by(cohort_id: cohort.id, user_id: @id)
    return nil unless enrollment

    student = enrollment.user
    features = FeatureSwitches.for(cohort: cohort)
    items = [ item("cohort", value: cohort.name, cohort_id: cohort.id) ]
    items << help_item("help_requests", student_help(student, cohort), cohort) if features["help_requests"]
    if features["interventions"]
      items << item("follow_ups", count: Intervention.active.where(enrollment_id: enrollment.id).count, cohort_id: cohort.id, user_id: student.id)
    end
    items << conversation_item(cohort, student)
    if features["private_meetings"]
      upcoming = PrivateMeetingBooking.confirmed.where(enrollment_id: enrollment.id).where(ends_at: Time.current..)
      items << item("meetings", count: upcoming.count, starts_at: upcoming.minimum(:starts_at)&.iso8601, cohort_id: cohort.id)
    end
    others = Enrollment.with_read_access.where(user_id: student.id, cohort_id: @viewer.accessible_cohorts.select(:id))
      .where.not(id: enrollment.id).order(enrolled_at: :desc, id: :desc)
    items << item("other_enrollments", count: others.count, cohort_id: others.pick(:cohort_id), user_id: student.id)

    result("student", student.id, items, cohort: cohort, student: student)
  end

  # --- Cohorts (staff) -------------------------------------------------------

  def cohort_related
    return nil unless @viewer.staff? && cohort_access?(@id)

    cohort = Cohort.find_by(id: @id)
    return nil unless cohort

    features = FeatureSwitches.for(cohort: cohort)
    enrollment_ids = Enrollment.with_read_access.where(cohort_id: cohort.id).pluck(:id)
    work_ids = ContentBlock.joins(:lesson).where(lessons: { module_id: CurriculumModule.where(curriculum_id: cohort.curriculum_id).select(:id) }).to_a.select(&:gradable_work_block?).map(&:id)

    items = [
      item("students", count: Enrollment.active.where(cohort_id: cohort.id).count, cohort_id: cohort.id),
      item("waiting_review", count: waiting_count(enrollment_ids, work_ids), cohort_id: cohort.id)
    ]
    items << item("open_help", count: HelpRequest.active_queue.where(cohort_id: cohort.id).count, cohort_id: cohort.id) if features["help_requests"]
    if features["interventions"]
      items << item("follow_ups", count: Intervention.active.joins(:enrollment).where(enrollments: { cohort_id: cohort.id }).count, cohort_id: cohort.id)
    end
    items << item("recordings", count: cohort.recordings.count, cohort_id: cohort.id) if features["recordings"]
    items << item("updates", count: cohort.announcements.count, cohort_id: cohort.id) if features["announcements"]

    result("cohort", cohort.id, items, cohort: cohort)
  end

  # --- Helpers ---------------------------------------------------------------

  # Staff access to a cohort from its id alone (User#can_access_cohort? for
  # staff), so nothing about the cohort or the record loads before it passes.
  # At most one query; none for admins or a missing id.
  def cohort_access?(cohort_id)
    return false unless cohort_id && @viewer.staff?

    @viewer.admin? || @viewer.cohort_instructor_assignments.exists?(cohort_id: cohort_id)
  end

  def student_help(student, cohort)
    HelpRequest.where(student_id: student.id, cohort_id: cohort.id)
  end

  # Total requests, with how many are still open, and the one to open when there is only one.
  def help_item(key, scope, cohort)
    rows = scope.pluck(:id, :status)
    open = rows.count { |_, status| %w[open acknowledged].include?(status) }
    item(key, count: rows.size, open_count: open, help_request_id: rows.size == 1 ? rows.first.first : nil, cohort_id: cohort.id)
  end

  # The viewer's own direct conversation with the learner in this cohort, if one exists.
  def conversation_item(cohort, student)
    workspace_id = cohort.workspace&.id
    conversation = workspace_id && DirectConversation.visible_for(@viewer)
      .find_by(workspace_id: workspace_id, member_key: DirectConversation.member_key_for([ @viewer.id, student.id ]))
    last = conversation && Message.where(direct_conversation_id: conversation.id, deleted_at: nil).maximum(:created_at)
    item("conversation", direct_conversation_id: conversation&.id, cohort_id: cohort.id, user_id: student.id, last_message_at: last&.iso8601)
  end

  def latest_submissions(enrollment, block_ids)
    return {} if block_ids.empty?

    latest_ids = Submission.where(enrollment_id: enrollment.id, content_block_id: block_ids)
      .select("DISTINCT ON (content_block_id) id").order(:content_block_id, created_at: :desc, id: :desc)
    Submission.where(id: latest_ids).index_by(&:content_block_id)
  end

  # Latest attempts with no grade yet, one per learner per piece of work.
  def waiting_count(enrollment_ids, block_ids)
    return 0 if enrollment_ids.empty? || block_ids.empty?

    latest_ids = Submission.where(enrollment_id: enrollment_ids, content_block_id: block_ids)
      .select("DISTINCT ON (enrollment_id, user_id, content_block_id) id")
      .order(:enrollment_id, :user_id, :content_block_id, created_at: :desc, id: :desc)
    Submission.where(id: latest_ids, grade: nil).count
  end

  def item(key, count: nil, value: nil, **ids)
    { key: key, count: count, value: value }.merge(ids)
  end

  def result(type, id, items, cohort: nil, student: nil, lesson: nil, view: nil)
    context = {}
    context[:cohort] = { id: cohort.id, name: cohort.name } if cohort
    context[:student] = { id: student.id, name: student.full_name } if student
    if lesson
      context[:lesson] = { id: lesson.id, title: lesson.title }
      context[:module] = { id: lesson.module_id, name: lesson.curriculum_module.name }
    end
    { type: type, id: id, view: view, context: context, items: items }.compact
  end

  def positive_id(value)
    id = Integer(value.to_s, 10, exception: false)
    id if id&.positive?
  end
end
