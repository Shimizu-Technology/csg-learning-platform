require "test_helper"

class HomeBaseDigestTest < ActionDispatch::IntegrationTest
  def setup
    @admin = user("owner", :admin)
    @student = user("student", :student)
    @other_admin = user("other", :admin)
    @curriculum = Curriculum.create!(name: "Digest curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Digest cohort", start_date: Date.current, status: :active)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort)
    @channel = @cohort.channels.find_by!(name: "Class Chat")
    @conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @admin, @student ])
    @record, @token = HomeBaseToken.issue!(user: @admin)
  end

  test "valid token reads only the digest and records use without marking anything read" do
    @conversation.messages.create!(author: @student, body: "Please help")
    cursor = @conversation.direct_conversation_members.find_by!(user: @admin)
    get_digest
    assert_response :success
    assert_equal "no-store", response.headers["Cache-Control"]
    assert_includes response.headers["Vary"].split(", "), "Authorization"
    assert @record.reload.last_used_at
    assert_nil cursor.reload.last_read_at
    assert_equal 1, data.fetch("unread_direct_messages").first.fetch("unread_count")
    refute_includes @record.attributes.values, @token
    with_singleton(ClerkAuth, :verify, ->(*) { flunk "Integration tokens must not reach Clerk" }) do
      get "/api/v1/profile", headers: headers
      assert_response :unauthorized
      patch "/api/v1/profile", params: { first_name: "Changed" }, headers: headers
      assert_response :unauthorized
    end
    assert_equal "Owner", @admin.reload.first_name
  end

  test "missing malformed bad revoked and Clerk tokens receive the same unauthorized response" do
    [ nil, "Bearer invalid", "Basic #{@token}", "Bearer #{@token} extra", "Bearer clerk.jwt.token" ].each do |authorization|
      get "/api/v1/home_base/digest", headers: { "Authorization" => authorization }
      assert_response :unauthorized
      assert_equal({ "error" => "Unauthorized" }, data)
    end
    assert_nil @record.reload.last_used_at
    @record.revoke!
    get_digest
    assert_response :unauthorized
    assert_equal({ "error" => "Unauthorized" }, data)
    assert_nil @record.reload.last_used_at
  end

  test "credential owner must remain an accepted active admin" do
    assert_raises(ActiveRecord::RecordInvalid) { HomeBaseToken.issue!(user: @student) }
    @admin.update!(role: :instructor)
    get_digest
    assert_response :unauthorized
    @admin.update!(role: :admin, archived_at: Time.current)
    get_digest
    assert_response :unauthorized
    @admin.update_columns(archived_at: nil, clerk_id: "pending_owner")
    get_digest
    assert_response :unauthorized
  end

  test "unknown and revoked tokens still use fixed length constant time digest comparison" do
    original = ActiveSupport::SecurityUtils.method(:secure_compare)
    calls = []
    comparator = ->(left, right) { calls << [ left.length, right.length ]; original.call(left, right) }
    with_singleton(ActiveSupport::SecurityUtils, :secure_compare, comparator) do
      assert_nil HomeBaseToken.authenticate("wrong")
      @record.revoke!
      assert_nil HomeBaseToken.authenticate(@token)
    end
    assert_equal [ [ 64, 64 ], [ 64, 64 ] ], calls
  end

  test "DM unread state matches web including deleted self same timestamp and legacy cursors" do
    at = 2.hours.ago.change(usec: 0)
    read = @conversation.messages.create!(author: @student, body: "Read", created_at: at)
    unread = @conversation.messages.create!(author: @student, body: "Unread", created_at: at)
    @conversation.messages.create!(author: @admin, body: "Mine", created_at: at + 1)
    @conversation.messages.create!(author: @student, body: "Deleted", deleted_at: Time.current, created_at: at + 1)
    cursor = @conversation.direct_conversation_members.find_by!(user: @admin)
    cursor.update!(last_read_at: at, last_read_message: read)
    assert_web_unread_count(1)
    get_digest
    row = data.fetch("unread_direct_messages").sole
    assert_equal 1, row.fetch("unread_count")
    assert_equal unread.body, row.fetch("snippet")
    assert_equal "Student", row.fetch("sender_name")
    cursor.update!(last_read_message: nil)
    assert_web_unread_count(0)
    get_digest
    assert_empty data.fetch("unread_direct_messages")
    cursor.update!(last_read_at: nil)
    assert_web_unread_count(2)
    get_digest
    assert_equal 2, data.fetch("unread_direct_messages").sole.fetch("unread_count")
    @conversation.archived!
    get_digest
    assert_empty data.fetch("unread_direct_messages")
  end

  test "mentions reuse delivery matching and channel cursor without leaking inaccessible or blocked messages" do
    at = 2.hours.ago.change(usec: 0)
    read = @channel.messages.create!(author: @student, body: "@Owner read", mention_user_ids: [ @admin.id ], created_at: at)
    explicit = @channel.messages.create!(author: @student, body: "Hello", mention_user_ids: [ @admin.id ], created_at: at)
    legacy = @channel.messages.create!(author: @student, body: "@Owner please look", created_at: at + 1)
    everyone = @channel.messages.create!(author: @student, body: "@everyone help", created_at: at + 2)
    @channel.messages.create!(author: @student, body: "@Owner for someone else", mention_user_ids: [ @other_admin.id ])
    @channel.messages.create!(author: @student, body: "@Owner deleted", deleted_at: Time.current)
    @channel.messages.create!(author: @admin, body: "@Owner self", mention_user_ids: [ @admin.id ])
    hidden = Workspace.create!(name: "Hidden", slug: "hidden-digest", workspace_type: :community, status: :archived)
    hidden.channels.create!(name: "Hidden").messages.create!(author: @student, body: "@Owner hidden")
    @admin.channel_read_states.create!(channel: @channel, last_read_at: at, last_read_message: read)
    get_digest
    assert_equal [ everyone.id, legacy.id, explicit.id ], data.fetch("unread_mentions").map { |row| row.fetch("message_id") }
    UserBlock.create!(blocker: @admin, blocked_user: @student)
    get_digest
    assert_empty data.fetch("unread_mentions")
  end

  test "staff queues include unresolved help latest ungraded attempts own due cases and next two days meetings" do
    now = Time.current.change(usec: 0)
    travel_to now do
      request = help_request(created_at: 2.days.ago)
      acknowledged = help_request(context_id: 2)
      acknowledged.acknowledge!(@other_admin)
      resolved = help_request(context_id: 3)
      resolved.resolve!(@admin, response: "Private response")
      pending = block("Pending", 0)
      superseded = block("Superseded", 1)
      submission(pending, created_at: 3.days.ago)
      submission(superseded, created_at: 5.days.ago)
      submission(superseded, grade: :A, text: "Secret submitted work", feedback: "Private feedback")
      intervention = Intervention.create!(enrollment: @enrollment, owner: @admin, created_by: @admin, trigger_type: :manual, next_follow_up_at: 1.day.ago)
      Intervention.create!(enrollment: @enrollment, owner: @other_admin, created_by: @admin, trigger_type: :redo, next_follow_up_at: 1.day.ago)
      plan = RecoveryPlan.create!(enrollment: @enrollment, owner: @admin, created_by: @admin, source: :manual, target_pace: "Private pace", required_scope: "Private scope", check_in_cadence: "Weekly", next_check_in_at: 2.days.ago)
      meeting = meeting_at(now + 1.hour)
      later_student = user("later", :student)
      later_enrollment = Enrollment.create!(user: later_student, cohort: @cohort)
      meeting_at(now + 3.days, student: later_student, enrollment: later_enrollment)
      get_digest
      assert_equal [ request.id, acknowledged.id ].sort, data.fetch("help_requests").map { |row| row.fetch("id") }.sort
      assert_equal 2.days.to_i, data.fetch("help_requests").first.fetch("age_seconds")
      assert_equal 1, data.fetch("grading").sole.fetch("count")
      assert_equal 3.days.to_i, data.fetch("grading").sole.fetch("oldest_waiting_age_seconds")
      assert_equal [ intervention.id ], data.fetch("due_interventions").map { |row| row.fetch("id") }
      assert_equal [ plan.id ], data.fetch("due_recovery_plans").map { |row| row.fetch("id") }
      assert_equal [ meeting.id ], data.fetch("upcoming_private_meetings").map { |row| row.fetch("id") }
      assert_private_fields_absent
    end
  end

  test "every list is capped and message snippets redact contact details and stay under 200 characters" do
    21.times do |i|
      student = user("cap#{i}", :student)
      enrollment = Enrollment.create!(user: student, cohort: @cohort)
      conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @admin, student ])
      conversation.messages.create!(author: student, body: "Email private@example.com or +1 (671) 555-0101 " + "x" * 300)
      @channel.messages.create!(author: student, body: "@Owner please look", mention_user_ids: [ @admin.id ])
      help_request(student: student, context_id: i)
      mod = CurriculumModule.create!(curriculum: @curriculum, name: "Module #{i}", position: i, day_offset: 0, schedule_days: "daily")
      lesson = Lesson.create!(curriculum_module: mod, title: "Lesson", position: 0, release_day: 0)
      content = lesson.content_blocks.create!(block_type: :exercise, position: 0)
      Submission.create!(user: student, enrollment: enrollment, content_block: content)
      Intervention.create!(enrollment: enrollment, owner: @admin, created_by: @admin, trigger_type: :manual, next_follow_up_at: 1.day.ago)
      RecoveryPlan.create!(enrollment: enrollment, owner: @admin, created_by: @admin, source: :manual, target_pace: "One", required_scope: "One", check_in_cadence: "Weekly", next_check_in_at: 1.day.ago)
      meeting_at(Time.current.change(usec: 0) + (i + 1).hours, student: student, enrollment: enrollment)
    end
    get_digest
    data.except("generated_at").each { |key, rows| assert_equal 20, rows.size, key }
    data.fetch("unread_direct_messages").each do |row|
      assert_operator row.fetch("snippet").length, :<=, 200
      assert_includes row.fetch("snippet"), "[email redacted]"
      assert_includes row.fetch("snippet"), "[phone redacted]"
    end
    assert_private_fields_absent
  end

  private

  def user(name, role)
    User.create!(clerk_id: "digest_#{name}", email: "#{name}@example.com", first_name: name.capitalize, role: role)
  end

  def headers
    { "Authorization" => "Bearer #{@token}" }
  end

  def get_digest
    get "/api/v1/home_base/digest", headers: headers
  end

  def data
    JSON.parse(response.body)
  end

  def assert_web_unread_count(expected)
    get "/api/v1/direct_conversations", headers: { "Authorization" => "Bearer test_token_#{@admin.id}" }
    assert_response :success
    assert_equal expected, data.fetch("direct_conversations").sole.fetch("unread_count")
  end

  def with_singleton(target, name, replacement)
    original = target.method(name)
    target.define_singleton_method(name, replacement)
    yield
  ensure
    target.define_singleton_method(name, original)
  end

  def help_request(**attributes)
    HelpRequest.create!({ student: @student, cohort: @cohort, context_type: :lesson, context_source: :primary,
      context_id: 1, context_label: "Private context", context_path: "/lessons/1", category: :technical,
      message: "Private help message" }.merge(attributes))
  end

  def block(title, position)
    mod = @curriculum.modules.first || @curriculum.modules.create!(name: "Basics", position: 0, day_offset: 0, schedule_days: "daily")
    lesson = mod.lessons.first || mod.lessons.create!(title: "Lesson", position: 0, release_day: 0)
    lesson.content_blocks.create!(block_type: :exercise, position: position, title: title)
  end

  def submission(content, **attributes)
    Submission.create!({ user: @student, enrollment: @enrollment, content_block: content }.merge(attributes))
  end

  def meeting_at(time, student: @student, enrollment: @enrollment)
    config = @cohort.private_meeting_config || @cohort.create_private_meeting_config!(instructor: @admin, duration_minutes: 30)
    slot = config.private_meeting_slots.create!(instructor: @admin, starts_at: time, ends_at: time + config.duration_minutes.minutes)
    PrivateMeetingBooking.create!(private_meeting_slot: slot, enrollment: enrollment, cohort: @cohort,
      instructor: @admin, student: student, starts_at: slot.starts_at, ends_at: slot.ends_at, week_number: config.week_for(time))
  end

  def assert_private_fields_absent
    forbidden = %w[email phone grade feedback text repo_url live_url message staff_response evidence_snapshot zoom_url token_digest]
    check = lambda do |value|
      case value
      when Hash
        assert_empty(value.keys & forbidden)
        value.each_value { |item| check.call(item) }
      when Array then value.each { |item| check.call(item) }
      end
    end
    check.call(data)
    %w[private@example.com Secret\ submitted\ work Private\ feedback Private\ help\ message Private\ response Private\ scope].each do |secret|
      refute_includes response.body, secret
    end
  end
end
