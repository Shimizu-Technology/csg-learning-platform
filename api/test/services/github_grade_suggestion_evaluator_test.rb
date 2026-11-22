require "test_helper"

class GithubGradeSuggestionEvaluatorTest < ActiveSupport::TestCase
  SHA_ONE = "1111111111111111111111111111111111111111".freeze
  SHA_TWO = "2222222222222222222222222222222222222222".freeze
  WORKFLOW_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".freeze
  TAMPERED_WORKFLOW_SHA = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".freeze

  setup do
    @curriculum = Curriculum.create!(name: "Evaluator Curriculum")
    @mod = @curriculum.modules.create!(name: "Prework", position: 0)
    @lesson = @mod.lessons.create!(title: "Ruby Basics", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Exercise 111", filename: "111.rb", submission_type: :prework_github_sync)
    @other_block = @lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Exercise 112", filename: "112.rb", submission_type: :prework_github_sync)

    @admin = User.create!(clerk_id: "eval_admin", email: "eval-admin@example.invalid", first_name: "Eval", last_name: "Admin", role: :admin)
    @student = User.create!(clerk_id: "eval_student", email: "eval-student@example.invalid", first_name: "Eval", last_name: "Student", role: :student, github_username: "eval-student")

    SchoolSetting.current.update!(features: { "github_app" => true, "github_grade_suggestions" => true })
    @cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Opt-In Prework Cohort",
      start_date: Date.current,
      status: :active,
      settings: { "features" => { "github_app" => true, "github_grade_suggestions" => true } }
    )
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @policy = ExerciseCheckPolicy.create_version!(
      content_block: @block,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: ".github/workflows/prework-checks.yml",
      created_by: @admin
    )
    @now = Time.zone.parse("2026-11-22 10:00:00 UTC")
  end

  test "returns nil and makes zero writes when cohort is not opted into both github_app and github_grade_suggestions" do
    submission = create_verified_submission
    create_check_run(submission, name: "prework/111.rb", conclusion: "success")

    [
      [ false, true ],
      [ true, false ],
      [ false, false ]
    ].each do |app_on, suggestions_on|
      @cohort.update!(settings: { "features" => { "github_app" => app_on, "github_grade_suggestions" => suggestions_on } })
      submission.enrollment.association(:cohort).reset

      queries = capture_sql_queries do
        assert_nil GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now)
      end
      assert_equal 0, SubmissionGradeSuggestion.count
      refute queries.any? { |sql| sql.match?(/exercise_check_policies|submission_grade_suggestions/) }
    end
  end

  test "suggests B when all required exercise checks pass from a trusted app slug and writes zero grade/progress/notification side effects" do
    submission = create_verified_submission
    run = create_check_run(submission, external_id: 5001, name: "prework/111.rb", status: "completed", conclusion: "success", app_slug: "github-actions", check_suite_id: 9001)
    original_updated_at = submission.updated_at

    assert_no_difference [ "SubmissionCriterionResult.count", "Progress.count", "GithubIssueDelivery.count", "Notification.count", "ActivityEvent.count" ] do
      suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now)

      assert_equal "suggest_b", suggestion.outcome
      assert_equal "B", suggestion.suggested_grade
      assert_equal "all_required_checks_passed", suggestion.reason_code
      assert_equal @policy.id, suggestion.exercise_check_policy_id
      assert_equal 1, suggestion.policy_version
      assert_equal SHA_ONE, suggestion.commit_sha
      assert_equal @now, suggestion.evaluated_at
      assert_equal [ "prework/111.rb" ], suggestion.evidence.fetch("required_checks")
      assert_equal [ run.external_id ], suggestion.evidence.fetch("runs").map { |r| r.fetch("external_id") }
      assert_equal [ 9001 ], suggestion.evidence.fetch("runs").map { |r| r.fetch("check_suite_id") }
      assert_equal false, suggestion.stale_policy?
    end

    submission.reload
    assert_nil submission.grade
    assert_nil submission.graded_at
    assert_nil submission.graded_by_id
    assert_nil submission.feedback
    assert_equal original_updated_at, submission.updated_at
  end

  test "returns review_for_redo without suggested_grade when a required check fails" do
    submission = create_verified_submission
    create_check_run(submission, name: "prework/111.rb", status: "completed", conclusion: "failure")

    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now)

    assert_equal "review_for_redo", suggestion.outcome
    assert_nil suggestion.suggested_grade
    assert_equal "required_check_failed", suggestion.reason_code
    assert_includes suggestion.reason_summary, "prework/111.rb"
  end

  test "legacy submissions without immutable X-6.3 revision provenance yield unverified_revision" do
    legacy = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "puts 1",
      commit_sha: SHA_ONE,
      branch: "main",
      github_revision: nil
    )
    create_check_run(legacy, name: "prework/111.rb", status: "completed", conclusion: "success")

    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(legacy, now: @now)
    assert_equal "no_suggestion", suggestion.outcome
    assert_nil suggestion.suggested_grade
    assert_equal "unverified_revision", suggestion.reason_code

    mismatched_sha = create_verified_submission(revision_overrides: { "commit_sha" => SHA_TWO })
    create_check_run(mismatched_sha, name: "prework/111.rb", status: "completed", conclusion: "success")
    suggestion2 = GithubGradeSuggestionEvaluator.evaluate_submission!(mismatched_sha, now: @now)
    assert_equal "no_suggestion", suggestion2.outcome
    assert_equal "unverified_revision", suggestion2.reason_code
  end

  test "missing active policy or empty required checks never produces a pass" do
    ExerciseCheckPolicy.deactivate_active!(content_block: @block)
    submission = create_verified_submission
    create_check_run(submission, name: "prework/111.rb", status: "completed", conclusion: "success")

    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now)
    assert_equal "no_suggestion", suggestion.outcome
    assert_nil suggestion.suggested_grade
    assert_equal "missing_policy", suggestion.reason_code

    # Pure evaluator also refuses a policy object whose required_checks array is empty.
    empty_policy = ExerciseCheckPolicy.new(id: 999, content_block_id: @block.id, version: 2, active: true, required_checks: [], allowed_app_slugs: [ "github-actions" ])
    pure = GithubGradeSuggestionEvaluator.evaluate(submission: submission, policy: empty_policy, check_runs: submission.github_check_runs.to_a, latest_submission_id: submission.id, now: @now)
    assert_equal "no_suggestion", pure.outcome
    assert_equal "missing_policy", pure.reason_code
  end

  test "branch mismatch returns no_suggestion and accepts refs/heads prefix match" do
    wrong_branch = create_verified_submission(branch: "feature/experiment", revision_overrides: { "branch" => "feature/experiment" })
    create_check_run(wrong_branch, name: "prework/111.rb", status: "completed", conclusion: "success")

    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(wrong_branch, now: @now)
    assert_equal "no_suggestion", suggestion.outcome
    assert_equal "branch_mismatch", suggestion.reason_code

    ref_match = create_verified_submission(branch: nil, revision_overrides: { "branch" => nil, "ref" => "refs/heads/main" })
    create_check_run(ref_match, name: "prework/111.rb", status: "completed", conclusion: "success")

    suggestion_ok = GithubGradeSuggestionEvaluator.evaluate_submission!(ref_match, now: @now)
    assert_equal "suggest_b", suggestion_ok.outcome
    assert_equal "B", suggestion_ok.suggested_grade
  end

  test "tampered or missing workflow SHA is rejected when expected_workflow_sha is pinned" do
    pinned_policy = ExerciseCheckPolicy.create_version!(
      content_block: @block,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: ".github/workflows/prework-checks.yml",
      expected_workflow_sha: WORKFLOW_SHA,
      created_by: @admin
    )

    tampered = create_verified_submission(revision_overrides: { "workflow_sha" => TAMPERED_WORKFLOW_SHA })
    create_check_run(tampered, name: "prework/111.rb", status: "completed", conclusion: "success")
    result = GithubGradeSuggestionEvaluator.evaluate_submission!(tampered, now: @now)
    assert_equal "no_suggestion", result.outcome
    assert_equal "workflow_tampered", result.reason_code

    missing_wf = create_verified_submission(revision_overrides: {})
    create_check_run(missing_wf, name: "prework/111.rb", status: "completed", conclusion: "success")
    result_missing = GithubGradeSuggestionEvaluator.evaluate_submission!(missing_wf, now: @now)
    assert_equal "no_suggestion", result_missing.outcome
    assert_equal "workflow_tampered", result_missing.reason_code

    verified_wf = create_verified_submission(revision_overrides: { "workflow_sha" => WORKFLOW_SHA.upcase })
    create_check_run(verified_wf, name: "prework/111.rb", status: "completed", conclusion: "success")
    result_ok = GithubGradeSuggestionEvaluator.evaluate_submission!(verified_wf, now: @now)
    assert_equal "suggest_b", result_ok.outcome
    assert_equal pinned_policy.version, result_ok.policy_version
  end

  test "every pending status and every inconclusive conclusion maps to no_suggestion" do
    %w[queued in_progress pending requested waiting].each_with_index do |status, idx|
      sub = create_verified_submission
      create_check_run(sub, external_id: 6100 + idx, name: "prework/111.rb", status: status, conclusion: nil)
      res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
      assert_equal "no_suggestion", res.outcome, "expected no_suggestion for status=#{status}"
      assert_nil res.suggested_grade
      assert_equal "check_pending", res.reason_code, "expected check_pending for status=#{status}"
    end

    [ "skipped", "neutral", "cancelled", "timed_out", "action_required", "stale", "startup_failure", nil ].each_with_index do |conclusion, idx|
      sub = create_verified_submission
      create_check_run(sub, external_id: 6200 + idx, name: "prework/111.rb", status: "completed", conclusion: conclusion)
      res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
      assert_equal "no_suggestion", res.outcome, "expected no_suggestion for conclusion=#{conclusion.inspect}"
      assert_nil res.suggested_grade
      assert_equal "check_inconclusive", res.reason_code, "expected check_inconclusive for conclusion=#{conclusion.inspect}"
    end
  end

  test "missing required check and exercise isolation prevent wrong-exercise or repo-wide ci check from passing" do
    ExerciseCheckPolicy.create_version!(
      content_block: @other_block,
      required_checks: [ "prework/112.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      created_by: @admin
    )

    # Zero checks at all -> missing_required_check
    empty_sub = create_verified_submission(content_block: @block)
    res_empty = GithubGradeSuggestionEvaluator.evaluate_submission!(empty_sub, now: @now)
    assert_equal "no_suggestion", res_empty.outcome
    assert_equal "missing_required_check", res_empty.reason_code

    # Repo-wide `ci` check cannot satisfy exercise requiring `prework/111.rb`
    create_check_run(empty_sub, external_id: 7001, name: "ci", status: "completed", conclusion: "success")
    res_ci = GithubGradeSuggestionEvaluator.evaluate_submission!(empty_sub, now: @now)
    assert_equal "no_suggestion", res_ci.outcome
    assert_equal "missing_required_check", res_ci.reason_code

    # Passing `prework/111.rb` cannot satisfy exercise requiring `prework/112.rb`
    sub_112 = create_verified_submission(content_block: @other_block)
    create_check_run(sub_112, external_id: 7002, name: "prework/111.rb", status: "completed", conclusion: "success")
    res_112 = GithubGradeSuggestionEvaluator.evaluate_submission!(sub_112, now: @now)
    assert_equal "no_suggestion", res_112.outcome
    assert_equal "missing_required_check", res_112.reason_code
    assert_equal [ "prework/112.rb" ], res_112.evidence.fetch("missing_checks")
  end

  test "spoofed check name from untrusted app_slug is rejected even if workflow_name matches GitHub Actions" do
    submission = create_verified_submission
    create_check_run(
      submission,
      external_id: 7100,
      name: "prework/111.rb",
      workflow_name: "GitHub Actions",
      app_slug: "untrusted-third-party-app",
      status: "completed",
      conclusion: "success"
    )

    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now)
    assert_equal "no_suggestion", suggestion.outcome
    assert_nil suggestion.suggested_grade
    assert_equal "untrusted_producer", suggestion.reason_code
    assert_equal "untrusted-third-party-app", suggestion.evidence.fetch("untrusted_checks").first.fetch("app_slug")
  end

  test "multiple required jobs enforce strict priority and require every check to pass" do
    ExerciseCheckPolicy.create_version!(
      content_block: @block,
      required_checks: [ "prework/111.rb", "prework/111-edge.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      created_by: @admin
    )

    # 1 pass + 1 missing -> missing_required_check
    sub = create_verified_submission
    create_check_run(sub, external_id: 7201, name: "prework/111.rb", status: "completed", conclusion: "success")
    res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
    assert_equal "missing_required_check", res.reason_code

    # 1 pass + 1 in_progress -> check_pending
    run2 = create_check_run(sub, external_id: 7202, name: "prework/111-edge.rb", status: "in_progress", conclusion: nil)
    res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
    assert_equal "check_pending", res.reason_code

    # 1 failure + 1 skipped -> check_inconclusive beats failure per strict priority
    sub.github_check_runs.find_by!(external_id: 7201).update!(conclusion: "failure")
    run2.update!(status: "completed", conclusion: "skipped")
    res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
    assert_equal "check_inconclusive", res.reason_code

    # 1 failure + 1 success -> review_for_redo
    run2.update!(conclusion: "success")
    res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
    assert_equal "review_for_redo", res.outcome
    assert_equal "required_check_failed", res.reason_code
    assert_nil res.suggested_grade

    # Both success -> suggest_b
    sub.github_check_runs.find_by!(external_id: 7201).update!(conclusion: "success")
    res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
    assert_equal "suggest_b", res.outcome
    assert_equal "B", res.suggested_grade
    assert_equal "all_required_checks_passed", res.reason_code
  end

  test "fresh passing rerun replaces earlier failed run for the same required check and SHA" do
    submission = create_verified_submission
    create_check_run(
      submission,
      external_id: 8001,
      name: "prework/111.rb",
      status: "completed",
      conclusion: "failure",
      started_at: @now - 10.minutes,
      completed_at: @now - 9.minutes
    )
    fresh = create_check_run(
      submission,
      external_id: 8002,
      name: "prework/111.rb",
      status: "completed",
      conclusion: "success",
      started_at: @now - 3.minutes,
      completed_at: @now - 2.minutes
    )

    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now)
    assert_equal "suggest_b", suggestion.outcome
    assert_equal "B", suggestion.suggested_grade
    assert_equal [ fresh.external_id ], suggestion.evidence.fetch("runs").map { |r| r.fetch("external_id") }
  end

  test "stale SHA, superseded submission, and policy version staleness are flagged as stale_evidence" do
    # 1. Stale SHA (checks only exist for an older commit)
    stale_sha_sub = create_verified_submission(commit_sha: SHA_TWO)
    create_check_run(stale_sha_sub, external_id: 8101, name: "prework/111.rb", head_sha: SHA_ONE, status: "completed", conclusion: "success")
    res_sha = GithubGradeSuggestionEvaluator.evaluate_submission!(stale_sha_sub, now: @now)
    assert_equal "stale_evidence", res_sha.outcome
    assert_nil res_sha.suggested_grade
    assert_equal "stale_sha", res_sha.reason_code

    # 2. Superseded submission (newer attempt exists)
    newer = create_verified_submission(commit_sha: SHA_TWO)
    create_check_run(stale_sha_sub, external_id: 8102, name: "prework/111.rb", head_sha: SHA_TWO, status: "completed", conclusion: "success")
    res_sup = GithubGradeSuggestionEvaluator.evaluate_submission!(stale_sha_sub, now: @now)
    assert_equal "stale_evidence", res_sup.outcome
    assert_equal "superseded_submission", res_sup.reason_code
    assert_equal newer.id, res_sup.evidence.fetch("latest_submission_id")

    # 3. Policy version change staleness
    create_check_run(newer, external_id: 8103, name: "prework/111.rb", head_sha: SHA_TWO, status: "completed", conclusion: "success")
    v1_suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(newer, now: @now)
    assert_equal "suggest_b", v1_suggestion.outcome
    assert_equal 1, v1_suggestion.policy_version
    assert_equal false, v1_suggestion.stale_policy?

    v2_policy = ExerciseCheckPolicy.create_version!(
      content_block: @block,
      required_checks: [ "prework/111.rb", "prework/111-lint.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      created_by: @admin
    )

    assert_equal true, v1_suggestion.reload.stale_policy?

    # Evaluating against the archived v1 policy explicitly marks stale_policy
    archived_result = GithubGradeSuggestionEvaluator.evaluate_submission!(newer, now: @now, policy: @policy.reload)
    assert_equal "stale_evidence", archived_result.outcome
    assert_equal "stale_policy", archived_result.reason_code

    # Re-evaluating against the new active v2 policy updates policy_version and outcome
    v2_result = GithubGradeSuggestionEvaluator.evaluate_submission!(newer, now: @now)
    assert_equal v2_policy.id, v2_result.exercise_check_policy_id
    assert_equal 2, v2_result.policy_version
    assert_equal "no_suggestion", v2_result.outcome
    assert_equal "missing_required_check", v2_result.reason_code
    assert_equal false, v2_result.stale_policy?
  end

  test "GithubCheckRunSyncService hooks evaluation after check-run commit for opted-in cohorts and skips Off cohorts" do
    @student.record_verified_github_identity!(id: 99_001, login: "eval-student")
    installation = GithubAppInstallation.create!(
      cohort: @cohort,
      app_id: 12_345,
      installation_id: 42_001,
      account_login: "eval-student",
      account_id: 99_001,
      account_type: "User",
      repository_selection: "selected",
      connection_state: "connected",
      connected_at: @now,
      checked_at: @now
    )
    binding = @enrollment.github_repository_bindings.create!(
      github_app_installation: installation,
      curriculum_module: @mod,
      repository_id: 55_555,
      full_name: "eval-student/prework",
      github_username: "eval-student",
      github_user_id: "99001",
      verification_state: "verified",
      verified_at: @now
    )
    submission = create_verified_submission(
      commit_sha: SHA_ONE,
      repo_url: "https://github.com/eval-student/prework",
      revision_overrides: { "binding_id" => binding.id, "repository_id" => 55_555, "repository_full_name" => "eval-student/prework" }
    )

    fake_client = Object.new
    fake_client.define_singleton_method(:repository) do |**_kwargs|
      { "id" => 55_555, "full_name" => "eval-student/prework", "fork" => false, "owner" => { "login" => "eval-student", "id" => 99_001, "type" => "User" } }
    end
    fake_client.define_singleton_method(:checks) do |**_kwargs|
      {
        "total_count" => 1,
        "check_runs" => [ {
          "id" => 9901,
          "name" => "prework/111.rb",
          "head_sha" => SHA_ONE,
          "status" => "completed",
          "conclusion" => "success",
          "app" => { "slug" => "github-actions" },
          "check_suite" => { "id" => 77_001, "app" => { "name" => "GitHub Actions" } },
          "started_at" => "2026-11-22T09:58:00Z",
          "completed_at" => "2026-11-22T09:59:00Z"
        } ]
      }
    end

    result = GithubCheckRunSyncService.new(submission: submission, token: nil, now: @now, app_client: fake_client).call
    assert_nil result[:error]
    assert_equal 77_001, submission.github_check_runs.find_by!(external_id: 9901).check_suite_id
    assert_equal "suggest_b", result[:grade_suggestion].outcome
    assert_equal "B", submission.reload.submission_grade_suggestion.suggested_grade
    assert_nil submission.grade

    # Off cohort: sync does zero queries on policies or suggestions.
    @cohort.update!(settings: { "features" => { "github_app" => true, "github_grade_suggestions" => false } })
    submission.enrollment.association(:cohort).reset
    SubmissionGradeSuggestion.delete_all

    queries = capture_sql_queries do
      off_result = GithubCheckRunSyncService.new(submission: submission, token: nil, now: @now, app_client: fake_client).call
      assert_nil off_result[:error]
      assert_nil off_result[:grade_suggestion]
    end
    assert_equal 0, SubmissionGradeSuggestion.count
    refute queries.any? { |sql| sql.match?(/exercise_check_policies|submission_grade_suggestions/) }
  end

  private

  def create_verified_submission(content_block: @block, commit_sha: SHA_ONE, branch: "main", repo_url: "https://github.com/eval-student/prework", revision_overrides: {})
    revision = {
      "version" => 1,
      "binding_id" => 101,
      "repository_id" => 55_555,
      "repository_full_name" => "eval-student/prework",
      "paths" => [ content_block.filename || "111.rb" ],
      "content_digest" => Digest::SHA256.hexdigest("puts 1"),
      "source_bytes" => 6,
      "captured_at" => @now.iso8601(6)
    }.merge(revision_overrides)

    Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: content_block,
      submission_type: :prework_github_sync,
      text: "puts 1",
      repo_url: repo_url,
      commit_sha: commit_sha,
      branch: branch,
      github_revision: revision
    )
  end

  def create_check_run(submission, external_id: nil, name:, head_sha: submission.commit_sha, status: "completed", conclusion: "success",
    app_slug: "github-actions", workflow_name: "GitHub Actions", check_suite_id: nil, started_at: @now - 2.minutes, completed_at: @now - 1.minute)
    @next_external_id ||= 10_000
    submission.github_check_runs.create!(
      external_id: external_id || (@next_external_id += 1),
      name: name,
      app_slug: app_slug,
      workflow_name: workflow_name,
      check_suite_id: check_suite_id,
      head_sha: head_sha,
      status: status,
      conclusion: conclusion,
      details_url: "https://github.com/eval-student/prework/actions/runs/1",
      started_at: started_at,
      completed_at: completed_at,
      fetched_at: @now
    )
  end

  def capture_sql_queries
    queries = []
    callback = ->(*, payload) { queries << payload[:sql] unless %w[SCHEMA TRANSACTION].include?(payload[:name]) }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { yield }
    queries
  end
end
