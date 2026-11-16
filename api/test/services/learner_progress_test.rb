require "test_helper"

# AS-10: one definition of complete and next. The matrix covers block types x
# evidence (progress and latest submission), availability (released, upcoming,
# closed, paused, lesson-only), delivery (guided, self-paced), personal plans
# and the knowledge-check and GitHub-sync switches.
class LearnerProgressTest < ActiveSupport::TestCase
  FIXTURES = JSON.parse(Rails.root.join("../fixtures/shared-logic-parity.json").read)

  setup do
    @curriculum = Curriculum.create!(name: "Progress curriculum")
    @mod = @curriculum.modules.create!(name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Progress cohort", start_date: Date.current - 5, status: :active)
    @student = User.create!(clerk_id: "progress_student", email: "progress-student@example.com", first_name: "Pat", last_name: "Learner", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
  end

  test "status precedence matches the shared learner-status fixtures" do
    FIXTURES.fetch("statuses").each do |row|
      input = row.fetch("input")
      status = LearnerProgress.status_for(
        completed: input["completed"] || false,
        available: input.fetch("available", true),
        submissions_closed: input["submissionsClosed"] || false,
        review_status: input["reviewStatus"],
        partial: input["partial"] || false
      )
      assert_equal row.fetch("expected"), status, input.inspect
    end
  end

  # [name, blocks, evidence per block, expected block states, lesson status, completed, handed in / total]
  MATRIX = [
    [ "video not started", [ [ :video ] ], [ nil ], %w[not_started], "open", false, [ 0, 1 ] ],
    [ "video below the watch-credit threshold", [ [ :video ] ], [ { progress: :in_progress } ], %w[in_progress], "open", false, [ 0, 1 ] ],
    [ "video credited by watch time", [ [ :video ] ], [ { progress: :completed } ], %w[complete], "done", true, [ 1, 1 ] ],
    [ "manual step marked complete", [ [ :exercise, :manual_complete ] ], [ { progress: :completed } ], %w[complete], "done", true, [ 1, 1 ] ],
    [ "reviewed work not started", [ [ :exercise, :text_submission ] ], [ nil ], %w[not_started], "open", false, [ 0, 1 ] ],
    [ "reviewed work submitted", [ [ :exercise, :text_submission ] ], [ { progress: :completed, grades: [ nil ] } ], %w[submitted], "awaiting_review", true, [ 1, 1 ] ],
    [ "redo requested", [ [ :exercise, :text_submission ] ], [ { progress: :in_progress, grades: [ "R" ] } ], %w[redo_requested], "redo", false, [ 0, 1 ] ],
    [ "redo with a stale completed flag", [ [ :exercise, :text_submission ] ], [ { progress: :completed, grades: [ "R" ] } ], %w[redo_requested], "redo", false, [ 0, 1 ] ],
    [ "redo resubmitted", [ [ :exercise, :text_submission ] ], [ { progress: :completed, grades: [ "R", nil ] } ], %w[submitted], "awaiting_review", true, [ 1, 1 ] ],
    [ "reviewed work graded", [ [ :exercise, :text_submission ] ], [ { progress: :completed, grades: [ "B" ] } ], %w[complete], "done", true, [ 1, 1 ] ],
    [ "graded without a progress row", [ [ :exercise, :repo_url_submission ] ], [ { grades: [ "A" ] } ], %w[complete], "done", true, [ 1, 1 ] ],
    [ "reviewed checkpoint redo", [ [ :checkpoint, :text_submission ] ], [ { progress: :in_progress, grades: [ "R" ] } ], %w[redo_requested], "redo", false, [ 0, 1 ] ],
    [ "plain checkpoint toggled", [ [ :checkpoint ] ], [ { progress: :completed } ], %w[complete], "done", true, [ 1, 1 ] ],
    [ "video beside an exercise is not a step", [ [ :video ], [ :exercise, :text_submission ] ], [ { progress: :completed }, nil ], %w[not_started], "open", false, [ 0, 1 ] ],
    [ "one of two exercises handed in", [ [ :exercise, :text_submission ], [ :exercise, :manual_complete ] ], [ { progress: :completed, grades: [ nil ] }, nil ], %w[submitted not_started], "in_progress", false, [ 1, 2 ] ],
    [ "graded and waiting", [ [ :exercise, :text_submission ], [ :exercise, :text_submission ] ], [ { progress: :completed, grades: [ "A" ] }, { progress: :completed, grades: [ nil ] } ], %w[complete submitted], "awaiting_review", true, [ 2, 2 ] ],
    [ "one redo among done steps", [ [ :exercise, :text_submission ], [ :exercise, :manual_complete ] ], [ { progress: :in_progress, grades: [ "R" ] }, { progress: :completed } ], %w[redo_requested complete], "redo", false, [ 1, 2 ] ]
  ].freeze

  test "block types and evidence decide block and lesson states" do
    MATRIX.each_with_index do |(name, blocks, evidence, block_states, status, completed, counts), index|
      lesson = build_lesson(name, release_day: 0, position: index, blocks: blocks)
      lesson.content_blocks.each_with_index { |block, block_index| record_evidence(block, evidence[block_index]) }
    end
    progress = LearnerProgress.new(@enrollment)
    MATRIX.each do |name, _blocks, _evidence, block_states, status, completed, counts|
      lesson = progress.lessons.find { |candidate| candidate.title == name }
      entry = progress.lesson_progress(lesson)
      assert_equal block_states, lesson.completion_blocks.map { |block| progress.block_state(block) }, name
      assert_equal status, entry.status, name
      assert_equal completed, entry.completed, name
      assert_equal counts, [ entry.completed_blocks, entry.total_blocks ], name
    end
  end

  test "switched-off knowledge checks and GitHub sync never block completion" do
    checked = build_lesson("Quick check", release_day: 0, blocks: [ [ :checkpoint ] ])
    KnowledgeCheck.create!(content_block: checked.content_blocks.first, prompt: "Pick one", options: %w[a b], correct_option: 0, explanation: "a")
    synced = build_lesson("Prework", release_day: 1, blocks: [ [ :exercise, :prework_github_sync ] ])
    @cohort.update!(settings: { "features" => { "knowledge_checks" => false, "github_sync" => false } })
    record_evidence(checked.content_blocks.first, { progress: :completed })
    record_evidence(synced.content_blocks.first, { progress: :completed, grades: [ nil ] })

    progress = LearnerProgress.new(@enrollment.reload)
    assert_equal "done", progress.lesson_progress(find(progress, checked)).status
    assert_equal "awaiting_review", progress.lesson_progress(find(progress, synced)).status
    assert_nil progress.next_lesson
  end

  test "availability: upcoming and closed lessons are never the next step" do
    closed = build_lesson("Closed week", release_day: 0)
    open = build_lesson("Open week", release_day: 7)
    upcoming = build_lesson("Next month", release_day: 30)
    @cohort.update!(start_date: Date.current - 8)
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 1, submissions_close_at: 1.hour.ago)

    progress = LearnerProgress.new(@enrollment.reload)
    assert_equal "closed", progress.lesson_progress(find(progress, closed)).status
    assert_equal "open", progress.lesson_progress(find(progress, open)).status
    assert_equal "upcoming", progress.lesson_progress(find(progress, upcoming)).status
    assert_equal open.id, progress.next_lesson.id
  end

  # Fix round 1: a redo the learner cannot act on (its week's submissions are
  # closed, or the lesson is locked) keeps its badge and feedback, but the next
  # step moves on to the first lesson they can work on.
  [ :guided, :self_paced, :personal_plan ].each do |mode|
    test "a closed-week redo is not the next step (#{mode})" do
      redo_lesson = build_lesson("Closed redo", release_day: 0)
      open = build_lesson("Open week", release_day: 7)
      record_evidence(redo_lesson.content_blocks.first, { progress: :completed, grades: [ "R" ] })
      @cohort.update!(start_date: Date.current - 8)
      @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 1, submissions_close_at: 1.hour.ago)
      apply_mode(mode, [ redo_lesson, open ])

      progress = LearnerProgress.new(@enrollment.reload)
      entry = progress.lesson_progress(find(progress, redo_lesson))
      assert_equal [ "redo", true ], [ entry.status, entry.available ]
      assert_equal [ redo_lesson.content_blocks.first.id ], progress.redo_submissions.map(&:content_block_id), "the feedback stays listed"
      assert_equal open.id, progress.next_lesson.id
    end

    test "a locked redo is not the next step (#{mode})" do
      @mod.update!(position: 1)
      early = @curriculum.modules.create!(name: "Week 0", position: 0, day_offset: 0, schedule_days: "daily")
      redo_lesson = build_lesson("Locked redo", release_day: 0, mod: early)
      @enrollment.lesson_assignments.create!(lesson: redo_lesson, unlocked: false)
      open = build_lesson("Open lesson", release_day: 0)
      record_evidence(redo_lesson.content_blocks.first, { progress: :in_progress, grades: [ "R" ] })
      apply_mode(mode, [ redo_lesson, open ])

      progress = LearnerProgress.new(@enrollment.reload)
      assert_equal [ redo_lesson.id, open.id ], progress.lessons.map(&:id), "the locked redo comes first in course order"
      entry = progress.lesson_progress(find(progress, redo_lesson))
      assert_equal [ "redo", false ], [ entry.status, entry.available ]
      assert_equal open.id, progress.next_lesson.id
    end
  end

  test "a lesson that only needs watching can be next in a closed week" do
    watch = build_lesson("Closed-week video", release_day: 0, blocks: [ [ :video ] ])
    work = build_lesson("Closed-week exercise", release_day: 1)
    @cohort.update!(start_date: Date.current - 8)
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 1, submissions_close_at: 1.hour.ago)

    progress = LearnerProgress.new(@enrollment.reload)
    assert_equal %w[closed closed], [ watch, work ].map { |lesson| progress.lesson_progress(find(progress, lesson)).status }
    assert_equal watch.id, progress.next_lesson.id

    record_evidence(watch.content_blocks.first, { progress: :completed })
    assert_nil LearnerProgress.new(@enrollment.reload).next_lesson, "submission work in a closed week is skipped"
  end

  test "a redo on work that is not reviewed is past feedback, not work to do" do
    lesson = build_lesson("Imported", release_day: 0, blocks: [ [ :checkpoint ] ])
    record_evidence(lesson.content_blocks.first, { progress: :completed, grades: [ "R" ] })

    progress = LearnerProgress.new(@enrollment.reload)
    assert_equal "done", progress.lesson_progress(find(progress, lesson)).status
    assert_empty progress.redo_submissions
    assert_equal [ lesson.content_blocks.first.id ], progress.historical_redo_submissions.map(&:content_block_id)
  end

  test "next step: the first required lesson to act on, in course order" do
    done = build_lesson("Done", release_day: 0)
    waiting = build_lesson("Waiting", release_day: 1)
    optional = build_lesson("Optional", release_day: 2, required: false)
    redone = build_lesson("Redo", release_day: 3)
    later = build_lesson("Later", release_day: 4)
    record_evidence(done.content_blocks.first, { progress: :completed, grades: [ "A" ] })
    record_evidence(waiting.content_blocks.first, { progress: :completed, grades: [ nil ] })
    record_evidence(redone.content_blocks.first, { progress: :completed, grades: [ "R" ] })

    progress = LearnerProgress.new(@enrollment.reload)
    assert_equal redone.id, progress.next_lesson.id
    assert_equal "open", progress.lesson_progress(find(progress, optional)).status

    record_evidence(redone.content_blocks.first, { grades: [ nil ] })
    record_evidence(later.content_blocks.first, { progress: :completed, grades: [ nil ] })
    progress = LearnerProgress.new(@enrollment.reload)
    assert_nil progress.next_lesson, "work waiting for review leaves nothing to do"
    assert_equal({ completed: 4, total: 5, percentage: 80.0, completed_lessons: 4, total_lessons: 5 }, progress.overall)
    assert_equal [ "in_progress", 4, 5 ], progress.module_progress(@mod).then { |entry| [ entry.status, entry.completed_blocks, entry.total_blocks ] }
  end

  test "personal plans order the next step by milestone and count only required lessons" do
    first = build_lesson("First", release_day: 0)
    second = build_lesson("Second", release_day: 1)
    third = build_lesson("Third", release_day: 2)
    @enrollment.create_learning_plan!(title: "Plan", active: true,
      milestones: [ { "title" => "Ship", "due_on" => (Date.current + 7).iso8601, "lesson_ids" => [ third.id, second.id ] } ],
      lesson_overrides: [ { "lesson_id" => first.id, "required" => false, "reason" => "Already covered" } ])

    progress = LearnerProgress.new(@enrollment.reload)
    assert_equal third.id, progress.next_lesson.id
    assert_equal 2, progress.overall[:total]
    assert_not progress.required?(find(progress, first))

    @cohort.update!(settings: { "features" => { "learning_plans" => false } })
    progress = LearnerProgress.new(@enrollment.reload)
    assert_nil progress.plan
    assert_equal first.id, progress.next_lesson.id
    assert_equal 3, progress.overall[:total]
  end

  test "self-paced courses open every assigned lesson" do
    first = build_lesson("Start", release_day: 0)
    far = build_lesson("Far ahead", release_day: 60)
    @cohort.update!(course_delivery: "self_paced")
    record_evidence(first.content_blocks.first, { progress: :completed, grades: [ "A" ] })

    progress = LearnerProgress.new(@enrollment.reload)
    assert progress.available?(find(progress, far))
    assert_equal far.id, progress.next_lesson.id
  end

  test "paused learners only see and count what they could read before pausing" do
    before = build_lesson("Before pause", release_day: 0)
    build_lesson("After pause", release_day: 4)
    before.update_columns(created_at: 10.days.ago)
    @enrollment.module_assignments.first.update_columns(created_at: 10.days.ago, updated_at: 10.days.ago, availability_changed_at: 10.days.ago)
    @enrollment.update!(status: :paused)
    @enrollment.update_columns(paused_at: 3.days.ago)

    progress = LearnerProgress.new(@enrollment.reload)
    assert_equal [ before.id ], progress.lessons.map(&:id)
    assert_equal before.id, progress.next_lesson.id
    assert_equal 1, progress.overall[:total]
  end

  test "a lesson assigned on its own is available without its module" do
    other = @curriculum.modules.create!(name: "Week 2", position: 1, day_offset: 7, schedule_days: "daily")
    solo = build_lesson("Solo", release_day: 0, mod: other)
    build_lesson("Sibling", release_day: 1, mod: other)
    @enrollment.lesson_assignments.create!(lesson: solo, unlocked: true)

    progress = LearnerProgress.new(@enrollment.reload)
    assert_equal [ solo.id ], progress.content.lessons_for(other).map(&:id)
    assert progress.available?(find(progress, solo))
    assert LessonReadAccess.allowed?(@student, solo)
  end

  private

  def apply_mode(mode, plan_lessons)
    @cohort.update!(course_delivery: "self_paced") if mode == :self_paced
    return unless mode == :personal_plan

    @enrollment.create_learning_plan!(title: "Plan", active: true,
      milestones: [ { "title" => "First", "due_on" => (Date.current + 7).iso8601, "lesson_ids" => plan_lessons.map(&:id) } ])
  end

  def build_lesson(title, release_day:, position: release_day, required: true, blocks: [ [ :exercise, :text_submission ] ], mod: @mod)
    lesson = mod.lessons.create!(title: title, position: position, release_day: release_day, required: required)
    blocks.each_with_index do |(type, submission_type), index|
      lesson.content_blocks.create!(block_type: type, position: index, title: "#{title} #{type}", submission_type: submission_type,
        video_url: type == :video ? "https://www.youtube.com/watch?v=example#{index}" : nil)
    end
    lesson
  end

  def record_evidence(block, evidence)
    return unless evidence

    if evidence[:progress]
      Progress.find_or_initialize_by(enrollment: @enrollment, content_block: block).update!(user: @student, status: evidence[:progress])
    end
    Array(evidence[:grades]).each do |grade|
      Submission.create!(user: @student, enrollment: @enrollment, content_block: block, text: "Answer", grade: grade, graded_at: grade && Time.current)
    end
  end

  def find(progress, lesson)
    progress.lessons.find { |candidate| candidate.id == lesson.id }
  end
end
