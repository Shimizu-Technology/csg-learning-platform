class WeeklyPlanProjection
  TIMEZONE = LearningCalendar::TIMEZONE
  RECORDING_LIMIT = 3
  UPCOMING_UNLOCK_LIMIT = 5

  def initialize(user, now: Time.current)
    @user = user
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
    @cohort = enrollment.cohort
    @module_assignments = enrollment.module_assignments.index_by(&:module_id)
    @lesson_assignments = enrollment.lesson_assignments.index_by(&:lesson_id)
    @modules = assigned_modules
    @lessons = @modules.flat_map { |mod| mod.lessons.map { |lesson| [ mod, lesson ] } }
    @completed_block_ids = completed_block_ids
    @latest_submissions = latest_submissions

    lesson_items = @lessons.filter_map { |mod, lesson| lesson_item(mod, lesson) }
    required = sort_lesson_items(lesson_items.select { |item| item[:required] })
    optional = sort_lesson_items(lesson_items.reject { |item| item[:required] })

    {
      enrolled: true,
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

  def active_enrollment
    @user.enrollments.active.includes(
      :module_assignments,
      :lesson_assignments,
      cohort: [
        :cohort_module_schedules,
        :cohort_module_submission_windows,
        :office_hours,
        :recordings,
        { curriculum: { modules: { lessons: :content_blocks } } }
      ]
    ).first
  end

  def assigned_modules
    assignment_ids = @module_assignments.keys
    @cohort.curriculum.modules.select { |mod| assignment_ids.include?(mod.id) }
  end

  def completed_block_ids
    ids = @lessons.flat_map { |_mod, lesson| lesson.completion_block_ids }
    @user.progresses.completed.where(content_block_id: ids).pluck(:content_block_id).to_set
  end

  def latest_submissions
    ids = @lessons.flat_map { |_mod, lesson| lesson.content_blocks.map(&:id) }
    latest_ids = @user.submissions.where(content_block_id: ids).group(:content_block_id).maximum(:id).values
    @user.submissions.where(id: latest_ids).includes(content_block: :lesson).index_by(&:content_block_id)
  end

  def lesson_item(mod, lesson)
    unlock_on = lesson_unlock_on(lesson)
    completed = lesson_completed?(lesson)
    in_current_week = unlock_on.between?(@week_start, @week_end)
    carried_forward = unlock_on < @week_start && !completed && lesson_available?(lesson)
    return unless in_current_week || carried_forward

    window = SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: lesson, at: @now)
    {
      id: "lesson-#{lesson.id}",
      kind: "lesson",
      lesson_id: lesson.id,
      module_id: mod.id,
      title: lesson.title,
      module_title: mod.name,
      lesson_type: lesson.lesson_type,
      required: lesson.required?,
      scheduled_for: unlock_on,
      carried_forward: carried_forward,
      state: lesson_state(completed: completed, available: lesson_available?(lesson), window: window),
      submission_close_at: window[:submissions_close_at],
      submissions_closed: window[:submissions_closed]
    }
  end

  def lesson_unlock_on(lesson)
    assignment = @lesson_assignments[lesson.id]
    assignment&.unlock_date_override || lesson.unlock_date(@cohort, @module_assignments[lesson.module_id])
  end

  def lesson_available?(lesson)
    lesson.available?(
      @cohort,
      @module_assignments[lesson.module_id],
      @lesson_assignments[lesson.id],
      on: @today
    )
  end

  def lesson_completed?(lesson)
    ids = lesson.completion_block_ids
    ids.any? && ids.all? { |id| @completed_block_ids.include?(id) }
  end

  def lesson_state(completed:, available:, window:)
    return "completed" if completed
    return "upcoming" unless available
    return "closed" if window[:submissions_closed]

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
    @redo_items ||= @latest_submissions.values.select { |submission| submission.grade == "R" }
      .sort_by { |submission| submission.graded_at || Time.zone.at(0) }
      .reverse
      .map do |submission|
        lesson = submission.content_block.lesson
        window = SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: lesson, at: @now)
        {
          id: "redo-#{submission.id}",
          kind: "redo",
          submission_id: submission.id,
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
      next unless unlock_on > @today

      {
        id: "unlock-#{lesson.id}",
        kind: "unlock",
        lesson_id: lesson.id,
        module_id: mod.id,
        title: lesson.title,
        module_title: mod.name,
        unlocks_on: unlock_on,
        required: lesson.required?
      }
    end.sort_by { |item| [ item[:unlocks_on], item[:module_id], item[:lesson_id] ] }.first(UPCOMING_UNLOCK_LIMIT)
  end

  def recording_items
    progress = @user.watch_progresses.where(recording_id: @cohort.recordings.map(&:id)).index_by(&:recording_id)
    @cohort.recordings.reject { |recording| progress[recording.id]&.completed? }
      .sort_by { |recording| [ recording.recorded_date || recording.created_at.to_date, recording.id ] }
      .reverse
      .first(RECORDING_LIMIT)
      .map do |recording|
        watch = progress[recording.id]
        {
          id: "recording-#{recording.id}",
          kind: "recording",
          recording_id: recording.id,
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
