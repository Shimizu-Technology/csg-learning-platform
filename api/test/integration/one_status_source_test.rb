require "test_helper"

# U-0.5 and 9.2b: one learner with mixed work reads the same numbers on every
# staff and learner surface. Counts and statuses come from LearnerProgress and
# "last active" from LearnerActivity, so the Students list, the student page,
# cohort home, the attention list, staff and learner Today, Learn, the student
# preview and the peek card can't disagree. The mix covers each way they used
# to: a redo whose old progress row still says completed, work waiting for
# review (handed in, so it counts), graded work, a credited video, an untouched
# lesson, and a lesson assigned on its own outside an assigned module.
class OneStatusSourceTest < ActionDispatch::IntegrationTest
  setup do
    @curriculum = Curriculum.create!(name: "Status curriculum")
    @mod = @curriculum.modules.create!(name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @extra = @curriculum.modules.create!(name: "Week 2", position: 1, day_offset: 0, schedule_days: "daily")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Status cohort", start_date: Date.current - 7, status: :active)
    @teacher = person("teacher", :instructor)
    @admin = person("admin", :admin)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @student = person("alex", :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active, joined_at: 3.days.ago)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)

    redo_lesson = lesson(@mod, "Redo", 0)
    pending = lesson(@mod, "Pending", 1)
    graded = lesson(@mod, "Graded", 2)
    video = lesson(@mod, "Video", 3, block: :video)
    lesson(@mod, "Untouched", 4)
    own = lesson(@extra, "Assigned on its own", 0, block: :video)
    @enrollment.lesson_assignments.create!(lesson: own, unlocked: true)

    evidence(redo_lesson, progress: :completed, grade: "R")
    @pending_submission = evidence(pending, progress: :completed, grade: nil)
    # A second finished exercise in the graded lesson makes steps (5 of 7) and
    # lessons (4 of 6) differ, so a surface that reports one as the other fails.
    second_exercise = graded.content_blocks.create!(block_type: :exercise, position: 2, title: "Graded second exercise", submission_type: :text_submission)
    evidence(graded, progress: :completed, grade: "A", block: graded.content_blocks.find_by!(position: 1))
    evidence(graded, progress: :completed, grade: "B", block: second_exercise)
    evidence(video, progress: :completed)
    evidence(own, progress: :completed)
    @pending_submission.update!(created_at: 2.hours.ago)
  end

  test "every surface reports the same counts, status and last active" do
    expected = LearnerProgress.new(@enrollment.reload).overall
    assert_equal({ completed: 5, total: 7, percentage: 71.4, completed_lessons: 4, total_lessons: 6 }, expected,
      "the redo is not handed in even though its old progress row says completed; waiting work is")
    steps = [ 5, 7, 71.4 ]
    lessons = [ 4, 6 ]
    last_active = @pending_submission.created_at.iso8601(3)

    # Staff Students list and staff Today read the dashboard's attention rows.
    get "/api/v1/dashboard", headers: headers(@teacher)
    assert_response :success
    dashboard = response.parsed_body["dashboard"]
    row = dashboard["cohorts"].sole["students"].find { |item| item["user_id"] == @student.id }
    assert_row(row, steps, lessons, last_active)
    attention_row = dashboard.dig("attention", "students").find { |item| item["user_id"] == @student.id }
    assert_row(attention_row, steps, lessons, last_active)

    # The attention list (Support).
    get "/api/v1/support_queue", headers: headers(@teacher)
    assert_response :success
    assert_row(response.parsed_body.dig("support_queue", "students").find { |item| item["user_id"] == @student.id }, steps, lessons, last_active)

    # Cohort home.
    get "/api/v1/cohorts/#{@cohort.id}/home", headers: headers(@teacher)
    assert_response :success
    home = response.parsed_body["home"]
    assert_row(home["students"].find { |item| item["user_id"] == @student.id }, steps, lessons, last_active)

    # The student page, which the student preview also reads.
    get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_response :success
    page = response.parsed_body
    assert_equal steps + lessons, page["overall_progress"].values_at("completed", "total", "percentage", "completed_lessons", "total_lessons")
    assert_equal last_active, Time.zone.parse(page.dig("user", "last_active_at")).iso8601(3)
    assert_equal [ "Work to review", true ], page["status"].values_at("label", "needs_attention")
    assert_equal row["status_label"], page.dig("status", "label")
    assert_equal lessons, sum_lessons(page["modules"])
    assert_equal steps.first(2), sum_steps(page["modules"])
    assert_equal [ "redo", "awaiting_review", "done", "done", "open" ], page["modules"].first["lessons"].map { |item| item["learner_status"] }

    # The roster on the cohort page shows the same last active.
    get "/api/v1/cohorts/#{@cohort.id}", headers: headers(@teacher)
    assert_response :success
    roster_row = response.parsed_body.dig("cohort", "students").find { |item| item["user_id"] == @student.id }
    assert_equal last_active, Time.zone.parse(roster_row["last_active_at"]).iso8601(3)

    # The peek card.
    get "/api/v1/records/student/#{@student.id}/summary", params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_response :success
    summary = response.parsed_body["summary"] || response.parsed_body
    facts = summary["facts"].index_by { |fact| fact["key"] }
    assert_equal "#{lessons[0]} / #{lessons[1]}", facts.dig("progress", "value"), "the peek card counts lessons, not steps"
    assert_equal row["status_label"], facts.dig("status", "value")
    assert_equal last_active, Time.zone.parse(summary["last_active_at"]).iso8601(3)

    # Enrollment detail.
    get "/api/v1/enrollments/#{@enrollment.id}", headers: headers(@admin)
    assert_response :success
    enrollment = response.parsed_body["enrollment"]
    assert_equal steps + lessons, enrollment.values_at("completed_blocks", "total_blocks", "progress_percentage", "completed_lessons", "total_lessons")

    # The learner's Today and Learn (the same dashboard payload).
    get "/api/v1/dashboard", headers: headers(@student)
    assert_response :success
    learner = response.parsed_body["dashboard"]
    assert_equal steps + lessons, learner["overall_progress"].values_at("completed", "total", "percentage", "completed_lessons", "total_lessons")
    assert_equal lessons, sum_lessons(learner["modules"])
    assert_equal steps.first(2), sum_steps(learner["modules"])

    # The learner's own cohort home percentage.
    get "/api/v1/cohorts/#{@cohort.id}/home", headers: headers(@student)
    assert_response :success
    assert_equal steps.last, (response.parsed_body["home"])["own_progress_percentage"]
  end

  test "staff grading never counts as the learner being active" do
    graded_at = 1.minute.ago
    ActivityEvent.record!(event_type: "submission_graded", actor: @teacher, subject_user: @student, cohort: @cohort)
    @student.update!(last_seen_at: Time.current, last_sign_in_at: Time.current)

    activity = LearnerActivity.last_active_at(@enrollment)
    assert_operator activity, :<, graded_at, "sign-ins, presence and staff grading are not learning activity"
    assert_equal @pending_submission.created_at.to_i, activity.to_i
  end

  private

  def assert_row(row, steps, lessons, last_active)
    assert row, "the learner has a row"
    assert_equal steps, row.values_at("completed_blocks", "total_blocks", "progress_percentage")
    assert_equal lessons, row.values_at("completed_lessons", "total_lessons")
    assert_equal last_active, Time.zone.parse(row["last_activity_at"]).iso8601(3)
    assert_equal "Work to review", row["status_label"]
  end

  def sum_steps(modules)
    [ modules.sum { |mod| mod["completed_blocks"] }, modules.sum { |mod| mod["total_blocks"] } ]
  end

  def sum_lessons(modules)
    [ modules.sum { |mod| mod["completed_lessons"] }, modules.sum { |mod| mod["total_lessons"] } ]
  end

  def lesson(mod, title, position, block: :exercise)
    lesson = mod.lessons.create!(title: title, position: position, release_day: 0)
    if block == :video
      lesson.content_blocks.create!(block_type: :video, position: 0, title: "#{title} video", video_url: "https://www.youtube.com/watch?v=example")
    else
      lesson.content_blocks.create!(block_type: :video, position: 0, title: "#{title} intro", video_url: "https://www.youtube.com/watch?v=example")
      lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "#{title} exercise", submission_type: :text_submission)
    end
    lesson
  end

  def evidence(lesson, progress:, grade: :none, block: lesson.content_blocks.max_by(&:position))
    Progress.create!(enrollment: @enrollment, user: @student, content_block: block, status: progress, completed_at: 1.day.ago)
    return if grade == :none

    Submission.create!(user: @student, enrollment: @enrollment, content_block: block, text: "Answer", grade: grade, graded_at: grade && 1.day.ago).tap do |submission|
      submission.update_columns(created_at: 1.day.ago) unless grade.nil?
    end
  end

  def person(name, role)
    User.create!(clerk_id: "status_#{name}", email: "status-#{name}@example.com", first_name: name.capitalize, last_name: "Synthetic", role: role)
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
end
