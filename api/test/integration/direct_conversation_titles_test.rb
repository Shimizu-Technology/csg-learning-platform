require "test_helper"

# Group DM titles are built from preloaded members on the list and from a
# query on the detail view. Both must name the other members in user id order,
# even after a member's row is updated and moves within the users table.
class DirectConversationTitlesTest < ActionDispatch::IntegrationTest
  setup do
    @cohort = Cohort.create!(curriculum: Curriculum.create!(name: "Titles curriculum"), name: "Titles cohort",
      start_date: Date.current - 7, end_date: Date.current + 60, status: :active)
    @learner = person("learner", :student, "Load", "Learner")
    @peer2 = person("peer2", :student, "Load", "Peer2")
    @peer3 = person("peer3", :student, "Load", "Peer3")
    @instructor = person("instructor", :instructor, "Load", "Instructor")
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    [ @learner, @peer2, @peer3 ].each { |user| Enrollment.create!(user: user, cohort: @cohort, status: :active) }
    @group = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @peer3, @instructor, @learner, @peer2 ])
  end

  test "list and detail titles match and keep user id order after a member profile changes" do
    @peer2.update!(first_name: "Changed")
    @learner.update_column(:last_seen_at, Time.current)

    expected = "Load Learner, Changed Peer2, Load Peer3"
    assert_equal [ @learner, @peer2, @peer3 ].map(&:id), [ @learner, @peer2, @peer3 ].map(&:id).sort

    as_user(@instructor) { get "/api/v1/direct_conversations", headers: auth_headers }
    assert_response :success
    list_title = response.parsed_body.fetch("direct_conversations").find { |conversation| conversation.fetch("id") == @group.id }.fetch("title")

    as_user(@instructor) { get "/api/v1/direct_conversations/#{@group.id}", headers: auth_headers }
    assert_response :success
    detail_title = response.parsed_body.dig("direct_conversation", "title")

    assert_equal expected, list_title
    assert_equal list_title, detail_title
    assert_equal expected, DirectConversation.find(@group.id).title_for(@instructor)
    assert_equal expected, DirectConversation.includes(:users).find(@group.id).title_for(@instructor)
  end

  private

  def person(name, role, first, last)
    User.create!(clerk_id: "titles_#{name}", email: "titles-#{name}@example.com", first_name: first, last_name: last, role: role,
      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
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
