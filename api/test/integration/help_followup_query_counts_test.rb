require "test_helper"
require_relative "../support/query_counter"

# PR #282 fix round 1: the help request, follow-up plan and Support pages send
# the same number of queries however many replies, notes, requests and plans
# they show. Each test measures twice, warm, at a small and a larger size.
class HelpFollowupQueryCountsTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    @curriculum = Curriculum.create!(name: "Counted course")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Counted cohort", start_date: Date.current, status: :active)
    @instructor = person("instructor", :instructor)
    @admin = person("admin", :admin)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @students = []
  end

  test "follow-up plan detail with more notes" do
    plan = Intervention.create!(enrollment: enroll(person("planned", :student)), trigger_type: :manual, owner: @instructor, created_by: @admin, next_follow_up_at: 1.day.from_now)
    counts = [ 1, 10 ].map do |size|
      (plan.notes.count...size).each { |index| plan.notes.create!(author: index.even? ? @instructor : @admin, body: "Note #{index}") }
      measure(@instructor, "/api/v1/interventions/#{plan.id}") { assert_equal size, response.parsed_body.dig("intervention", "notes").size }
    end
    assert_equal counts.first, counts.last, "GET /interventions/:id sent #{counts.join(' then ')} queries for 1 then 10 notes"
  end

  test "Support with more exercise-context requests, replies, resolved requests and plans" do
    counts = [ 1, 6 ].map do |size|
      grow_to(size)
      measure(@instructor, "/api/v1/support_queue") { assert_equal size, response.parsed_body.dig("support_queue", "help_requests").size }
    end
    assert_equal counts.first, counts.last, "GET /support_queue sent #{counts.join(' then ')} queries for 1 then 6 of each"
  end

  test "help request list with more exercise-context requests and replies" do
    counts = [ 1, 6 ].map do |size|
      grow_to(size)
      measure(@instructor, "/api/v1/help_requests")
    end
    assert_equal counts.first, counts.last, "GET /help_requests sent #{counts.join(' then ')} queries for 1 then 6 of each"
  end

  private

  def grow_to(size)
    while @students.size < size
      index = @students.size
      student = person("learner#{index}", :student)
      enrollment = enroll(student)
      lesson = Lesson.create!(curriculum_module: @module, title: "Lesson #{index}", position: index, release_day: 0)
      block = lesson.content_blocks.create!(block_type: :exercise, title: "Exercise #{index}", position: 0, submission_type: :text_submission)
      open = help(student, block, "Open #{index}")
      open.reply!(index.even? ? @instructor : @admin, body: "Hint #{index}")
      open.reply!(@instructor, body: "Another hint #{index}")
      help(student, lesson.content_blocks.create!(block_type: :exercise, title: "Done #{index}", position: 1, submission_type: :text_submission), "Resolved #{index}")
        .reply!(@admin, body: "Answer #{index}", resolve: true)
      plan = Intervention.create!(enrollment: enrollment, help_request: open, trigger_type: :help_request, owner: index.even? ? @instructor : @admin, created_by: @admin, next_follow_up_at: 1.day.ago)
      RecoveryPlan.create!(enrollment: enrollment, intervention: plan, owner: @instructor, created_by: @admin, source: :manual, target_pace: "Weekly", required_scope: "Labs", next_check_in_at: 1.day.ago)
      @students << student
    end
  end

  def help(student, block, message)
    HelpRequest.create!(student: student, cohort: @cohort, context_type: :exercise, context_source: :primary, context_id: block.id,
      context_label: block.title, context_path: "/lessons/#{block.lesson_id}", category: :concept, message: message)
  end

  def measure(user, path)
    as_user(user) { get path, headers: auth_headers }
    assert_response :success
    yield if block_given?
    count = count_queries { as_user(user) { get path, headers: auth_headers } }
    assert_response :success
    count
  end

  def enroll(student)
    Enrollment.create!(user: student, cohort: @cohort, status: :active)
  end

  def person(name, role)
    User.create!(clerk_id: "counted_#{name}", email: "counted-#{name}@example.com", first_name: "Counted", last_name: name.capitalize, role: role)
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
