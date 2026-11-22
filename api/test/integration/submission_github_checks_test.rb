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
    @cohort = Cohort.create!(curriculum: curriculum, name: "Checks cohort", start_date: Date.current, status: :active)
    @cohort.cohort_instructor_assignments.create!(user: @staff)
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @submission = Submission.create!(user: @student, enrollment: enrollment, content_block: block, repo_url: "https://github.com/check-owner/project", commit_sha: "abc123", num_submissions: 1)
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
    assert_equal "test", response.parsed_body.dig("submission", "github_checks", "runs", 0, "name")
  end

  test "other students cannot read or refresh another learner's checks" do
    as_user(@other) { get "/api/v1/submissions/#{@submission.id}/github_checks", headers: auth_headers }
    assert_response :forbidden

    as_user(@student) { post "/api/v1/submissions/#{@submission.id}/github_checks", headers: auth_headers }
    assert_response :forbidden
  end

  test "POST /github_checks returns refreshed grade_suggestion for staff on opted-in cohorts and omits it on Off cohorts" do
    sha = "a" * 40
    @student.update!(github_username: "check-owner")
    @student.record_verified_github_identity!(id: 55_001, login: "check-owner")
    SchoolSetting.current.update!(features: { "github_app" => true, "github_grade_suggestions" => true })
    opted_cohort = Cohort.create!(
      curriculum: @cohort.curriculum,
      name: "Opted Checks Cohort",
      start_date: Date.current,
      status: :active,
      settings: { "features" => { "github_app" => true, "github_grade_suggestions" => true } }
    )
    opted_cohort.cohort_instructor_assignments.create!(user: @staff)
    enrollment = Enrollment.create!(user: @student, cohort: opted_cohort, status: :active)
    installation = GithubAppInstallation.create!(
      cohort: opted_cohort, app_id: 12_345, installation_id: 91_001, account_login: "check-owner",
      account_id: 55_001, account_type: "User", repository_selection: "selected",
      connection_state: "connected", connected_at: Time.current, checked_at: Time.current
    )
    binding = enrollment.github_repository_bindings.create!(
      github_app_installation: installation, curriculum_module: @submission.content_block.lesson.curriculum_module,
      repository_id: 66_001, full_name: "check-owner/project", github_username: "check-owner",
      github_user_id: "55001", verification_state: "verified", verified_at: Time.current
    )
    ExerciseCheckPolicy.create_version!(
      content_block: @submission.content_block, required_checks: [ "prework/test" ], allowed_app_slugs: [ "github-actions" ], created_by: @staff
    )
    opted_sub = Submission.create!(
      user: @student, enrollment: enrollment, content_block: @submission.content_block,
      submission_type: :prework_github_sync, text: "puts 1", commit_sha: sha, branch: "main",
      github_revision: {
        "version" => 1, "binding_id" => binding.id, "repository_id" => binding.repository_id,
        "repository_full_name" => binding.full_name, "paths" => [ "test.rb" ],
        "content_digest" => Digest::SHA256.hexdigest("puts 1"), "source_bytes" => 6,
        "captured_at" => Time.current.iso8601(6)
      }
    )

    fake_sync = Struct.new(:sub, :sha) do
      def call
        sub.github_check_runs.create!(
          external_id: 999, name: "prework/test", app_slug: "github-actions",
          head_sha: sha, status: "completed", conclusion: "success", fetched_at: Time.current
        )
        GithubGradeSuggestionEvaluator.evaluate_submission!(sub)
        { synced: 1 }
      end
    end

    original_new = GithubCheckRunSyncService.method(:new)
    begin
      GithubCheckRunSyncService.define_singleton_method(:new) { |submission:, token:| fake_sync.new(submission, submission.commit_sha) }

      as_user(@staff) { post "/api/v1/submissions/#{opted_sub.id}/github_checks", headers: auth_headers }
      assert_response :success
      assert_equal "suggest_b", response.parsed_body.dig("grade_suggestion", "outcome")
      assert_equal false, response.parsed_body.dig("grade_suggestion", "stale")

      # Off cohort omits grade_suggestion completely
      original_token = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
      ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = "fake-token"
      begin
        as_user(@staff) { post "/api/v1/submissions/#{@submission.id}/github_checks", headers: auth_headers }
      ensure
        ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = original_token
      end
      assert_response :success
      assert_not response.parsed_body.key?("grade_suggestion")
    ensure
      GithubCheckRunSyncService.define_singleton_method(:new, original_new)
    end
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
