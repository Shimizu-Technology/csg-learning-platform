require "test_helper"

class RubricsApiTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Web Development")
    @admin = User.create!(
      clerk_id: "clerk_admin_rubrics_api",
      email: "admin-rubrics@example.com",
      first_name: "Admin",
      role: :admin
    )
    @rubric = Rubric.create!(
      curriculum: @curriculum,
      title: "Project quality",
      rubric_criteria_attributes: [
        { title: "Correctness", description: "The required behavior works." },
        { title: "Clarity", description: "The work is easy to follow." }
      ]
    )
  end

  test "admin can update, add, and remove unused criteria atomically" do
    correctness = @rubric.rubric_criteria.ordered.first

    as_user(@admin) do
      patch "/api/v1/rubrics/#{@rubric.id}",
            params: {
              rubric: {
                title: "Capstone quality",
                criteria: [
                  { id: correctness.id, title: "Working behavior", description: "All required behavior works." },
                  { title: "Explanation", description: "The student can explain the decisions." }
                ]
              }
            },
            headers: auth_headers
    end

    assert_response :success
    assert_equal "Capstone quality", @rubric.reload.title
    assert_equal [ "Working behavior", "Explanation" ], @rubric.rubric_criteria.ordered.pluck(:title)
    assert_equal correctness.id, @rubric.rubric_criteria.ordered.first.id
  end

  test "admin can delete an unused rubric and its criteria" do
    assert_difference("Rubric.count", -1) do
      assert_difference("RubricCriterion.count", -2) do
        as_user(@admin) do
          delete "/api/v1/rubrics/#{@rubric.id}", headers: auth_headers
        end
      end
    end

    assert_response :no_content
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
