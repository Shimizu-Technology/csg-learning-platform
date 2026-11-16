require "test_helper"

# T-3: "Message selected students" sends one direct message per student through
# the same two endpoints as "Message Alex" (web/src/lib/bulkMessage.ts). There
# is no bulk endpoint, so each send meets the normal checks: the staff member's
# cohort access, who they may message, blocks in either direction, and the
# shared per-person message rate limit (#252). This walks the exact requests
# the composer makes.
class MessageSelectedStudentsTest < ActionDispatch::IntegrationTest
  setup do
    curriculum = Curriculum.create!(name: "Bulk message curriculum")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current - 7, status: :active)
    @other = Cohort.create!(curriculum: curriculum, name: "Cohort 4", start_date: Date.current - 7, status: :active)
    @teacher = person("teacher", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @students = %w[alex blair casey].map { |name| person(name, :student).tap { |user| Enrollment.create!(user: user, cohort: @cohort, status: :active, joined_at: 1.day.ago) } }
    @elsewhere = person("dana", :student).tap { |user| Enrollment.create!(user: user, cohort: @other, status: :active, joined_at: 1.day.ago) }
  end

  test "each selected student gets their own conversation and message; a blocked student is refused" do
    UserBlock.create!(blocker: @students[1], blocked_user: @teacher)

    outcomes = @students.map { |student| send_one(student, "Checking in before Saturday", "bulk-b1-#{student.id}") }

    assert_equal [ :created, :forbidden, :created ], outcomes
    conversations = DirectConversation.joins(:direct_conversation_members).where(direct_conversation_members: { user_id: @teacher.id }).distinct
    assert_equal 2, conversations.count, "one private conversation per reachable student, never a group"
    conversations.each { |conversation| assert_equal 2, conversation.users.count }
    assert_equal 2, Message.where(author: @teacher, body: "Checking in before Saturday").count
    assert_empty Message.joins(:direct_conversation).merge(DirectConversation.joins(:direct_conversation_members).where(direct_conversation_members: { user_id: @students[1].id }))
  end

  test "a retried batch does not message anyone twice" do
    2.times { assert_equal :created, send_one(@students[0], "Once only", "bulk-retry-#{@students[0].id}") }
    assert_equal 1, Message.where(author: @teacher, body: "Once only").count
  end

  test "staff can't message a student in a cohort they don't teach" do
    post "/api/v1/direct_conversations", params: { cohort_id: @other.id, user_ids: [ @elsewhere.id ] }, headers: headers(@teacher), as: :json
    assert_response :forbidden
    post "/api/v1/direct_conversations", params: { cohort_id: @cohort.id, user_ids: [ @elsewhere.id ] }, headers: headers(@teacher), as: :json
    assert_response :not_found, "a student outside this cohort isn't someone they can message here"
    assert_equal 0, Message.where(author: @teacher).count
  end

  test "the batch shares the per-person message limit and stops at it" do
    ApiRateLimits::STORE.clear
    key = "rate-limit:authenticated-api:messages:#{@teacher.id}"
    ApiRateLimits::STORE.write(key, 117, expires_in: 1.minute)

    assert_equal :created, send_one(@students[0], "Near the limit", "bulk-limit-#{@students[0].id}")
    post "/api/v1/direct_conversations", params: { cohort_id: @cohort.id, user_ids: [ @students[1].id ] }, headers: headers(@teacher), as: :json
    assert_response :created
    conversation_id = response.parsed_body.dig("direct_conversation", "id")
    post "/api/v1/direct_conversations/#{conversation_id}/messages", params: { body: "Near the limit", client_message_id: "bulk-limit-#{@students[1].id}" }, headers: headers(@teacher), as: :json
    assert_response :too_many_requests
    assert_equal 1, Message.where(author: @teacher, body: "Near the limit").count
  ensure
    ApiRateLimits::STORE.clear
  end

  private

  def send_one(student, body, client_message_id)
    post "/api/v1/direct_conversations", params: { cohort_id: @cohort.id, user_ids: [ student.id ] }, headers: headers(@teacher), as: :json
    return Rack::Utils::SYMBOL_TO_STATUS_CODE.key(response.status) unless response.status == 201

    conversation_id = response.parsed_body.dig("direct_conversation", "id")
    post "/api/v1/direct_conversations/#{conversation_id}/messages", params: { body: body, client_message_id: client_message_id }, headers: headers(@teacher), as: :json
    response.status.in?([ 200, 201 ]) ? :created : [ Rack::Utils::SYMBOL_TO_STATUS_CODE.key(response.status), response.parsed_body ]
  end

  def person(name, role)
    User.create!(clerk_id: "bulk_#{name}", email: "bulk-#{name}@example.com", first_name: name.capitalize, last_name: "Synthetic", role: role,
      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
end
