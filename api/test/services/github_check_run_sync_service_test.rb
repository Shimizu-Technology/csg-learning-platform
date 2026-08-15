require "test_helper"

class GithubCheckRunSyncServiceTest < ActiveSupport::TestCase
  FakeResponse = Struct.new(:success?, :code, :parsed_response)

  def setup
    curriculum = Curriculum.create!(name: "Checks curriculum")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "CI", position: 0)
    lesson = Lesson.create!(curriculum_module: mod, title: "Automated checks", position: 0, release_day: 0)
    block = lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Ship it")
    student = User.create!(clerk_id: "checks_student", email: "checks@example.com", first_name: "Checks", last_name: "Student", role: :student)
    @submission = Submission.create!(
      user: student,
      content_block: block,
      repo_url: "https://github.com/checks-student/course-project",
      commit_sha: "abc123",
      num_submissions: 1
    )
  end

  test "imports privacy-safe check metadata for the submission commit" do
    @submission.github_check_runs.create!(external_id: 80, name: "superseded test", head_sha: "abc123", status: "completed", conclusion: "failure", fetched_at: 1.hour.ago)
    @submission.github_check_runs.create!(external_id: 79, name: "old commit test", head_sha: "old123", status: "completed", conclusion: "failure", fetched_at: 1.day.ago)
    service = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token", now: Time.zone.parse("2026-08-15 10:00"))
    original_get = service.method(:github_get)
    service.define_singleton_method(:github_get) do |url|
      raise "wrong endpoint" unless url.end_with?("/repos/checks-student/course-project/commits/abc123/check-runs")

      FakeResponse.new(true, 200, {
        "total_count" => 1,
        "check_runs" => [ {
          "id" => 81,
          "name" => "test",
          "head_sha" => "abc123",
          "status" => "completed",
          "conclusion" => "success",
          "details_url" => "https://github.com/checks-student/course-project/actions/runs/9",
          "started_at" => "2026-08-15T00:00:00Z",
          "completed_at" => "2026-08-15T00:01:00Z",
          "app" => { "slug" => "github-actions" },
          "check_suite" => { "app" => { "name" => "GitHub Actions" } },
          "output" => { "text" => "private logs are intentionally ignored" }
        } ]
      })
    end

    result = service.call

    assert_nil result[:error]
    run = @submission.github_check_runs.find_by!(external_id: 81)
    assert_equal "test", run.name
    assert_equal "success", run.conclusion
    assert_equal "github-actions", run.app_slug
    refute_includes run.attributes.to_json, "private logs"
    assert_not @submission.github_check_runs.exists?(external_id: 80)
    assert @submission.github_check_runs.exists?(external_id: 79), "prior-commit history should remain available for audit"
  ensure
    service.define_singleton_method(:github_get, original_get)
  end

  test "rejects non-GitHub repository coordinates without making a request" do
    @submission.update!(repo_url: "https://example.com/checks-student/course-project")
    result = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token").call

    assert_match "repository URL", result[:error]
    assert_empty @submission.github_check_runs
  end

  test "does not prune current commit rows from a partial GitHub page" do
    @submission.github_check_runs.create!(external_id: 80, name: "not on first page", head_sha: "abc123", status: "completed", conclusion: "success", fetched_at: 1.hour.ago)
    service = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token")
    original_get = service.method(:github_get)
    service.define_singleton_method(:github_get) do |_url|
      FakeResponse.new(true, 200, {
        "total_count" => 101,
        "check_runs" => [ {
          "id" => 81,
          "name" => "first page test",
          "head_sha" => "abc123",
          "status" => "completed",
          "conclusion" => "success"
        } ]
      })
    end

    assert_nil service.call[:error]
    assert @submission.github_check_runs.exists?(external_id: 80)
    assert @submission.github_check_runs.exists?(external_id: 81)
  ensure
    service.define_singleton_method(:github_get, original_get)
  end
end
