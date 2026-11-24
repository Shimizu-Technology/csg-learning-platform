require "test_helper"
require_relative "../support/query_counter"

# U-4.7: staff can reply to a help request and keep it open, or reply and
# resolve it. Each reply notifies the learner once, through the same
# help-request notification as acknowledging and resolving.
class HelpRequestRepliesTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper
  include QueryCounter

  def setup
    @curriculum = Curriculum.create!(name: "Replies course")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Loops", position: 0, release_day: 0)
    @student = person("student", :student)
    @instructor = person("instructor", :instructor)
    @other_instructor = person("other", :instructor)
    @admin = person("admin", :admin)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Replies cohort", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Other cohort", start_date: Date.current, status: :active)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort.cohort_instructor_assignments.create!(user: @other_instructor)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @help = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_source: :primary, context_id: @lesson.id,
      context_label: "Loops", context_path: "/lessons/#{@lesson.id}?cohort_id=#{@cohort.id}", category: :concept, message: "Why does my loop stop early?")
    NotificationDeliveryService.help_request_created(@help, push: false)
  end

  test "Reply posts the reply and keeps the request open, acknowledged by the replier" do
    assert_enqueued_jobs 1, only: PushNotificationJob do
      reply(@instructor, "Check the loop condition on line 3.")
    end

    assert_response :created
    body = response.parsed_body
    assert_equal "acknowledged", body.dig("help_request", "status")
    assert_equal "Check the loop condition on line 3.", body.dig("reply", "body")
    assert_equal false, body.dig("reply", "resolved_request")
    assert_equal [ "Check the loop condition on line 3." ], body.dig("help_request", "replies").map { |item| item["body"] }
    @help.reload
    assert @help.status_acknowledged?
    assert_equal @instructor, @help.owner
    assert_nil @help.resolved_at
    assert_equal "Check the loop condition on line 3.", @help.staff_response, "installed clients read the latest reply here"

    note = Notification.find_by!(notifiable: @help, user: @student)
    assert_equal "#{@instructor.full_name} replied to your help request", note.title
    assert_nil note.read_at
    # Still open, so other staff keep their unread "asked for help" notification.
    assert_nil Notification.find_by!(notifiable: @help, user: @admin).read_at
  end

  test "a second reply keeps the request active and updates the learner's one notification" do
    reply(@instructor, "First hint.")
    Notification.find_by!(notifiable: @help, user: @student).update!(read_at: Time.current)

    assert_enqueued_jobs 1, only: PushNotificationJob do
      reply(@admin, "Second hint.")
    end

    assert_response :created
    assert_equal "acknowledged", @help.reload.status
    assert_equal [ "First hint.", "Second hint." ], @help.replies.map(&:body)
    assert_equal "Second hint.", @help.staff_response
    assert_equal 1, Notification.where(notifiable: @help, user: @student).count
    assert_nil Notification.find_by!(notifiable: @help, user: @student).read_at, "a new reply is unread again"
  end

  test "Reply & resolve saves the reply, resolves, and notifies the learner once" do
    reply(@instructor, "You were missing a closing bracket.", resolve: true)
    assert_response :created
    assert_equal "resolved", response.parsed_body.dig("help_request", "status")
    assert_equal true, response.parsed_body.dig("reply", "resolved_request")
    @help.reload
    assert @help.status_resolved?
    assert @help.resolved_at
    assert_equal 1, @help.replies.count

    jobs = enqueued_jobs.select { |job| job["job_class"] == "PushNotificationJob" }
    assert_equal 1, jobs.size, "one push for reply and resolve together"
    student_note = Notification.find_by!(notifiable: @help, user: @student)
    assert_equal "Help request resolved", student_note.title
    assert_equal [ student_note.id ], jobs.first["arguments"].last
    assert Notification.find_by!(notifiable: @help, user: @admin).read_at, "resolving closes staff notifications"
  end

  test "the legacy PATCH resolve still works for installed apps and is saved as a reply" do
    as_user(@instructor) { patch "/api/v1/help_requests/#{@help.id}", params: { help_request: { status: "resolved", staff_response: "Legacy answer" } }, headers: auth_headers }

    assert_response :success
    assert_equal true, response.parsed_body["status_changed"]
    assert_equal [ [ "Legacy answer", true ] ], @help.reload.replies.map { |item| [ item.body, item.resolved_request ] }
    assert_equal 1, enqueued_jobs.count { |job| job["job_class"] == "PushNotificationJob" }
  end

  test "a resolved or canceled request takes no reply and notifies nobody" do
    @help.resolve!(@instructor, response: "Done.")
    clear_enqueued_jobs

    reply(@instructor, "One more thing.")
    assert_response :unprocessable_entity
    assert_equal 1, @help.reload.replies.count
    assert_no_enqueued_jobs only: PushNotificationJob
  end

  test "a blank reply is refused without changing the request" do
    reply(@instructor, " \n\t ")
    assert_response :unprocessable_entity
    assert @help.reload.status_open?
    assert_empty @help.replies
    assert_no_enqueued_jobs only: PushNotificationJob

    reply(@instructor, "x" * 2_001)
    assert_response :unprocessable_entity
    assert @help.reload.status_open?
  end

  test "only staff who can open the request may reply first" do
    reply(@student, "Answering myself")
    assert_response :unprocessable_entity
    assert_match "once your instructor answers", response.parsed_body["error"]

    reply(@other_instructor, "Not my cohort")
    assert_response :not_found

    assert @help.reload.status_open?
    assert_empty @help.replies
  end

  test "the learner follows up after a staff reply and the owner is notified" do
    reply(@instructor, "What error did you see?")
    Notification.find_by!(notifiable: @help, user: @instructor).update!(read_at: Time.current)
    clear_enqueued_jobs

    assert_enqueued_jobs 1, only: PushNotificationJob do
      reply(@student, "It says undefined method each.", client_request_id: "follow-up-attempt-1")
    end

    assert_response :created
    body = response.parsed_body
    assert_equal true, body.dig("reply", "from_student")
    assert_equal [ false, true ], body.dig("help_request", "replies").map { |item| item["from_student"] }
    assert_nil body.dig("help_request", "student"), "the learner's payload has no staff-only fields"
    @help.reload
    assert @help.status_acknowledged?, "a follow-up keeps the request with its owner"
    assert_equal @instructor, @help.owner
    assert_equal "What error did you see?", @help.staff_response, "staff_response mirrors staff replies only"

    note = Notification.find_by!(notifiable: @help, user: @instructor)
    assert_equal "#{@student.full_name} followed up on their help request", note.title
    assert_nil note.read_at
    assert_equal @student, note.actor

    # A retry returns the saved follow-up and alerts nobody again.
    clear_enqueued_jobs
    reply(@student, "It says undefined method each.", client_request_id: "follow-up-attempt-1")
    assert_response :created
    assert_equal true, response.parsed_body["replayed"]
    assert_equal 2, @help.replies.count
    assert_no_enqueued_jobs only: PushNotificationJob
  end

  test "a follow-up with no owner notifies every staff member on the cohort" do
    @help.update!(staff_response: "Legacy hint")
    reply(@student, "Still stuck.")

    assert_response :created
    recipients = Notification.where(notifiable: @help, title: "#{@student.full_name} followed up on their help request").pluck(:user_id)
    assert_equal [ @admin.id, @instructor.id ].sort, recipients.sort
  end

  test "learners cannot follow up on closed requests, other learners' requests, or without instructor help" do
    reply(@instructor, "Try again.", resolve: true)
    reply(@student, "Thanks!")
    assert_response :unprocessable_entity

    other = User.create!(clerk_id: "reply_other_student", email: "reply-other-student@example.com", first_name: "Other", last_name: "Student", role: :student)
    Enrollment.create!(user: other, cohort: @cohort, status: :active)
    reply(other, "Not mine")
    assert_response :not_found

    open_help = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_source: :primary, context_id: @lesson.id + 1000,
      context_label: "Other", context_path: "/lessons/1", category: :concept, message: "Another question")
    open_help.reply!(@instructor, body: "Question back")
    @enrollment.update!(status: :paused)
    as_user(@student) { post "/api/v1/help_requests/#{open_help.id}/replies", params: { reply: { body: "Hello" } }, headers: auth_headers }
    assert_response :forbidden
    assert_equal 1, open_help.reload.replies.count
  end

  test "learners see every reply but never the follow-up plan; staff see the plan on the record" do
    reply(@instructor, "Try printing the counter.")
    plan = Intervention.create!(enrollment: @enrollment, help_request: @help, owner: @instructor, created_by: @instructor,
      trigger_type: :help_request, next_follow_up_at: 2.days.from_now)

    as_user(@student) { get "/api/v1/help_requests/#{@help.id}", headers: auth_headers }
    assert_response :success
    assert_equal [ "Try printing the counter." ], response.parsed_body.dig("help_request", "replies").map { |item| item["body"] }
    refute response.parsed_body.fetch("help_request").key?("follow_up")

    as_user(@student) { get "/api/v1/help_requests", headers: auth_headers }
    refute response.parsed_body.fetch("help_requests").first.key?("follow_up")

    as_user(@instructor) { get "/api/v1/help_requests/#{@help.id}", headers: auth_headers }
    assert_equal({ "id" => plan.id, "status" => "open", "destination" => { "kind" => "follow_up", "id" => plan.id, "context" => {}, "anchor" => {} } },
      response.parsed_body.dig("help_request", "follow_up"))
  end

  test "a retried reply returns the saved reply and pushes nothing again" do
    reply(@instructor, "Check the loop condition.", client_request_id: "reply-attempt-0001")
    assert_response :created
    first_id = response.parsed_body.dig("reply", "id")
    assert_equal false, response.parsed_body["replayed"]
    clear_enqueued_jobs

    # The response was lost; the client sends the same attempt again.
    reply(@instructor, "Check the loop condition.", client_request_id: "reply-attempt-0001")

    assert_response :created
    assert_equal true, response.parsed_body["replayed"]
    assert_equal first_id, response.parsed_body.dig("reply", "id")
    assert_equal 1, @help.reload.replies.count
    assert_no_enqueued_jobs only: PushNotificationJob
  end

  test "a retried Reply & resolve replays after the request is resolved" do
    reply(@instructor, "Add one to the counter.", resolve: true, client_request_id: "resolve-attempt-01")
    assert_response :created
    clear_enqueued_jobs

    reply(@instructor, "Add one to the counter.", resolve: true, client_request_id: "resolve-attempt-01")

    assert_response :created, "a retry of the resolving reply is not refused as a change to a resolved request"
    assert_equal true, response.parsed_body["replayed"]
    assert_equal "resolved", response.parsed_body.dig("help_request", "status")
    assert_equal 1, @help.reload.replies.count
    assert_no_enqueued_jobs only: PushNotificationJob
    # A new attempt (new id) on the resolved request is still refused.
    reply(@instructor, "One more thing.", client_request_id: "resolve-attempt-02")
    assert_response :unprocessable_entity
  end

  test "client request ids are scoped to the author and the request, and must be well formed" do
    reply(@instructor, "First hint.", client_request_id: "shared-attempt-1")
    reply(@admin, "Second hint.", client_request_id: "shared-attempt-1")
    assert_equal false, response.parsed_body["replayed"], "another staff member's id never replays someone else's reply"
    assert_equal 2, @help.reload.replies.count

    [ "short", "x" * 65, "has spaces in it", "semi;colon-id" ].each do |bad|
      reply(@instructor, "Bad id.", client_request_id: bad)
      assert_response :unprocessable_entity, bad
    end
    assert_equal 2, @help.reload.replies.count
  end

  test "the request record loads its replies in a fixed number of queries" do
    counts = [ 2, 10 ].map do |size|
      (@help.replies.count...size).each { |index| @help.replies.create!(author: index.even? ? @instructor : @admin, body: "Hint #{index}") }
      as_user(@instructor) { get "/api/v1/help_requests/#{@help.id}", headers: auth_headers }
      assert_response :success
      assert_equal size, response.parsed_body.dig("help_request", "replies").size
      count_queries { as_user(@instructor) { get "/api/v1/help_requests/#{@help.id}", headers: auth_headers } }
    end
    assert_equal counts.first, counts.last, "GET /help_requests/:id sent #{counts.join(' then ')} queries for 2 then 10 replies"
  end

  private

  def reply(user, body, resolve: false, client_request_id: nil)
    payload = { body: body, resolve: resolve }
    payload[:client_request_id] = client_request_id if client_request_id
    as_user(user) do
      post "/api/v1/help_requests/#{@help.id}/replies", params: { reply: payload }, headers: auth_headers, as: :json
    end
  end

  def person(name, role)
    User.create!(clerk_id: "reply_#{name}", email: "reply-#{name}@example.com", first_name: "Reply", last_name: name.capitalize, role: role)
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
