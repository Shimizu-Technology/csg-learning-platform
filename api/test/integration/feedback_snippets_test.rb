require "test_helper"

class FeedbackSnippetsTest < ActionDispatch::IntegrationTest
  def setup
    @instructor = User.create!(clerk_id: "snippet-instructor", email: "snippet-instructor@example.com", first_name: "Ina", role: :instructor)
    @other_instructor = User.create!(clerk_id: "snippet-other", email: "snippet-other@example.com", first_name: "Owen", role: :instructor)
    @admin = User.create!(clerk_id: "snippet-admin", email: "snippet-admin@example.com", first_name: "Ada", role: :admin)
    @student = User.create!(clerk_id: "snippet-student", email: "snippet-student@example.com", first_name: "Stu", role: :student)
  end

  test "staff can create, list, and use shared editable snippets" do
    as_user(@instructor) do
      post "/api/v1/feedback_snippets",
           params: { feedback_snippet: { body: "Your solution works. Next, explain why you chose this approach." } },
           headers: auth_headers
    end
    assert_response :created
    snippet = JSON.parse(response.body).fetch("feedback_snippet")
    assert_equal "Your solution works. Next, explain why you chose this approach.", snippet.fetch("body")
    assert snippet.fetch("title").present?
    assert_equal true, snippet.fetch("can_manage")

    as_user(@other_instructor) do
      get "/api/v1/feedback_snippets", headers: auth_headers
    end
    assert_response :success
    listed = JSON.parse(response.body).dig("feedback_snippets", 0)
    assert_equal snippet.fetch("id"), listed.fetch("id")
    assert_equal false, listed.fetch("can_manage")

    as_user(@other_instructor) do
      post "/api/v1/feedback_snippets/#{snippet.fetch('id')}/use", headers: auth_headers
    end
    assert_response :success
    assert_equal 1, FeedbackSnippet.find(snippet.fetch("id")).usage_count
  end

  test "only the creator or an admin can manage a shared snippet" do
    snippet = @instructor.feedback_snippets.create!(title: "Clear next step", body: "Add one focused next step.")

    as_user(@other_instructor) do
      patch "/api/v1/feedback_snippets/#{snippet.id}",
            params: { feedback_snippet: { body: "Changed by someone else" } },
            headers: auth_headers
    end
    assert_response :forbidden
    assert_equal "Add one focused next step.", snippet.reload.body

    as_user(@admin) do
      delete "/api/v1/feedback_snippets/#{snippet.id}", headers: auth_headers
    end
    assert_response :no_content
    assert_not snippet.reload.active?
  end

  test "students cannot access instructor snippets" do
    as_user(@student) do
      get "/api/v1/feedback_snippets", headers: auth_headers
    end
    assert_response :forbidden
  end

  private

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = {
      "sub" => user.clerk_id,
      "email" => user.email,
      "first_name" => user.first_name,
      "last_name" => user.last_name
    }
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
