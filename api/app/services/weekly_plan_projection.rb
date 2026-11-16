class WeeklyPlanProjection
  TIMEZONE = LearningCalendar::TIMEZONE
  RECORDING_LIMIT = 3
  UPCOMING_UNLOCK_LIMIT = 5

  def initialize(user, now: Time.current, cohort_id: nil, record_open: true, progress: nil)
    @user = user
    @cohort_id = cohort_id
    @record_open = record_open
    @given_progress = progress
    @now = now
    @zone = Time.find_zone!(TIMEZONE)
    @today = LearningCalendar.today(at: now)
    @week_start = @today.beginning_of_week(:monday)
    @week_end = @week_start + 6.days
  end

  def call
    enrollment = active_enrollment
    return { enrolled: false, timezone: TIMEZONE } unless enrollment

    @enrollment = enrollment
    enrollment.record_first_course_open! if @record_open
    @cohort = enrollment.cohort
    progress = @given_progress if @given_progress&.enrollment&.id == enrollment.id
    content = progress&.content || AssignedLearningContent.new(enrollment)
    @module_assignments = content.module_assignments
    @lesson_assignments = content.lesson_assignments
    @modules = content.modules
    @lessons = @modules.flat_map { |mod| content.lessons_for(mod).map { |lesson| [ mod, lesson ] } }
    @progress = progress || LearnerProgress.new(enrollment, content: content, now: @now)

    @personal_plan = LearningPlanProjection.new(enrollment, progress: @progress).call if @progress.plan

    return library_plan if @cohort.alumni?
    return self_paced_plan if @cohort.self_paced?

    lesson_items = @lessons.filter_map { |mod, lesson| lesson_item(mod, lesson) }
    required = sort_lesson_items(lesson_items.select { |item| item[:required] })
    optional = sort_lesson_items(lesson_items.reject { |item| item[:required] })

    {
      enrolled: true,
      personal_plan: @personal_plan,
      capabilities: EnrollmentCapabilities.for(@enrollment),
      cohort: { id: @cohort.id, name: @cohort.name },
      week_number: cohort_week_number,
      starts_on: @week_start,
      ends_on: @week_end,
      timezone: TIMEZONE,
      generated_at: @now,
      summary: summary(required, optional),
      required: required,
      optional: optional,
      redos: redo_items,
      events: event_items,
      upcoming_unlocks: upcoming_unlock_items,
      recording_catch_up: recording_items
    }
  end

  private

  def self_paced_plan
    next_lesson = @progress.next_lesson
    # Installed clients still select the library card from mode + library_summary.
    library_plan.merge(
      plan_kind: "self_paced",
      course_overview: {
        course_name: @cohort.curriculum.name,
        next_lesson: @personal_plan ? @personal_plan[:next_lesson] : next_lesson && { lesson_id: next_lesson.id, title: next_lesson.title, module_id: next_lesson.module_id }
      },
      redos: redo_items
    )
  end

  def library_plan
    {
      enrolled: true,
      personal_plan: @personal_plan,
      mode: "library",
      capabilities: EnrollmentCapabilities.for(@enrollment),
      cohort: { id: @cohort.id, name: @cohort.name },
      timezone: TIMEZONE,
      generated_at: @now,
      library_summary: {
        module_count: @modules.size,
        lesson_count: @lessons.size,
        recording_count: recorded_lesson_count
      },
      events: @cohort.self_paced? ? [] : event_items,
      recording_catch_up: recording_items
    }
  end

  def recorded_lesson_count
    @lessons.count do |_mod, lesson|
      lesson.content_blocks.any? { |block| block.video? || block.recording? }
    end
  end

  def active_enrollment
    scope = @user.enrollments
    enrollment = if @cohort_id
      scope.with_read_access.where(cohort_id: @cohort_id).first
    else
      scope.active.first || scope.with_read_access.where(status: :paused).first
    end
    return unless enrollment

    # Select through the normal access scope before reusing a caller's snapshot.
    # Loaded associations must survive writes that invalidate the SQL query cache.
    return @given_progress.enrollment if @given_progress&.enrollment&.id == enrollment.id

    ActiveRecord::Associations::Preloader.new(records: [ enrollment ], associations: [
      :module_assignments,
      :lesson_assignments,
      cohort: [
        :cohort_module_schedules,
        :cohort_module_submission_windows,
        :office_hours,
        :recordings,
        { curriculum: { modules: { lessons: :content_blocks } } }
      ]
    ]).call
    enrollment
  end

  def lesson_item(mod, lesson)
    unlock_on = personal_target_on(lesson) || lesson_unlock_on(lesson)
    return unless unlock_on

    progress = @progress.lesson_progress(lesson)
    in_current_week = unlock_on.between?(@week_start, @week_end)
    carried_forward = unlock_on < @week_start && !progress.completed && progress.available
    return unless in_current_week || carried_forward

    window = progress.submission_window
    {
      id: "lesson-#{lesson.id}",
      kind: "lesson",
      lesson_id: lesson.id,
      module_id: mod.id,
      title: lesson.title,
      module_title: mod.name,
      lesson_type: lesson.lesson_type,
      required: progress.required,
      scheduled_for: unlock_on,
      carried_forward: carried_forward,
      state: lesson_state(progress),
      learner_status: progress.status,
      review_status: progress.review_status,
      submission_close_at: window[:submissions_close_at],
      submissions_closed: window[:submissions_closed]
    }
  end

  def personal_target_on(lesson)
    return unless @progress.plan

    milestone = @progress.plan.milestones.find { |item| item["lesson_ids"].include?(lesson.id) }
    Date.iso8601(milestone["due_on"]) if milestone
  end

  def lesson_unlock_on(lesson)
    assignment = @lesson_assignments[lesson.id]
    lesson.assigned_unlock_date(@cohort, @module_assignments[lesson.module_id], assignment)
  end

  # The weekly plan's coarse state; clients add review_status for the learner status.
  def lesson_state(progress)
    return "completed" if progress.completed
    return "upcoming" unless progress.available
    return "closed" if progress.submission_window[:submissions_closed]

    "open"
  end

  def summary(required, optional)
    {
      required_count: required.size,
      required_completed_count: required.count { |item| item[:state] == "completed" },
      open_redo_count: redo_items.count { |item| item[:state] == "open" },
      optional_count: optional.size
    }
  end

  def sort_lesson_items(items)
    items.sort_by do |item|
      [ item[:carried_forward] ? 0 : 1, item[:scheduled_for], item[:module_id], item[:lesson_id] ]
    end
  end

  def redo_items
    @redo_items ||= @progress.redo_submissions.map do |submission|
      lesson = submission.content_block.lesson
      window = SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: lesson, at: @now)
      {
        id: "redo-#{submission.id}",
        kind: "redo",
        submission_id: submission.id,
        content_block_id: submission.content_block_id,
        lesson_id: lesson.id,
        title: submission.content_block.title.presence || lesson.title,
        lesson_title: lesson.title,
        feedback: submission.feedback,
        state: window[:submissions_closed] ? "closed" : "open",
        submission_close_at: window[:submissions_close_at]
      }
    end
  end

  def event_items
    return [] unless FeatureSwitches.for(cohort: @cohort)["office_hours"]

    week_start_time = @zone.local(@week_start.year, @week_start.month, @week_start.day).beginning_of_day
    week_end_time = @zone.local(@week_end.year, @week_end.month, @week_end.day).end_of_day
    OfficeHourSerializer.active_for(@cohort).flat_map do |scheduled_event|
      scheduled_event.upcoming_occurrences(limit: 10, from: week_start_time).filter_map do |occurrence|
        next unless occurrence[:starts_at] <= week_end_time && occurrence[:ends_at] >= @now

        OfficeHourSerializer.occurrence_json(scheduled_event, occurrence).merge(
          id: "event-#{scheduled_event.id}-#{occurrence[:starts_at].to_i}",
          kind: scheduled_event.event_kind
        )
      end
    end.sort_by { |item| item[:starts_at] }
  end

  def upcoming_unlock_items
    @lessons.filter_map do |mod, lesson|
      unlock_on = lesson_unlock_on(lesson)
      next unless unlock_on && unlock_on > @today

      {
        id: "unlock-#{lesson.id}",
        kind: "unlock",
        lesson_id: lesson.id,
        module_id: mod.id,
        title: lesson.title,
        module_title: mod.name,
        unlocks_on: unlock_on,
        required: @progress.required?(lesson)
      }
    end.sort_by { |item| [ item[:unlocks_on], item[:module_id], item[:lesson_id] ] }.first(UPCOMING_UNLOCK_LIMIT)
  end

  def recording_items
    return [] unless FeatureSwitches.for(cohort: @cohort)["recordings"]

    recordings = @cohort.recordings.select { |recording| @enrollment.recording_available_for_read?(recording) }
    progress = @user.watch_progresses.where(recording_id: recordings.map(&:id)).index_by(&:recording_id)
    recordings.reject { |recording| progress[recording.id]&.completed? }
      .sort_by { |recording| [ recording.recorded_date || recording.created_at.to_date, recording.id ] }
      .reverse
      .first(RECORDING_LIMIT)
      .map do |recording|
        watch = progress[recording.id]
        {
          id: "recording-#{recording.id}",
          kind: "recording",
          recording_id: recording.id,
          cohort_id: @cohort.id,
          title: recording.title,
          recorded_on: recording.recorded_date,
          progress_percentage: watch&.progress_percentage || 0
        }
      end
  end

  def cohort_week_number
    [ ((@week_start - @cohort.start_date).to_i / 7) + 1, 1 ].max
  end
end
