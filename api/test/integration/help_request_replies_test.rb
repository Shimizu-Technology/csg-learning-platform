require "test_helper"

# U-4.7: staff can reply to a help request and keep it open, or reply and
# resolve it. Each reply notifies the learner once, through the same
# help-request notification as acknowledging and resolving.
class HelpRequestRepliesTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

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

  test "only staff who can open the request may reply" do
    reply(@student, "Answering myself")
    assert_response :forbidden

    reply(@other_instructor, "Not my cohort")
    assert_response :not_found

    assert @help.reload.status_open?
    assert_empty @help.replies
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

  private

  def reply(user, body, resolve: false)
    as_user(user) do
      post "/api/v1/help_requests/#{@help.id}/replies", params: { reply: { body: body, resolve: resolve } }, headers: auth_headers, as: :json
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
