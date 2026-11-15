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
# schedules when the caller did not preload them.
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

  attr_reader :enrollment, :content, :today, :latest_submissions

  def initialize(enrollment, content: nil, now: Time.current)
    @enrollment = enrollment
    @cohort = enrollment.cohort
    @now = now
    @today = LearningCalendar.today(at: now)
    @content = content || AssignedLearningContent.new(enrollment)
    @plan = enrollment.learning_plan_enabled? ? enrollment.learning_plan : nil
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
    @progress = Progress.where(enrollment_id: enrollment.id, user_id: enrollment.user_id, content_block_id: @blocks.keys).index_by(&:content_block_id)
    @latest_submissions = load_latest_submissions
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

  def overall
    counted = @lessons.select { |lesson| counted?(lesson) }.map { |lesson| lesson_progress(lesson) }
    completed = counted.sum(&:completed_blocks)
    total = counted.sum(&:total_blocks)
    { completed: completed, total: total, percentage: total.positive? ? (completed.to_f / total * 100).round(1) : 0 }
  end

  # The single next step, or nil when nothing required is open to act on.
  def next_lesson
    return @next_lesson if defined?(@next_lesson)

    @next_lesson = @lessons
      .select { |lesson| required?(lesson) }
      .sort_by { |lesson| [ milestone_index(lesson), @course_index.fetch(lesson.id) ] }
      .find { |lesson| actionable?(lesson_progress(lesson)) }
  end

  # Can the learner act on this lesson now? See "Next step" above.
  def actionable?(entry)
    return false unless entry.available
    return Status::ACTIONABLE.include?(entry.status) unless entry.submission_window[:submissions_closed]

    !entry.completed && entry.lesson.completion_blocks.none?(&:student_work_block?)
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

  private

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

  # The newest attempt per step (highest id), matching every earlier projection.
  def load_latest_submissions
    return {} if @blocks.empty?

    scope = Submission.where(enrollment_id: @enrollment.id, user_id: @enrollment.user_id, content_block_id: @blocks.keys)
    Submission.where(id: scope.group(:content_block_id).select("MAX(id)")).to_a.each do |submission|
      submission.association(:content_block).target = @blocks.fetch(submission.content_block_id)
    end.index_by(&:content_block_id)
  end
end
