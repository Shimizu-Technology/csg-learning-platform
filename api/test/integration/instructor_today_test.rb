require "test_helper"
require_relative "../support/query_counter"

class InstructorTodayTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    @original_verify = ClerkAuth.method(:verify)
    travel_to Time.zone.parse("2026-11-17 09:00:00")
    @curriculum = Curriculum.create!(name: "Today curriculum")
    @mod = @curriculum.modules.create!(name: "Week", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = @mod.lessons.create!(title: "Loops", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, title: "Try loops", position: 0, submission_type: :text_submission)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Today cohort", start_date: Date.current - 30, status: :active)
    @teacher = person("teacher", :instructor)
    @other = person("other", :instructor)
    @admin = person("admin", :admin)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @student = person("student", :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active, joined_at: 20.days.ago, enrolled_at: 20.days.ago)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    untouched = @mod.lessons.create!(title: "Next", position: 1, release_day: 0)
    untouched.content_blocks.create!(block_type: :text, position: 0, body: "Read this")
    @help = help("First question", 3.days.ago)
    @new_help = help("Second question", 1.day.ago)
    @submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @block, submission_type: :text_submission, text: "Synthetic answer", created_at: 10.days.ago)
    @conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @teacher, @student ])
    Message.create!(direct_conversation: @conversation, author: @student, body: "Can we talk?", created_at: 1.hour.ago)
  end

  test "ranked by category then age then id with source text and exact actions" do
    today = fetch_today(@teacher)
    assert_equal %w[help help review message quiet], today["items"].map { |row| row["kind"] }
    assert_equal [ @help.id, @new_help.id ], today["items"].first(2).map { |row| row["id"] }
    assert_equal "First question", today["items"].first["text"]
    assert_equal "Can we talk?", today["items"][3]["text"]
    assert_equal "/admin/submissions/#{@submission.id}", today["items"][2]["web_path"]
    assert_equal today, fetch_today(@teacher)
  end

  test "only assigned cohorts and explicit scope" do
    assert_empty fetch_today(@other)["items"]
    assert_equal 4, fetch_today(@admin)["items"].size
    other_cohort = Cohort.create!(curriculum: @curriculum, name: "Another", status: :active, start_date: Date.current)
    @cohort.cohort_instructor_assignments.create!(user: @other)
    other_cohort.cohort_instructor_assignments.create!(user: @teacher)
    assert_empty fetch_today(@teacher, cohort_id: other_cohort.id)["items"]
    get "/api/v1/dashboard", params: { cohort_id: other_cohort.id }, headers: headers(@other)
    assert_response :forbidden
    assert_equal 5, fetch_today(@teacher, cohort_id: @cohort.id)["items"].size
  end

  test "school and cohort switches remove help and scheduled events" do
    OfficeHour.create!(cohort: @cohort, title: "Questions", starts_at: 1.hour.from_now, ends_at: 2.hours.from_now, meeting_url: "https://example.invalid/office")
    assert_equal "Questions · Today cohort", fetch_today(@teacher)["upcoming"].sole["title"]
    @cohort.update!(settings: { "features" => { "help_requests" => false, "office_hours" => false } })
    today = fetch_today(@teacher)
    assert_equal %w[review message quiet], today["items"].map { |row| row["kind"] }
    assert_empty today["upcoming"]
    assert_nil today["counts"]["help"]
    @cohort.update!(settings: {})
    SchoolSetting.current.update!(features: { "help_requests" => false })
    assert_nil fetch_today(@teacher)["counts"]["help"]
  end

  test "read cursor removes messages and resolving help removes the action" do
    @conversation.direct_conversation_members.find_by!(user: @teacher).mark_read!(@conversation.messages.last)
    @help.resolve!(@teacher, response: "Try the example")
    today = fetch_today(@teacher)
    assert_equal %w[help review quiet], today["items"].map { |row| row["kind"] }
  end

  test "unread staff conversations remain visible without a learner record link" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @teacher, @admin ])
    Message.create!(direct_conversation: conversation, author: @admin, body: "Staff coordination")
    entry = fetch_today(@teacher)["items"].find { |row| row["text"] == "Staff coordination" }
    assert_equal false, entry["student_record"]
    assert_equal "/messages/dm/#{conversation.id}", entry["web_path"]
  end

  test "urgent help outranks older normal requests and review names work" do
    @new_help.update!(urgency: :urgent)
    today = fetch_today(@teacher)
    assert_equal @new_help.id, today["items"].first["id"]
    assert_equal true, today["items"].first["urgent"]
    review = today["items"].find { |row| row["kind"] == "review" }
    assert_equal "Try loops", review["text"]
    assert_equal "Open grading", review["action_label"]
  end

  test "blocked previews match DM list and attachments have a fallback" do
    UserBlock.create!(blocker: @student, blocked_user: @teacher)
    assert_equal "Message hidden", fetch_today(@teacher)["items"].find { |row| row["kind"] == "message" }["text"]
    UserBlock.delete_all
    message = @conversation.messages.first
    message.update_columns(body: "")
    message.message_attachments.create!(uploaded_by: @student, filename: "answer.txt", content_type: "text/plain", byte_size: 12, s3_key: "synthetic/answer")
    assert_equal "Attachment", fetch_today(@teacher)["items"].find { |row| row["kind"] == "message" }["text"]
  end

  test "paused learners retain help and ungraded work" do
    @enrollment.update!(status: :paused)
    kinds = fetch_today(@teacher)["items"].map { |row| row["kind"] }
    assert_includes kinds, "help"
    assert_includes kinds, "review"
  end

  test "caps rows while retaining full counts and suppresses disabled help in projection" do
    23.times { |i| help("Extra #{i}", (i + 5).days.ago) }
    today = fetch_today(@teacher)
    assert_equal 25, today["counts"]["help"]
    assert_equal 20, today["items"].count { |row| row["kind"] == "help" }
    @cohort.update!(settings: { "features" => { "help_requests" => false } })
    row = AttentionProjection.new(cohort_ids: [ @cohort.id ]).call[:enrollments].sole
    assert_equal 0, row[:help_request_count]
    assert_not_includes row[:reasons].map { |reason| reason[:code] }, "help_response"
  end

  test "due followups reuse projection actions and respect switches" do
    intervention = Intervention.create!(trigger_type: :manual, enrollment: @enrollment, owner: @teacher, created_by: @teacher, next_follow_up_at: 1.day.ago)
    today = fetch_today(@teacher)
    row = today["items"].find { |entry| entry["kind"] == "follow_up" }
    assert row
    assert_includes row["web_path"], "/admin/interventions/#{intervention.id}"
    @cohort.update!(settings: { "features" => { "interventions" => false } })
    assert_not_includes fetch_today(@teacher)["items"].map { |entry| entry["kind"] }, "follow_up"
  end

  test "community conversations appear only in the unscoped inbox" do
    workspace = Workspace.create!(name: "Community", slug: "today-community", workspace_type: :community)
    workspace.workspace_memberships.create!(user: @teacher)
    workspace.workspace_memberships.create!(user: @admin)
    conversation = DirectConversation.find_or_create_for!(workspace: workspace, users: [ @teacher, @admin ])
    Message.create!(direct_conversation: conversation, author: @admin, body: "Community hello")
    assert_includes fetch_today(@teacher)["items"].map { |entry| entry["text"] }, "Community hello"
    assert_not_includes fetch_today(@teacher, cohort_id: @cohort.id)["items"].map { |entry| entry["text"] }, "Community hello"
  end

  test "meetings use booking times rather than moved slots and include identity" do
    config = PrivateMeetingConfig.create!(cohort: @cohort, instructor: @teacher, weeks: 100)
    slot = config.private_meeting_slots.create!(instructor: @teacher, starts_at: 3.days.from_now, ends_at: 3.days.from_now + 1.hour)
    booking = PrivateMeetingBooking.create!(private_meeting_slot: slot, cohort: @cohort, enrollment: @enrollment, student: @student, instructor: @teacher, starts_at: 1.hour.from_now, ends_at: 2.hours.from_now, week_number: 1)
    event = fetch_today(@teacher)["upcoming"].sole
    assert_equal booking.starts_at.iso8601(3), event["starts_at"]
    assert_includes event["title"], @student.full_name
    booking.update!(starts_at: 1.day.ago, ends_at: 1.day.ago + 1.hour)
    assert_empty fetch_today(@teacher)["upcoming"]
  end

  test "checkins use learning plan switch and setup remains in attention summary" do
    RecoveryPlan.create!(enrollment: @enrollment, owner: @teacher, created_by: @teacher, source: :manual, target_pace: "One step", required_scope: "Loops", check_in_cadence: "Daily", next_check_in_at: 1.day.ago)
    row = fetch_today(@teacher)["items"].find { |entry| entry["kind"] == "follow_up" }
    assert_equal "Recovery check-in due", row["text"]
    assert_includes row["web_path"], "/support?plan_id="
    @cohort.update!(settings: { "features" => { "learning_plans" => false } })
    assert_not_includes fetch_today(@teacher)["items"].map { |entry| entry["kind"] }, "follow_up"
    HelpRequest.delete_all
    Submission.delete_all
    @conversation.direct_conversation_members.find_by!(user: @teacher).mark_read!(@conversation.messages.last)
    @enrollment.module_assignments.destroy_all
    today = fetch_today(@teacher)
    assert_empty today["items"]
    assert_equal 1, today["attention_remaining"]
  end

  teardown do
    ClerkAuth.define_singleton_method(:verify, @original_verify)
    travel_back
  end

  private

  def help(text, at)
    HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_source: :primary, context_id: at.to_i,
      context_label: @lesson.title, context_path: "/lessons/#{@lesson.id}", category: :concept, urgency: :normal, message: text, created_at: at)
  end

  def person(name, role)
    User.create!(clerk_id: "today_#{name}", email: "today-#{name}@example.invalid", first_name: name.capitalize, last_name: "Example", role: role)
  end

  def headers(user)
    payload = { "sub" => user.clerk_id, "email" => user.email }
    ClerkAuth.define_singleton_method(:verify) { |_| payload }
    { "Authorization" => "Bearer test_token" }
  end

  def fetch_today(user, **params)
    get "/api/v1/dashboard", params: params, headers: headers(user)
    assert_response :success
    response.parsed_body.dig("dashboard", "today")
  end
end
