require "test_helper"
require_relative "../support/query_counter"

class LearnerExtensionsTest < ActionDispatch::IntegrationTest
  include QueryCounter
  setup do
    curriculum = Curriculum.create!(name: "Extensions")
    @mod = curriculum.modules.create!(name: "Module", position: 0, day_offset: 0)
    @lesson = @mod.lessons.create!(title: "Work", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Answer", submission_type: "text_submission")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Program", start_date: 2.weeks.ago.to_date)
    @teacher = person("teacher", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @student = person("student", :student)
    @enrollment = Enrollment.create!(cohort: @cohort, user: @student, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 1, submissions_close_at: 1.day.ago)
    @path = "/api/v1/enrollments/#{@enrollment.id}/extensions"
  end

  test "grant, change and removal enforce effective window and retain history" do
    submit
    assert_response :forbidden
    grant
    assert_response :success
    id = response.parsed_body.fetch("extensions").first.fetch("id")
    get @path, headers: headers(@teacher)
    assert_response :success
    submit
    assert_response :success
    patch "#{@path}/#{id}", params: input.merge(reason: "Changed"), headers: headers(@teacher), as: :json
    assert_response :success
    delete "#{@path}/#{id}", params: { reason: "No longer needed" }, headers: headers(@teacher), as: :json
    assert_response :success
    assert_equal 3, response.parsed_body.fetch("extensions").first.fetch("revisions").size
    submit
    assert_response :forbidden
  end

  test "reason required and unauthorized reads and writes are uniformly not found" do
    post @path, params: input.merge(reason: " "), headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    [ @student, person("outsider", :instructor) ].each do |actor|
      post @path, params: input, headers: headers(actor), as: :json
      assert_response :not_found
      assert_equal({ "error" => "Not found" }, response.parsed_body)
      get @path, headers: headers(actor)
      assert_response :not_found
      assert_equal({ "error" => "Not found" }, response.parsed_body)
    end
  end

  test "unknown grants are not found and invalid changes preserve history" do
    patch "#{@path}/99999999", params: input, headers: headers(@teacher), as: :json
    assert_response :not_found
    delete "#{@path}/99999999", params: { reason: "Missing" }, headers: headers(@teacher), as: :json
    assert_response :not_found
    grant
    id = response.parsed_body.fetch("extensions").first.fetch("id")
    patch "#{@path}/#{id}", params: input.merge(reason: ""), headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    delete "#{@path}/#{id}", params: { reason: "" }, headers: headers(@teacher), as: :json
    assert_response :unprocessable_entity
    assert_equal 1, LearnerExtension.find(id).revisions.size
    assert_nil LearnerExtension.find(id).removed_at
  end

  test "program effective windows are byte identical without grants" do
    original = SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson)
    assert_equal original.to_json, SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: @enrollment).to_json
    grant
    other = Enrollment.create!(cohort: @cohort, user: person("other", :student), status: :active)
    assert_equal original.to_json, SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: other).to_json
  end

  test "queue and workspace queries stay flat as extension fixtures grow" do
    grant
    submit
    row = GradingQueue.new(viewer: @teacher, cohort: @cohort).as_json.fetch(:submissions).first
    assert_equal "Travel", row.fetch(:extensions).first.fetch("reason")
    assert_not row.fetch(:submission_window).fetch(:submissions_closed)
    measure = lambda do
      queue = count_queries { GradingQueue.new(viewer: @teacher, cohort: @cohort).as_json }
      workspace = count_queries { get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @cohort.id }, headers: headers(@teacher) }
      assert_response :success
      [ queue, workspace ]
    end
    measure.call
    one = measure.call
    4.times do |index|
      student = person("more#{index}", :student)
      enrollment = Enrollment.create!(cohort: @cohort, user: student, status: :active)
      enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
      enrollment.learner_extensions.new(scope: "lesson", lesson: @lesson, submissions_close_at: 2.days.from_now, reason: "Travel").record_change!(actor: @teacher)
      Submission.create!(user: student, enrollment: enrollment, content_block: @block, text: "Answer", submission_type: "text_submission")
      @enrollment.learner_extensions.new(scope: "lesson", lesson: @lesson, submissions_close_at: (index + 3).days.from_now, reason: "Additional").record_change!(actor: @teacher)
    end
    assert_equal one, measure.call
  end

  test "final extensions shift future milestones, survive replanning, and retain both histories" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 4, 6 ])
    @lesson.update!(lesson_type: :project)
    LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    target = 8.weeks.from_now.in_time_zone("Pacific/Guam").end_of_day
    post @path, params: { scope: "final", submissions_close_at: target.iso8601, reason: "Medical leave" }, headers: headers(@teacher), as: :json
    assert_response :success
    plan = @enrollment.learning_plan.reload
    assert_equal target.to_date, plan.target_date
    assert plan.revisions.count >= 2
    LearnerPace.new(@enrollment.reload).choose!(weeks: 12, actor: @teacher)
    assert_equal target.to_date, @enrollment.learning_plan.reload.target_date
    assert_equal target.to_i, SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: @enrollment.reload)[:submissions_close_at].to_i
    assert_equal "Medical leave", @enrollment.learner_extensions.first.reason
    travel_to(target + 1.second) do
      submit
      assert_response :forbidden
    end
  end

  test "a module-week grant affects only that module week" do
    post @path, params: input.except(:lesson_id).merge(scope: "module", module_id: @mod.id, week_number: 1), headers: headers(@teacher), as: :json
    assert_response :success
    assert_not SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: @enrollment.reload)[:submissions_closed]
    second = @mod.lessons.create!(title: "Week two", position: 1, release_day: 7)
    original = SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: second)
    assert_equal original, SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: second, enrollment: @enrollment.reload)
  end

  test "weekly pace milestones remain soft even after cohort windows close" do
    @cohort.update!(course_delivery: "guided", learner_pace_weeks: [ 3, 4, 6 ])
    LearnerPace.new(@enrollment).choose!(weeks: 3, actor: @teacher)
    assert_not SubmissionWindowStatus.for_lesson(cohort: @cohort, lesson: @lesson, enrollment: @enrollment.reload)[:submissions_closed]
    submit
    assert_response :success
  end

  private

  def person(name, role)
    user = User.create!(clerk_id: "extensions_#{name}", email: "extensions_#{name}@example.com", role: role)
    user.clerk_identities.create!(issuer: ClerkEnvironment.primary&.issuer || "https://test.clerk.invalid", clerk_user_id: user.clerk_id)
    user
  end
  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
  def input = { scope: "lesson", lesson_id: @lesson.id, submissions_close_at: 2.days.from_now.iso8601, reason: "Travel" }
  def grant = post(@path, params: input, headers: headers(@teacher), as: :json)
  def submit = post("/api/v1/submissions", params: { content_block_id: @block.id, cohort_id: @cohort.id, text: "Answer" }, headers: headers(@student), as: :json)
end
