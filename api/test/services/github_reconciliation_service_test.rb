require "test_helper"
require "stringio"
require_relative "../support/github_app_fixtures"
require_relative "../support/non_transactional_test_cleanup"

class GithubReconciliationServiceTest < ActiveSupport::TestCase
  include GithubAppFixtures

  SHA1 = "1111111111111111111111111111111111111111".freeze
  SHA2 = "2222222222222222222222222222222222222222".freeze

  setup do
    @now = Time.utc(2026, 11, 22, 12, 0, 0)
    travel_to @now
    build_github_app_fixture
    enable_reconciliation!(@cohort)
    verify_binding!(@binding, repo_id: 98765, verified_at: @now - 10.minutes)
    @fake.commit_sha = SHA1
    @fake.commit_branch = "main"
    @fake.committed_at = @now - 5.minutes
    @fake.source_text = "puts 'exercise 111 solution'"
  end

  teardown do
    travel_back
  end

  test "resolves exact commit SHA before fetching files and skips file fetch when head SHA is unchanged" do
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }

    metrics = {}
    GithubReconciliationService.new(client: @fake).call(now: @now, metrics: metrics)

    assert_equal 1, metrics[:claimed]
    assert_equal 1, metrics[:sent]
    assert_equal 0, metrics[:failed]
    assert_equal 1, metrics[:revisions_synced]

    call_order = @fake.calls.map(&:first)
    assert_equal [ :repository, :default_branch_head, :files_at_commit, :checks ], call_order

    files_call = @fake.calls.find { |c| c.first == :files_at_commit }
    assert_equal SHA1, files_call[3], "files must be fetched at the resolved exact commit SHA"

    sub = @enrollment.submissions.sole
    assert_equal SHA1, sub.commit_sha
    assert_equal 98765, sub.github_repository_id
    assert_equal "puts 'exercise 111 solution'", sub.text
    assert_nil sub.grade

    state = @binding.reload.github_reconciliation_state
    assert_equal "ok", state.last_status
    assert_equal SHA1, state.last_head_sha
    assert_equal 0, state.consecutive_failures
    assert_nil state.claim_token
    assert_nil state.claimed_until
    assert_equal @now + 1.hour, state.next_reconcile_at

    # Complete check run so next run has nothing pending.
    sub.github_check_runs.create!(
      external_id: 7001,
      name: "prework/111.rb",
      head_sha: SHA1,
      status: "completed",
      conclusion: "success",
      app_slug: "github-actions",
      fetched_at: @now
    )

    # Next hourly tick with unchanged head SHA skips files_at_commit completely!
    @fake.calls.clear
    next_time = @now + 1.hour + 1.minute
    travel_to next_time
    GithubReconciliationService.new(client: @fake).call(now: next_time, metrics: {})
    assert_equal [ :repository, :default_branch_head ], @fake.calls.map(&:first)

    # Adding a brand-new exercise block after last_reconciled_at triggers file fetch even at the same SHA.
    @fake.calls.clear
    travel_to(next_time + 5.minutes)
    @lesson.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "112.rb", position: 1)
    later_time = next_time + 1.hour + 1.minute
    travel_to later_time
    GithubReconciliationService.new(client: @fake).call(now: later_time, metrics: {})
    assert_includes @fake.calls.map(&:first), :files_at_commit
    assert_equal 2, @enrollment.submissions.count
  end

  test "event-before-sync recovery replays staged check_run webhook, attaches run, and evaluates suggest_b without writing Submission.grade" do
    @cohort.update!(settings: {
      "features" => {
        "github_app" => true,
        "github_webhooks" => true,
        "github_reconciliation" => true,
        "github_grade_suggestions" => true
      }
    })
    SchoolSetting.current.update!(features: {
      "github_app" => true,
      "github_webhooks" => true,
      "github_reconciliation" => true,
      "github_grade_suggestions" => true
    })

    workflow_text = "name: Prework\non: [push]\n"
    workflow_sha256 = Digest::SHA256.hexdigest(workflow_text)
    @fake.workflow_files = { ".github/workflows/prework.yml" => { "text" => workflow_text } }

    ExerciseCheckPolicy.create!(
      content_block: @block,
      version: 1,
      active: true,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: ".github/workflows/prework.yml",
      expected_workflow_sha: workflow_sha256
    )

    # Staged check_run webhook arrived BEFORE submission existed!
    staged = GithubWebhookDelivery.create!(
      delivery_id: "del-before-sync-pass",
      event: "check_run",
      action: "completed",
      installation_id: 123,
      repository_id: 98765,
      head_sha: SHA1,
      payload: {
        "check_run" => {
          "external_id" => 9001,
          "name" => "prework/111.rb",
          "status" => "completed",
          "conclusion" => "success",
          "head_sha" => SHA1,
          "app_slug" => "github-actions",
          "workflow_name" => "GitHub Actions",
          "workflow_path" => ".github/workflows/prework.yml",
          "check_suite_id" => 555,
          "started_at" => (@now - 4.minutes).iso8601,
          "completed_at" => (@now - 3.minutes).iso8601
        },
        "repository" => { "id" => 98765, "full_name" => "app-learner/prework-exercises" },
        "installation" => { "id" => 123 }
      },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 3.minutes
    )

    # Also a staged push event for the same SHA.
    staged_push = GithubWebhookDelivery.create!(
      delivery_id: "del-push-before-sync",
      event: "push",
      installation_id: 123,
      repository_id: 98765,
      head_sha: SHA1,
      payload: {
        "ref" => "refs/heads/main",
        "after" => SHA1,
        "deleted" => false,
        "repository" => { "id" => 98765, "full_name" => "app-learner/prework-exercises" }
      },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 4.minutes
    )

    metrics = {}
    GithubReconciliationService.new(client: @fake).call(now: @now, metrics: metrics)

    assert_equal 1, metrics[:revisions_synced]
    assert_equal 2, metrics[:webhooks_replayed]
    assert_equal 1, metrics[:suggestions_evaluated]
    # Because the replayed staged webhook already completed the only required check, no extra :checks HTTP call was needed!
    refute_includes @fake.calls.map(&:first), :checks

    assert_equal "processed", staged.reload.processing_state
    assert_not_nil staged.processed_at
    assert_equal "processed", staged_push.reload.processing_state

    sub = @enrollment.submissions.sole
    assert_nil sub.grade, "reconciliation must NEVER write Submission.grade"
    assert_nil sub.graded_at
    assert_nil sub.graded_by_id

    run = sub.github_check_runs.find_by!(external_id: 9001)
    assert_equal "completed", run.status
    assert_equal "success", run.conclusion
    assert_equal ".github/workflows/prework.yml", run.workflow_path

    suggestion = SubmissionGradeSuggestion.find_by!(submission_id: sub.id)
    assert_equal "suggest_b", suggestion.outcome
    assert_equal "B", suggestion.suggested_grade
    assert_equal "all_required_checks_passed", suggestion.reason_code
  end

  test "event-before-sync recovery with failed required check evaluates review_for_redo without writing Submission.grade" do
    @cohort.update!(settings: {
      "features" => {
        "github_app" => true,
        "github_webhooks" => true,
        "github_reconciliation" => true,
        "github_grade_suggestions" => true
      }
    })
    SchoolSetting.current.update!(features: {
      "github_app" => true,
      "github_webhooks" => true,
      "github_reconciliation" => true,
      "github_grade_suggestions" => true
    })

    ExerciseCheckPolicy.create!(
      content_block: @block,
      version: 1,
      active: true,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main"
    )

    staged = GithubWebhookDelivery.create!(
      delivery_id: "del-before-sync-fail",
      event: "check_run",
      action: "completed",
      installation_id: 123,
      repository_id: 98765,
      head_sha: SHA1,
      payload: {
        "check_run" => {
          "external_id" => 9002,
          "name" => "prework/111.rb",
          "status" => "completed",
          "conclusion" => "failure",
          "head_sha" => SHA1,
          "app_slug" => "github-actions",
          "completed_at" => (@now - 2.minutes).iso8601
        },
        "repository" => { "id" => 98765, "full_name" => "app-learner/prework-exercises" }
      },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 2.minutes
    )

    GithubReconciliationService.new(client: @fake).call(now: @now)

    assert_equal "processed", staged.reload.processing_state
    sub = @enrollment.submissions.sole
    assert_nil sub.grade
    suggestion = SubmissionGradeSuggestion.find_by!(submission_id: sub.id)
    assert_equal "review_for_redo", suggestion.outcome
    assert_nil suggestion.suggested_grade
    assert_equal "required_check_failed", suggestion.reason_code
  end

  test "refreshes paginated pending check runs, deduplicates per commit SHA, and handles incomplete check lists safely" do
    block2 = @lesson.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "112.rb", position: 1)
    @fake.files_by_name = { "111.rb" => "puts 1", "112.rb" => "puts 2" }

    pages_requested = []
    @fake.on_checks = lambda do |sha:, page:, **|
      pages_requested << page
      {
        "total_count" => 2,
        "check_runs" => [ {
          "id" => 8000 + page,
          "name" => page == 1 ? "prework/111.rb" : "prework/112.rb",
          "head_sha" => sha,
          "status" => "completed",
          "conclusion" => "success",
          "app" => { "slug" => "github-actions" }
        } ]
      }
    end

    GithubReconciliationService.new(client: @fake).call(now: @now)

    # Both submissions share SHA1 -> GitHub checks endpoint fetched ONCE (pages 1 & 2), not twice!
    assert_equal [ 1, 2 ], pages_requested
    assert_equal 2, @enrollment.submissions.where(content_block_id: [ @block.id, block2.id ]).count
    @enrollment.submissions.each do |sub|
      assert_equal [ 8001, 8002 ], sub.github_check_runs.order(:external_id).pluck(:external_id)
    end

    # Now simulate an incomplete check list on a pending run -> triggers backoff without losing existing runs.
    @enrollment.submissions.first.github_check_runs.find_by!(external_id: 8001).update!(status: "in_progress", conclusion: nil)
    @fake.on_checks = ->(page:, **) { { "total_count" => 5, "check_runs" => [] } }

    later = @now + 1.hour + 1.minute
    travel_to later
    metrics = {}
    GithubReconciliationService.new(client: @fake).call(now: later, metrics: metrics)

    assert_equal 1, metrics[:failed]
    state = @binding.reload.github_reconciliation_state
    assert_equal "backoff", state.last_status
    assert_equal 1, state.consecutive_failures
    assert_match(/incomplete check list/i, state.last_error)
    assert_equal "verified", @binding.verification_state
    assert @enrollment.submissions.first.github_check_runs.exists?(external_id: 8001)
  end

  test "resolves ambiguous staged installation revocations via live provider verification" do
    staged_suspend = GithubWebhookDelivery.create!(
      delivery_id: "del-ambiguous-suspend",
      event: "installation",
      action: "suspend",
      installation_id: 123,
      payload: { "action" => "suspend", "installation" => { "id" => 123 } },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 5.minutes
    )
    staged_removed = GithubWebhookDelivery.create!(
      delivery_id: "del-ambiguous-removed",
      event: "installation_repositories",
      action: "removed",
      installation_id: 123,
      payload: { "action" => "removed", "repositories_removed_ids" => [ 98765 ] },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 5.minutes
    )

    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }
    GithubReconciliationService.new(client: @fake).call(now: @now)

    assert_equal "ignored", staged_suspend.reload.processing_state
    assert_equal "ignored", staged_removed.reload.processing_state
    assert_equal "verified", @binding.reload.verification_state

    # Now test when live provider check confirms revocation (404/422): staged revocation becomes processed.
    staged_revoked = GithubWebhookDelivery.create!(
      delivery_id: "del-confirmed-removed",
      event: "installation_repositories",
      action: "removed",
      installation_id: 123,
      payload: { "action" => "removed", "repositories_removed_ids" => [ 98765 ] },
      processing_state: "staged",
      attempts: 1,
      received_at: @now + 1.hour
    )
    @fake.failure = GithubAppClient::Error.new("GitHub installation cannot access this repository", status: 404)
    later = @now + 1.hour + 1.minute
    travel_to later
    GithubReconciliationService.new(client: @fake).call(now: later)

    assert_equal "processed", staged_revoked.reload.processing_state
    assert_equal "failed", @binding.reload.verification_state
    assert_equal "failed", @binding.github_reconciliation_state.last_status
  end

  test "transient API errors (403 rate limit with Retry-After, 429, 5xx, timeout) preserve binding verification and schedule backoff" do
    cases = [
      [ GithubAppClient::Error.new("GitHub rate limit reached; try again later", status: 403, retry_after: 180, rate_limited: true), 180.seconds ],
      [ GithubAppClient::Error.new("GitHub rate limit reached; try again later", status: 429, retry_after: 90, rate_limited: true), 90.seconds ],
      [ GithubAppClient::Error.new("GitHub is temporarily unavailable; try again", status: 503), 1.hour ],
      [ GithubAppClient::Error.new(GithubAppClient::PROVIDER_ERROR), 2.hours ]
    ]

    current_time = @now
    cases.each_with_index do |(error, expected_delay), idx|
      @fake.failure = error
      travel_to current_time
      metrics = {}
      GithubReconciliationService.new(client: @fake).call(now: current_time, metrics: metrics)

      assert_equal 1, metrics[:failed]
      assert_equal "verified", @binding.reload.verification_state, "transient error #{error.status} must preserve verified state"
      assert_equal "connected", @installation.reload.connection_state

      state = @binding.github_reconciliation_state.reload
      assert_equal "backoff", state.last_status
      assert_equal idx + 1, state.consecutive_failures
      assert_equal current_time + expected_delay, state.next_reconcile_at
      assert_nil state.claim_token
      assert_nil state.claimed_until

      current_time = state.next_reconcile_at + 1.second
    end

    # 401 non-transient auth failure marks installation/binding failed and sets state to failed.
    @fake.failure = GithubAppClient::Error.new("GitHub authorization expired; reconnect the installation", status: 401)
    travel_to current_time
    GithubReconciliationService.new(client: @fake).call(now: current_time)

    assert_equal "failed", @installation.reload.connection_state
    assert_equal "failed", @binding.reload.verification_state
    state = @binding.github_reconciliation_state.reload
    assert_equal "failed", state.last_status
    assert_equal 5, state.consecutive_failures
    assert_equal current_time + 4.hours, state.next_reconcile_at
  end

  test "bounded backlog rotation prevents one failing repository from starving healthy bindings" do
    # Create 2 additional verified bindings in the same opted-in cohort.
    healthy_bindings = [ 2, 3 ].map do |n|
      student = User.create!(clerk_id: "recon-s#{n}", email: "recon-s#{n}@example.invalid", role: :student, github_username: "learner-#{n}")
      student.record_verified_github_identity!(id: "#{30000 + n}", login: "learner-#{n}")
      enrollment = Enrollment.create!(cohort: @cohort, user: student, status: :active)
      inst = @cohort.github_app_installations.create!(app_id: 12345, installation_id: 200 + n, account_id: 30000 + n, account_login: "learner-#{n}", account_type: "User", repository_selection: "selected", connected_at: @now - 10.minutes, checked_at: @now - 10.minutes)
      binding = enrollment.github_repository_bindings.create!(github_app_installation: inst, full_name: "learner-#{n}/prework-exercises")
      verify_binding!(binding, repo_id: 99000 + n, user_id: "#{30000 + n}", username: "learner-#{n}", verified_at: @now - 10.minutes)
      binding
    end

    # Binding 1 always fails with 503; healthy bindings succeed.
    @fake.on_repository = lambda do |full_name:, repository_id:, **|
      if repository_id == 98765
        raise GithubAppClient::Error.new("GitHub is temporarily unavailable; try again", status: 503)
      end
      owner = full_name.split("/").first
      n = owner.split("-").last.to_i
      @fake.repository_owner = owner
      @fake.repository_owner_id = 30000 + n
    end
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }

    # Cap at 2 bindings per tick: tick 1 processes bad binding (@binding) + healthy[0];
    # bad binding backs off 15 minutes so tick 2 (1 minute later) immediately picks up healthy[1] without starvation!
    m1 = {}
    GithubReconciliationService.new(client: @fake, max_bindings: 2).call(now: @now, metrics: m1)
    assert_equal 2, m1[:claimed]
    assert_equal 1, m1[:failed]
    assert_equal 1, m1[:sent]
    assert_equal "backoff", @binding.reload.github_reconciliation_state.last_status
    assert_equal "ok", healthy_bindings[0].reload.github_reconciliation_state.last_status
    assert_nil healthy_bindings[1].reload.github_reconciliation_state

    t2 = @now + 1.minute
    travel_to t2
    m2 = {}
    GithubReconciliationService.new(client: @fake, max_bindings: 2).call(now: t2, metrics: m2)
    assert_equal 1, m2[:claimed]
    assert_equal 1, m2[:sent]
    assert_equal 0, m2[:failed]
    assert_equal "ok", healthy_bindings[1].reload.github_reconciliation_state.last_status
  end

  test "wall-clock budget exhaustion stops cleanly and releases claim without burning a failure" do
    ticks = [ 100.0, 100.0, 100.0, 125.0 ] # deadline = 120.0; third call exhausts budget
    monotonic = -> { ticks.size > 1 ? ticks.shift : ticks.first }

    metrics = {}
    GithubReconciliationService.new(client: @fake, max_duration: 20.seconds, monotonic: monotonic).call(now: @now, metrics: metrics)

    assert_equal 0, metrics[:claimed]
    assert_equal 0, metrics[:failed]
    state = @binding.reload.github_reconciliation_state
    assert_equal "idle", state.last_status
    assert_equal 0, state.consecutive_failures
    assert_nil state.claim_token
    assert_nil state.claimed_until
    assert_nil state.next_reconcile_at
  end

  test "respects active claim lease, recovers expired lease, and guards finalization by claim_token" do
    state = GithubReconciliationState.create!(
      github_repository_binding: @binding,
      activated_at: @now - 10.minutes,
      claim_token: "active-worker-token",
      claimed_until: @now + 3.minutes,
      last_status: "idle"
    )

    # Active lease prevents overlapping tick from touching binding or calling GitHub.
    metrics = {}
    GithubReconciliationService.new(client: @fake).call(now: @now, metrics: metrics)
    assert_equal 0, metrics[:claimed]
    assert_empty @fake.calls
    assert_equal "active-worker-token", state.reload.claim_token

    # Expired lease (simulating crashed worker) IS recovered.
    state.update!(claimed_until: @now - 1.minute)
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }
    GithubReconciliationService.new(client: @fake).call(now: @now, metrics: metrics)
    assert_equal 1, metrics[:claimed]
    assert_equal 1, metrics[:sent]
    assert_equal "ok", state.reload.last_status
    assert_nil state.claim_token

    # Claim token guard: if another worker takes over mid-flight, stale finalization makes zero state overwrites.
    state.update!(next_reconcile_at: @now - 1.minute, last_head_sha: SHA1)
    @fake.commit_sha = SHA2
    @fake.on_default_branch_head = lambda do |**|
      state.reload.update!(claim_token: "newer-worker-token", claimed_until: @now + 5.minutes, last_status: "backoff", consecutive_failures: 2)
      { commit_hash: SHA2, branch: "main", committed_at: @now }
    end

    outcome = GithubReconciliationService.new(client: @fake).reconcile_binding!(@binding, now: @now)
    assert_equal :stale_claim, outcome
    state.reload
    assert_equal "newer-worker-token", state.claim_token
    assert_equal "backoff", state.last_status
    assert_equal 2, state.consecutive_failures
  end

  test "activation boundary prevents back-crawling historical pre-activation commits, submissions, and webhooks" do
    # Historical binding verified 60 days ago with an old commit from 30 days ago.
    verify_binding!(@binding, repo_id: 98765, verified_at: @now - 60.days)
    @fake.committed_at = @now - 30.days

    old_submission = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "old historical code",
      commit_sha: "9" * 40,
      github_repository_id: 98765,
      github_revision: { "version" => 1, "binding_id" => @binding.id, "repository_id" => 98765, "content_digest" => "abc" },
      created_at: @now - 30.days,
      num_submissions: 1
    )
    old_staged_push = GithubWebhookDelivery.create!(
      delivery_id: "del-historical-push",
      event: "push",
      installation_id: 123,
      repository_id: 98765,
      head_sha: SHA1,
      payload: { "ref" => "refs/heads/main", "after" => SHA1 },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 30.days
    )

    GithubReconciliationService.new(client: @fake).call(now: @now)

    # Zero files fetched, zero check runs crawled for old historical submission, old push ignored, baseline SHA recorded!
    assert_equal [ :repository, :default_branch_head ], @fake.calls.map(&:first)
    assert_equal 1, @enrollment.submissions.count
    assert_equal old_submission.id, @enrollment.submissions.sole.id
    assert_empty old_submission.github_check_runs
    assert_equal "ignored", old_staged_push.reload.processing_state

    state = @binding.reload.github_reconciliation_state
    assert_equal @now, state.activated_at
    assert_equal SHA1, state.last_head_sha
    assert_equal "ok", state.last_status

    # A NEW commit pushed AFTER activation IS imported normally on the next tick.
    @fake.calls.clear
    @fake.commit_sha = SHA2
    @fake.committed_at = @now + 30.minutes
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }
    later = @now + 1.hour + 1.minute
    travel_to later
    GithubReconciliationService.new(client: @fake).call(now: later)

    assert_equal 2, @enrollment.submissions.count
    assert_equal SHA2, @enrollment.submissions.order(:id).last.commit_sha
  end

  test "skips paused enrollment, closed submission window, and off cohorts with zero writes or HTTP calls" do
    # 1. Off cohort (Cohort 3 shape) with school switch On -> zero writes, zero HTTP!
    @cohort.update!(settings: { "features" => { "student_experience_v2" => false, "github_app" => true } })
    assert_no_difference [ "GithubReconciliationState.count", "Submission.count" ] do
      GithubReconciliationService.new(client: @fake).call(now: @now)
    end
    assert_empty @fake.calls

    # 2. Re-enable cohort, pause enrollment -> zero writes, zero HTTP!
    enable_reconciliation!(@cohort)
    @enrollment.update!(status: :paused)
    assert_no_difference [ "GithubReconciliationState.count", "Submission.count" ] do
      GithubReconciliationService.new(client: @fake).call(now: @now)
    end
    assert_empty @fake.calls

    # 3. Reactivate enrollment, close submission window -> reconciles head safely but imports ZERO submissions!
    @enrollment.update!(status: :active)
    @cohort.cohort_module_submission_windows.create!(
      curriculum_module: @mod,
      week_number: 1,
      submissions_close_at: @now - 1.hour
    )
    assert_no_difference "Submission.count" do
      GithubReconciliationService.new(client: @fake).call(now: @now)
    end
    refute_includes @fake.calls.map(&:first), :files_at_commit
    assert_equal "ok", @binding.reload.github_reconciliation_state.last_status
  end

  test "dry run makes zero DB writes and zero external HTTP calls while reporting due bindings and staged webhooks" do
    GithubWebhookDelivery.create!(
      delivery_id: "del-dry-run-staged",
      event: "check_run",
      action: "completed",
      installation_id: 123,
      repository_id: 98765,
      head_sha: SHA1,
      payload: { "check_run" => { "external_id" => 999, "name" => "test", "status" => "completed", "conclusion" => "success" } },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 1.minute
    )

    log = StringIO.new
    logger = ActiveSupport::Logger.new(log)
    task = ScheduledTick::TASKS.find { |t| t.name == "github_reconciliation" }
    assert_equal false, task.hold_lock

    with_app_provider do
      assert_no_difference [ "GithubReconciliationState.count", "ScheduledTaskRun.count", "Submission.count", "GithubCheckRun.count" ] do
        assert ScheduledTick.new(now: @now, dry_run: true, tasks: [ task ], logger: logger).call
      end
    end

    assert_empty @fake.calls
    assert_includes log.string, '"name":"github_reconciliation","status":"would_run"'
    assert_includes log.string, '"would_claim":1'
    assert_includes log.string, '"staged_deliveries":1'
  end

  test "other ScheduledTick tasks continue running cleanly even if github_reconciliation raises" do
    ran_other = false
    other_locked = ScheduledTick::Task.new(name: "other_locked_probe", daily_hour: nil, hold_lock: true, call: ->(*) { ran_other = true })
    ran_unlocked = false
    other_unlocked = ScheduledTick::Task.new(name: "other_unlocked_probe", daily_hour: nil, hold_lock: false, call: ->(*) { ran_unlocked = true })
    recon_task = ScheduledTick::TASKS.find { |t| t.name == "github_reconciliation" }

    failing_service = Object.new
    failing_service.define_singleton_method(:call) { |**| raise RuntimeError, "simulated unexpected crash" }

    original_new = GithubReconciliationService.method(:new)
    GithubReconciliationService.define_singleton_method(:new) { |**| failing_service }

    log = StringIO.new
    result = ScheduledTick.new(now: @now, tasks: [ other_locked, recon_task, other_unlocked ], logger: ActiveSupport::Logger.new(log)).call

    assert_equal false, result
    assert ran_other, "locked task must still run"
    assert ran_unlocked, "subsequent unlocked task must still run even when github_reconciliation errors"
    assert_equal "error", ScheduledTaskRun.find_by!(name: "github_reconciliation").last_result["status"]
    assert_not_nil ScheduledTaskRun.find_by!(name: "other_unlocked_probe").last_succeeded_at
  ensure
    GithubReconciliationService.define_singleton_method(:new, original_new) if original_new
  end

  private

  def enable_reconciliation!(cohort)
    SchoolSetting.current.update!(features: { "github_app" => true, "github_reconciliation" => true })
    cohort.update!(settings: { "features" => { "github_app" => true, "github_reconciliation" => true } })
  end

  def verify_binding!(binding, repo_id:, user_id: "24680", username: "app-learner", verified_at: @now)
    binding.update!(
      repository_id: repo_id,
      github_user_id: user_id,
      github_username: username,
      verification_state: "verified",
      failure_reason: nil,
      verified_at: verified_at,
      checked_at: verified_at
    )
  end
