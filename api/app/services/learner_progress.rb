# Where a learner stands in one enrollment: the one server definition of
# "complete" and "next" (AS-10). Today, the weekly plan, the personal learning
# plan, Learn and the lesson page all read their states, counts and next step
# from here, so they cannot disagree.
#
# Blocks. A step's state comes from its evidence:
# - reviewed work (`ContentBlock#gradable_work_block?`) follows its latest
#   submission: Redo is "redo_requested" (the learner must act), no grade yet
#   is "submitted" (waiting for review), any other grade is "complete";
# - everything else follows its progress record, which the server sets when
#   the learner marks a manual step complete, passes a knowledge check, or
#   earns the watch credit a video needs (WatchCredit). A switched-off
#   knowledge check or GitHub sync falls back to the manual or text path, so
#   an off switch never blocks completion.
#
# Lessons. A lesson's steps are `Lesson#completion_blocks`. Submitted steps
# count as handed in, so they count toward progress (as they always have),
# but the lesson reads "awaiting_review" rather than "done". A redo is not
# handed in, so the lesson is not complete. Statuses use the learner
# vocabulary shared with web and mobile (fixtures/shared-logic-parity.json,
# "statuses"): done, awaiting_review, redo, in_progress, open, upcoming, closed.
#
# Availability is LessonReadAccess's rule, so a lesson counted as available
# here is one the learner can open. Paused enrollments only see what they could
# read before pausing (AssignedLearningContent).
#
# Next step. The first required lesson the learner can act on now, in
# personal-plan milestone order when a plan is on, then course order. A lesson
# that is locked, waiting for review or done is never next. A closed
# submission week blocks handing in work and marking student work done, so a
# lesson there is next only when finishing it needs neither (videos and
# readings). A locked or closed redo keeps its "redo" status and feedback, but
# is not the next step.
#
# Queries are fixed per enrollment: content (AssignedLearningContent), the
# learning plan, progress and latest submissions, plus the cohort's module
# schedules when the caller did not preload them. `LearnerProgress.for_all`
# answers for many enrollments at once with a fixed number of queries in
# total, so staff lists (students, cohort home, attention, peeks) read the same
# definition as the learner without a query per learner.
class LearnerProgress
  module BlockState
    NOT_STARTED = "not_started".freeze
    IN_PROGRESS = "in_progress".freeze
    SUBMITTED = "submitted".freeze
    REDO_REQUESTED = "redo_requested".freeze
    COMPLETE = "complete".freeze
    HANDED_IN = [ SUBMITTED, COMPLETE ].freeze
  end

  module Status
    DONE = "done".freeze
    AWAITING_REVIEW = "awaiting_review".freeze
    REDO = "redo".freeze
    IN_PROGRESS = "in_progress".freeze
    OPEN = "open".freeze
    UPCOMING = "upcoming".freeze
    CLOSED = "closed".freeze
    ALL = [ DONE, AWAITING_REVIEW, REDO, IN_PROGRESS, OPEN, UPCOMING, CLOSED ].freeze
    # The learner has something to do now.
    ACTIONABLE = [ REDO, IN_PROGRESS, OPEN ].freeze
  end

  # One lesson's answer. `completed` means every step is handed in (done or
  # waiting for review), which is what the `completed` payload fields carry.
  LessonProgress = Data.define(:lesson, :status, :review_status, :available, :required, :completed,
    :completed_blocks, :total_blocks, :submission_window) do
    def done? = status == Status::DONE
  end

  ModuleProgress = Data.define(:module, :status, :completed_blocks, :total_blocks, :lessons) do
    def progress_percentage = total_blocks.positive? ? (completed_blocks.to_f / total_blocks * 100).round(1) : 0
  end

  # How many lessons a set of lesson answers holds and how many are complete
  # (every step handed in). Learners count lessons, never steps (U-5.6); a
  # lesson with no steps has nothing to finish, so it is not counted.
  def self.lesson_counts(entries)
    countable = entries.select { |entry| entry.total_blocks.positive? }
    { completed_lessons: countable.count(&:completed), total_lessons: countable.size }
  end

  # The fixture rule, shared with web `learnerLessonStatus` and mobile
  # `learnerLessonStatus`. Review outcomes win over the stored completion flag.
  def self.status_for(completed:, available: true, submissions_closed: false, review_status: nil, partial: false)
    return Status::REDO if review_status == LessonReviewStatus::REDO_REQUESTED
    return Status::AWAITING_REVIEW if review_status == LessonReviewStatus::AWAITING_REVIEW && completed
    return Status::DONE if completed
    return Status::UPCOMING unless available
    return Status::CLOSED if submissions_closed
    return Status::IN_PROGRESS if partial

    Status::OPEN
  end

  # What `for_all` preloads on each enrollment: everything `new` reads.
  PRELOAD = [ :module_assignments, :lesson_assignments, :learning_plan,
    { cohort: [ :cohort_module_schedules, :cohort_module_submission_windows, { curriculum: { modules: { lessons: :content_blocks } } } ] } ].freeze

  # LearnerProgress for each enrollment, keyed by enrollment id, in a fixed
  # number of queries however many enrollments there are: the preloads above,
  # one for progress, one for latest submissions (Submission.latest_attempts, the
  # grading authority's ordering) and one for school switches.
  def self.for_all(enrollments, now: Time.current, school_features: nil)
    enrollments = enrollments.to_a
    return {} if enrollments.empty?

    ActiveRecord::Associations::Preloader.new(records: enrollments, associations: PRELOAD).call
    ids = enrollments.map(&:id)
    progress = Progress.joins(:enrollment).where(enrollment_id: ids).where("progresses.user_id = enrollments.user_id").to_a.group_by(&:enrollment_id)
    owned = Submission.joins(:enrollment).where(enrollment_id: ids).where("submissions.user_id = enrollments.user_id")
    submissions = owned.latest_attempts.to_a.group_by(&:enrollment_id)
    school = school_features || FeatureSwitches.school
    enrollments.to_h do |enrollment|
      [ enrollment.id, new(enrollment, now: now, progress: progress.fetch(enrollment.id, []), submissions: submissions.fetch(enrollment.id, []), school_features: school) ]
    end
  end

  attr_reader :enrollment, :content, :today, :latest_submissions

  # `progress` and `submissions` (the latest attempt per step) are for
  # `for_all`, which loads them for many enrollments at once.
  def initialize(enrollment, content: nil, now: Time.current, progress: nil, submissions: nil, school_features: nil)
    @enrollment = enrollment
    @cohort = enrollment.cohort
    @now = now
    @today = LearningCalendar.today(at: now)
    @content = content || AssignedLearningContent.new(enrollment, modules: enrollment.cohort.curriculum.modules)
    @plan = plan_for(enrollment, school_features)
    @lessons = @content.modules.flat_map { |mod| @content.lessons_for(mod) }
    @course_index = @lessons.each_with_index.to_h { |lesson, index| [ lesson.id, index ] }
    @blocks = @lessons.flat_map do |lesson|
      lesson.content_blocks.each { |block| block.association(:lesson).target = lesson }
    end.index_by(&:id)
    @cohort.cohort_module_submission_windows.load
    @cohort.cohort_module_schedules.load
    # Availability reads each assignment's module (its start date), so hand the
    # assignments the modules already loaded rather than one query per module.
    modules_by_id = @content.modules.index_by(&:id)
    @content.module_assignments.each_value do |assignment|
      mod = modules_by_id[assignment.module_id]
      assignment.association(:curriculum_module).target = mod if mod
    end
    @progress = if progress
      progress.select { |record| @blocks.key?(record.content_block_id) }.index_by(&:content_block_id)
    else
      Progress.where(enrollment_id: enrollment.id, user_id: enrollment.user_id, content_block_id: @blocks.keys).index_by(&:content_block_id)
    end
    @latest_submissions = submissions ? attach_blocks(submissions.select { |record| @blocks.key?(record.content_block_id) }) : load_latest_submissions
    @lesson_progress = {}
  end

  # Lessons in course order, with their modules.
  def lessons = @lessons

  def plan = @plan

  def required?(lesson)
    @plan ? @plan.required?(lesson) : lesson.required?
  end

  def available?(lesson)
    lesson_progress(lesson).available
  end

  def block_state(block)
    if block.gradable_work_block? && (submission = @latest_submissions[block.id])
      return BlockState::REDO_REQUESTED if submission.grade == "R"
      return BlockState::SUBMITTED if submission.grade.nil?

      return BlockState::COMPLETE
    end

    case @progress[block.id]&.status
    when "completed" then BlockState::COMPLETE
    when "in_progress" then BlockState::IN_PROGRESS
    else BlockState::NOT_STARTED
    end
  end

  def lesson_progress(lesson)
    @lesson_progress[lesson.id] ||= begin
      states = lesson.completion_blocks.map { |block| block_state(block) }
      handed_in = states.count { |state| BlockState::HANDED_IN.include?(state) }
      completed = states.any? && handed_in == states.size
      available = readable?(lesson)
      review_status = LessonReviewStatus.for(lesson, @latest_submissions)
      window = SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: lesson, at: @now)
      LessonProgress.new(
        lesson: lesson,
        status: self.class.status_for(completed: completed, available: available, submissions_closed: window[:submissions_closed],
          review_status: review_status, partial: handed_in.positive?),
        review_status: review_status,
        available: available,
        required: required?(lesson),
        completed: completed,
        completed_blocks: handed_in,
        total_blocks: states.size,
        submission_window: window
      )
    end
  end

  # Progress counts only required lessons when a personal plan is on, and every
  # assigned lesson otherwise (unchanged from the dashboard's long-standing rule).
  def counted?(lesson)
    !@plan || required?(lesson)
  end

  def module_progress(mod)
    lessons = @content.lessons_for(mod).map { |lesson| lesson_progress(lesson) }
    counted = lessons.select { |entry| counted?(entry.lesson) }
    completed_blocks = counted.sum(&:completed_blocks)
    total_blocks = counted.sum(&:total_blocks)
    statuses = counted.map(&:status)
    status = if statuses.include?(Status::REDO)
      Status::REDO
    elsif total_blocks.positive? && completed_blocks == total_blocks
      statuses.include?(Status::AWAITING_REVIEW) ? Status::AWAITING_REVIEW : Status::DONE
    elsif lessons.none?(&:available)
      Status::UPCOMING
    elsif completed_blocks.positive?
      Status::IN_PROGRESS
    else
      Status::OPEN
    end
    ModuleProgress.new(module: mod, status: status, completed_blocks: completed_blocks, total_blocks: total_blocks, lessons: lessons)
  end

  # Lessons counted in a module, for "12 of 26 lessons" (the same rule as `overall`).
  def module_lesson_counts(mod)
    self.class.lesson_counts(@content.lessons_for(mod).select { |lesson| counted?(lesson) }.map { |lesson| lesson_progress(lesson) })
  end

  # The learner's overall standing: steps handed in (`completed`, `total`,
  # `percentage`) and whole lessons (`completed_lessons`, `total_lessons`).
  # Every staff and learner surface reads these numbers from here (U-0.5).
  def overall
    @overall ||= begin
      counted = @lessons.select { |lesson| counted?(lesson) }.map { |lesson| lesson_progress(lesson) }
      completed = counted.sum(&:completed_blocks)
      total = counted.sum(&:total_blocks)
      { completed: completed, total: total, percentage: total.positive? ? (completed.to_f / total * 100).round(1) : 0 }
        .merge(self.class.lesson_counts(counted))
    end
  end

  # Steps in counted lessons that are open to the learner now (released), and
  # how many of those are not handed in yet. Staff "released unfinished" and the
  # inactivity reason read these, so they agree with the learner's counts.
  def released
    counted = @lessons.select { |lesson| counted?(lesson) }.map { |lesson| lesson_progress(lesson) }.select(&:available)
    total = counted.sum(&:total_blocks)
    { total: total, unfinished: total - counted.sum(&:completed_blocks) }
  end

  # Steps in counted lessons the learner completed (by their progress record)
  # at or after `time`, for "this week" counts.
  def steps_completed_since(time)
    @lessons.select { |lesson| counted?(lesson) }.flat_map(&:completion_blocks).count do |block|
      record = @progress[block.id]
      record&.status == "completed" && record.completed_at && record.completed_at >= time
    end
  end

  # The single next step, or nil when nothing required is open to act on.
  def next_lesson
    return @next_lesson if defined?(@next_lesson)

    @next_lesson = @lessons
      .select { |lesson| required?(lesson) }
      .sort_by { |lesson| [ milestone_index(lesson), @course_index.fetch(lesson.id) ] }
      .find { |lesson| actionable?(lesson_progress(lesson)) }
  end

  # Reading order is the outline's order, across module boundaries. The primary
  # continuation after handing in a lesson is still the one required next step
  # (including an earlier redo), never a second client-side progress rule.
  def lesson_navigation(lesson)
    entries = @lessons.map { |item| lesson_progress(item) }
    index = @course_index[lesson.id]
    return nil unless index

    current = entries[index]
    ActiveRecord::Associations::Preloader.new(records: lesson.content_blocks.to_a, associations: :knowledge_check).call
    readable = entries.select(&:available).map(&:lesson)
    reading_index = readable.index { |item| item.id == lesson.id }
    following = reading_index && readable[reading_index + 1]
    target = if @enrollment.active? && !@cohort.alumni?
      current.completed ? next_lesson : following
    else
      following # Browsing available lessons never changes progress.
    end
    ref = ->(item) { item && { id: item.id, title: item.title, module_id: item.module_id } }
    counts = overall.slice(:completed_lessons, :total_lessons)
    {
      number: index + 1,
      total: @lessons.size,
      previous: ref.call(reading_index && reading_index.positive? ? readable[reading_index - 1] : nil),
      next: ref.call(target),
      next_module: target.present? && @course_index.fetch(target.id) > index && target.module_id != lesson.module_id,
      next_redo: target.present? && lesson_progress(target).status == Status::REDO,
      course_complete: !@cohort.alumni? && counts[:total_lessons].positive? && counts[:completed_lessons] == counts[:total_lessons],
      counts: counts,
      # Completion controls use the same evidence as the status, including
      # feature fallbacks. Reviewed submissions and checks keep their own UI.
      manual_block_ids: manual_completion_blocks(lesson).reject { |block|
        (current.submission_window[:submissions_closed] && block.student_work_block?) ||
          block_state(block) == BlockState::COMPLETE || (block.gradable_work_block? && @latest_submissions.key?(block.id))
      }.map(&:id)
    }
  end

  # Can the learner act on this lesson now? See "Next step" above.
  def actionable?(entry)
    return false unless entry.available
    return Status::ACTIONABLE.include?(entry.status) unless entry.submission_window[:submissions_closed]

    !entry.completed && entry.lesson.completion_blocks.none?(&:student_work_block?)
  end

  # Where a program learner stands against the cohort's schedule (U-5.1).
  # Overdue work is required lessons scheduled before this week (Monday) that
  # are open and not handed in; a redo is not handed in, so it counts. "About N
  # weeks behind" is that work measured in the course's typical required week
  # (the median number of required lessons scheduled per week), so one old
  # straggler doesn't read as months behind. Self-paced courses, the alumni
  # library and read-only enrollments (paused, ended) have no schedule to keep,
  # so they have no pace. Personal-plan exceptions decide what is required.
  #
  # Personal pace (W9.1): in a cohort with personal pace on, the schedule is
  # the learner's own plan, so "behind" is measured against its milestones
  # (`milestone_pace`) for guided and self-paced learners alike, and there is
  # no pace until a plan exists.
  def pace
    return @pace if defined?(@pace)
    return @pace = nil if @cohort.alumni? || !@enrollment.active?
    return @pace = milestone_pace if @cohort.personal_pace?
    return @pace = nil if @cohort.self_paced?

    week_start = @today.beginning_of_week(:monday)
    # A lesson with no steps has nothing to finish (lesson_counts), so it is in
    # neither the overdue work nor the scheduled weeks it is measured against.
    scheduled = @lessons.select { |lesson| required?(lesson) && lesson_progress(lesson).total_blocks.positive? }.filter_map do |lesson|
      on = scheduled_on(lesson)
      [ lesson, on ] if on
    end
    overdue = scheduled.filter_map do |lesson, on|
      entry = lesson_progress(lesson)
      lesson if on < week_start && entry.available && !entry.completed
    end
    per_week = scheduled.group_by { |_, on| on.beginning_of_week(:monday) }.values.map(&:size).sort
    typical = per_week.empty? ? 1 : [ per_week[(per_week.size - 1) / 2], 1 ].max
    weeks = (overdue.size.to_f / typical).round
    this_week = scheduled.select { |_, on| on >= week_start && on <= week_start + 6.days }.map(&:first)
    @pace = {
      behind: weeks >= 1,
      weeks_behind: weeks,
      overdue_lessons: overdue,
      this_week: { total: this_week.size, completed: this_week.count { |lesson| lesson_progress(lesson).completed }, ends_on: week_start + 6.days }
    }
  end

  # Where a learner stands against their plan's milestones (personal pace).
  # A milestone counts its required lessons that have steps. It is "done"
  # when every one is handed in (waiting for review counts, as everywhere),
  # "behind" when its date has passed first, "current" for the first unfinished
  # one not yet due, and "upcoming" after that. Overdue work is the open,
  # unfinished lessons of behind milestones; each behind milestone is a week
  # behind, since milestones are weekly. `this_week` is the milestone that
  # covers today. Nil without a plan or milestones.
  def milestone_pace
    return nil unless @plan && @plan.milestones.any?

    by_id = @lessons.index_by(&:id)
    current_found = false
    milestones = @plan.milestones.map do |item|
      lessons = item["lesson_ids"].filter_map { |id| by_id[id] }
        .select { |lesson| required?(lesson) && lesson_progress(lesson).total_blocks.positive? }
      due_on = Date.iso8601(item["due_on"])
      completed = lessons.count { |lesson| lesson_progress(lesson).completed }
      status = if completed == lessons.size
        "done"
      elsif due_on < @today
        "behind"
      elsif !current_found
        current_found = true
        "current"
      else
        "upcoming"
      end
      { title: item["title"], due_on: due_on, lessons: lessons, total: lessons.size, completed: completed, status: status }
    end
    behind = milestones.select { |milestone| milestone[:status] == "behind" }
    overdue = behind.flat_map { |milestone| milestone[:lessons].reject { |lesson| lesson_progress(lesson).completed || !lesson_progress(lesson).available } }
    covering = milestones.find { |milestone| milestone[:due_on] >= @today }
    {
      behind: behind.any?,
      weeks_behind: behind.size,
      overdue_lessons: overdue,
      this_week: covering && covering.slice(:total, :completed).merge(ends_on: covering[:due_on]),
      milestones: milestones,
      next_milestone: milestones.find { |milestone| milestone[:status] != "done" }
    }
  end

  # The day the cohort schedule puts a lesson on for this learner (its unlock
  # date), or nil when it has none.
  def scheduled_on(lesson)
    lesson.assigned_unlock_date(@cohort, @content.module_assignments[lesson.module_id], @content.lesson_assignments[lesson.id])
  end

  # Latest attempts graded Redo on reviewed work, newest grade first: exactly
  # the "redo_requested" steps, which the learner has to act on.
  def redo_submissions
    @redo_submissions ||= redo_graded.select { |submission| submission.content_block.gradable_work_block? }
  end

  # A Redo on a step that is not reviewed work (only imported history has one).
  # It does not hold the lesson open, so it is past feedback, not work to do.
  def historical_redo_submissions
    @historical_redo_submissions ||= redo_graded.reject { |submission| submission.content_block.gradable_work_block? }
  end

  # Latest attempts on reviewed work with no grade yet, oldest first: exactly
  # the "submitted" steps, waiting for an instructor.
  def awaiting_review_submissions
    @awaiting_review_submissions ||= @latest_submissions.values
      .select { |submission| submission.grade.nil? && submission.content_block.gradable_work_block? }
      .sort_by { |submission| [ submission.created_at, submission.id ] }
  end

  # Latest attempts with a final grade, newest first, plus Redo on work that
  # isn't reviewed (past feedback, not work to do). Together with the redo and
  # awaiting lists this is every latest attempt the learner has graded or not.
  def graded_submissions
    @graded_submissions ||= begin
      historical = historical_redo_submissions.to_set
      @latest_submissions.values
        .select { |submission| submission.grade.present? && (submission.grade != "R" || historical.include?(submission)) }
        .sort_by { |submission| [ submission.graded_at || Time.zone.at(0), submission.id ] }
        .reverse
    end
  end

  private

  def manual_completion_blocks(lesson)
    github = (@cohort.settings || {}).dig("module_github_config", lesson.module_id.to_s, "requires_github") || false
    checks = FeatureSwitches.for(cohort: @cohort)["knowledge_checks"]
    lesson.completion_blocks.select do |block|
      manual = block.text? || block.effective_submission_type(requires_github: github, feature_cohort: @cohort) == "manual_complete"
      manual && !block.video? && !block.recording? && !(block.checkpoint? && block.knowledge_check && checks)
    end
  end

  def redo_graded
    @latest_submissions.values
      .select { |submission| submission.grade == "R" }
      .sort_by { |submission| [ submission.graded_at || Time.zone.at(0), submission.id ] }
      .reverse
  end

  def readable?(lesson)
    LessonReadAccess.readable?(@enrollment, lesson, @content.module_assignments[lesson.module_id], @content.lesson_assignments[lesson.id], on: @today)
  end

  def milestone_index(lesson)
    return 0 unless @plan

    @milestone_order ||= @plan.milestones.flat_map { |item| item["lesson_ids"] }.each_with_index.to_h
    @milestone_order.fetch(lesson.id, @milestone_order.size)
  end

  def plan_for(enrollment, school_features)
    plan = enrollment.learning_plan
    return nil unless plan&.active?
    return nil unless FeatureSwitches.for(cohort: enrollment.cohort, school: school_features)["learning_plans"]

    plan
  end

  # The newest attempt per step (highest id), matching every earlier projection.
  def load_latest_submissions
    return {} if @blocks.empty?

    scope = Submission.where(enrollment_id: @enrollment.id, user_id: @enrollment.user_id, content_block_id: @blocks.keys)
    attach_blocks(scope.latest_attempts.to_a)
  end

  def attach_blocks(submissions)
    submissions.each do |submission|
      submission.association(:content_block).target = @blocks.fetch(submission.content_block_id)
    end.index_by(&:content_block_id)
  end
end
