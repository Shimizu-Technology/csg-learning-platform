require "test_helper"

class SubmissionGithubChecksTest < ActionDispatch::IntegrationTest
  def setup
    curriculum = Curriculum.create!(name: "Submission checks")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "CI", position: 0)
    lesson = Lesson.create!(curriculum_module: mod, title: "Checks", position: 0, release_day: 0)
    block = lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Tested project")
    @student = User.create!(clerk_id: "checks_owner", email: "owner@example.com", first_name: "Check", last_name: "Owner", role: :student)
    @other = User.create!(clerk_id: "checks_other", email: "other-checks@example.com", first_name: "Other", last_name: "Student", role: :student)
    @staff = User.create!(clerk_id: "checks_staff", email: "checks-staff@example.com", first_name: "Staff", last_name: "Reviewer", role: :instructor)
    @submission = Submission.create!(user: @student, content_block: block, repo_url: "https://github.com/check-owner/project", commit_sha: "abc123", num_submissions: 1)
    @submission.github_check_runs.create!(external_id: 4, name: "test", head_sha: "abc123", status: "completed", conclusion: "success", details_url: "https://github.com/check-owner/project/actions/runs/4", fetched_at: Time.current)
    @submission.github_check_runs.create!(external_id: 3, name: "old test", head_sha: "old123", status: "completed", conclusion: "failure", fetched_at: 1.day.ago)
  end

  test "the submission owner and staff can read persisted check metadata" do
    as_user(@student) { get "/api/v1/submissions/#{@submission.id}/github_checks", headers: auth_headers }
    assert_response :success
    assert_equal 1, JSON.parse(response.body).dig("github_checks", "summary", "passed")

    as_user(@staff) { get "/api/v1/submissions/#{@submission.id}/github_checks", headers: auth_headers }
    assert_response :success

    as_user(@staff) { get "/api/v1/submissions/#{@submission.id}", headers: auth_headers }
    assert_response :success
    assert_equal 1, JSON.parse(response.body).dig("submission", "github_checks", "summary", "total")
  end

  test "other students cannot read or refresh another learner's checks" do
    as_user(@other) { get "/api/v1/submissions/#{@submission.id}/github_checks", headers: auth_headers }
    assert_response :forbidden

    as_user(@student) { post "/api/v1/submissions/#{@submission.id}/github_checks", headers: auth_headers }
    assert_response :forbidden
  end

  private

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
