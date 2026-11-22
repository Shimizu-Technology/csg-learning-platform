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
    service.define_singleton_method(:github_get) do |url, page:|
      raise "wrong endpoint" unless url.end_with?("/repos/checks-student/course-project/commits/abc123/check-runs")
      raise "wrong page" unless page == 1

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

  test "loads every GitHub page before pruning superseded current commit rows" do
    @submission.github_check_runs.create!(external_id: 80, name: "not on first page", head_sha: "abc123", status: "completed", conclusion: "success", fetched_at: 1.hour.ago)
    service = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token")
    original_get = service.method(:github_get)
    requested_pages = []
    service.define_singleton_method(:github_get) do |_url, page:|
      requested_pages << page
      FakeResponse.new(true, 200, {
        "total_count" => 2,
        "check_runs" => [ {
          "id" => 80 + page,
          "name" => "page #{page} test",
          "head_sha" => "abc123",
          "status" => "completed",
          "conclusion" => "success"
        } ]
      })
    end

    assert_nil service.call[:error]
    assert_equal [ 1, 2 ], requested_pages
    assert_not @submission.github_check_runs.exists?(external_id: 80)
    assert @submission.github_check_runs.exists?(external_id: 81)
    assert @submission.github_check_runs.exists?(external_id: 82)
  ensure
    service.define_singleton_method(:github_get, original_get)
  end

  test "concurrent webhook check run committed during manual refresh is never regressed or pruned" do
    @submission.github_check_runs.create!(
      external_id: 700,
      name: "stale run",
      head_sha: "abc123",
      status: "completed",
      conclusion: "failure",
      fetched_at: 1.hour.ago
    )
    @submission.github_check_runs.create!(
      external_id: 701,
      name: "prework/111.rb",
      head_sha: "abc123",
      status: "in_progress",
      started_at: Time.iso8601("2026-08-15T00:00:00Z"),
      fetched_at: 5.minutes.ago
    )

    service = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token", now: Time.zone.parse("2026-08-15 10:00"))
    original_get = service.method(:github_get)
    submission = @submission

    service.define_singleton_method(:github_get) do |_url, page:|
      # Simulate a webhook committing newer evidence while the manual HTTP fetch is in flight:
      # 1) external_id 701 completes with success
      # 2) a brand-new check run 702 arrives that is absent from this older HTTP snapshot
      submission.with_lock do
        GithubCheckRunMerger.upsert_locked!(
          submission: submission,
          attributes: {
            external_id: 701,
            name: "prework/111.rb",
            head_sha: "abc123",
            status: "completed",
            conclusion: "success",
            started_at: "2026-08-15T00:00:00Z",
            completed_at: "2026-08-15T00:02:00Z",
            app_slug: "github-actions"
          },
          fetched_at: Time.zone.parse("2026-08-15 10:00:01")
        )
        GithubCheckRunMerger.upsert_locked!(
          submission: submission,
          attributes: {
            external_id: 702,
            name: "prework/lint",
            head_sha: "abc123",
            status: "completed",
            conclusion: "success",
            started_at: "2026-08-15T00:01:00Z",
            completed_at: "2026-08-15T00:02:30Z",
            app_slug: "github-actions"
          },
          fetched_at: Time.zone.parse("2026-08-15 10:00:01")
        )
      end

      # Older GitHub HTTP snapshot still shows 701 as in_progress and does not include 702.
      FakeResponse.new(true, 200, {
        "total_count" => 1,
        "check_runs" => [ {
          "id" => 701,
          "name" => "prework/111.rb",
          "head_sha" => "abc123",
          "status" => "in_progress",
          "conclusion" => nil,
          "started_at" => "2026-08-15T00:00:00Z",
          "completed_at" => nil,
          "app" => { "slug" => "github-actions" }
        } ]
      })
    end

    result = service.call
    assert_nil result[:error]

    # Pre-existing stale run 700 (unchanged during fetch and absent from snapshot) IS pruned.
    assert_not @submission.github_check_runs.exists?(external_id: 700)

    # Webhook's completed 701 is NOT regressed back to in_progress.
    run_701 = @submission.github_check_runs.find_by!(external_id: 701)
    assert_equal "completed", run_701.status
    assert_equal "success", run_701.conclusion

    # Webhook's newly committed 702 is NOT pruned by the older snapshot.
    run_702 = @submission.github_check_runs.find_by!(external_id: 702)
    assert_equal "completed", run_702.status
    assert_equal "success", run_702.conclusion
  ensure
    service.define_singleton_method(:github_get, original_get)
  end

  test "manual refresh reflects a legitimate GitHub rerun reset when untouched since pre-fetch" do
    @submission.github_check_runs.create!(
      external_id: 801,
      name: "prework/111.rb",
      head_sha: "abc123",
      status: "completed",
      conclusion: "failure",
      started_at: Time.iso8601("2026-08-15T00:00:00Z"),
      completed_at: Time.iso8601("2026-08-15T00:01:00Z"),
      fetched_at: 5.minutes.ago
    )

    service = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token", now: Time.zone.parse("2026-08-15 10:05"))
    original_get = service.method(:github_get)
    service.define_singleton_method(:github_get) do |_url, page:|
      FakeResponse.new(true, 200, {
        "total_count" => 1,
        "check_runs" => [ {
          "id" => 801,
          "name" => "prework/111.rb",
          "head_sha" => "abc123",
          "status" => "in_progress",
          "conclusion" => nil,
          "started_at" => "2026-08-15T10:04:00Z",
          "completed_at" => nil,
          "app" => { "slug" => "github-actions" }
        } ]
      })
    end

    result = service.call
    assert_nil result[:error]

    run = @submission.github_check_runs.find_by!(external_id: 801)
    assert_equal "in_progress", run.status
    assert_nil run.conclusion
    assert_nil run.completed_at
    assert_equal Time.iso8601("2026-08-15T10:04:00Z"), run.started_at
  ensure
    service.define_singleton_method(:github_get, original_get)
  end

  test "stale completed snapshot older than an active newer rerun does not overwrite it" do
    @submission.github_check_runs.create!(
      external_id: 810,
      name: "prework/111.rb",
      head_sha: "abc123",
      status: "in_progress",
      started_at: Time.iso8601("2026-08-15T10:05:00Z"),
      fetched_at: Time.zone.parse("2026-08-15 10:05:05")
    )

    @submission.with_lock do
      GithubCheckRunMerger.upsert_locked!(
        submission: @submission,
        attributes: {
          external_id: 810,
          name: "prework/111.rb",
          head_sha: "abc123",
          status: "completed",
          conclusion: "failure",
          started_at: "2026-08-15T10:00:00Z",
          completed_at: "2026-08-15T10:01:00Z"
        },
        fetched_at: Time.zone.parse("2026-08-15 10:05:10")
      )
    end

    run = @submission.github_check_runs.find_by!(external_id: 810)
    assert_equal "in_progress", run.status
    assert_nil run.conclusion
    assert_equal Time.iso8601("2026-08-15T10:05:00Z"), run.started_at

    # Same-attempt completion (started_at >= run.started_at) DOES advance cleanly.
    @submission.with_lock do
      GithubCheckRunMerger.upsert_locked!(
        submission: @submission,
        attributes: {
          external_id: 810,
          name: "prework/111.rb",
          head_sha: "abc123",
          status: "completed",
          conclusion: "success",
          started_at: "2026-08-15T10:05:00Z",
          completed_at: "2026-08-15T10:06:00Z"
        },
        fetched_at: Time.zone.parse("2026-08-15 10:06:05")
      )
    end
    run.reload
    assert_equal "completed", run.status
    assert_equal "success", run.conclusion
  end

  test "manual refresh makes zero writes and returns retryable error if submission commit_sha changes mid-fetch" do
    existing = @submission.github_check_runs.create!(
      external_id: 820,
      name: "existing run",
      head_sha: "abc123",
      status: "completed",
      conclusion: "success",
      fetched_at: 5.minutes.ago
    )

    service = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token")
    original_get = service.method(:github_get)
    submission = @submission
    service.define_singleton_method(:github_get) do |_url, page:|
      # Another sync updates commit_sha while this HTTP fetch is in flight.
      submission.update!(commit_sha: "newsha999")
      FakeResponse.new(true, 200, {
        "total_count" => 1,
        "check_runs" => [ {
          "id" => 821,
          "name" => "stale sha run",
          "head_sha" => "abc123",
          "status" => "completed",
          "conclusion" => "failure"
        } ]
      })
    end

    result = service.call
    assert_match(/commit changed/i, result[:error])
    assert_empty result[:check_runs]
    assert @submission.github_check_runs.exists?(existing.id)
    assert_not @submission.github_check_runs.exists?(external_id: 821)
  ensure
    service.define_singleton_method(:github_get, original_get)
  end
end
