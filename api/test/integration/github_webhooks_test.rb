require "test_helper"
require "openssl"
require "stringio"
require_relative "../support/github_app_fixtures"

class GithubWebhooksTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures

  WEBHOOK_PATH = "/api/v1/webhooks/github".freeze
  SECRET = "synthetic-github-webhook-secret-value".freeze
  SHA = "1111111111111111111111111111111111111111".freeze

  setup do
    @previous_webhook_secret = ENV["GITHUB_WEBHOOK_SECRET"]
    @previous_app_webhook_secret = ENV["GITHUB_APP_WEBHOOK_SECRET"]
    ENV["GITHUB_WEBHOOK_SECRET"] = SECRET
    ENV.delete("GITHUB_APP_WEBHOOK_SECRET")
    ApiRateLimits::STORE.clear

    build_github_app_fixture
    SchoolSetting.current.update!(features: { "github_app" => true, "github_webhooks" => true })
    @cohort.update!(settings: { "features" => { "github_app" => true, "github_webhooks" => true } })
    @binding.update!(
      repository_id: 98765,
      github_user_id: "24680",
      github_username: "app-learner",
      verification_state: "verified",
      verified_at: Time.current,
      checked_at: Time.current
    )
    @submission = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "puts 'hello'",
      commit_sha: SHA,
      repo_url: "https://github.com/app-learner/prework-exercises",
      github_repository_id: 98765,
      num_submissions: 1
    )
  end

  teardown do
    ENV["GITHUB_WEBHOOK_SECRET"] = @previous_webhook_secret
    ENV["GITHUB_APP_WEBHOOK_SECRET"] = @previous_app_webhook_secret
    ApiRateLimits::STORE.clear
  end

  test "rejects requests when webhook secret is unconfigured" do
    ENV.delete("GITHUB_WEBHOOK_SECRET")
    ENV.delete("GITHUB_APP_WEBHOOK_SECRET")
    body = check_run_payload.to_json

    assert_no_difference [ "GithubWebhookDelivery.count", "GithubCheckRun.count" ] do
      post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "check_run", delivery_id: "del-unconfigured")
    end

    assert_response :service_unavailable
    assert_equal({ "error" => "GitHub webhooks are not configured" }, response.parsed_body)
  end

  test "supports GITHUB_APP_WEBHOOK_SECRET fallback when GITHUB_WEBHOOK_SECRET is unset" do
    ENV.delete("GITHUB_WEBHOOK_SECRET")
    ENV["GITHUB_APP_WEBHOOK_SECRET"] = "fallback-app-secret"
    body = check_run_payload.to_json

    post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "check_run", delivery_id: "del-fallback", secret: "fallback-app-secret")
    assert_response :ok
    assert_equal "processed", response.parsed_body.fetch("status")
  end

  test "rejects missing signature, invalid signature, and modified raw body with 401" do
    body = check_run_payload.to_json

    assert_no_difference [ "GithubWebhookDelivery.count", "GithubCheckRun.count" ] do
      post WEBHOOK_PATH, params: body, headers: {
        "CONTENT_TYPE" => "application/json",
        "X-GitHub-Event" => "check_run",
        "X-GitHub-Delivery" => "del-missing-sig"
      }
      assert_response :unauthorized

      post WEBHOOK_PATH, params: body, headers: {
        "CONTENT_TYPE" => "application/json",
        "X-GitHub-Event" => "check_run",
        "X-GitHub-Delivery" => "del-bad-sig",
        "X-Hub-Signature-256" => "sha256=#{'0' * 64}"
      }
      assert_response :unauthorized

      tampered = body.sub("prework/111.rb", "prework/222.rb")
      post WEBHOOK_PATH, params: tampered, headers: signed_headers(body, event: "check_run", delivery_id: "del-tampered")
      assert_response :unauthorized
    end
  end

  test "rejects oversized payload with 413 and missing headers or malformed JSON with 400" do
    oversized = "{" + ("a" * (GithubWebhookReceiver::MAX_PAYLOAD_BYTES + 10)) + "}"
    post WEBHOOK_PATH, params: oversized, headers: signed_headers(oversized, event: "check_run", delivery_id: "del-huge")
    assert_response :content_too_large

    body = check_run_payload.to_json
    post WEBHOOK_PATH, params: body, headers: {
      "CONTENT_TYPE" => "application/json",
      "X-Hub-Signature-256" => signature_for(body)
    }
    assert_response :bad_request

    invalid_json = "{not valid json"
    post WEBHOOK_PATH, params: invalid_json, headers: signed_headers(invalid_json, event: "check_run", delivery_id: "del-bad-json")
    assert_response :bad_request
    assert_equal 0, GithubWebhookDelivery.count
  end

  test "verifies valid UTF-8 Unicode raw body bytes without Clerk auth and makes zero external HTTP calls" do
    forbid_external_http do
      payload = check_run_payload(name: "prework/111.rb — café 日本語 ✓")
      raw_body = JSON.generate(payload).encode(Encoding::UTF_8)

      post WEBHOOK_PATH, params: raw_body, headers: signed_headers(raw_body, event: "check_run", delivery_id: "del-unicode-1")
      assert_response :ok
      assert_equal(
        { "status" => "processed", "delivery_id" => "del-unicode-1", "event" => "check_run", "duplicate" => false },
        response.parsed_body
      )

      run = @submission.github_check_runs.find_by!(external_id: 5001)
      assert_equal "prework/111.rb — café 日本語 ✓", run.name
      assert_equal "completed", run.status
      assert_equal "success", run.conclusion
      assert_nil @submission.reload.grade

      delivery = GithubWebhookDelivery.find_by!(delivery_id: "del-unicode-1")
      assert_equal "processed", delivery.processing_state
      assert_equal 1, delivery.attempts
      assert_not_nil delivery.processed_at
      refute_includes delivery.payload.to_json, "private log blob"
    end
  end

  test "ignores unsupported events without cluttering delivery table" do
    body = { zen: "Keep it logically awesome.", hook_id: 42 }.to_json
    assert_no_difference "GithubWebhookDelivery.count" do
      post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "ping", delivery_id: "del-ping-1")
    end
    assert_response :ok
    assert_equal(
      { "status" => "ignored", "delivery_id" => "del-ping-1", "event" => "ping", "duplicate" => false },
      response.parsed_body
    )
  end

  test "handles duplicate X-GitHub-Delivery idempotently and resumes pending or failed deliveries" do
    body = check_run_payload(external_id: 5010).to_json
    headers = signed_headers(body, event: "check_run", delivery_id: "del-dup-1")

    post WEBHOOK_PATH, params: body, headers: headers
    assert_response :ok
    assert_equal false, response.parsed_body.fetch("duplicate")
    assert_equal 1, GithubWebhookDelivery.count
    assert_equal 1, @submission.github_check_runs.count

    # Second identical delivery is an idempotent no-op.
    post WEBHOOK_PATH, params: body, headers: headers
    assert_response :ok
    assert_equal true, response.parsed_body.fetch("duplicate")
    assert_equal "processed", response.parsed_body.fetch("status")
    assert_equal 1, GithubWebhookDelivery.count
    assert_equal 1, GithubWebhookDelivery.find_by!(delivery_id: "del-dup-1").attempts

    # Simulate a pre-existing unfinished pending delivery; duplicate resumes it safely.
    pending_body = check_run_payload(external_id: 5011).to_json
    GithubWebhookDelivery.create!(
      delivery_id: "del-resume-1",
      event: "check_run",
      action: "completed",
      installation_id: 123,
      repository_id: 98765,
      head_sha: SHA,
      payload: {
        "check_run" => {
          "external_id" => 5011,
          "name" => "prework/111.rb",
          "status" => "completed",
          "conclusion" => "success",
          "head_sha" => SHA,
          "completed_at" => "2026-11-22T02:05:00Z"
        }
      },
      processing_state: "pending",
      attempts: 0,
      received_at: 2.minutes.ago
    )

    post WEBHOOK_PATH, params: pending_body, headers: signed_headers(pending_body, event: "check_run", delivery_id: "del-resume-1")
    assert_response :ok
    assert_equal true, response.parsed_body.fetch("duplicate")
    assert_equal "processed", response.parsed_body.fetch("status")
    assert @submission.github_check_runs.exists?(external_id: 5011)
    assert_equal "processed", GithubWebhookDelivery.find_by!(delivery_id: "del-resume-1").processing_state

    # Simulate concurrent RecordNotUnique race on delivery_id unique index.
    race_body = check_run_payload(external_id: 5012).to_json
    existing_race = GithubWebhookDelivery.create!(
      delivery_id: "del-race-1",
      event: "check_run",
      action: "completed",
      installation_id: 123,
      repository_id: 98765,
      head_sha: SHA,
      payload: { "check_run" => { "external_id" => 5012, "name" => "prework/111.rb", "status" => "completed", "conclusion" => "success", "head_sha" => SHA } },
      processing_state: "pending",
      attempts: 0,
      received_at: Time.current
    )
    original_find_by = GithubWebhookDelivery.method(:find_by)
    original_create = GithubWebhookDelivery.method(:create!)
    skipped_first_lookup = false
    GithubWebhookDelivery.define_singleton_method(:find_by) do |*args, **kwargs|
      if !skipped_first_lookup && kwargs[:delivery_id] == "del-race-1"
        skipped_first_lookup = true
        nil
      else
        original_find_by.call(*args, **kwargs)
      end
    end
    GithubWebhookDelivery.define_singleton_method(:create!) do |*_args, **_kwargs|
      raise ActiveRecord::RecordNotUnique, "duplicate key value violates unique constraint"
    end
    begin
      post WEBHOOK_PATH, params: race_body, headers: signed_headers(race_body, event: "check_run", delivery_id: "del-race-1")
    ensure
      GithubWebhookDelivery.define_singleton_method(:find_by, original_find_by)
      GithubWebhookDelivery.define_singleton_method(:create!, original_create)
    end
    assert_response :ok
    assert_equal true, response.parsed_body.fetch("duplicate")
    assert_equal "processed", response.parsed_body.fetch("status")
    assert_equal "processed", existing_race.reload.processing_state
  end

  test "out-of-order check_run events never regress newer evidence" do
    # Newer completed event arrives first.
    newer_body = check_run_payload(
      external_id: 6001,
      status: "completed",
      conclusion: "success",
      started_at: "2026-11-22T02:00:00Z",
      completed_at: "2026-11-22T02:05:00Z"
    ).to_json
    post WEBHOOK_PATH, params: newer_body, headers: signed_headers(newer_body, event: "check_run", delivery_id: "del-order-1")
    assert_response :ok

    # Late in_progress event for same external_id must not regress completed -> in_progress.
    late_in_progress = check_run_payload(
      external_id: 6001,
      status: "in_progress",
      conclusion: nil,
      started_at: "2026-11-22T02:00:00Z",
      completed_at: nil
    ).to_json
    post WEBHOOK_PATH, params: late_in_progress, headers: signed_headers(late_in_progress, event: "check_run", delivery_id: "del-order-2")
    assert_response :ok

    # Older completed_at for same external_id must not overwrite newer completion.
    older_completed = check_run_payload(
      external_id: 6001,
      status: "completed",
      conclusion: "failure",
      started_at: "2026-11-22T01:50:00Z",
      completed_at: "2026-11-22T01:55:00Z"
    ).to_json
    post WEBHOOK_PATH, params: older_completed, headers: signed_headers(older_completed, event: "check_run", delivery_id: "del-order-3")
    assert_response :ok

    run = @submission.github_check_runs.find_by!(external_id: 6001)
    assert_equal "completed", run.status
    assert_equal "success", run.conclusion
    assert_equal Time.iso8601("2026-11-22T02:05:00Z"), run.completed_at

    # Older superseded external_id for the same name/app/sha must not be inserted.
    older_external = check_run_payload(
      external_id: 5999,
      status: "completed",
      conclusion: "failure",
      started_at: "2026-11-22T01:40:00Z",
      completed_at: "2026-11-22T01:45:00Z"
    ).to_json
    post WEBHOOK_PATH, params: older_external, headers: signed_headers(older_external, event: "check_run", delivery_id: "del-order-4")
    assert_response :ok
    assert_not @submission.github_check_runs.exists?(external_id: 5999)

    # Normal forward progression queued -> in_progress -> completed DOES update.
    queued_body = check_run_payload(external_id: 6002, name: "prework/lint", status: "queued", conclusion: nil, started_at: nil, completed_at: nil).to_json
    post WEBHOOK_PATH, params: queued_body, headers: signed_headers(queued_body, event: "check_run", delivery_id: "del-order-5")
    assert_equal "queued", @submission.github_check_runs.find_by!(external_id: 6002).status

    completed_body = check_run_payload(external_id: 6002, name: "prework/lint", status: "completed", conclusion: "success").to_json
    post WEBHOOK_PATH, params: completed_body, headers: signed_headers(completed_body, event: "check_run", delivery_id: "del-order-6")
    progressed = @submission.github_check_runs.find_by!(external_id: 6002)
    assert_equal "completed", progressed.status
    assert_equal "success", progressed.conclusion
  end

  test "stages check_run and push events that arrive before sync for opted-in bindings" do
    future_sha = "2222222222222222222222222222222222222222"
    check_body = check_run_payload(external_id: 7001, head_sha: future_sha).to_json

    assert_no_difference "GithubCheckRun.count" do
      post WEBHOOK_PATH, params: check_body, headers: signed_headers(check_body, event: "check_run", delivery_id: "del-staged-check")
    end
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    staged_check = GithubWebhookDelivery.find_by!(delivery_id: "del-staged-check")
    assert_equal "staged", staged_check.processing_state
    assert_nil staged_check.processed_at
    assert_equal future_sha, staged_check.head_sha

    push_body = {
      ref: "refs/heads/main",
      before: SHA,
      after: future_sha,
      deleted: false,
      repository: { id: 98765, full_name: "app-learner/prework-exercises", default_branch: "main" },
      installation: { id: 123 }
    }.to_json
    post WEBHOOK_PATH, params: push_body, headers: signed_headers(push_body, event: "push", delivery_id: "del-staged-push")
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    staged_push = GithubWebhookDelivery.find_by!(delivery_id: "del-staged-push")
    assert_equal "staged", staged_push.processing_state
    assert_equal future_sha, staged_push.head_sha

    # Branch deletion push is ignored.
    delete_push = {
      ref: "refs/heads/old-branch",
      before: SHA,
      after: "0" * 40,
      deleted: true,
      repository: { id: 98765, full_name: "app-learner/prework-exercises" },
      installation: { id: 123 }
    }.to_json
    post WEBHOOK_PATH, params: delete_push, headers: signed_headers(delete_push, event: "push", delivery_id: "del-delete-push")
    assert_response :ok
    assert_equal "ignored", response.parsed_body.fetch("status")
  end

  test "installation deleted and suspend revoke opted-in installation and bindings locally" do
    before_generation = @installation.connection_generation
    body = {
      action: "deleted",
      installation: { id: 123, app_id: 12345, account: { id: 24680, login: "app-learner", type: "User" }, repository_selection: "selected" }
    }.to_json

    forbid_external_http do
      post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "installation", delivery_id: "del-inst-deleted")
    end
    assert_response :ok
    assert_equal "processed", response.parsed_body.fetch("status")

    @installation.reload
    @binding.reload
    assert_equal "failed", @installation.connection_state
    assert_not_equal before_generation, @installation.connection_generation
    assert_match(/removed/i, @installation.failure_reason)
    assert_equal "failed", @binding.verification_state
    assert_nil @binding.verified_at

    # Reconnect and verify suspend with fresh provider timestamp also revokes.
    @installation.update!(connection_state: "connected", failure_reason: nil, connected_at: Time.current, checked_at: Time.current)
    @binding.update!(verification_state: "verified", failure_reason: nil, verified_at: Time.current, checked_at: Time.current)
    suspend_body = {
      action: "suspend",
      installation: {
        id: 123,
        app_id: 12345,
        suspended_at: (Time.current + 1.second).utc.iso8601,
        updated_at: (Time.current + 1.second).utc.iso8601,
        account: { id: 24680, login: "app-learner", type: "User" }
      }
    }.to_json
    post WEBHOOK_PATH, params: suspend_body, headers: signed_headers(suspend_body, event: "installation", delivery_id: "del-inst-suspend")
    assert_response :ok
    assert_equal "processed", response.parsed_body.fetch("status")
    assert_equal "failed", @installation.reload.connection_state
    assert_match(/suspended/i, @installation.failure_reason)
    assert_equal "failed", @binding.reload.verification_state
  end

  test "delayed installation suspend arriving after newer reconnection stages without clobbering" do
    reconnected_at = Time.utc(2026, 11, 22, 12, 10, 0)
    @installation.update!(connection_state: "connected", failure_reason: nil, connected_at: reconnected_at, checked_at: reconnected_at)
    @binding.update!(verification_state: "verified", failure_reason: nil, verified_at: reconnected_at, checked_at: reconnected_at)

    # Delayed suspend from 5 minutes before reconnect must NOT revoke the newer connection.
    delayed_suspend = {
      action: "suspend",
      installation: {
        id: 123,
        app_id: 12345,
        suspended_at: (reconnected_at - 5.minutes).iso8601,
        updated_at: (reconnected_at - 5.minutes).iso8601,
        account: { id: 24680, login: "app-learner", type: "User" }
      }
    }.to_json
    post WEBHOOK_PATH, params: delayed_suspend, headers: signed_headers(delayed_suspend, event: "installation", delivery_id: "del-delayed-suspend")
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_equal "connected", @installation.reload.connection_state
    assert_equal "verified", @binding.reload.verification_state

    # Suspend with missing provider timestamp is ambiguous -> stage rather than clobber.
    ambiguous_suspend = {
      action: "suspend",
      installation: { id: 123, app_id: 12345, account: { id: 24680, login: "app-learner", type: "User" } }
    }.to_json
    post WEBHOOK_PATH, params: ambiguous_suspend, headers: signed_headers(ambiguous_suspend, event: "installation", delivery_id: "del-ambiguous-suspend")
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_equal "connected", @installation.reload.connection_state
    assert_equal "verified", @binding.reload.verification_state

    # Suspend with tied timestamp (equal to latest connection freshness) stages rather than clobbering.
    freshness = [ @installation.connected_at, @installation.checked_at, @installation.updated_at ].compact.max.change(usec: 0)
    @installation.update_columns(connected_at: freshness, checked_at: freshness, updated_at: freshness)
    tied_suspend = {
      action: "suspend",
      installation: {
        id: 123,
        app_id: 12345,
        suspended_at: freshness.utc.iso8601,
        updated_at: freshness.utc.iso8601,
        account: { id: 24680, login: "app-learner", type: "User" }
      }
    }.to_json
    post WEBHOOK_PATH, params: tied_suspend, headers: signed_headers(tied_suspend, event: "installation", delivery_id: "del-tied-suspend")
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_equal "connected", @installation.reload.connection_state
    assert_equal "verified", @binding.reload.verification_state
  end

  test "installation_repositories removed revokes only removed repositories when timestamp proves ordering" do
    other_mod = @curriculum.modules.create!(name: "Module 2", position: 1)
    kept_binding = @enrollment.github_repository_bindings.create!(
      github_app_installation: @installation,
      curriculum_module: other_mod,
      full_name: "app-learner/kept-repo",
      repository_id: 77777,
      github_user_id: "24680",
      github_username: "app-learner",
      verification_state: "verified",
      verified_at: Time.current,
      checked_at: Time.current
    )

    body = {
      action: "removed",
      installation: { id: 123, repository_selection: "selected", updated_at: (Time.current + 1.second).utc.iso8601 },
      repositories_removed: [ { id: 98765, full_name: "app-learner/prework-exercises" } ],
      repositories_added: []
    }.to_json

    forbid_external_http do
      post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "installation_repositories", delivery_id: "del-repo-removed")
    end
    assert_response :ok
    assert_equal "processed", response.parsed_body.fetch("status")
    assert_equal "failed", @binding.reload.verification_state
    assert_nil @binding.verified_at
    assert_match(/removed/i, @binding.failure_reason)
    assert_equal "verified", kept_binding.reload.verification_state
  end

  test "delayed or timestamp-less installation_repositories removed stages without clobbering newer reverification" do
    reverified_at = Time.utc(2026, 11, 22, 12, 15, 0)
    @binding.update!(verification_state: "verified", failure_reason: nil, verified_at: reverified_at, checked_at: reverified_at)

    delayed_removed = {
      action: "removed",
      installation: { id: 123, repository_selection: "selected", updated_at: (reverified_at - 5.minutes).iso8601 },
      repositories_removed: [ { id: 98765, full_name: "app-learner/prework-exercises" } ],
      repositories_added: []
    }.to_json
    post WEBHOOK_PATH, params: delayed_removed, headers: signed_headers(delayed_removed, event: "installation_repositories", delivery_id: "del-delayed-removed")
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_equal "verified", @binding.reload.verification_state

    # Missing installation.updated_at cannot prove ordering against verified_at -> stage.
    timeless_removed = {
      action: "removed",
      installation: { id: 123, repository_selection: "selected" },
      repositories_removed: [ { id: 98765, full_name: "app-learner/prework-exercises" } ],
      repositories_added: []
    }.to_json
    post WEBHOOK_PATH, params: timeless_removed, headers: signed_headers(timeless_removed, event: "installation_repositories", delivery_id: "del-timeless-removed")
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_equal "verified", @binding.reload.verification_state

    # Tied timestamp (installation.updated_at == verified_at) stages rather than clobbering.
    tied_removed = {
      action: "removed",
      installation: { id: 123, repository_selection: "selected", updated_at: reverified_at.utc.iso8601 },
      repositories_removed: [ { id: 98765, full_name: "app-learner/prework-exercises" } ],
      repositories_added: []
    }.to_json
    post WEBHOOK_PATH, params: tied_removed, headers: signed_headers(tied_removed, event: "installation_repositories", delivery_id: "del-tied-removed")
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_equal "verified", @binding.reload.verification_state
  end

  test "installation_repositories removed parses integer Unix timestamp installation.updated_at" do
    reverified_at = Time.utc(2026, 11, 22, 12, 15, 0)
    @binding.update!(verification_state: "verified", failure_reason: nil, verified_at: reverified_at, checked_at: reverified_at)

    # Older integer Unix timestamp must NOT revoke the binding and must stage.
    older_epoch = (reverified_at - 5.minutes).to_i
    older_removed = {
      action: "removed",
      installation: { id: 123, repository_selection: "selected", updated_at: older_epoch },
      repositories_removed: [ { id: 98765, full_name: "app-learner/prework-exercises" } ],
      repositories_added: []
    }.to_json
    post WEBHOOK_PATH, params: older_removed, headers: signed_headers(older_removed, event: "installation_repositories", delivery_id: "del-epoch-older-removed")
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_equal "verified", @binding.reload.verification_state
    older_delivery = GithubWebhookDelivery.find_by!(delivery_id: "del-epoch-older-removed")
    assert_equal Time.at(older_epoch).utc.iso8601, older_delivery.payload.dig("installation", "updated_at")

    # Newer integer Unix timestamp proves ordering and revokes the removed binding cleanly.
    newer_epoch = (reverified_at + 10.seconds).to_i
    newer_removed = {
      action: "removed",
      installation: { id: 123, repository_selection: "selected", updated_at: newer_epoch },
      repositories_removed: [ { id: 98765, full_name: "app-learner/prework-exercises" } ],
      repositories_added: []
    }.to_json
    post WEBHOOK_PATH, params: newer_removed, headers: signed_headers(newer_removed, event: "installation_repositories", delivery_id: "del-epoch-newer-removed")
    assert_response :ok
    assert_equal "processed", response.parsed_body.fetch("status")
    @binding.reload
    assert_equal "failed", @binding.verification_state
    assert_nil @binding.verified_at
    assert_match(/removed/i, @binding.failure_reason)
    newer_delivery = GithubWebhookDelivery.find_by!(delivery_id: "del-epoch-newer-removed")
    assert_equal Time.at(newer_epoch).utc.iso8601, newer_delivery.payload.dig("installation", "updated_at")
  end

  test "same-name check_run suppression is scoped to matching check_suite_id" do
    # Newer completed run in check_suite 901 arrives first.
    suite_a_newer = check_run_payload(
      external_id: 6200,
      check_suite_id: 901,
      name: "test",
      status: "completed",
      conclusion: "success",
      started_at: "2026-11-22T02:04:00Z",
      completed_at: "2026-11-22T02:05:00Z"
    ).to_json
    post WEBHOOK_PATH, params: suite_a_newer, headers: signed_headers(suite_a_newer, event: "check_run", delivery_id: "del-suite-a-newer")
    assert_response :ok

    # Out-of-order run with the SAME name/app_slug/head_sha from a DIFFERENT check_suite (902)
    # must still be stored even with an older completed_at and smaller external_id.
    suite_b_failure = check_run_payload(
      external_id: 6150,
      check_suite_id: 902,
      name: "test",
      status: "completed",
      conclusion: "failure",
      started_at: "2026-11-22T02:00:00Z",
      completed_at: "2026-11-22T02:01:00Z"
    ).to_json
    post WEBHOOK_PATH, params: suite_b_failure, headers: signed_headers(suite_b_failure, event: "check_run", delivery_id: "del-suite-b-older")
    assert_response :ok

    run_a = @submission.github_check_runs.find_by!(external_id: 6200)
    run_b = @submission.github_check_runs.find_by!(external_id: 6150)
    assert_equal 901, run_a.check_suite_id
    assert_equal "success", run_a.conclusion
    assert_equal 902, run_b.check_suite_id
    assert_equal "failure", run_b.conclusion

    # An older superseded run in the SAME check_suite (901) is still rejected.
    suite_a_superseded = check_run_payload(
      external_id: 6100,
      check_suite_id: 901,
      name: "test",
      status: "completed",
      conclusion: "failure",
      started_at: "2026-11-22T01:55:00Z",
      completed_at: "2026-11-22T01:58:00Z"
    ).to_json
    post WEBHOOK_PATH, params: suite_a_superseded, headers: signed_headers(suite_a_superseded, event: "check_run", delivery_id: "del-suite-a-superseded")
    assert_response :ok
    assert_not @submission.github_check_runs.exists?(external_id: 6100)
  end

  test "unknown repository and Off cohorts including Cohort 3 are ignored with zero writes" do
    # Unknown repository
    unknown_body = check_run_payload(repository_id: 999_999, external_id: 8001).to_json
    assert_no_difference "GithubCheckRun.count" do
      post WEBHOOK_PATH, params: unknown_body, headers: signed_headers(unknown_body, event: "check_run", delivery_id: "del-unknown-repo")
    end
    assert_response :ok
    assert_equal "ignored", response.parsed_body.fetch("status")

    # Cohort 3 shape: student_experience_v2 Off, github_app & github_webhooks Off/inherited
    cohort3 = Cohort.create!(
      name: "Cohort 3",
      curriculum: @curriculum,
      start_date: Date.new(2026, 10, 5),
      status: :active,
      settings: { "features" => { "student_experience_v2" => false } }
    )
    c3_student = User.create!(clerk_id: "c3-student", email: "c3@example.invalid", role: :student, github_username: "c3-learner")
    c3_student.record_verified_github_identity!(id: "33333", login: "c3-learner")
    c3_enrollment = Enrollment.create!(cohort: cohort3, user: c3_student, status: :active)
    c3_inst = cohort3.github_app_installations.create!(
      app_id: 12345, installation_id: 333, account_id: 33333, account_login: "c3-learner",
      account_type: "User", repository_selection: "selected", connected_at: Time.current, checked_at: Time.current
    )
    c3_binding = c3_enrollment.github_repository_bindings.create!(
      github_app_installation: c3_inst, full_name: "c3-learner/prework", repository_id: 33333,
      github_user_id: "33333", github_username: "c3-learner", verification_state: "verified",
      verified_at: Time.current, checked_at: Time.current
    )
    c3_submission = Submission.create!(
      user: c3_student, enrollment: c3_enrollment, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'c3'", commit_sha: SHA, num_submissions: 1
    )

    c3_check = check_run_payload(installation_id: 333, repository_id: 33333, external_id: 8002).to_json
    assert_no_difference "GithubCheckRun.count" do
      post WEBHOOK_PATH, params: c3_check, headers: signed_headers(c3_check, event: "check_run", delivery_id: "del-c3-check")
    end
    assert_response :ok
    assert_equal "ignored", response.parsed_body.fetch("status")
    assert_empty c3_submission.github_check_runs

    c3_delete = { action: "deleted", installation: { id: 333 } }.to_json
    post WEBHOOK_PATH, params: c3_delete, headers: signed_headers(c3_delete, event: "installation", delivery_id: "del-c3-delete")
    assert_response :ok
    assert_equal "ignored", response.parsed_body.fetch("status")
    assert_equal "connected", c3_inst.reload.connection_state
    assert_equal "verified", c3_binding.reload.verification_state

    # Cohort with github_app On but github_webhooks Off (inherited) is also ignored.
    @cohort.update!(settings: { "features" => { "github_app" => true } })
    off_webhook_body = check_run_payload(external_id: 8003).to_json
    assert_no_difference "GithubCheckRun.count" do
      post WEBHOOK_PATH, params: off_webhook_body, headers: signed_headers(off_webhook_body, event: "check_run", delivery_id: "del-wh-off")
    end
    assert_response :ok
    assert_equal "ignored", response.parsed_body.fetch("status")
  end

  test "module-specific repository binding takes precedence over default binding" do
    mod2 = @curriculum.modules.create!(name: "Module 2", position: 1)
    lesson2 = mod2.lessons.create!(title: "Mod 2 lesson", position: 0, release_day: 0)
    block2 = lesson2.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "222.rb", position: 0)
    mod2_submission = Submission.create!(
      user: @student, enrollment: @enrollment, content_block: block2,
      submission_type: :prework_github_sync, text: "puts 2", commit_sha: SHA,
      github_repository_id: 88888, num_submissions: 1
    )
    @enrollment.github_repository_bindings.create!(
      github_app_installation: @installation,
      curriculum_module: mod2,
      full_name: "app-learner/mod2-repo",
      repository_id: 88888,
      github_user_id: "24680",
      github_username: "app-learner",
      verification_state: "verified",
      verified_at: Time.current,
      checked_at: Time.current
    )

    body = check_run_payload(repository_id: 98765, external_id: 8100).to_json
    post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "check_run", delivery_id: "del-mod-scope")
    assert_response :ok
    assert @submission.github_check_runs.exists?(external_id: 8100)
    assert_not mod2_submission.github_check_runs.exists?(external_id: 8100)
  end

  test "database failure does not return 200" do
    body = check_run_payload(external_id: 9001).to_json
    original = GithubWebhookDelivery.method(:create!)
    GithubWebhookDelivery.define_singleton_method(:create!) { |*_args, **_kwargs| raise ActiveRecord::StatementInvalid, "simulated db outage" }

    post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "check_run", delivery_id: "del-db-fail")
    assert_response :service_unavailable
    assert_equal({ "error" => "Webhook storage temporarily unavailable" }, response.parsed_body)
  ensure
    GithubWebhookDelivery.define_singleton_method(:create!, original)
  end

  test "local processing failure records failed state, does not return 200, and retries cleanly" do
    body = check_run_payload(external_id: 9002).to_json
    headers = signed_headers(body, event: "check_run", delivery_id: "del-proc-fail")

    original = Submission.method(:joins)
    failed_once = false
    Submission.define_singleton_method(:joins) do |*args, **kwargs|
      if !failed_once
        failed_once = true
        raise ActiveRecord::StatementInvalid, "transient submission lookup failure"
      end
      original.call(*args, **kwargs)
    end

    post WEBHOOK_PATH, params: body, headers: headers
    assert_response :service_unavailable
    delivery = GithubWebhookDelivery.find_by!(delivery_id: "del-proc-fail")
    assert_equal "failed", delivery.processing_state
    assert_equal 1, delivery.attempts
    assert_match(/StatementInvalid/, delivery.last_error)

    Submission.define_singleton_method(:joins, original)
    post WEBHOOK_PATH, params: body, headers: headers
    assert_response :ok
    assert_equal true, response.parsed_body.fetch("duplicate")
    assert_equal "processed", response.parsed_body.fetch("status")
    assert @submission.github_check_runs.exists?(external_id: 9002)
    delivery.reload
    assert_equal "processed", delivery.processing_state
    assert_nil delivery.last_error
  ensure
    Submission.define_singleton_method(:joins, original) if original
  end

  test "public webhook rate limit enforces 600 requests per minute" do
    body = { zen: "rate limit check" }.to_json
    ip = "198.51.100.77"
    ApiRateLimits::STORE.write("rate-limit:public-api:github_webhooks:#{ip}", 600, expires_in: 1.minute)

    post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "ping", delivery_id: "del-rl-1").merge(
      "REMOTE_ADDR" => "10.0.0.2",
      "X-Forwarded-For" => "#{ip}, 10.0.0.1"
    )
    assert_response :too_many_requests
    assert_equal({ "error" => "Too many requests", "retry_after" => 60 }, response.parsed_body)
  end

  test "pure Rack endpoint rejects oversized Content-Length and chunked streams without buffering and never logs unsigned bodies" do
    # (a) Oversized payload WITH Content-Length header returns 413 without reading rack.input.
    read_calls = 0
    unreadable_input = Object.new
    unreadable_input.define_singleton_method(:read) { |*_args| read_calls += 1; "" }
    status, _headers, body_chunks = GithubWebhookEndpoint.new.call(
      "REQUEST_METHOD" => "POST",
      "PATH_INFO" => WEBHOOK_PATH,
      "REMOTE_ADDR" => "198.51.100.88",
      "CONTENT_LENGTH" => (GithubWebhookReceiver::MAX_PAYLOAD_BYTES + 100).to_s,
      "rack.input" => unreadable_input
    )
    assert_equal 413, status
    assert_equal 0, read_calls
    assert_equal({ "error" => "Payload too large" }, JSON.parse(body_chunks.join))

    # (b) Oversized payload WITHOUT Content-Length (chunked) returns 413 and stops reading after MAX_PAYLOAD_BYTES + 1.
    bytes_read = 0
    chunk_size = 65_536
    chunked_input = Object.new
    chunked_input.define_singleton_method(:read) do |length = nil|
      n = [ length || chunk_size, chunk_size ].min
      bytes_read += n
      "x" * n
    end
    status, _headers, body_chunks = GithubWebhookEndpoint.new.call(
      "REQUEST_METHOD" => "POST",
      "PATH_INFO" => WEBHOOK_PATH,
      "REMOTE_ADDR" => "198.51.100.89",
      "HTTP_TRANSFER_ENCODING" => "chunked",
      "rack.input" => chunked_input
    )
    assert_equal 413, status
    assert_equal GithubWebhookReceiver::MAX_PAYLOAD_BYTES + 1, bytes_read
    assert_equal({ "error" => "Payload too large" }, JSON.parse(body_chunks.join))

    # (c) Unsigned request with distinctive secret marker in JSON body produces ZERO occurrences in Rails.logger.
    marker = "UNAUTHENTICATED_BODY_LEAK_CANARY_987654321"
    log_buffer = StringIO.new
    original_logger = Rails.logger
    Rails.logger = ActiveSupport::Logger.new(log_buffer)
    begin
      post WEBHOOK_PATH,
        params: { canary: marker, check_run: { name: marker } }.to_json,
        headers: {
          "CONTENT_TYPE" => "application/json",
          "X-GitHub-Event" => "check_run",
          "X-GitHub-Delivery" => "del-log-canary"
        }
      assert_response :unauthorized
    ensure
      Rails.logger = original_logger
    end
    refute_includes log_buffer.string, marker
  end

  test "submission repository provenance prevents cross-repository and post-rebind check-run attachment" do
    # (a) Same commit SHA in two different repositories: only the matching repo's submission receives the check run.
    mod2 = @curriculum.modules.create!(name: "Module B", position: 2)
    lesson2 = mod2.lessons.create!(title: "Lesson B", position: 0, release_day: 0)
    block2 = lesson2.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "222.rb", position: 0)
    other_repo_submission = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: block2,
      submission_type: :prework_github_sync,
      text: "puts 'other'",
      commit_sha: SHA,
      github_code_url: "https://github.com/app-learner/other-repo/blob/#{SHA}/222.rb#L1-L1",
      github_repository_id: 55555,
      num_submissions: 1
    )
    @enrollment.github_repository_bindings.create!(
      github_app_installation: @installation,
      curriculum_module: mod2,
      full_name: "app-learner/other-repo",
      repository_id: 55555,
      github_user_id: "24680",
      github_username: "app-learner",
      verification_state: "verified",
      verified_at: Time.current,
      checked_at: Time.current
    )

    body = check_run_payload(repository_id: 98765, external_id: 8201).to_json
    post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "check_run", delivery_id: "del-prov-same-sha")
    assert_response :ok
    assert_equal "processed", response.parsed_body.fetch("status")
    assert @submission.github_check_runs.exists?(external_id: 8201)
    assert_not other_repo_submission.github_check_runs.exists?(external_id: 8201)

    # (b) Binding changed to a replacement repository after submission: webhook from new binding with the same SHA
    # must NOT attach to the old repository's submission and must stage cleanly.
    @binding.update!(
      full_name: "app-learner/replacement-repo",
      repository_id: 66666,
      verification_state: "verified",
      verified_at: Time.current
    )
    replacement_body = check_run_payload(
      repository_id: 66666,
      repository_full_name: "app-learner/replacement-repo",
      external_id: 8202
    ).to_json
    assert_no_difference "GithubCheckRun.count" do
      post WEBHOOK_PATH, params: replacement_body, headers: signed_headers(replacement_body, event: "check_run", delivery_id: "del-prov-rebound")
    end
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_not @submission.github_check_runs.exists?(external_id: 8202)

    # (c) Replacement repository recreated at the SAME owner/repo path with a new numeric repository_id:
    # even if grading later advances submission.updated_at past binding.verified_at, numeric provenance
    # mismatch (98765 != 777888) MUST still stage and NOT attach.
    verified_time = Time.current
    @binding.update!(
      full_name: "app-learner/prework-exercises",
      repository_id: 777_888,
      verification_state: "verified",
      verified_at: verified_time,
      checked_at: verified_time
    )
    @submission.update!(grade: :B, feedback: "Good work", graded_at: verified_time + 5.minutes, updated_at: verified_time + 5.minutes)
    recreated_same_path_body = check_run_payload(
      repository_id: 777_888,
      repository_full_name: "app-learner/prework-exercises",
      external_id: 8203
    ).to_json
    assert_no_difference "GithubCheckRun.count" do
      post WEBHOOK_PATH, params: recreated_same_path_body, headers: signed_headers(recreated_same_path_body, event: "check_run", delivery_id: "del-prov-same-path-recreated")
    end
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_not @submission.github_check_runs.exists?(external_id: 8203)

    # (d) Legacy submission without stored github_repository_id stages cleanly rather than guessing from URL.
    @binding.update!(repository_id: 98765, full_name: "app-learner/prework-exercises", verification_state: "verified", verified_at: Time.current)
    @submission.update!(github_repository_id: nil)
    legacy_body = check_run_payload(repository_id: 98765, external_id: 8204).to_json
    assert_no_difference "GithubCheckRun.count" do
      post WEBHOOK_PATH, params: legacy_body, headers: signed_headers(legacy_body, event: "check_run", delivery_id: "del-prov-legacy-nil")
    end
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_not @submission.github_check_runs.exists?(external_id: 8204)
  end

  test "concurrent module-specific binding override added before lock prevents default binding attachment" do
    enrollment = @enrollment
    installation = @installation
    mod = @mod
    override_created = false

    # Simulate a module-specific binding being inserted after initial candidate lookup
    # but before attach_check_run_if_proven! acquires the enrollment/submission locks.
    original = GithubCheckRunMerger.method(:submission_matches_binding?)
    GithubCheckRunMerger.define_singleton_method(:submission_matches_binding?) do |*args, **kwargs|
      if !override_created
        override_created = true
        enrollment.github_repository_bindings.create!(
          github_app_installation: installation,
          curriculum_module: mod,
          full_name: "app-learner/override-repo",
          repository_id: 444_444,
          github_user_id: "24680",
          github_username: "app-learner",
          verification_state: "verified",
          verified_at: Time.current,
          checked_at: Time.current
        )
      end
      original.call(*args, **kwargs)
    end

    body = check_run_payload(repository_id: 98765, external_id: 8250).to_json
    assert_no_difference "GithubCheckRun.count" do
      post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "check_run", delivery_id: "del-concurrent-mod-override")
    end
    assert_response :ok
    assert_equal "staged", response.parsed_body.fetch("status")
    assert_not @submission.github_check_runs.exists?(external_id: 8250)
  ensure
    GithubCheckRunMerger.define_singleton_method(:submission_matches_binding?, original) if original
  end

  test "malformed nested scalar JSON shapes return 400 instead of 500" do
    malformed_cases = [
      [ "check_run", { installation: "bad", repository: { id: 98765 }, check_run: { id: 1 } } ],
      [ "check_run", { installation: { id: 123 }, repository: 42, check_run: { id: 1 } } ],
      [ "check_run", { installation: { id: 123 }, repository: { id: 98765 }, check_run: 123 } ],
      [ "check_run", { installation: { id: 123 }, repository: { id: 98765 }, check_run: { id: 1, app: "bad" } } ],
      [ "installation", { action: "deleted", installation: { id: 123, account: "bad" } } ],
      [ "installation_repositories", { action: "removed", installation: { id: 123 }, repositories_removed: "bad" } ],
      [ "installation_repositories", { action: "removed", installation: { id: 123 }, repositories_removed: [ 123 ] } ]
    ]

    assert_no_difference "GithubWebhookDelivery.count" do
      malformed_cases.each_with_index do |(event, payload), index|
        raw = payload.to_json
        post WEBHOOK_PATH, params: raw, headers: signed_headers(raw, event: event, delivery_id: "del-malformed-#{index}")
        assert_response :bad_request, "Expected 400 for malformed #{event} case #{index}"
        assert_equal({ "error" => "Invalid webhook payload structure" }, response.parsed_body)
      end
    end
  end

  test "Cohort 3 full session response is byte-for-byte identical whether school github_webhooks is Off or On" do
    cohort3 = Cohort.create!(
      name: "Cohort 3 Session Parity",
      curriculum: @curriculum,
      start_date: Date.new(2026, 10, 5),
      status: :active,
      settings: { "features" => { "student_experience_v2" => false } }
    )
    c3_student = User.create!(clerk_id: "c3-session-student", email: "c3-session@example.invalid", role: :student)
    Enrollment.create!(cohort: cohort3, user: c3_student, status: :active)

    SchoolSetting.current.update!(features: { "github_app" => false, "github_webhooks" => false })
    as_app_user(c3_student) { post "/api/v1/sessions", headers: app_headers }
    assert_response :success
    body_when_off = response.body

    SchoolSetting.current.update!(features: { "github_app" => false, "github_webhooks" => true })
    as_app_user(c3_student) { post "/api/v1/sessions", headers: app_headers }
    assert_response :success
    body_when_on = response.body

    assert_equal body_when_off, body_when_on
    refute_includes body_when_on, "github_webhooks"
  end

  test "check_run webhook captures workflow_path and preserves it across subsequent updates" do
    payload = check_run_payload(external_id: 5099, status: "in_progress", conclusion: nil)
    payload[:workflow] = { path: ".github/workflows/prework.yml" }
    body = payload.to_json

    forbid_external_http do
      post WEBHOOK_PATH, params: body, headers: signed_headers(body, event: "check_run", delivery_id: "del-wf-path-1")
    end
    assert_response :ok
    run = @submission.github_check_runs.find_by!(external_id: 5099)
    assert_equal ".github/workflows/prework.yml", run.workflow_path

    # Follow-up completion without workflow_path preserves existing workflow_path.
    done_body = check_run_payload(external_id: 5099, status: "completed", conclusion: "success").to_json
    forbid_external_http do
      post WEBHOOK_PATH, params: done_body, headers: signed_headers(done_body, event: "check_run", delivery_id: "del-wf-path-2")
    end
    assert_response :ok
    run.reload
    assert_equal "completed", run.status
    assert_equal "success", run.conclusion
    assert_equal ".github/workflows/prework.yml", run.workflow_path
  end

  private

  def signature_for(raw_body, secret: SECRET)
    "sha256=#{OpenSSL::HMAC.hexdigest('SHA256', secret.b, raw_body.to_s.b)}"
  end

  def signed_headers(raw_body, event:, delivery_id:, secret: SECRET)
    {
      "CONTENT_TYPE" => "application/json",
      "X-GitHub-Event" => event,
      "X-GitHub-Delivery" => delivery_id,
      "X-Hub-Signature-256" => signature_for(raw_body, secret: secret)
    }
  end

  def check_run_payload(
    external_id: 5001,
    check_suite_id: 900,
    name: "prework/111.rb",
    status: "completed",
    conclusion: "success",
    head_sha: SHA,
    repository_id: 98765,
    repository_full_name: "app-learner/prework-exercises",
    installation_id: 123,
    started_at: "2026-11-22T02:00:00Z",
    completed_at: "2026-11-22T02:01:00Z"
  )
    {
      action: status == "completed" ? "completed" : "created",
      check_run: {
        id: external_id,
        name: name,
        head_sha: head_sha,
        status: status,
        conclusion: conclusion,
        details_url: "https://github.com/app-learner/prework-exercises/actions/runs/42",
        started_at: started_at,
        completed_at: completed_at,
        app: { slug: "github-actions" },
        check_suite: { id: check_suite_id, app: { name: "GitHub Actions" } },
        output: { title: "Output", summary: "private log blob", text: "very long private log blob" }
      },
      repository: { id: repository_id, full_name: repository_full_name },
      installation: { id: installation_id }
    }
  end

  def forbid_external_http
    original_httparty = HTTParty.method(:get)
    original_post = HTTParty.method(:post)
    HTTParty.define_singleton_method(:get) { |*_a, **_k| raise "External HTTP GET forbidden during webhook receipt" }
    HTTParty.define_singleton_method(:post) { |*_a, **_k| raise "External HTTP POST forbidden during webhook receipt" }
    yield
  ensure
    HTTParty.define_singleton_method(:get, original_httparty)
    HTTParty.define_singleton_method(:post, original_post)
  end
end
