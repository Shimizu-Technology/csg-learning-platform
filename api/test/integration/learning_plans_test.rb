require "test_helper"

class LearningPlansTest < ActionDispatch::IntegrationTest
  def setup
    @admin = person("Admin", :admin)
    @teacher = person("Teacher", :instructor)
    @outsider = person("Outsider", :instructor)
    @learner = person("Learner", :student)
    @other = person("Other", :student)
    @curriculum = Curriculum.create!(name: "Personal plan curriculum")
    @mod = @curriculum.modules.create!(name: "Foundations", position: 0, schedule_days: "daily")
    @stretch = lesson("Optional review", 0, false)
    @first = lesson("Backend", 1, true)
    @second = lesson("Frontend", 2, true)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Individual pace", status: :active, start_date: 1.month.ago)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @enrollment = Enrollment.create!(cohort: @cohort, user: @learner)
    @other_enrollment = Enrollment.create!(cohort: @cohort, user: @other)
    [ @enrollment, @other_enrollment ].each { |enrollment| enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true) }
    @path = "/api/v1/enrollments/#{@enrollment.id}/learning_plan"
  end

  test "regular curriculum has no plan and the next task prioritizes required work" do
    get @path, headers: headers(@teacher)
    assert_response :success
    assert_nil response.parsed_body["learning_plan"]
    assert_equal 3, response.parsed_body["lessons"].size
    get "/api/v1/dashboard", headers: headers(@learner)
    assert_response :success
    assert_equal @first.id, response.parsed_body.dig("dashboard", "continue_lesson", "id")
  end

  test "save uses shared lessons and affects only the selected enrollment" do
    put @path, params: { learning_plan: plan_input }, headers: headers(@teacher), as: :json
    assert_response :success
    assert_equal 0, response.parsed_body.dig("learning_plan", "lock_version")
    assert_equal 1, response.parsed_body["revisions"].size
    assert_equal @teacher.full_name, response.parsed_body.dig("revisions", 0, "author")
    assert @first.reload.required?
    assert_nil @other_enrollment.reload.learning_plan

    get "/api/v1/dashboard", headers: headers(@learner)
    assert_response :success
    dashboard = response.parsed_body["dashboard"]
    assert_equal @second.id, dashboard.dig("continue_lesson", "id")
    assert_equal 1, dashboard.dig("overall_progress", "total")
    assert_equal 1, dashboard.dig("personal_plan", "required_count")
    assert_equal false, dashboard.dig("modules", 0, "lessons", 1, "required")
    get "/api/v1/modules/#{@mod.id}?cohort_id=#{@cohort.id}", headers: headers(@learner)
    assert_equal false, response.parsed_body.dig("module", "lessons", 1, "required")
    get "/api/v1/lessons/#{@first.id}?cohort_id=#{@cohort.id}", headers: headers(@learner)
    assert_equal false, response.parsed_body.dig("lesson", "required")
    get "/api/v1/progress/student/#{@learner.id}?cohort_id=#{@cohort.id}", headers: headers(@teacher)
    assert_equal 1, response.parsed_body.dig("personal_plan", "required_count")
    assert_equal 1, response.parsed_body.dig("overall_progress", "total")
  end

  test "weekly and self paced views apply personal requirements and milestone ordering" do
    @enrollment.create_learning_plan!(plan_input)
    get "/api/v1/weekly_plan", headers: headers(@learner)
    assert_response :success
    assert_equal @second.id, response.parsed_body.dig("weekly_plan", "personal_plan", "next_lesson", "lesson_id")
    assert_includes response.parsed_body.dig("weekly_plan", "optional").map { |item| item["lesson_id"] }, @first.id
    @cohort.update!(course_delivery: "self_paced")
    get "/api/v1/weekly_plan", headers: headers(@learner)
    assert_equal @second.id, response.parsed_body.dig("weekly_plan", "course_overview", "next_lesson", "lesson_id")
  end

  test "staff preview includes the selected learner support without starting their support clock" do
    @enrollment.create_learning_plan!(plan_input)
    block = @second.content_blocks.first
    submission = Submission.create!(user: @learner, enrollment: @enrollment, content_block: block, grade: :R, feedback: "Recheck ownership", graded_at: Time.current)
    now = Time.find_zone!("Pacific/Guam").local(2026, 10, 24, 10)
    event = @cohort.office_hours.create!(title: "Next session", starts_at: now + 1.hour, ends_at: now + 2.hours, meeting_url: "https://meet.example.com/class", timezone: "Pacific/Guam", recurrence: :once, created_by: @teacher)
    travel_to(now) do
      get "/api/v1/progress/student/#{@learner.id}?cohort_id=#{@cohort.id}", headers: headers(@teacher)
      assert_response :success
      weekly = response.parsed_body["weekly_plan"]
      assert_equal @cohort.id, weekly.dig("cohort", "id")
      assert_equal submission.id, weekly.dig("redos", 0, "submission_id")
      assert_equal event.id, weekly.dig("events", 0, "office_hour_id")
      assert_equal @second.id, weekly.dig("personal_plan", "next_lesson", "lesson_id")
      @cohort.update!(course_delivery: "self_paced")
      before = @enrollment.reload.attributes
      get "/api/v1/progress/student/#{@learner.id}?cohort_id=#{@cohort.id}", headers: headers(@teacher)
      assert_response :success
      assert_equal before, @enrollment.reload.attributes
      assert_nil @enrollment.first_opened_at
      assert_equal submission.id, response.parsed_body.dig("weekly_plan", "redos", 0, "submission_id")
    end
  end

  test "personal targets retain enforced submission deadlines including lessons outside milestones" do
    @enrollment.create_learning_plan!(plan_input)
    close_at = 1.day.ago.change(usec: 0)
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 1, submissions_close_at: close_at)
    get "/api/v1/dashboard", headers: headers(@learner)
    assert_response :success
    deadlines = response.parsed_body.dig("dashboard", "personal_plan", "submission_deadlines")
    assert_equal [ @second.id ], deadlines.map { |item| item["lesson_id"] }
    assert_equal true, deadlines.first["closed"]
    assert_equal close_at, Time.parse(deadlines.first["closes_at"])
    assert_equal true, deadlines.first["available"]
    @enrollment.module_assignments.first.update!(unlocked: false, unlock_date_override: 1.month.from_now.to_date)
    get "/api/v1/dashboard", headers: headers(@learner)
    assert_equal false, response.parsed_body.dig("dashboard", "personal_plan", "submission_deadlines", 0, "available")
    @enrollment.learning_plan.update!(milestones: [])
    get "/api/v1/dashboard", headers: headers(@learner)
    assert_equal @second.id, response.parsed_body.dig("dashboard", "personal_plan", "submission_deadlines", 0, "lesson_id")
  end

  test "selected enrollment projection retains a personal lesson-only assignment outside the cohort schedule" do
    mod = @curriculum.modules.create!(name: "Individual lesson", position: 1, schedule_days: "daily")
    lesson = mod.lessons.create!(title: "Individual project", position: 0, release_day: 0, required: true)
    block = lesson.content_blocks.create!(block_type: :exercise, position: 0, submission_type: :text_submission)
    @enrollment.lesson_assignments.create!(lesson: lesson, unlocked: true)
    @enrollment.create_learning_plan!(plan_input.merge(milestones: [ { title: "My individual task", due_on: "2026-12-05", lesson_ids: [ lesson.id ] } ]))
    Submission.create!(user: @learner, enrollment: @enrollment, content_block: block, grade: :R, feedback: "Try again")
    get "/api/v1/progress/student/#{@learner.id}?cohort_id=#{@cohort.id}", headers: headers(@teacher)
    assert_response :success
    actual = response.parsed_body["modules"].find { |item| item["id"] == mod.id }["lessons"].first
    assert_equal true, actual["assigned"]
    assert_equal true, actual["available"]
    assert_equal "redo_requested", actual["review_status"]
    assert_equal lesson.id, response.parsed_body.dig("personal_plan", "next_lesson", "lesson_id")
    assert_equal lesson.id, response.parsed_body.dig("weekly_plan", "personal_plan", "next_lesson", "lesson_id")
  end

  test "staff projection loads submission windows once as the curriculum grows" do
    12.times { |index| @mod.lessons.create!(title: "Later work #{index}", position: index + 3, release_day: index * 7 + 7) }
    queries = []
    subscriber = ->(_name, _start, _finish, _id, payload) { queries << payload[:sql] if !payload[:cached] && payload[:sql].match?(/SELECT.*cohort_module_submission_windows/) }
    ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") do
      get "/api/v1/progress/student/#{@learner.id}?cohort_id=#{@cohort.id}", headers: headers(@teacher)
    end
    assert_response :success
    assert_equal 1, queries.size
  end

  test "students and staff outside the cohort cannot manage a plan" do
    [ @learner, @other, @outsider ].each do |user|
      get @path, headers: headers(user)
      assert_response :forbidden
      put @path, params: { learning_plan: plan_input }, headers: headers(user), as: :json
      assert_response :forbidden
    end
    assert_nil @enrollment.reload.learning_plan
  end

  test "invalid lesson scopes dates and missing reasons reject the whole write" do
    foreign = Curriculum.create!(name: "Other curriculum").modules.create!(name: "Foreign", position: 0)
    foreign_lesson = foreign.lessons.create!(title: "Not assigned", position: 0)
    variants = [
      plan_input.merge(milestones: [ { title: "Foreign", due_on: "2026-12-05", lesson_ids: [ foreign_lesson.id ] } ]),
      plan_input.merge(milestones: [ { title: "Invalid", due_on: "2026-02-30", lesson_ids: [ @second.id ] } ]),
      plan_input.merge(milestones: [ { title: "Empty", due_on: "2026-12-05", lesson_ids: [] } ]),
      plan_input.merge(lesson_overrides: [ { lesson_id: @first.id, required: false, reason: "" } ]),
      plan_input.merge(target_date: "2026-10-01")
    ]
    variants.each do |attributes|
      put @path, params: { learning_plan: attributes }, headers: headers(@admin), as: :json
      assert_response :unprocessable_entity
      assert_nil @enrollment.reload.learning_plan
    end
  end

  test "stale or missing versions do not overwrite an existing plan" do
    put @path, params: { learning_plan: plan_input }, headers: headers(@admin), as: :json
    assert_response :success
    put @path, params: { learning_plan: plan_input.merge(title: "Latest", lock_version: 0) }, headers: headers(@admin), as: :json
    assert_response :success
    [ nil, 0 ].each do |version|
      put @path, params: { learning_plan: plan_input.merge(title: "Stale", lock_version: version) }, headers: headers(@teacher), as: :json
      assert_response :conflict
    end
    assert_equal "Latest", @enrollment.reload.learning_plan.title
    assert_equal 2, @enrollment.learning_plan.revisions.count
  end

  test "restoring regular curriculum preserves submitted work and audit history" do
    block = @second.content_blocks.first
    submission = Submission.create!(user: @learner, enrollment: @enrollment, content_block: block, text: "My original work")
    progress = Progress.create!(user: @learner, enrollment: @enrollment, content_block: block, status: :completed)
    put @path, params: { learning_plan: plan_input }, headers: headers(@admin), as: :json
    put @path, params: { learning_plan: { active: false, lock_version: 0 } }, headers: headers(@admin), as: :json
    assert_response :success
    assert_not @enrollment.reload.learning_plan.active?
    assert_equal 2, @enrollment.learning_plan.revisions.count
    assert_equal "My original work", submission.reload.text
    assert progress.reload.completed?
    get "/api/v1/dashboard", headers: headers(@learner)
    assert_nil response.parsed_body.dig("dashboard", "personal_plan")
    assert_equal 3, response.parsed_body.dig("dashboard", "overall_progress", "total")
    assert_equal @first.id, response.parsed_body.dig("dashboard", "continue_lesson", "id")
  end

  test "plan targets never grant access or change the original unlock schedule" do
    assignment = @enrollment.module_assignments.first
    assignment.update!(unlocked: false, unlock_date_override: 1.month.from_now.to_date)
    put @path, params: { learning_plan: plan_input }, headers: headers(@teacher), as: :json
    assert_response :success
    get "/api/v1/dashboard", headers: headers(@learner)
    assert_nil response.parsed_body.dig("dashboard", "personal_plan", "next_lesson")
    get "/api/v1/lessons/#{@second.id}?cohort_id=#{@cohort.id}", headers: headers(@learner)
    assert_response :forbidden
    assert_equal 1.month.from_now.to_date, assignment.reload.unlock_date_override
  end

  private

  def person(name, role)
    user = User.create!(first_name: name, last_name: "Plan", email: "#{name.downcase}@plans.invalid", clerk_id: "plan_#{name}", role: role)
    ClerkIdentity.create!(user: user, issuer: "https://test.clerk.invalid", clerk_user_id: user.clerk_id)
    user
  end

  def lesson(title, position, required)
    lesson = @mod.lessons.create!(title: title, position: position, release_day: position, required: required)
    lesson.content_blocks.create!(block_type: :checkpoint, position: 0, title: title)
    lesson
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }

  def plan_input
    {
      active: true, title: "Finish my application", target_date: "2026-12-05", next_check_in_on: "2026-10-31",
      milestones: [ { title: "Frontend", due_on: "2026-11-14", lesson_ids: [ @second.id ] } ],
      lesson_overrides: [ { lesson_id: @first.id, required: false, reason: "Agreed enrichment after the core project" } ]
    }
  end
end
