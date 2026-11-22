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

  # --- Regression tests for adversarial review findings #1–#10 ---

  test "finding 1: evaluates grade suggestions after live webhook check completion, mid-binding abort recovery, and active policy bump" do
    enable_grade_suggestions!(@cohort)

    policy_v1 = ExerciseCheckPolicy.create!(
      content_block: @block,
      version: 1,
      active: true,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main"
    )

    # (a) Tick 1 syncs submission with check still in_progress -> suggestion is no_suggestion (check_pending).
    @fake.on_checks = lambda do |**|
      {
        "total_count" => 1,
        "check_runs" => [
          {
            "id" => 9101,
            "name" => "prework/111.rb",
            "status" => "in_progress",
            "conclusion" => nil,
            "head_sha" => SHA1,
            "app" => { "slug" => "github-actions" },
            "started_at" => (@now - 2.minutes).iso8601
          }
        ]
      }
    end

    GithubReconciliationService.new(client: @fake).call(now: @now)
    sub = @enrollment.submissions.sole
    assert_equal "no_suggestion", sub.submission_grade_suggestion.outcome
    assert_equal "check_pending", sub.submission_grade_suggestion.reason_code
    assert_nil sub.reload.grade

    # Live webhook completes the check run between ticks while head_sha is unchanged!
    between = @now + 20.minutes
    travel_to between
    sub.github_check_runs.sole.update!(
      status: "completed",
      conclusion: "success",
      completed_at: between,
      fetched_at: between
    )

    # Tick 2: head_sha unchanged and check is already completed (so Step 2 and Step 4 do nothing),
    # yet Step 5 catch-up detects check_run.updated_at > suggestion.evaluated_at and evaluates suggest_b!
    tick2 = @now + 1.hour + 1.minute
    travel_to tick2
    @fake.calls.clear
    metrics2 = {}
    GithubReconciliationService.new(client: @fake).call(now: tick2, metrics: metrics2)
    assert_equal [ :repository, :default_branch_head ], @fake.calls.map(&:first)
    assert_equal 1, metrics2[:suggestions_evaluated]
    suggestion = sub.reload.submission_grade_suggestion
    assert_equal "suggest_b", suggestion.outcome
    assert_equal "B", suggestion.suggested_grade
    assert_equal policy_v1.id, suggestion.exercise_check_policy_id
    assert_nil sub.grade

    # (c) Active ExerciseCheckPolicy version bump (v1 -> v2) triggers re-evaluation on Tick 3!
    policy_v1.update!(active: false)
    policy_v2 = ExerciseCheckPolicy.create!(
      content_block: @block,
      version: 2,
      active: true,
      required_checks: [ "prework/111.rb", "prework/extra.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main"
    )
    @fake.on_checks = lambda do |**|
      {
        "total_count" => 1,
        "check_runs" => [
          {
            "id" => 9101,
            "name" => "prework/111.rb",
            "status" => "completed",
            "conclusion" => "success",
            "head_sha" => SHA1,
            "app" => { "slug" => "github-actions" },
            "started_at" => (@now - 2.minutes).iso8601,
            "completed_at" => between.iso8601
          }
        ]
      }
    end
    tick3 = tick2 + 1.hour + 1.minute
    travel_to tick3
    metrics3 = {}
    GithubReconciliationService.new(client: @fake).call(now: tick3, metrics: metrics3)
    assert_equal 1, metrics3[:suggestions_evaluated]
    suggestion = sub.reload.submission_grade_suggestion
    assert_equal policy_v2.id, suggestion.exercise_check_policy_id
    assert_equal "no_suggestion", suggestion.outcome
    assert_equal "missing_required_check", suggestion.reason_code

    # (b) Step 4 raises BudgetExceeded after Step 2 committed a new SHA2 submission ->
    # next tick catches up the missing suggestion on SHA2 even if check was completed out-of-band.
    tick4 = tick3 + 1.hour + 1.minute
    travel_to tick4
    @fake.commit_sha = SHA2
    @fake.committed_at = tick4 - 1.minute
    @fake.source_text = "puts 'exercise 111 solution v2'"
    @fake.on_checks = ->(**) { raise GithubAppClient::BudgetExceeded, "simulated budget exhaustion in step 4" }
    GithubReconciliationService.new(client: @fake).call(now: tick4)

    sub2 = @enrollment.submissions.order(:id).last
    assert_equal SHA2, sub2.commit_sha
    assert_nil sub2.submission_grade_suggestion

    # Complete both required checks out-of-band before next tick.
    sub2.github_check_runs.create!(
      external_id: 9201, name: "prework/111.rb", head_sha: SHA2, status: "completed",
      conclusion: "success", app_slug: "github-actions", fetched_at: tick4 + 1.minute
    )
    sub2.github_check_runs.create!(
      external_id: 9202, name: "prework/extra.rb", head_sha: SHA2, status: "completed",
      conclusion: "success", app_slug: "github-actions", fetched_at: tick4 + 1.minute
    )

    tick5 = tick4 + 5.minutes
    travel_to tick5
    @fake.on_checks = ->(**) { raise "should not need check refresh when all required checks already completed" }
    metrics5 = {}
    GithubReconciliationService.new(client: @fake).call(now: tick5, metrics: metrics5)
    assert_equal 1, metrics5[:suggestions_evaluated]
    assert_equal "suggest_b", sub2.reload.submission_grade_suggestion.outcome
    assert_nil sub2.grade
  end

  test "finding 2: pre_activation_head stays active on Tick 2+ even after ContentBlock edit or historical submission at SHA_OLD" do
    verify_binding!(@binding, repo_id: 98765, verified_at: @now - 60.days)
    @fake.commit_sha = SHA1
    @fake.committed_at = @now - 30.days

    # Historical pre-activation submission at SHA1 (same SHA as branch HEAD)
    old_submission = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "historical code",
      commit_sha: SHA1,
      github_repository_id: 98765,
      github_revision: { "version" => 1, "binding_id" => @binding.id, "repository_id" => 98765, "content_digest" => "hist" },
      created_at: @now - 30.days,
      num_submissions: 1
    )

    # Tick 1 records baseline SHA1 without fetching files or crawling historical checks.
    GithubReconciliationService.new(client: @fake).call(now: @now)
    assert_equal [ :repository, :default_branch_head ], @fake.calls.map(&:first)
    assert_equal SHA1, @binding.reload.github_reconciliation_state.last_head_sha
    assert_empty old_submission.github_check_runs

    # Instructor edits ContentBlock (and adds another exercise) between Tick 1 and Tick 2!
    travel_to(@now + 10.minutes)
    @block.update!(title: "Updated title")
    @lesson.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "112.rb", position: 1)

    # Tick 2: branch is STILL on pre-activation SHA1 -> must STILL skip Step 2 file import and Step 4 historical check crawl!
    @fake.calls.clear
    tick2 = @now + 1.hour + 1.minute
    travel_to tick2
    GithubReconciliationService.new(client: @fake).call(now: tick2)

    assert_equal [ :repository, :default_branch_head ], @fake.calls.map(&:first)
    assert_equal 1, @enrollment.submissions.count
    assert_empty old_submission.reload.github_check_runs
  end

  test "finding 3a: >50 intermediate non-head staged check_run deliveries do not block HEAD delivery and settle as ignored" do
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }

    # 55 older intermediate non-head staged check_run deliveries
    old_deliveries = 55.times.map do |i|
      intermediate_sha = format("%040x", i + 10)
      GithubWebhookDelivery.create!(
        delivery_id: "del-intermediate-#{i}",
        event: "check_run",
        action: "completed",
        installation_id: 123,
        repository_id: 98765,
        head_sha: intermediate_sha,
        payload: {
          "check_run" => {
            "external_id" => 5000 + i,
            "name" => "prework/111.rb",
            "status" => "completed",
            "conclusion" => "failure",
            "head_sha" => intermediate_sha
          },
          "repository" => { "id" => 98765, "full_name" => "app-learner/prework-exercises" }
        },
        processing_state: "staged",
        attempts: 1,
        received_at: @now - 5.minutes + i.seconds
      )
    end

    # Newer HEAD check_run delivery (56th in raw FIFO order)
    head_delivery = GithubWebhookDelivery.create!(
      delivery_id: "del-head-priority",
      event: "check_run",
      action: "completed",
      installation_id: 123,
      repository_id: 98765,
      head_sha: SHA1,
      payload: {
        "check_run" => {
          "external_id" => 9999,
          "name" => "prework/111.rb",
          "status" => "completed",
          "conclusion" => "success",
          "head_sha" => SHA1
        },
        "repository" => { "id" => 98765, "full_name" => "app-learner/prework-exercises" }
      },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 1.minute
    )

    GithubReconciliationService.new(client: @fake).call(now: @now)

    # HEAD delivery was prioritized and attached immediately on Tick 1!
    assert_equal "processed", head_delivery.reload.processing_state
    sub = @enrollment.submissions.sole
    assert_equal 9999, sub.github_check_runs.sole.external_id
    assert_equal "success", sub.github_check_runs.sole.conclusion

    # 49 superseded intermediate deliveries settled to "ignored" in the remaining batch slots
    ignored_count = GithubWebhookDelivery.where(id: old_deliveries.map(&:id), processing_state: "ignored").count
    assert_equal 49, ignored_count
  end

  test "finding 3b: shared staged delivery stays staged for sibling eligible binding and settles once both reconcile" do
    # Second module with an explicit module-scoped binding pointing at the SAME repository
    mod2 = @curriculum.modules.create!(name: "Module 2", position: 1)
    @cohort.update!(content_defaults: (@cohort.content_defaults || {}).merge(mod2.id.to_s => { "assigned" => true }))
    lesson2 = mod2.lessons.create!(title: "Lesson 2", position: 0, release_day: 0)
    block2 = lesson2.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "222.rb", position: 0)
    binding2 = @enrollment.github_repository_bindings.create!(
      github_app_installation: @installation,
      curriculum_module: mod2,
      full_name: "app-learner/prework-exercises",
      repository_id: 98765,
      github_user_id: "24680",
      github_username: "app-learner",
      verification_state: "verified",
      verified_at: @now - 10.minutes,
      checked_at: @now - 10.minutes
    )

    shared_delivery = GithubWebhookDelivery.create!(
      delivery_id: "del-shared-check",
      event: "check_run",
      action: "completed",
      installation_id: 123,
      repository_id: 98765,
      head_sha: SHA1,
      payload: {
        "check_run" => {
          "external_id" => 8801,
          "name" => "prework/all",
          "status" => "completed",
          "conclusion" => "success",
          "head_sha" => SHA1
        },
        "repository" => { "id" => 98765, "full_name" => "app-learner/prework-exercises" }
      },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 2.minutes
    )

    # Reconcile ONLY binding 1 first (max_bindings: 1)
    GithubReconciliationService.new(client: @fake, max_bindings: 1).call(now: @now)

    sub1 = @enrollment.submissions.find_by!(content_block: @block)
    assert_equal 8801, sub1.github_check_runs.sole.external_id
    # Must remain staged because binding2 has not yet reconciled past delivery.received_at!
    assert_equal "staged", shared_delivery.reload.processing_state

    # Now reconcile binding 2
    GithubReconciliationService.new(client: @fake, max_bindings: 1).call(now: @now)

    sub2 = @enrollment.submissions.find_by!(content_block: block2)
    assert_equal 8801, sub2.github_check_runs.sole.external_id
    assert_equal "processed", shared_delivery.reload.processing_state
    assert_equal "ok", binding2.reload.github_reconciliation_state.last_status
  end

  test "finding 3c: multi-repo and multi-binding revocation deliveries do not settle prematurely while other repos remain active" do
    mod2 = @curriculum.modules.create!(name: "Module 2", position: 1)
    @cohort.update!(content_defaults: (@cohort.content_defaults || {}).merge(mod2.id.to_s => { "assigned" => true }))
    lesson2 = mod2.lessons.create!(title: "Lesson 2", position: 0, release_day: 0)
    lesson2.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "222.rb", position: 0)
    binding2 = @enrollment.github_repository_bindings.create!(
      github_app_installation: @installation,
      curriculum_module: mod2,
      full_name: "app-learner/second-repo",
      repository_id: 98766,
      github_user_id: "24680",
      github_username: "app-learner",
      verification_state: "verified",
      verified_at: @now - 10.minutes,
      checked_at: @now - 10.minutes
    )

    inst_delivery = GithubWebhookDelivery.create!(
      delivery_id: "del-multi-inst-revoke",
      event: "installation",
      action: "deleted",
      installation_id: 123,
      payload: { "installation" => { "id" => 123 } },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 1.minute
    )
    repos_delivery = GithubWebhookDelivery.create!(
      delivery_id: "del-multi-repos-remove",
      event: "installation_repositories",
      action: "removed",
      installation_id: 123,
      payload: { "installation" => { "id" => 123 }, "repositories_removed_ids" => [ 98765, 98766 ] },
      processing_state: "staged",
      attempts: 1,
      received_at: @now - 1.minute
    )

    # Case 1 (live verification succeeds on binding1 only): binding2 still has checked_at < received_at -> both stay staged!
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }
    GithubReconciliationService.new(client: @fake, max_bindings: 1).call(now: @now)
    assert_equal "staged", inst_delivery.reload.processing_state
    assert_equal "staged", repos_delivery.reload.processing_state

    # Case 2 (binding1 fails 403 revoked while binding2 is still verified and installation is still connected):
    # settle_revoked_staged_webhooks! must NOT prematurely mark either delivery processed!
    @binding.github_reconciliation_state.update!(next_reconcile_at: @now)
    @fake.on_repository = ->(full_name:, **) do
      if full_name == "app-learner/prework-exercises"
        raise GithubAppClient::Error.new("revoked", status: 403)
      else
        { "id" => 98766, "full_name" => "app-learner/second-repo", "fork" => false, "owner" => { "id" => 24680, "login" => "app-learner", "type" => "User" } }
      end
    end
    GithubReconciliationService.new(client: @fake).reconcile_binding!(@binding.id, now: @now)
    assert_equal "failed", @binding.reload.verification_state
    assert_equal "staged", inst_delivery.reload.processing_state
    assert_equal "staged", repos_delivery.reload.processing_state

    # Once binding2 also fails 403, no verified binding in removed_ids remains -> repos_delivery settles to processed!
    @fake.on_repository = ->(**) { raise GithubAppClient::Error.new("revoked", status: 403) }
    GithubReconciliationService.new(client: @fake).reconcile_binding!(binding2.id, now: @now)
    assert_equal "failed", binding2.reload.verification_state
    assert_equal "processed", repos_delivery.reload.processing_state
    # inst_delivery still stays staged while installation itself remains connected
    assert_equal "staged", inst_delivery.reload.processing_state
  end

  test "finding 4: binary/truncated Step 2 error uses backoff without failing binding, while statusless Step 1 verification failure records failed" do
    # (a) Step 2 raises statusless non-transient GithubAppClient::Error (e.g. truncated/binary file)
    @fake.on_files_at_commit = ->(**) { raise GithubAppClient::Error.new("GitHub returned truncated source for 111.rb") }

    metrics = {}
    GithubReconciliationService.new(client: @fake).call(now: @now, metrics: metrics)

    assert_equal "verified", @binding.reload.verification_state, "Step 2 file error must NEVER mark binding failed"
    state = @binding.github_reconciliation_state
    assert_equal "backoff", state.last_status
    assert_equal 1, state.consecutive_failures
    assert_includes state.last_error, "truncated source"

    # (b) Step 1 fails verification with a statusless error (forked repository) -> binding fails & state records permanent failed
    @fake.on_files_at_commit = nil
    @fake.on_repository = lambda do |**|
      {
        "id" => 98765,
        "full_name" => "app-learner/prework-exercises",
        "fork" => true,
        "owner" => { "id" => 24680, "login" => "app-learner", "type" => "User" }
      }
    end
    state.update!(next_reconcile_at: @now)

    GithubReconciliationService.new(client: @fake).call(now: @now)
    assert_equal "failed", @binding.reload.verification_state
    assert_equal "failed", state.reload.last_status
  end

  test "finding 5: skips non-github submission_type exercises and unassigned modules disabled in cohort content_defaults" do
    # Exercise with text_submission (even though it has a filename) must NOT be imported via GitHub sync!
    text_block = @lesson.content_blocks.create!(
      block_type: :exercise,
      submission_type: :text_submission,
      filename: "notes.md",
      position: 1
    )

    # Module disabled by default in cohort.content_defaults with NO enrollment assignment -> must NOT be imported!
    hidden_mod = @curriculum.modules.create!(name: "Optional Bonus Module", position: 1)
    hidden_lesson = hidden_mod.lessons.create!(title: "Bonus Lesson", position: 0, release_day: 0)
    hidden_block = hidden_lesson.content_blocks.create!(
      block_type: :exercise,
      submission_type: :prework_github_sync,
      filename: "bonus.rb",
      position: 0
    )

    # Module disabled in content_defaults, with ONLY lesson_a assigned (lesson_b unassigned)
    partial_mod = @curriculum.modules.create!(name: "Partial Module", position: 2)
    lesson_a = partial_mod.lessons.create!(title: "Assigned Lesson", position: 0, release_day: 0)
    block_a = lesson_a.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "partial_a.rb", position: 0)
    lesson_b = partial_mod.lessons.create!(title: "Unassigned Lesson", position: 1, release_day: 0)
    block_b = lesson_b.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "partial_b.rb", position: 0)

    # Module absent from non-nil content_defaults snapshot with NO enrollment assignment -> must NOT be imported!
    absent_mod = @curriculum.modules.create!(name: "Newly Added Unassigned Module", position: 3)
    absent_lesson = absent_mod.lessons.create!(title: "Absent Lesson", position: 0, release_day: 0)
    absent_block = absent_lesson.content_blocks.create!(
      block_type: :exercise,
      submission_type: :prework_github_sync,
      filename: "absent.rb",
      position: 0
    )

    @cohort.update!(
      content_defaults: {
        @mod.id.to_s => { "assigned" => true },
        hidden_mod.id.to_s => { "assigned" => false },
        partial_mod.id.to_s => { "assigned" => false }
      }
    )
    LessonAssignment.create!(enrollment: @enrollment, lesson: lesson_a, unlocked: true)

    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }
    GithubReconciliationService.new(client: @fake).call(now: @now)

    synced_block_ids = @enrollment.submissions.pluck(:content_block_id)
    assert_includes synced_block_ids, @block.id
    assert_includes synced_block_ids, block_a.id
    refute_includes synced_block_ids, text_block.id
    refute_includes synced_block_ids, hidden_block.id
    refute_includes synced_block_ids, block_b.id
    refute_includes synced_block_ids, absent_block.id
  end

  test "revocation delivery arriving mid-Step-2 (after Step-1 checked_at) stays staged instead of being ignored" do
    current_clock = @now
    mid_step2_revocation = nil
    @fake.on_files_at_commit = lambda do |**|
      # Advance wall clock 30 seconds after Step-1 verification and insert revocation webhook mid-Step-2!
      current_clock = @now + 30.seconds
      travel_to current_clock
      mid_step2_revocation = GithubWebhookDelivery.create!(
        delivery_id: "del-mid-step2-revoke",
        event: "installation",
        action: "deleted",
        installation_id: 123,
        payload: { "installation" => { "id" => 123 } },
        processing_state: "staged",
        attempts: 1,
        received_at: @now + 15.seconds
      )
      { commit_hash: SHA1, branch: "main", files: [ { "name" => "111.rb", "text" => "puts 'ok'" } ], workflow_files: {} }
    end
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }

    GithubReconciliationService.new(client: @fake, clock: -> { current_clock }).call(now: @now)

    assert_equal @now, @binding.reload.checked_at
    assert_equal "staged", mid_step2_revocation.reload.processing_state
  end

  test "finding 6: deleting reconciliation state mid-run returns stale_claim cleanly without aborting remaining bindings" do
    student2 = User.create!(clerk_id: "recon-s2", email: "recon-s2@example.invalid", role: :student, github_username: "learner-two")
    student2.record_verified_github_identity!(id: "24681", login: "learner-two")
    enrollment2 = Enrollment.create!(cohort: @cohort, user: student2, status: :active)
    inst2 = @cohort.github_app_installations.create!(
      app_id: 12345, installation_id: 456, account_id: 24681, account_login: "learner-two",
      account_type: "User", repository_selection: "selected", connected_at: @now - 10.minutes, checked_at: @now - 10.minutes
    )
    binding2 = enrollment2.github_repository_bindings.create!(
      github_app_installation: inst2,
      full_name: "learner-two/prework-exercises",
      repository_id: 98769,
      github_user_id: "24681",
      github_username: "learner-two",
      verification_state: "verified",
      verified_at: @now - 10.minutes,
      checked_at: @now - 10.minutes
    )

    @fake.on_repository = lambda do |full_name:, **|
      if full_name == "app-learner/prework-exercises"
        # Simulate concurrent binding cascade-delete / state removal mid-HTTP
        GithubReconciliationState.where(github_repository_binding_id: @binding.id).delete_all
        { "id" => 98765, "full_name" => full_name, "fork" => false, "owner" => { "id" => 24680, "login" => "app-learner", "type" => "User" } }
      else
        { "id" => 98769, "full_name" => full_name, "fork" => false, "owner" => { "id" => 24681, "login" => "learner-two", "type" => "User" } }
      end
    end
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }

    metrics = {}
    assert_nothing_raised do
      GithubReconciliationService.new(client: @fake).call(now: @now, metrics: metrics)
    end

    # Binding 1 returned :stale_claim cleanly; Binding 2 still completed normally!
    assert_equal 1, metrics[:claimed]
    assert_equal 1, metrics[:sent]
    assert_equal "ok", binding2.reload.github_reconciliation_state.last_status
  end

  test "finding 7: mid-loop deadline exhaustion aborts cleanly and releases claim without incrementing failures" do
    # Create 3 staged deliveries; expire monotonic clock on the 2nd iteration of Step 3
    3.times do |i|
      GithubWebhookDelivery.create!(
        delivery_id: "del-budget-loop-#{i}",
        event: "push",
        installation_id: 123,
        repository_id: 98765,
        head_sha: SHA1,
        payload: { "ref" => "refs/heads/main", "after" => SHA1 },
        processing_state: "staged",
        attempts: 1,
        received_at: @now - 2.minutes + i.seconds
      )
    end

    clock = 0.0
    monotonic = lambda do
      clock += 2.0
      clock
    end

    # max_duration = 15.0: enough for Step 1 + Step 2, then expires mid-loop in Step 3
    metrics = {}
    service = GithubReconciliationService.new(client: @fake, max_duration: 15.0, monotonic: monotonic)
    service.call(now: @now, metrics: metrics)

    state = @binding.reload.github_reconciliation_state
    assert_nil state.claim_token, "claim must be released on mid-loop BudgetExceeded"
    assert_nil state.claimed_until
    assert_equal 0, state.consecutive_failures, "budget exhaustion must not increment consecutive_failures"
    assert_equal "idle", state.last_status
  end

  test "finding 8: config-changed sync retries without advancing last_head_sha, 256 KiB warning surfaces in last_error, and last_reconciled_at stamps request_started_at" do
    # (a) Oversized >256 KiB file surfaces curated warning in state.last_error
    @fake.source_text = "x" * (GithubSubmittedRevisionSync::MAX_SOURCE_BYTES + 10)
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }

    GithubReconciliationService.new(client: @fake).call(now: @now)
    state = @binding.reload.github_reconciliation_state
    assert_equal "ok", state.last_status
    assert_equal GithubReconciliationService::SIZE_LIMIT_WARNING, state.last_error
    assert_equal 0, @enrollment.submissions.count

    # (b) Exercise config changed during sync -> raises RetryableSyncError, sets backoff, does NOT advance last_head_sha!
    @fake.source_text = "puts 'normal size'"
    @fake.commit_sha = SHA2
    @fake.committed_at = @now + 30.minutes
    tick2 = @now + 1.hour + 1.minute
    travel_to tick2
    @fake.on_files_at_commit = lambda do |**|
      # Mutate exercise block filename mid-HTTP so GithubSubmittedRevisionSync detects config change
      @block.update!(filename: "renamed_mid_sync.rb")
      { commit_hash: SHA2, branch: "main", files: [ { "name" => "111.rb", "text" => "puts 'normal size'" } ], workflow_files: {} }
    end

    GithubReconciliationService.new(client: @fake).call(now: tick2)
    state.reload
    assert_equal "backoff", state.last_status
    assert_equal SHA1, state.last_head_sha, "last_head_sha must NOT advance when exercise config changed mid-sync"
    assert_equal 1, state.consecutive_failures

    # (c) last_reconciled_at is stamped to request_started_at (before HTTP), so an exercise edited mid-flight is detected next tick!
    @fake.on_files_at_commit = nil
    @block.update!(filename: "111.rb")
    tick3 = tick2 + 20.minutes
    current_clock = tick3
    @fake.on_files_at_commit = lambda do |**|
      # Advance wall clock by 30 seconds while HTTP is in-flight and edit block during HTTP!
      current_clock = tick3 + 30.seconds
      travel_to current_clock
      @block.update!(title: "Edited mid-HTTP")
      { commit_hash: SHA2, branch: "main", files: [ { "name" => "111.rb", "text" => "puts 'after'" } ], workflow_files: {} }
    end

    travel_to tick3
    GithubReconciliationService.new(client: @fake, clock: -> { current_clock }).call(now: tick3)
    state.reload
    assert_equal "ok", state.last_status
    assert_equal tick3, state.last_reconciled_at, "last_reconciled_at must record request_started_at"
    assert_operator @block.reload.updated_at, :>, state.last_reconciled_at
  end

  test "finding 9: ineligible bindings do not crowd out eligible ones and >50 completed exercises do not hide an older pending exercise" do
    # (a) Create 5 archived/pending/mismatched bindings ahead of @binding with max_bindings: 1 (SQL limit = 3)
    5.times do |i|
      bad_user = User.create!(
        clerk_id: i.even? ? "pending_crowd_#{i}" : "crowd_#{i}",
        email: "crowd_#{i}@example.invalid",
        role: :student,
        github_username: "crowd-#{i}",
        archived_at: i.odd? ? @now - 1.day : nil
      )
      bad_user.record_verified_github_identity!(id: (30000 + i).to_s, login: "crowd-#{i}")
      bad_enrollment = Enrollment.create!(cohort: @cohort, user: bad_user, status: :active)
      bad_inst = @cohort.github_app_installations.create!(
        app_id: 12345, installation_id: 8000 + i, account_id: 30000 + i, account_login: "crowd-#{i}",
        account_type: "User", repository_selection: "selected", connected_at: @now - 10.minutes, checked_at: @now - 10.minutes
      )
      bad_enrollment.github_repository_bindings.create!(
        github_app_installation: bad_inst,
        full_name: "crowd-#{i}/prework",
        repository_id: 88000 + i,
        github_user_id: (30000 + i).to_s,
        github_username: "crowd-#{i}",
        verification_state: "verified",
        verified_at: @now - 10.minutes,
        checked_at: @now - 10.minutes
      )
    end

    # Verify due_bindings_relation excludes all 5 ineligible rows in SQL!
    due_ids = GithubReconciliationService.due_bindings_relation(cohort_ids: [ @cohort.id ], now: @now).pluck(:id)
    assert_equal [ @binding.id ], due_ids

    # (b) Create 55 already-completed post-activation exercises + 1 older pending exercise (at position 0)
    older_pending_sub = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "pending exercise",
      commit_sha: SHA2,
      github_repository_id: 98765,
      github_revision: { "version" => 1, "binding_id" => @binding.id, "repository_id" => 98765, "content_digest" => "p0" },
      created_at: @now - 2.minutes,
      num_submissions: 1
    )
    older_pending_sub.github_check_runs.create!(
      external_id: 60001, name: "prework/111.rb", head_sha: SHA2, status: "in_progress",
      app_slug: "github-actions", fetched_at: @now - 2.minutes
    )

    55.times do |i|
      blk = @lesson.content_blocks.create!(
        block_type: :exercise,
        submission_type: :prework_github_sync,
        filename: "done_#{i}.rb",
        position: i + 10
      )
      sub = Submission.create!(
        user: @student,
        enrollment: @enrollment,
        content_block: blk,
        submission_type: :prework_github_sync,
        text: "done #{i}",
        commit_sha: SHA1,
        github_repository_id: 98765,
        github_revision: { "version" => 1, "binding_id" => @binding.id, "repository_id" => 98765, "content_digest" => "d#{i}" },
        created_at: @now - 1.minute,
        num_submissions: 1
      )
      sub.github_check_runs.create!(
        external_id: 70000 + i, name: "prework/done_#{i}.rb", head_sha: SHA1, status: "completed",
        conclusion: "success", app_slug: "github-actions", fetched_at: @now - 1.minute
      )
    end

    # Set last_head_sha = SHA1 and last_reconciled_at = @now so Step 2 skips file sync and we test Step 4 directly.
    GithubReconciliationState.create!(
      github_repository_binding: @binding,
      activated_at: @now - 5.minutes,
      last_head_sha: SHA1,
      last_reconciled_at: @now,
      next_reconcile_at: @now,
      last_status: "ok"
    )

    checked_shas = []
    @fake.on_checks = lambda do |sha:, **|
      checked_shas << sha
      {
        "total_count" => 1,
        "check_runs" => [
          {
            "id" => 60001,
            "name" => "prework/111.rb",
            "status" => "completed",
            "conclusion" => "success",
            "head_sha" => sha,
            "app" => { "slug" => "github-actions" },
            "completed_at" => @now.iso8601
          }
        ]
      }
    end

    GithubReconciliationService.new(client: @fake, max_bindings: 1).call(now: @now)

    assert_equal [ SHA2 ], checked_shas, "older pending submission must be refreshed despite 55 newer completed submissions"
    assert_equal "completed", older_pending_sub.github_check_runs.sole.reload.status
  end

  test "finding 10: binding_eligible? evaluates upcoming cohort start_date against the passed now timestamp" do
    school_today = @now.in_time_zone(Rails.application.config.x.school.time_zone).to_date
    @cohort.update!(status: :upcoming, start_date: school_today + 2.days)
    school = FeatureSwitches.school(read_only: true)

    refute GithubReconciliationService.binding_eligible?(@binding, school: school, now: @now)
    assert GithubReconciliationService.binding_eligible?(@binding, school: school, now: @now + 2.days)
  end

  private

  def enable_grade_suggestions!(cohort)
    SchoolSetting.current.update!(features: {
      "github_app" => true,
      "github_webhooks" => true,
      "github_reconciliation" => true,
      "github_grade_suggestions" => true
    })
    cohort.update!(settings: {
      "features" => {
        "github_app" => true,
        "github_webhooks" => true,
        "github_reconciliation" => true,
        "github_grade_suggestions" => true
      }
    })
  end

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