end

# Real committed connections: verifies concurrent tick overlap and zero DB locks held across HTTP.
class GithubReconciliationOverlapTest < ActiveSupport::TestCase
  include NonTransactionalTestCleanup
  self.use_transactional_tests = false

  test "concurrent overlapping ticks honor durable claim lease without holding DB locks across GitHub HTTP" do
    now = Time.utc(2026, 11, 22, 12, 0, 0)
    student = User.create!(clerk_id: "recon-overlap-student", email: "recon-overlap-student@example.invalid", role: :student, github_username: "app-learner")
    student.record_verified_github_identity!(id: "24680", login: "app-learner")
    curriculum = Curriculum.create!(name: "Overlap curriculum")
    mod = curriculum.modules.create!(name: "Overlap module", position: 0)
    lesson = mod.lessons.create!(title: "Overlap lesson", position: 0, release_day: 0)
    lesson.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "111.rb", position: 0)
    cohort = Cohort.create!(
      name: "Overlap cohort",
      curriculum: curriculum,
      start_date: Date.current,
      status: :active,
      settings: { "features" => { "github_app" => true, "github_reconciliation" => true } }
    )
    enrollment = Enrollment.create!(cohort: cohort, user: student, status: :active)
    SchoolSetting.current.update!(features: { "github_app" => true, "github_reconciliation" => true })
    installation = cohort.github_app_installations.create!(
      app_id: 12345, installation_id: 77123, account_id: 24680, account_login: "app-learner",
      account_type: "User", repository_selection: "selected", connected_at: now - 5.minutes, checked_at: now - 5.minutes
    )
    binding = enrollment.github_repository_bindings.create!(
      github_app_installation: installation,
      full_name: "app-learner/prework-exercises",
      repository_id: 98765,
      github_user_id: "24680",
      github_username: "app-learner",
      verification_state: "verified",
      verified_at: now - 5.minutes,
      checked_at: now - 5.minutes
    )

    entered_http = Queue.new
    release_http = Queue.new
    fake1 = FakeGithubAppClient.new
    fake1.commit_sha = "1" * 40
    fake1.on_default_branch_head = lambda do |**|
      entered_http << true
      release_http.pop
      { commit_hash: "1" * 40, branch: "main", committed_at: now - 2.minutes }
    end
    fake1.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }

    fake2 = FakeGithubAppClient.new
    fake2.commit_sha = "1" * 40

    m1 = {}
    worker = Thread.new do
      Rails.application.executor.wrap do
        GithubReconciliationService.new(client: fake1).call(now: now, metrics: m1)
      end
    end

    assert entered_http.pop, "first worker should reach GitHub HTTP after committing its claim lease"

    # While worker 1 is mid-HTTP, worker 2 runs concurrently:
    # - must NOT block waiting for any DB lock
    # - must skip the leased binding and make ZERO GitHub HTTP calls!
    m2 = {}
    GithubReconciliationService.new(client: fake2).call(now: now, metrics: m2)
    assert_equal 0, m2[:claimed]
    assert_empty fake2.calls

    release_http << true
    assert worker.join(10)
    assert_equal 1, m1[:claimed]
    assert_equal 1, m1[:sent]
    assert_equal "ok", binding.reload.github_reconciliation_state.last_status
    assert_nil binding.github_reconciliation_state.claim_token
  ensure
    release_http << true if defined?(release_http) && release_http
    finish_test_threads(worker) if defined?(worker)
    Submission.where(enrollment_id: enrollment&.id).delete_all if defined?(enrollment) && enrollment
    Progress.where(enrollment_id: enrollment&.id).delete_all if defined?(enrollment) && enrollment
    GithubReconciliationState.where(github_repository_binding_id: binding&.id).delete_all if defined?(binding) && binding
    cohort&.destroy if defined?(cohort) && cohort
    curriculum&.destroy if defined?(curriculum) && curriculum
    delete_test_users(student) if defined?(student) && student
    SchoolSetting.delete_all
  end
end
