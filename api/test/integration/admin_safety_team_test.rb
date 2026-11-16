require "test_helper"
require "ostruct"
require_relative "../support/after_commit_helpers"
require_relative "../support/query_counter"

# W6 PR 6.4b: Safety (L-3.5), team member pages (L-3.6) and the help-request
# notification link (L-3.7). All data is synthetic.
class AdminSafetyTeamTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include QueryCounter

  setup do
    @curriculum = Curriculum.create!(name: "Safety curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort Teal", start_date: Date.current, status: :active)
    @channel = @cohort.channels.find_by!(name: "Class Chat")
    @admin = person("ada_admin", :admin, "Ada", "Admin")
    @second_admin = person("bo_admin", :admin, "Bo", "Second")
    @instructor = person("ina_instructor", :instructor, "Ina", "Teacher")
    @student = person("sam_student", :student, "Sam", "Learner")
    @classmate = person("cy_classmate", :student, "Cy", "Classmate")
    [ @student, @classmate ].each { |user| Enrollment.create!(user: user, cohort: @cohort, status: :active) }
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
  end

  # --- Safety queue -----------------------------------------------------------

  test "open and resolved views split the queue, resolved shows who, when and what, paginated" do
    open_report = report(@student, @classmate, status: :pending)
    reviewing = report(@classmate, @student, status: :reviewing)
    older = report(@student, @classmate, status: :dismissed, reviewer: @second_admin, resolved_at: 3.days.ago)
    newer = report(@classmate, @student, status: :actioned, reviewer: @admin, resolved_at: 1.hour.ago)

    as_user(@admin) { get "/api/v1/content_reports", params: { view: "open" }, headers: auth_headers }
    assert_response :success
    assert_equal [ open_report.id, reviewing.id ], ids

    as_user(@admin) { get "/api/v1/content_reports", params: { view: "resolved", per_page: 1 }, headers: auth_headers }
    assert_response :success
    body = response.parsed_body
    resolved = body.fetch("content_reports").sole
    assert_equal newer.id, resolved.fetch("id")
    assert_equal "actioned", resolved.fetch("status")
    assert_equal @admin.full_name, resolved.dig("reviewed_by", "full_name")
    assert resolved.fetch("resolved_at").present?
    assert_equal({ "page" => 1, "per_page" => 1, "total_count" => 2, "total_pages" => 2, "has_next_page" => true, "has_prev_page" => false }, body.fetch("meta"))

    as_user(@admin) { get "/api/v1/content_reports", params: { view: "resolved", per_page: 1, page: 2 }, headers: auth_headers }
    assert_equal [ older.id ], ids
  end

  test "without a view the list keeps its original shape for installed clients" do
    3.times { |index| report(index.even? ? @student : @classmate, index.even? ? @classmate : @student, status: index.zero? ? :pending : :dismissed, reviewer: index.zero? ? nil : @admin, resolved_at: index.zero? ? nil : Time.current, message: true) }

    as_user(@admin) { get "/api/v1/content_reports", headers: auth_headers }
    assert_response :success
    assert_equal ContentReport.recent_first.pluck(:id), ids
  end

  test "a reported message links to its conversation only when the admin can open it" do
    channel_message = Message.create!(channel: @channel, author: @classmate, body: "Channel post")
    dm = DirectConversation.find_or_create_for!(workspace: Workspace.find_or_create_for_cohort!(@cohort), users: [ @student, @classmate ])
    dm_message = Message.create!(direct_conversation: dm, author: @classmate, body: "Private note")
    channel_report = ContentReport.create!(reporter: @student, reported_user: @classmate, message: channel_message, reason: :spam)
    dm_report = ContentReport.create!(reporter: @student, reported_user: @classmate, message: dm_message, reason: :harassment)

    as_user(@admin) { get "/api/v1/content_reports", params: { view: "open" }, headers: auth_headers }
    reports = response.parsed_body.fetch("content_reports").index_by { |entry| entry.fetch("id") }
    channel = reports.fetch(channel_report.id).dig("message", "conversation")
    assert channel.fetch("available")
    assert_equal "#Class Chat in Cohort Teal", channel.fetch("label")
    assert_equal({ "kind" => "channel", "id" => @channel.id, "context" => {}, "anchor" => { "message_id" => channel_message.id } }, channel.fetch("destination"))
    assert_equal "/messages/#{@channel.id}?message_id=#{channel_message.id}", RecordDestination.to_web_path(channel.fetch("destination"))

    # The admin isn't in the direct conversation, so it stays text.
    private_conversation = reports.fetch(dm_report.id).dig("message", "conversation")
    assert_not private_conversation.fetch("available")
    assert_nil private_conversation.fetch("destination")
    assert_equal "Direct conversation in Cohort Teal", private_conversation.fetch("label")

    # One the admin is a member of opens.
    admin_dm = DirectConversation.find_or_create_for!(workspace: Workspace.find_or_create_for_cohort!(@cohort), users: [ @admin, @classmate ])
    admin_dm_message = Message.create!(direct_conversation: admin_dm, author: @classmate, body: "To the admin")
    member_report = ContentReport.create!(reporter: @admin, reported_user: @classmate, message: admin_dm_message, reason: :other)
    as_user(@admin) { get "/api/v1/content_reports/#{member_report.id}", headers: auth_headers }
    assert_response :success
    assert_equal "dm", response.parsed_body.dig("content_report", "message", "conversation", "destination", "kind")
  end

  test "the Safety lists cost the same number of queries for one row or many" do
    seed = lambda do |count|
      count.times do |index|
        author = person("noisy_#{SecureRandom.hex(4)}", :student, "Noisy", "Author #{index}")
        Enrollment.create!(user: author, cohort: @cohort, status: :active)
        message = Message.create!(channel: @channel, author: author, body: "Post #{index}")
        report = ContentReport.create!(reporter: @student, reported_user: author, message: message, reason: :spam)
        report.update!(status: :actioned, reviewed_by: @admin, resolved_at: Time.current)
        UserBlock.create!(blocker: @student, blocked_user: author)
      end
    end
    seed.call(1)
    # Warm up per-session work (sign-in bookkeeping) so only the lists are compared.
    as_user(@admin) { get "/api/v1/content_reports", params: { view: "resolved" }, headers: auth_headers }
    small = as_user(@admin) { count_queries { get "/api/v1/content_reports", params: { view: "resolved" }, headers: auth_headers } }
    small_blocks = as_user(@admin) { count_queries { get "/api/v1/safety/user_blocks", headers: auth_headers } }
    seed.call(5)
    large = as_user(@admin) { count_queries { get "/api/v1/content_reports", params: { view: "resolved" }, headers: auth_headers } }
    large_blocks = as_user(@admin) { count_queries { get "/api/v1/safety/user_blocks", headers: auth_headers } }

    assert_equal 6, response.parsed_body.fetch("user_blocks").size
    assert_equal small, large
    assert_equal small_blocks, large_blocks
  end

  test "admins see every block with both people, newest first" do
    older = UserBlock.create!(blocker: @student, blocked_user: @classmate, created_at: 2.days.ago)
    newer = UserBlock.create!(blocker: @classmate, blocked_user: @instructor)

    as_user(@admin) { get "/api/v1/safety/user_blocks", params: { per_page: 1 }, headers: auth_headers }
    assert_response :success
    body = response.parsed_body
    assert_equal [ newer.id ], body.fetch("user_blocks").map { |block| block.fetch("id") }
    assert_equal({ "id" => @classmate.id, "full_name" => "Cy Classmate", "email" => @classmate.email, "role" => "student", "archived" => false }, body.dig("user_blocks", 0, "blocker"))
    assert_equal "instructor", body.dig("user_blocks", 0, "blocked_user", "role")
    assert_equal 2, body.dig("meta", "total_count")

    as_user(@admin) { get "/api/v1/safety/user_blocks", params: { per_page: 1, page: 2 }, headers: auth_headers }
    assert_equal [ older.id ], response.parsed_body.fetch("user_blocks").map { |block| block.fetch("id") }
  end

  test "instructors and students get 403 on every admin-only Safety and Team endpoint" do
    report = report(@student, @classmate, status: :pending)
    [ @instructor, @student ].each do |user|
      as_user(user) do
        get "/api/v1/content_reports", params: { view: "resolved" }, headers: auth_headers
        assert_response :forbidden, "#{user.role} content_reports index"
        get "/api/v1/content_reports/#{report.id}", headers: auth_headers
        assert_response :forbidden, "#{user.role} content_reports show"
        get "/api/v1/safety/user_blocks", headers: auth_headers
        assert_response :forbidden, "#{user.role} safety user_blocks"
        get "/api/v1/team_members/#{@instructor.id}", headers: auth_headers
        assert_response :forbidden, "#{user.role} team_members show"
      end
    end
  end

  # --- Admin alerts -----------------------------------------------------------

  test "a new report alerts admins only, once, after it commits" do
    message = Message.create!(channel: @channel, author: @classmate, body: "Report me")
    with_inline_jobs do
      with_push_calls(:admin_alert) do |calls|
        2.times do
          as_user(@student) { post "/api/v1/content_reports", params: { content_report: { message_id: message.id, reason: "harassment" } }, headers: auth_headers, as: :json }
          assert_response :created
        end
        report = ContentReport.sole
        notifications = Notification.where(notifiable: report)
        assert_equal [ @admin.id, @second_admin.id ].sort, notifications.pluck(:user_id).sort
        assert notifications.all?(&:content_report?)
        assert_equal "Sam Learner reported a message from Cy Classmate", notifications.first.title
        assert_equal "Reason: Harassment", notifications.first.body
        assert_equal "/admin/moderation#report-#{report.id}", notifications.first.path
        assert_sent_after_commit(calls, "report push")
        # The repeat report pushes nobody again.
        assert_equal [ @admin.id, @second_admin.id ].sort, pushed_user_ids(calls).sort
      end
    end
  end

  test "an admin who reports someone is not alerted about their own report" do
    with_inline_jobs do
      as_user(@admin) { post "/api/v1/content_reports", params: { content_report: { reported_user_id: @classmate.id, reason: "spam" } }, headers: auth_headers, as: :json }
    end
    assert_response :created
    assert_equal [ @second_admin.id ], Notification.content_report.pluck(:user_id)
  end

  test "a deletion request alerts admins once and opens it in Safety" do
    with_inline_jobs do
      2.times { as_user(@student) { post "/api/v1/data_deletion_requests", headers: auth_headers, as: :json } }
    end
    request = DataDeletionRequest.sole
    notifications = Notification.data_deletion_request
    assert_equal [ @admin.id, @second_admin.id ].sort, notifications.pluck(:user_id).sort
    assert_equal "Sam Learner asked to delete their account", notifications.first.title

    as_user(@admin) { get "/api/v1/notifications", headers: auth_headers }
    entry = response.parsed_body.fetch("notifications").find { |item| item.fetch("notification_type") == "data_deletion_request" }
    assert_equal({ "kind" => "deletion_request", "id" => request.id.to_s, "context" => {}, "anchor" => {} }, entry.fetch("destination"))
    assert_equal "/admin/moderation#deletion-#{request.id}", entry.fetch("destination_path")
    assert_nil RecordDestination.to_native_href(entry.fetch("destination"))
  end

  test "a paid course alerts admins after the purchase lock commits, and a webhook replay does not repeat it" do
    self_paced = Cohort.create!(curriculum: @curriculum, name: "Python at your pace", start_date: Date.current, status: :active,
      cohort_type: :workshop, course_delivery: "self_paced", public_checkout_enabled: true, stripe_price_id: "price_synthetic", public_price_cents: 14_900)
    purchase = CoursePurchase.create!(user: @student, cohort: self_paced, stripe_price_id: "price_synthetic", price_cents: 14_900, stripe_session_id: "cs_synthetic")
    session = OpenStruct.new(id: "cs_synthetic", client_reference_id: purchase.id.to_s, payment_status: "paid", currency: "usd", amount_subtotal: 14_900, payment_intent: "pi_synthetic")

    with_inline_jobs do
      with_push_calls(:admin_alert) do |calls|
        CoursePurchaseFulfillment.fulfill!(session)
        CoursePurchaseFulfillment.fulfill!(session)
        assert_sent_after_commit(calls, "purchase push")
        assert_equal [ @admin.id, @second_admin.id ].sort, pushed_user_ids(calls).sort
      end
    end
    notification = Notification.course_purchase.find_by!(user: @admin)
    assert_equal "Sam Learner bought Python at your pace", notification.title
    assert_equal "$149.00 · 12 months of access", notification.body
    assert_equal "/admin/students/#{@student.id}?cohort_id=#{self_paced.id}", notification.path
    assert_equal "/staff/student/#{@student.id}?cohort_id=#{self_paced.id}", RecordDestination.to_native_href(notification.destination)
    assert_equal 2, Notification.course_purchase.count
  end

  test "a purchase that rolls back alerts nobody" do
    self_paced = Cohort.create!(curriculum: @curriculum, name: "Rolled back course", start_date: Date.current, status: :active,
      cohort_type: :workshop, course_delivery: "self_paced", public_checkout_enabled: true, stripe_price_id: "price_rollback", public_price_cents: 9_900)
    purchase = CoursePurchase.create!(user: @student, cohort: self_paced, stripe_price_id: "price_rollback", price_cents: 9_900, stripe_session_id: "cs_rollback")
    session = OpenStruct.new(id: "cs_rollback", client_reference_id: purchase.id.to_s, payment_status: "paid", currency: "usd", amount_subtotal: 9_900, payment_intent: "pi_rollback")

    with_inline_jobs do
      ActiveRecord::Base.transaction(requires_new: true) do
        CoursePurchaseFulfillment.fulfill!(session)
        raise ActiveRecord::Rollback
      end
    end
    assert_equal 0, Notification.course_purchase.count
  end

  test "admin alerts stay with the admin role" do
    report = report(@student, @classmate, status: :pending)
    NotificationDeliveryService.admin_alert(report, push: false)
    @second_admin.update!(role: :instructor)

    as_user(@second_admin) { get "/api/v1/notifications", headers: auth_headers }
    assert_response :success
    assert_empty response.parsed_body.fetch("notifications")
    as_user(@admin) { get "/api/v1/notifications", headers: auth_headers }
    assert_equal [ "content_report" ], response.parsed_body.fetch("notifications").map { |entry| entry.fetch("notification_type") }
  end

  # --- Team member pages ------------------------------------------------------

  test "a team member page shows role, cohorts with read-only editing access, and a cohort to message through" do
    second = Cohort.create!(curriculum: @curriculum, name: "Cohort Coral", start_date: 1.month.ago.to_date, status: :completed)
    second.cohort_instructor_assignments.create!(user: @instructor)
    @cohort.cohort_instructor_assignments.find_by!(user: @instructor).set_lesson_editing!(true, by: @admin)

    as_user(@admin) { get "/api/v1/team_members/#{@instructor.id}", headers: auth_headers }
    assert_response :success
    member = response.parsed_body.fetch("team_member")
    assert_equal "instructor", member.fetch("role")
    assert_equal [ "Cohort Teal", "Cohort Coral" ], member.fetch("teaching").map { |row| row.dig("cohort", "name") }
    running = member.fetch("teaching").first
    assert running.fetch("can_edit_lessons")
    assert_equal "Ada Admin", running.dig("edit_granted_by", "full_name")
    assert_not member.fetch("teaching").last.fetch("can_edit_lessons")
    assert_equal @cohort.id, member.fetch("message_cohort_id")

    # The id from message_cohort_id opens a conversation under the existing messaging rules.
    @admin.update!(community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
    as_user(@admin) { post "/api/v1/direct_conversations", params: { cohort_id: member.fetch("message_cohort_id"), user_ids: [ @instructor.id ] }, headers: auth_headers, as: :json }
    assert_response :created
  end

  test "an admin's page has no cohorts, their own page offers no message, and students are not team members" do
    as_user(@admin) { get "/api/v1/team_members/#{@second_admin.id}", headers: auth_headers }
    assert_response :success
    assert_empty response.parsed_body.dig("team_member", "teaching")
    assert_equal @cohort.id, response.parsed_body.dig("team_member", "message_cohort_id")

    as_user(@admin) { get "/api/v1/team_members/#{@admin.id}", headers: auth_headers }
    assert response.parsed_body.dig("team_member", "is_self")
    assert_nil response.parsed_body.dig("team_member", "message_cohort_id")

    as_user(@admin) { get "/api/v1/team_members/#{@student.id}", headers: auth_headers }
    assert_response :not_found
  end

  test "team search results open the team member page" do
    as_user(@admin) { get "/api/v1/search", params: { q: "Ina" }, headers: auth_headers }
    assert_response :success
    staff = response.parsed_body.fetch("groups").find { |group| group.fetch("type") == "staff" }
    assert_equal "/admin/team/#{@instructor.id}", RecordDestination.to_web_path(staff.fetch("results").first.fetch("destination"))
  end

  # --- Help-request notification (L-3.7) --------------------------------------

  test "a help-request alert opens the exact request with its cohort and student" do
    mod = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, schedule_days: "weekdays")
    lesson = Lesson.create!(curriculum_module: mod, title: "Loops", position: 0, release_day: 0)
    request = HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_source: :primary, context_id: lesson.id,
      context_label: "Loops lesson", context_path: "/lessons/#{lesson.id}", category: :concept, message: "Stuck on loops")
    NotificationDeliveryService.help_request_created(request, push: false)
    notification = Notification.find_by!(notifiable: request, user: @instructor)
    assert_equal "/admin/help-requests/#{request.id}?cohort_id=#{@cohort.id}&student_id=#{@student.id}", notification.path
    assert_equal "Cohort Teal · Loops lesson", notification.body

    # Rows stored before this change get the same destination.
    notification.update_columns(path: "/admin/help-requests/#{request.id}")
    as_user(@instructor) { get "/api/v1/notifications", headers: auth_headers }
    entry = response.parsed_body.fetch("notifications").find { |item| item.fetch("id") == notification.id }
    assert_equal({ "kind" => "help_request", "id" => request.id.to_s, "context" => { "cohort_id" => @cohort.id.to_s, "student_id" => @student.id.to_s }, "anchor" => {} }, entry.fetch("destination"))
    assert_equal "/staff/support/#{request.id}?cohort_id=#{@cohort.id}&student_id=#{@student.id}", RecordDestination.to_native_href(entry.fetch("destination"))
  end

  private

  def person(handle, role, first, last)
    User.create!(clerk_id: "ast_#{handle}", email: "#{handle}@example.test", first_name: first, last_name: last, role: role)
  end

  def report(reporter, reported, status:, reviewer: nil, resolved_at: nil, message: false)
    post_message = message ? Message.create!(channel: @channel, author: reported, body: "Synthetic #{SecureRandom.hex(3)}") : nil
    ContentReport.create!(reporter: reporter, reported_user: reported, message: post_message, reason: :spam, status: status, reviewed_by: reviewer, resolved_at: resolved_at)
  end

  def ids
    response.parsed_body.fetch("content_reports").map { |entry| entry.fetch("id") }
  end

  def with_push_calls(method_name)
    calls = []
    record_external_calls(WebPushNotificationService, method_name, calls: calls) do
      record_external_calls(ExpoPushNotificationService, method_name, calls: calls) { yield calls }
    end
  end

  # Web and Expo each get the same notifications; count each recipient once per provider pair.
  def pushed_user_ids(calls)
    calls.select { |call| call[:target] == WebPushNotificationService }.flat_map { |call| Array(call[:args].last).map(&:user_id) }
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
