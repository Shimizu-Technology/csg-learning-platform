# A learner's chosen pace (W9.1, AS-2), kept as their learning plan.
#
# In a cohort with personal pace on (`Cohort#personal_pace?`), a learner picks
# one of the cohort's paces (for example 3, 4 or 6 weeks) at first open or from
# Today. That becomes an ordinary LearningPlan with `source: "learner_pace"`:
# one soft milestone per week from the learner's own start
# (`Enrollment#personal_start_on`), lessons split evenly by count in course
# order, and the final project (the last required project lesson) in its own
# milestone on the last day. The plan's `target_date` is that day, the one firm
# date. Weekly dates guide "behind" (LearnerProgress#milestone_pace) and never
# lock lessons or close submissions.
#
# Changing pace regenerates the future and keeps the past: milestones already
# due keep the lessons the learner finished in them, and every unfinished
# required lesson is spread over the weeks from this one to the new end. The
# learner can change pace twice (MAX_LEARNER_CHANGES); after that, or whenever
# a staff plan is in place, staff decide. Staff can set any pace from 1 to 26
# weeks for a learner without using up a change, and saving in the plan editor
# makes the plan a staff plan. Every save writes a LearningPlanRevision, so the
# history shows each pace and who chose it.
#
# Requires the cohort's learning_plans switch, since a plan the switch hides
# can't pace anyone.
class LearnerPace
  MAX_LEARNER_CHANGES = 2

  class Refused < StandardError
    attr_reader :status

    def initialize(message, status: :unprocessable_entity)
      super(message)
      @status = status
    end
  end

  def initialize(enrollment, features: nil)
    @enrollment = enrollment
    @cohort = enrollment.cohort
    @features = features || FeatureSwitches.for(cohort: @cohort)
  end

  def available? = @cohort.personal_pace? && @features["learning_plans"] == true

  def options = Array(@cohort.learner_pace_weeks)

  # Choose or change the pace. `actor` is the learner or a staff member who
  # can teach the cohort (the controller checks which). Returns the plan.
  def choose!(weeks:, actor:, request_started_at: Time.current)
    raise Refused, "Choosing a pace isn't available in this course." unless available?

    staff = actor.staff?
    weeks = Integer(weeks.to_s, exception: false)
    allowed = staff ? Cohort::PACE_WEEK_RANGE : options
    raise Refused, staff ? "Choose a pace from #{allowed.min} to #{allowed.max} weeks." : "Choose one of the paces this course offers." unless weeks && allowed.include?(weeks)

    @enrollment.with_learning_write_guard(request_started_at: request_started_at) do
      raise Refused, "Your course is read-only right now, so your pace can't change." unless @enrollment.active?

      plan = LearningPlan.find_by(enrollment_id: @enrollment.id) || @enrollment.build_learning_plan
      changing = plan.persisted? && plan.active? && plan.learner_pace? && plan.pace_weeks.present?
      unless staff
        if plan.persisted? && plan.active? && !plan.learner_pace?
          raise Refused.new("Your instructor set your plan. Message them to change it.", status: :forbidden)
        end
        return plan if changing && plan.pace_weeks == weeks
        if changing && plan.pace_changes_count >= MAX_LEARNER_CHANGES
          raise Refused.new("You've changed your pace #{MAX_LEARNER_CHANGES} times. Message your instructor to change it again.", status: :forbidden)
        end
      end

      @enrollment.association(:learning_plan).reset
      progress = LearnerProgress.new(@enrollment)
      plan.assign_attributes(generate(weeks, plan, progress))
      plan.pace_changes_count += 1 if changing && !staff && plan.pace_weeks_changed?
      plan.save!
      plan.revisions.create!(author: actor, snapshot: plan.snapshot)
      @enrollment.association(:learning_plan).target = plan
      plan
    end
  end

  # Re-plan an active chosen pace from a moved start (staff changed it, or the
  # first open moved it past the cohort start). Same pace, no change used up,
  # nothing kept from the old dates. A no-op for a read-only enrollment or
  # without a chosen pace. Call inside the enrollment's lock.
  def regenerate!(actor:)
    return nil unless available? && @enrollment.active?

    plan = LearningPlan.find_by(enrollment_id: @enrollment.id)
    return nil unless plan&.active? && plan.learner_pace? && plan.pace_weeks

    @enrollment.association(:learning_plan).reset
    plan.assign_attributes(generate(plan.pace_weeks, plan, LearnerProgress.new(@enrollment), keep_past: false))
    return plan unless plan.changed?

    plan.save!
    plan.revisions.create!(author: actor, snapshot: plan.snapshot)
    @enrollment.association(:learning_plan).target = plan # callers read the new plan, not a cached old one
    plan
  end

  # What Today, the outline and the staff workspace show. Reads the pace from
  # LearnerProgress (the one status source) and one query for the latest
  # revision. `progress` must be this enrollment's.
  def as_json(progress)
    plan = @enrollment.learning_plan
    plan = nil unless plan&.active?
    pace = progress.pace
    chosen = plan&.learner_pace? && plan.pace_weeks.present?
    start = @enrollment.personal_start_on(@cohort)
    revision = plan && plan.revisions.order(created_at: :desc, id: :desc).includes(:author).first
    changes_left = chosen ? [ MAX_LEARNER_CHANGES - plan.pace_changes_count, 0 ].max : MAX_LEARNER_CHANGES
    {
      enrollment_id: @enrollment.id,
      available: available?,
      options: options,
      weeks: chosen ? plan.pace_weeks : nil,
      plan_source: plan&.source,
      starts_on: start,
      start_set_by_staff: @enrollment.starts_on.present?,
      ends_on: plan&.target_date,
      adjusted_for: chosen ? adjusted_for(plan, progress, start) : nil,
      choices: can_change?(plan, chosen, changes_left) ? choices(plan, progress, start) : [],
      current_week: chosen && start && progress.today >= start ? ((progress.today - start).to_i / 7) + 1 : nil,
      status: status(plan, pace, chosen),
      weeks_behind: pace ? pace[:weeks_behind] : 0,
      final_project: final_project(plan, progress),
      next_milestone: pace && pace[:next_milestone] && milestone_json(pace[:next_milestone], progress, lessons: true),
      milestones: pace ? pace[:milestones].map { |milestone| milestone_json(milestone, progress) } : [],
      can_change: can_change?(plan, chosen, changes_left),
      changes_left: changes_left,
      chosen_by: revision&.author && { id: revision.author.id, full_name: revision.author.full_name },
      chosen_at: revision&.created_at&.iso8601(6)
    }
  end

  # The last required project lesson, finished or not: the final project.
  def self.final_project_lesson(progress)
    progress.lessons.reverse.find { |item| item.project? && progress.required?(item) && progress.lesson_progress(item).total_blocks.positive? }
  end

  private

  def can_change?(plan, chosen, changes_left)
    available? && @enrollment.active? && (plan.nil? || plan.learner_pace?) && (!chosen || changes_left.positive?)
  end

  # What each offered pace would schedule if chosen now: the same generator,
  # not saved, so the picker's end date is the one the server would keep.
  def choices(plan, progress, start)
    return [] unless start

    base = plan || @enrollment.learning_plan || LearningPlan.new # unattached: a preview never becomes the enrollment's plan
    options.map do |weeks|
      preview = LearningPlan.new(generate(weeks, base, progress))
      { weeks: weeks, ends_on: preview.target_date, adjusted_for: adjusted_for(preview, progress, start) }
    end
  end

  def status(plan, pace, chosen)
    return "staff_plan" if plan && !plan.learner_pace?
    return "not_chosen" unless chosen
    return "on_track" unless pace
    return "done" if pace[:milestones].all? { |milestone| milestone[:status] == "done" }

    pace[:behind] ? "behind" : "on_track"
  end

  def milestone_json(milestone, progress, lessons: false)
    json = milestone.slice(:title, :due_on, :total, :completed, :status)
    return json unless lessons

    json.merge(lessons: milestone[:lessons].map do |lesson|
      entry = progress.lesson_progress(lesson)
      { id: lesson.id, title: lesson.title, kind: LessonKind.for(lesson), status: entry.status, available: entry.available }
    end)
  end

  # The last required project lesson, finished or not, due on the plan's firm date.
  def final_project(plan, progress)
    return nil unless plan&.learner_pace? && plan.target_date

    lesson = self.class.final_project_lesson(progress)
    lesson && { lesson_id: lesson.id, title: lesson.title, due_on: plan.target_date, status: progress.lesson_progress(lesson).status }
  end

  # Why a chosen pace runs past the weeks chosen: some planned lessons open
  # after it would have ended ("lessons_open_later"), or it was chosen or
  # re-planned after that end had passed ("late_start"). Nil when it fits.
  def adjusted_for(plan, progress, start)
    return nil unless plan&.learner_pace? && plan.pace_weeks && plan.target_date && start

    nominal_end = start + (plan.pace_weeks * 7) - 1
    return nil unless plan.target_date > nominal_end

    planned = plan.milestones.flat_map { |item| item["lesson_ids"] }.to_set
    later = progress.lessons.any? { |lesson| planned.include?(lesson.id) && (opens = progress.scheduled_on(lesson)) && opens > nominal_end }
    later ? "lessons_open_later" : "late_start"
  end

  # `keep_past: false` regenerates from scratch, for a moved start.
  def generate(weeks, plan, progress, keep_past: true)
    start = @enrollment.personal_start_on(@cohort)
    today = progress.today
    week_of = ->(date) { date < start ? 1 : ((date - start).to_i / 7) + 1 }
    current_week = week_of.call(today)
    due = ->(week) { start + (week * 7) - 1 }

    # Exceptions only carry over from a plan in use; an old inactive plan's may name lessons no longer assigned.
    overrides = plan.persisted? && plan.active? ? Array(plan.lesson_overrides) : []
    required = ->(lesson) { (item = overrides.find { |override| override["lesson_id"] == lesson.id }) ? item["required"] : lesson.required? }
    lessons = progress.lessons.select { |lesson| required.call(lesson) && progress.lesson_progress(lesson).total_blocks.positive? }
    finished = lessons.select { |lesson| progress.lesson_progress(lesson).completed }.map(&:id).to_set

    # The past stays as it was: a milestone already due keeps what was finished in it.
    previous = keep_past && plan.persisted? && plan.active? && plan.learner_pace? ? Array(plan.milestones) : []
    kept = previous.select { |item| Date.iso8601(item["due_on"]) < today }.filter_map do |item|
      done = item["lesson_ids"].select { |id| finished.include?(id) }
      item.merge("lesson_ids" => done) if done.any?
    end
    kept_ids = kept.flat_map { |item| item["lesson_ids"] }.to_set

    # No target falls before its lessons open. A lesson goes in the week it
    # opens or later (a staff module date can be later than the start), and
    # one locked with no date isn't planned. When lessons open after the
    # chosen pace would end, the plan runs to the week the last one opens;
    # `as_json` tells the learner and staff why (adjusted_for).
    opens_week = lessons.to_h do |lesson|
      opens = progress.available?(lesson) ? today : progress.scheduled_on(lesson)
      [ lesson.id, opens && week_of.call(opens) ]
    end
    # The final project is the last required project, done or not; only what
    # is unfinished gets a target.
    final = lessons.reverse.find(&:project?)
    remaining = lessons.reject { |lesson| lesson == final || finished.include?(lesson.id) || kept_ids.include?(lesson.id) || opens_week[lesson.id].nil? }
    schedule_final = final && !finished.include?(final.id) && !kept_ids.include?(final.id) && opens_week[final.id]
    last_week = [ weeks, current_week, *remaining.map { |lesson| opens_week[lesson.id] }, (opens_week[final.id] if schedule_final) ].compact.max
    target = due.call(last_week)
    # Lessons spread over the weeks chosen; one that opens later moves to its week.
    slots = (current_week..[ weeks, current_week ].max).to_a
    by_week = remaining.each_with_index.group_by do |lesson, index|
      [ slots[index * slots.size / remaining.size], opens_week[lesson.id] ].max
    end
    weekly = by_week.sort.map do |week, entries|
      { "title" => "Week #{week}", "due_on" => due.call(week).iso8601, "lesson_ids" => entries.map { |lesson, _| lesson.id } }
    end
    milestones = kept + weekly
    milestones << { "title" => "Final project", "due_on" => target.iso8601, "lesson_ids" => [ final.id ] } if schedule_final

    {
      active: true,
      source: "learner_pace",
      pace_weeks: weeks,
      title: "Your pace: #{weeks} #{weeks == 1 ? 'week' : 'weeks'}",
      description: nil,
      target_date: target,
      next_check_in_on: nil,
      milestones: milestones,
      lesson_overrides: overrides
    }
  end
end
