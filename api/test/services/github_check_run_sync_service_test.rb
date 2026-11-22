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
          "check_suite" => { "id" => 901, "app" => { "name" => "GitHub Actions" }, "workflow_path" => ".github/workflows/prework.yml" },
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
    assert_equal 901, run.check_suite_id
    assert_equal ".github/workflows/prework.yml", run.workflow_path
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

  test "overlapping older in_progress refresh cannot regress or prune newer committed completed runs" do
    @submission.github_check_runs.create!(
      external_id: 101,
      name: "prework/111.rb",
      head_sha: "abc123",
      status: "queued",
      conclusion: nil,
      started_at: Time.zone.parse("2026-08-15 09:59:00 UTC"),
      fetched_at: Time.zone.parse("2026-08-15 09:59:05 UTC")
    )

    service = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token", now: Time.zone.parse("2026-08-15 10:00:00 UTC"))
    original_get = service.method(:github_get)
    submission = @submission
    service.define_singleton_method(:github_get) do |_url, page:|
      # Simulate a newer refresh committing completed/success + a brand-new check run 102
      # while this older request's HTTP call was in flight.
      submission.github_check_runs.find_by!(external_id: 101).update!(
        status: "completed",
        conclusion: "success",
        completed_at: Time.zone.parse("2026-08-15 10:00:30 UTC"),
        fetched_at: Time.zone.parse("2026-08-15 10:00:35 UTC")
      )
      submission.github_check_runs.create!(
        external_id: 102,
        name: "prework/111-edge.rb",
        head_sha: "abc123",
        status: "completed",
        conclusion: "success",
        completed_at: Time.zone.parse("2026-08-15 10:00:32 UTC"),
        fetched_at: Time.zone.parse("2026-08-15 10:00:35 UTC")
      )
      FakeResponse.new(true, 200, {
        "total_count" => 1,
        "check_runs" => [ {
          "id" => 101,
          "name" => "prework/111.rb",
          "head_sha" => "abc123",
          "status" => "in_progress",
          "conclusion" => nil,
          "started_at" => "2026-08-15T09:59:10Z"
        } ]
      })
    end

    result = service.call
    assert_nil result[:error]

    run_101 = @submission.github_check_runs.find_by!(external_id: 101)
    assert_equal "completed", run_101.status
    assert_equal "success", run_101.conclusion
    assert @submission.github_check_runs.exists?(external_id: 102), "newer concurrently created check run must not be pruned"
  ensure
    service.define_singleton_method(:github_get, original_get)
  end

  test "aborts check-run write if submission commit_sha changed while provider HTTP was in flight" do
    service = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token")
    original_get = service.method(:github_get)
    submission = @submission
    service.define_singleton_method(:github_get) do |_url, page:|
      submission.update!(commit_sha: "def456")
      FakeResponse.new(true, 200, {
        "total_count" => 1,
        "check_runs" => [ {
          "id" => 201,
          "name" => "prework/111.rb",
          "head_sha" => "abc123",
          "status" => "completed",
          "conclusion" => "success"
        } ]
      })
    end

    result = service.call
    assert_match "commit changed", result[:error]
    assert_empty @submission.github_check_runs
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

  test "stale snapshot with tied timestamps does not overwrite webhook conclusion committed during fetch" do
    @submission.github_check_runs.create!(
      external_id: 750,
      name: "prework/111.rb",
      head_sha: "abc123",
      status: "completed",
      conclusion: "failure",
      started_at: Time.iso8601("2026-08-15T00:00:00Z"),
      completed_at: Time.iso8601("2026-08-15T00:01:00Z"),
      fetched_at: 5.minutes.ago
    )

    service = GithubCheckRunSyncService.new(submission: @submission, token: "secret-token", now: Time.zone.parse("2026-08-15 10:00"))
    original_get = service.method(:github_get)
    submission = @submission

    service.define_singleton_method(:github_get) do |_url, page:|
      # Concurrent webhook updates conclusion to success at the same second before HTTP fetch returns.
      submission.with_lock do
        GithubCheckRunMerger.upsert_locked!(
          submission: submission,
          attributes: {
            external_id: 750,
            name: "prework/111.rb",
            head_sha: "abc123",
            status: "completed",
            conclusion: "success",
            started_at: "2026-08-15T00:00:00Z",
            completed_at: "2026-08-15T00:01:00Z",
            app_slug: "github-actions"
          },
          fetched_at: Time.zone.parse("2026-08-15 10:00:01")
        )
      end

      # Stale HTTP snapshot has identical started_at/completed_at with the pre-webhook failure conclusion.
      FakeResponse.new(true, 200, {
        "total_count" => 1,
        "check_runs" => [ {
          "id" => 750,
          "name" => "prework/111.rb",
          "head_sha" => "abc123",
          "status" => "completed",
          "conclusion" => "failure",
          "started_at" => "2026-08-15T00:00:00Z",
          "completed_at" => "2026-08-15T00:01:00Z",
          "app" => { "slug" => "github-actions" }
        } ]
      })
    end

    result = service.call
    assert_nil result[:error]

    run = @submission.github_check_runs.find_by!(external_id: 750)
    assert_equal "completed", run.status
    assert_equal "success", run.conclusion

    # A subsequent snapshot with a strictly later completed_at DOES update even if the row changed mid-fetch.
    service.define_singleton_method(:github_get) do |_url, page:|
      submission.with_lock do
        GithubCheckRunMerger.upsert_locked!(
          submission: submission,
          attributes: {
            external_id: 750,
            name: "prework/111.rb",
            head_sha: "abc123",
            status: "completed",
            conclusion: "neutral",
            started_at: "2026-08-15T00:00:00Z",
            completed_at: "2026-08-15T00:01:00Z",
            app_slug: "github-actions"
          },
          fetched_at: Time.zone.parse("2026-08-15 10:00:02")
        )
      end

      FakeResponse.new(true, 200, {
        "total_count" => 1,
        "check_runs" => [ {
          "id" => 750,
          "name" => "prework/111.rb",
          "head_sha" => "abc123",
          "status" => "completed",
          "conclusion" => "success",
          "started_at" => "2026-08-15T00:00:00Z",
          "completed_at" => "2026-08-15T00:02:00Z",
          "app" => { "slug" => "github-actions" }
        } ]
      })
    end

    assert_nil service.call[:error]
    run.reload
    assert_equal "success", run.conclusion
    assert_equal Time.iso8601("2026-08-15T00:02:00Z"), run.completed_at
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

  test "GitHub App check sync resolves workflow_path via Actions workflow_runs for real check-run payloads and degrades fail-closed on 403" do
    sha = "a" * 40
    workflow_path = ".github/workflows/prework.yml"
    workflow_text = "name: Prework Checks\n"
    workflow_oid = "b" * 40
    workflow_sha256 = Digest::SHA256.hexdigest(workflow_text)

    curriculum = Curriculum.create!(name: "Actions Provenance Curriculum")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "Prework", position: 0)
    lesson = Lesson.create!(curriculum_module: mod, title: "Ex 1", position: 0, release_day: 0)
    block = lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "111", filename: "111.rb")
    cohort = Cohort.create!(
      curriculum: curriculum,
      name: "Actions Provenance Cohort",
      start_date: Date.current,
      status: :active,
      settings: { "features" => { "github_app" => true, "github_grade_suggestions" => true } }
    )
    SchoolSetting.current.update!(features: { "github_app" => true, "github_grade_suggestions" => true })

    student = User.create!(
      clerk_id: "actions_prov_student",
      email: "actions-prov@example.invalid",
      first_name: "Prov",
      last_name: "Student",
      role: :student,
      github_username: "prov-student"
    )
    student.record_verified_github_identity!(id: 99_001, login: "prov-student")
    enrollment = Enrollment.create!(user: student, cohort: cohort, status: :active)
    installation = GithubAppInstallation.create!(
      cohort: cohort,
      app_id: 12_345,
      installation_id: 88_001,
      account_login: "prov-student",
      account_id: 99_001,
      account_type: "User",
      repository_selection: "selected",
      connection_state: "connected",
      connected_at: Time.current,
      checked_at: Time.current
    )
    binding_record = GithubRepositoryBinding.create!(
      enrollment: enrollment,
      github_app_installation: installation,
      full_name: "prov-student/prework",
      repository_id: 55_555,
      github_user_id: "99001",
      github_username: "prov-student",
      verification_state: "verified",
      verified_at: Time.current,
      checked_at: Time.current
    )
    ExerciseCheckPolicy.create_version!(
      content_block: block,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: workflow_path,
      expected_workflow_sha: workflow_sha256
    )
    submission = Submission.create!(
      user: student,
      enrollment: enrollment,
      content_block: block,
      submission_type: :prework_github_sync,
      text: "puts 1",
      repo_url: "https://github.com/prov-student/prework",
      commit_sha: sha,
      branch: "main",
      github_repository_id: 55_555,
      github_revision: {
        "version" => 1,
        "binding_id" => binding_record.id,
        "repository_id" => 55_555,
        "repository_full_name" => "prov-student/prework",
        "paths" => [ "111.rb" ],
        "content_digest" => Digest::SHA256.hexdigest("puts 1"),
        "source_bytes" => 6,
        "captured_at" => Time.current.iso8601(6),
        "workflow_files" => {
          workflow_path => { "present" => true, "oid" => workflow_oid, "sha256" => workflow_sha256 }
        }
      }
    )

    key = OpenSSL::PKey::RSA.generate(2048)
    creds = Struct.new(:app_id, :slug, :private_key) { def configured? = true }.new("12345", "synthetic-app", key.to_pem)
    actions_status = 200
    transport = Object.new
    transport.define_singleton_method(:post) do |_url, **_opts|
      FakeResponse.new(true, 201, { "token" => "tok-1", "expires_at" => 1.hour.from_now.iso8601 })
    end
    transport.define_singleton_method(:get) do |url, **_opts|
      if url.end_with?("/repositories/55555")
        FakeResponse.new(true, 200, { "id" => 55_555, "full_name" => "prov-student/prework", "fork" => false, "owner" => { "id" => 99_001, "login" => "prov-student", "type" => "User" } })
      elsif url.end_with?("/commits/#{sha}/check-runs")
        # Realistic GitHub REST check-runs payload: has check_suite.id, NO workflow_path!
        FakeResponse.new(true, 200, {
          "total_count" => 1,
          "check_runs" => [ {
            "id" => 91_001,
            "name" => "prework/111.rb",
            "head_sha" => sha,
            "status" => "completed",
            "conclusion" => "success",
            "app" => { "slug" => "github-actions" },
            "check_suite" => { "id" => 77_001, "app" => { "name" => "GitHub Actions" } },
            "started_at" => "2026-11-22T09:58:00Z",
            "completed_at" => "2026-11-22T09:59:00Z"
          } ]
        })
      elsif url.end_with?("/actions/runs")
        if actions_status == 200
          FakeResponse.new(true, 200, {
            "total_count" => 1,
            "workflow_runs" => [ {
              "id" => 44_001,
              "check_suite_id" => 77_001,
              "head_sha" => sha,
              "path" => workflow_path
            } ]
          })
        else
          FakeResponse.new(false, actions_status, { "message" => "Resource not accessible by integration" })
        end
      else
        raise "Unexpected URL: #{url}"
      end
    end

    app_client = GithubAppClient.new(transport: transport, credentials: creds, cache: ActiveSupport::Cache::MemoryStore.new)

    # 1. When Actions API returns 403 (missing actions:read), sync still commits the check run,
    # binding remains verified, and evaluator fails closed (workflow_tampered) because workflow_path is nil.
    actions_status = 403
    denied_result = GithubCheckRunSyncService.new(submission: submission, token: nil, app_client: app_client).call
    assert_nil denied_result[:error]
    assert_equal "verified", binding_record.reload.verification_state
    run = submission.github_check_runs.find_by!(external_id: 91_001)
    assert_nil run.workflow_path
    assert_equal "no_suggestion", denied_result[:grade_suggestion].outcome
    assert_equal "workflow_tampered", denied_result[:grade_suggestion].reason_code

    # 2. When Actions API returns workflow_runs with matching check_suite_id + head_sha,
    # workflow_path is enriched and evaluator produces suggest_b.
    actions_status = 200
    ok_result = GithubCheckRunSyncService.new(submission: submission.reload, token: nil, app_client: app_client).call
    assert_nil ok_result[:error]
    assert_equal workflow_path, run.reload.workflow_path
    assert_equal "suggest_b", ok_result[:grade_suggestion].outcome
    assert_equal "B", ok_result[:grade_suggestion].suggested_grade
  end
end
