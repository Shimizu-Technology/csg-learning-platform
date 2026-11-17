require "test_helper"
require_relative "../support/query_counter"

class LessonNavigationTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    curriculum = Curriculum.create!(name: "Navigation lab")
    @first = curriculum.modules.create!(name: "Foundations", position: 0, day_offset: 0, schedule_days: "daily")
    @second = curriculum.modules.create!(name: "Next section", position: 1, day_offset: 14, schedule_days: "daily")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Navigation course", start_date: Date.current - 30, status: :active)
    @student = User.create!(clerk_id: "nav_student", email: "navigation@example.com", first_name: "Alex", last_name: "Rivera", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    [ @first, @second ].each { |mod| @enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true) }
    # Repeated positions across days expose the old position-only ordering.
    @one = reading(@first, "First", 0, 0)
    @two = reading(@first, "Second", 0, 1)
    @three = reading(@second, "Third", 0, 0)
  end

  test "continuation crosses modules in outline order and previous crosses back" do
    finish(@one)
    finish(@two)
    payload = show(@two)
    nav = payload.fetch("learning_navigation")
    assert_equal [ 2, 3 ], nav.values_at("number", "total")
    assert_equal @three.id, nav.dig("next", "id")
    assert_equal true, nav["next_module"]
    assert_equal @one.id, nav.dig("previous", "id")
    assert_equal @three.id, payload.dig("next_step", "id")
    assert_equal @two.id, show(@three).dig("learning_navigation", "previous", "id")
  end

  test "self-paced navigation ignores dates but respects assignments and archived lessons" do
    @cohort.update!(course_delivery: "self_paced", start_date: Date.current + 30)
    @enrollment.module_assignments.find_by!(module_id: @second.id).update!(unlocked: false)
    @first.lessons.create!(title: "Archived", position: 1, release_day: 0, archived_at: Time.current)
    finish(@one)
    finish(@two)
    assert_equal @three.id, show(@two).dig("learning_navigation", "next", "id")
    assert_equal "self_paced", show(@two).dig("outline", "mode")
    @enrollment.module_assignments.find_by!(module_id: @second.id).destroy!
    assert_nil show(@two).dig("learning_navigation", "next")
    assert_equal true, show(@two).dig("learning_navigation", "course_complete")
  end

  test "complete means every counted lesson handed in and redo reopens the course" do
    [ @one, @two ].each { |lesson| finish(lesson) }
    @three.content_blocks.destroy_all
    block = @three.content_blocks.create!(block_type: :exercise, position: 0, submission_type: :text_submission)
    attempt = Submission.create!(user: @student, enrollment: @enrollment, content_block: block, text: "print('answer')")
    payload = show(@three)
    assert_equal "awaiting_review", payload["learner_status"]
    assert_equal "submitted", payload["content_blocks"].sole["learner_state"]
    assert_equal true, payload.dig("learning_navigation", "course_complete")
    assert_nil payload.dig("learning_navigation", "next")
    attempt.update!(grade: "R", feedback: "Try again", graded_at: Time.current)
    payload = show(@two)
    assert_equal false, payload.dig("learning_navigation", "course_complete")
    assert_equal @three.id, payload.dig("learning_navigation", "next", "id")
  end

  test "an earlier redo is not a next module transition" do
    block = @one.content_blocks.sole
    block.update!(block_type: :exercise, submission_type: :text_submission)
    [ @two, @three ].each { |lesson| finish(lesson) }
    Submission.create!(user: @student, enrollment: @enrollment, content_block: block, text: "Try", grade: "R", feedback: "Again", graded_at: Time.current)
    nav = show(@three).fetch("learning_navigation")
    assert_equal @one.id, nav.dig("next", "id")
    assert_equal false, nav["next_module"]
    assert_equal true, nav["next_redo"]
  end

  test "lesson instructor excludes either direction of block only when On" do
    teacher = User.create!(clerk_id: "nav_teacher", email: "nav_teacher@example.com", first_name: "Tia", last_name: "Teacher", role: :instructor)
    @cohort.cohort_instructor_assignments.create!(user: teacher)
    assert_equal teacher.id, show(@one).dig("instructor", "id")
    [ [ @student, teacher ], [ teacher, @student ] ].each do |blocker, blocked|
      block = UserBlock.create!(blocker: blocker, blocked_user: blocked)
      assert_nil show(@one)["instructor"]
      block.destroy!
    end
  end

  test "paused and alumni learners can browse available following lessons without completion" do
    @enrollment.update!(status: :paused, paused_at: Time.current)
    nav = show(@one).fetch("learning_navigation")
    assert_equal @two.id, nav.dig("next", "id")
    assert_equal false, nav["course_complete"]
    @cohort.update!(cohort_type: :alumni)
    nav = show(@one).fetch("learning_navigation")
    assert_equal @two.id, nav.dig("next", "id")
    assert_equal false, nav["course_complete"]
  end

  test "closed submissions still allow reading completion but never manual exercise completion" do
    teacher = User.create!(clerk_id: "window_teacher", email: "window_teacher@example.com", first_name: "Tia", last_name: "Teacher", role: :instructor)
    CohortModuleSubmissionWindow.create!(cohort: @cohort, curriculum_module: @first, week_number: 1, submissions_close_at: 1.hour.ago, created_by: teacher)
    block = @two.content_blocks.create!(block_type: :exercise, position: 1, submission_type: :manual_complete)
    payload = show(@one)
    assert_equal true, payload.dig("submission_window", "submissions_closed")
    assert_equal [ @one.content_blocks.sole.id ], payload.dig("learning_navigation", "manual_block_ids")
    patch "/api/v1/progress", params: { content_block_id: @one.content_blocks.sole.id, status: "completed", cohort_id: @cohort.id }, headers: { "Authorization" => "Bearer test_token_#{@student.id}" }
    assert_response :success
    refute_includes show(@two).dig("learning_navigation", "manual_block_ids"), block.id
  end

  test "manual exercises use the progress completion definition and off has no new payload" do
    block = @two.content_blocks.sole
    block.update!(block_type: :exercise, submission_type: :manual_complete)
    assert_equal [ block.id ], show(@two).dig("learning_navigation", "manual_block_ids")
    finish(@two)
    assert_empty show(@two).dig("learning_navigation", "manual_block_ids")
    @cohort.update!(settings: { "features" => { "student_experience_v2" => false } })
    payload = show(@two)
    refute payload.key?("learning_navigation")
    refute payload.key?("outline")
    refute payload["content_blocks"].sole.key?("learner_state")
  end

  test "locked, closed and paused content never becomes an actionable continuation" do
    [ @one, @two ].each { |lesson| finish(lesson) }
    @enrollment.module_assignments.find_by!(module_id: @second.id).update!(unlocked: false, unlock_date_override: Date.current + 30)
    assert_nil show(@two).dig("learning_navigation", "next")
    assert_equal false, show(@two).dig("learning_navigation", "course_complete")
    @enrollment.update!(status: :paused)
    assert_nil show(@two).dig("learning_navigation", "next")
  end

  test "lesson navigation queries stay flat when modules lessons and work really grow" do
    [ @one, @two, @three ].each { |lesson| finish(lesson) }
    check = @two.content_blocks.create!(block_type: :checkpoint, position: 1, title: "Initial check")
    check.create_knowledge_check!(prompt: "Synthetic?", options: [ "Yes", "No" ], correct_option: 0, explanation: "Synthetic answer")
    show(@two)
    before = count_queries { show(@two) }
    4.times do |index|
      mod = @first.curriculum.modules.create!(name: "More #{index}", position: index + 2, day_offset: 0, schedule_days: "daily")
      @enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
      6.times do |number|
        lesson = reading(mod, "Growing #{index} #{number}", number, 0)
        finish(lesson)
        grow_work(lesson, number)
      end
    end
    6.times do |index|
      check = @two.content_blocks.create!(block_type: :checkpoint, position: index + 2, title: "Growing check #{index}")
      check.create_knowledge_check!(prompt: "Synthetic #{index}?", options: [ "Yes", "No" ], correct_option: 0, explanation: "Synthetic answer")
    end
    6.times { |index| grow_work(@two, index + 10) }
    assert_equal 120, Submission.where(enrollment: @enrollment).count, "attempt history must grow across current and other lessons"
    assert_equal 6, @two.content_blocks.where(submission_type: :prework_github_sync).count
    after = count_queries { show(@two) }
    assert_equal 20, response.parsed_body.dig("lesson", "content_blocks").size, "current-lesson blocks must grow too"
    assert_equal 27, response.parsed_body.dig("lesson", "learning_navigation", "total"), "growth fixture must actually reach the endpoint"
    assert_equal before, after, "queries grew #{before} → #{after}"
  end

  private

  def grow_work(lesson, number)
    [ :text_submission, :prework_github_sync ].each_with_index do |kind, offset|
      block = lesson.content_blocks.create!(block_type: :exercise, position: number * 2 + offset + 30, submission_type: kind)
      2.times { |attempt| Submission.create!(user: @student, enrollment: @enrollment, content_block: block, text: "Evidence #{number} #{attempt}") }
    end
  end

  def reading(mod, title, position, day)
    mod.lessons.create!(title: title, position: position, release_day: day, lesson_type: :reading).tap do |lesson|
      lesson.content_blocks.create!(block_type: :text, position: 0, body: "Read")
    end
  end

  def finish(lesson)
    lesson.completion_blocks.each { |block| Progress.create!(user: @student, enrollment: @enrollment, content_block: block, status: :completed, completed_at: Time.current) }
  end

  def show(lesson)
    get "/api/v1/lessons/#{lesson.id}", params: { cohort_id: @cohort.id }, headers: { "Authorization" => "Bearer test_token_#{@student.id}" }
    assert_response :success
    response.parsed_body.fetch("lesson")
  end
end
