require "test_helper"

class GithubGradeSuggestionEvaluatorTest < ActiveSupport::TestCase
  SHA_ONE = "1111111111111111111111111111111111111111".freeze
  SHA_TWO = "2222222222222222222222222222222222222222".freeze
  WORKFLOW_PATH = ".github/workflows/prework-checks.yml".freeze
  WORKFLOW_OID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".freeze
  WORKFLOW_SHA256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef".freeze
  TAMPERED_WORKFLOW_OID = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb".freeze

  setup do
    @now = Time.zone.parse("2026-11-22 10:00:00 UTC")
    @curriculum = Curriculum.create!(name: "Evaluator Curriculum")
    @mod = @curriculum.modules.create!(name: "Prework", position: 0)
    @lesson = @mod.lessons.create!(title: "Ruby Basics", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Exercise 111", filename: "111.rb", submission_type: :prework_github_sync)
    @other_block = @lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Exercise 112", filename: "112.rb", submission_type: :prework_github_sync)

    @admin = User.create!(clerk_id: "eval_admin", email: "eval-admin@example.invalid", first_name: "Eval", last_name: "Admin", role: :admin)
    @student = User.create!(clerk_id: "eval_student", email: "eval-student@example.invalid", first_name: "Eval", last_name: "Student", role: :student, github_username: "eval-student")
    @student.record_verified_github_identity!(id: 99_001, login: "eval-student")

    SchoolSetting.current.update!(features: { "github_app" => true, "github_grade_suggestions" => true })
    @cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Opt-In Prework Cohort",
      start_date: Date.current,
      status: :active,
      settings: { "features" => { "github_app" => true, "github_grade_suggestions" => true } }
    )
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @installation = GithubAppInstallation.create!(
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
    @binding = @enrollment.github_repository_bindings.create!(
      github_app_installation: @installation,
      curriculum_module: @mod,
      repository_id: 55_555,
      full_name: "eval-student/prework",
      github_username: "eval-student",
      github_user_id: "99001",
      verification_state: "verified",
      verified_at: @now
    )
    @policy = ExerciseCheckPolicy.create_version!(
      content_block: @block,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: WORKFLOW_PATH,
      created_by: @admin
    )
  end

  test "returns nil and makes zero policy or suggestion queries/writes when cohort is not opted into both switches" do
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
      assert_equal true, suggestion.evidence.fetch("workflow_file_present")
      assert_equal WORKFLOW_OID, suggestion.evidence.fetch("observed_workflow_oid")
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

  test "unverified provenance, non-integer IDs, mismatched binding_id, and failed/disconnected bindings fail closed" do
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
    assert_equal "unverified_revision", GithubGradeSuggestionEvaluator.evaluate_submission!(legacy, now: @now).reason_code

    # String-coerced repository_id, missing content_digest, mismatched commit_sha, wrong binding_id all rejected.
    [
      { "repository_id" => "55555abc" },
      { "binding_id" => @binding.id.to_s },
      { "binding_id" => @binding.id + 999 },
      { "content_digest" => "" },
      { "commit_sha" => SHA_TWO }
    ].each do |bad_override|
      sub = create_verified_submission(revision_overrides: bad_override)
      create_check_run(sub, name: "prework/111.rb", status: "completed", conclusion: "success")
      res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
      assert_equal "no_suggestion", res.outcome
      assert_equal "unverified_revision", res.reason_code, "expected unverified_revision for #{bad_override.inspect}"
    end

    # Valid submission fails closed once binding becomes failed or installation disconnects.
    valid_sub = create_verified_submission
    create_check_run(valid_sub, name: "prework/111.rb", status: "completed", conclusion: "success")
    assert_equal "suggest_b", GithubGradeSuggestionEvaluator.evaluate_submission!(valid_sub, now: @now).outcome

    @binding.update!(verification_state: "failed", failure_reason: "Repository access lost")
    assert_equal "unverified_revision", GithubGradeSuggestionEvaluator.evaluate_submission!(valid_sub, now: @now).reason_code

    @binding.update!(verification_state: "verified", failure_reason: nil)
    @installation.update!(connection_state: "failed")
    assert_equal "unverified_revision", GithubGradeSuggestionEvaluator.evaluate_submission!(valid_sub, now: @now).reason_code
  end

  test "missing active policy or empty required checks never produces a pass" do
    ExerciseCheckPolicy.deactivate_active!(content_block: @block)
    submission = create_verified_submission
    create_check_run(submission, name: "prework/111.rb", status: "completed", conclusion: "success")

    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now)
    assert_equal "no_suggestion", suggestion.outcome
    assert_nil suggestion.suggested_grade
    assert_equal "missing_policy", suggestion.reason_code

    empty_policy = ExerciseCheckPolicy.new(id: 999, content_block_id: @block.id, version: 2, active: true, required_checks: [], allowed_app_slugs: [ "github-actions" ])
    pure = GithubGradeSuggestionEvaluator.evaluate(
      submission: submission,
      policy: empty_policy,
      binding: @binding,
      check_runs: submission.github_check_runs.to_a,
      latest_submission_id: submission.id,
      now: @now
    )
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

  test "workflow_path and expected_workflow_sha fail closed when missing or modified and accept matching OID or SHA-256" do
    # Policy requires expected_workflow_path whenever expected_workflow_sha is set.
    invalid = ExerciseCheckPolicy.new(
      content_block: @block,
      version: 99,
      active: true,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      expected_workflow_sha: WORKFLOW_OID
    )
    refute invalid.valid?
    assert_includes invalid.errors[:expected_workflow_path], "is required when expected_workflow_sha is set"

    # Without workflow_files captured, expected_workflow_path fails closed!
    no_wf_sub = create_verified_submission(include_workflow_files: false)
    create_check_run(no_wf_sub, name: "prework/111.rb", status: "completed", conclusion: "success")
    assert_equal "workflow_tampered", GithubGradeSuggestionEvaluator.evaluate_submission!(no_wf_sub, now: @now).reason_code

    # Workflow absent at commit SHA -> fails closed!
    absent_wf_sub = create_verified_submission(revision_overrides: { "workflow_files" => { WORKFLOW_PATH => { "present" => false } } })
    create_check_run(absent_wf_sub, name: "prework/111.rb", status: "completed", conclusion: "success")
    assert_equal "workflow_tampered", GithubGradeSuggestionEvaluator.evaluate_submission!(absent_wf_sub, now: @now).reason_code

    # Pinned to 40-char Git blob OID
    ExerciseCheckPolicy.create_version!(
      content_block: @block,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: WORKFLOW_PATH,
      expected_workflow_sha: WORKFLOW_OID,
      created_by: @admin
    )

    tampered = create_verified_submission(revision_overrides: {
      "workflow_files" => { WORKFLOW_PATH => { "present" => true, "oid" => TAMPERED_WORKFLOW_OID, "sha256" => "f" * 64 } }
    })
    create_check_run(tampered, name: "prework/111.rb", status: "completed", conclusion: "success")
    assert_equal "workflow_tampered", GithubGradeSuggestionEvaluator.evaluate_submission!(tampered, now: @now).reason_code

    matching_oid = create_verified_submission
    create_check_run(matching_oid, name: "prework/111.rb", status: "completed", conclusion: "success")
    assert_equal "suggest_b", GithubGradeSuggestionEvaluator.evaluate_submission!(matching_oid, now: @now).outcome

    # Pinned to 64-char content SHA-256
    ExerciseCheckPolicy.create_version!(
      content_block: @block,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: WORKFLOW_PATH,
      expected_workflow_sha: WORKFLOW_SHA256.upcase,
      created_by: @admin
    )
    assert_equal "suggest_b", GithubGradeSuggestionEvaluator.evaluate_submission!(matching_oid, now: @now).outcome
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

    empty_sub = create_verified_submission(content_block: @block)
    res_empty = GithubGradeSuggestionEvaluator.evaluate_submission!(empty_sub, now: @now)
    assert_equal "no_suggestion", res_empty.outcome
    assert_equal "missing_required_check", res_empty.reason_code

    create_check_run(empty_sub, external_id: 7001, name: "ci", status: "completed", conclusion: "success")
    res_ci = GithubGradeSuggestionEvaluator.evaluate_submission!(empty_sub, now: @now)
    assert_equal "missing_required_check", res_ci.reason_code

    sub_112 = create_verified_submission(content_block: @other_block)
    create_check_run(sub_112, external_id: 7002, name: "prework/111.rb", status: "completed", conclusion: "success")
    res_112 = GithubGradeSuggestionEvaluator.evaluate_submission!(sub_112, now: @now)
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
      expected_workflow_path: WORKFLOW_PATH,
      created_by: @admin
    )

    sub = create_verified_submission
    create_check_run(sub, external_id: 7201, name: "prework/111.rb", status: "completed", conclusion: "success")
    assert_equal "missing_required_check", GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now).reason_code

    run2 = create_check_run(sub, external_id: 7202, name: "prework/111-edge.rb", status: "in_progress", conclusion: nil)
    assert_equal "check_pending", GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now).reason_code

    sub.github_check_runs.find_by!(external_id: 7201).update!(conclusion: "failure")
    run2.update!(status: "completed", conclusion: "skipped")
    assert_equal "check_inconclusive", GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now).reason_code

    run2.update!(conclusion: "success")
    res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
    assert_equal "review_for_redo", res.outcome
    assert_equal "required_check_failed", res.reason_code
    assert_nil res.suggested_grade

    sub.github_check_runs.find_by!(external_id: 7201).update!(conclusion: "success")
    res = GithubGradeSuggestionEvaluator.evaluate_submission!(sub, now: @now)
    assert_equal "suggest_b", res.outcome
    assert_equal "B", res.suggested_grade
    assert_equal "all_required_checks_passed", res.reason_code
  end

  test "sequential passing rerun replaces earlier failure, while newer pending reruns and overlapping dummy jobs fail closed" do
    # 1. Sequential passing rerun (started_at >= failed.completed_at) supersedes earlier failure -> suggest_b
    sequential_sub = create_verified_submission
    create_check_run(
      sequential_sub,
      external_id: 8001,
      name: "prework/111.rb",
      status: "completed",
      conclusion: "failure",
      started_at: @now - 10.minutes,
      completed_at: @now - 9.minutes
    )
    fresh = create_check_run(
      sequential_sub,
      external_id: 8002,
      name: "prework/111.rb",
      status: "completed",
      conclusion: "success",
      started_at: @now - 3.minutes,
      completed_at: @now - 2.minutes
    )
    res_seq = GithubGradeSuggestionEvaluator.evaluate_submission!(sequential_sub, now: @now)
    assert_equal "suggest_b", res_seq.outcome
    assert_equal [ fresh.external_id ], res_seq.evidence.fetch("runs").map { |r| r.fetch("external_id") }

    # 2a. Newer in_progress rerun after prior success -> check_pending (never suggest_b while running!)
    create_check_run(
      sequential_sub,
      external_id: 8003,
      name: "prework/111.rb",
      status: "in_progress",
      conclusion: nil,
      started_at: @now - 1.minute,
      completed_at: nil
    )
    res_in_progress = GithubGradeSuggestionEvaluator.evaluate_submission!(sequential_sub, now: @now)
    assert_equal "no_suggestion", res_in_progress.outcome
    assert_equal "check_pending", res_in_progress.reason_code

    # 2b. Newer queued rerun under clock skew (started_at: nil, fetched_at older than completed_at, higher external_id) -> check_pending
    skew_sub = create_verified_submission
    create_check_run(
      skew_sub,
      external_id: 8010,
      name: "prework/111.rb",
      status: "completed",
      conclusion: "success",
      started_at: @now - 5.minutes,
      completed_at: @now + 10.seconds,
      fetched_at: @now
    )
    create_check_run(
      skew_sub,
      external_id: 8011,
      name: "prework/111.rb",
      status: "queued",
      conclusion: nil,
      started_at: nil,
      completed_at: nil,
      fetched_at: @now - 1.second
    )
    res_skew = GithubGradeSuggestionEvaluator.evaluate_submission!(skew_sub, now: @now)
    assert_equal "no_suggestion", res_skew.outcome
    assert_equal "check_pending", res_skew.reason_code

    # 2c. Overlapping concurrent dummy passing job alongside failing real job -> review_for_redo (fail closed!)
    overlap_sub = create_verified_submission
    create_check_run(
      overlap_sub,
      external_id: 8020,
      name: "prework/111.rb",
      status: "completed",
      conclusion: "failure",
      started_at: @now - 5.minutes,
      completed_at: @now - 1.minute
    )
    create_check_run(
      overlap_sub,
      external_id: 8021,
      name: "prework/111.rb",
      status: "completed",
      conclusion: "success",
      started_at: @now - 4.minutes,
      completed_at: @now - 30.seconds
    )
    res_overlap = GithubGradeSuggestionEvaluator.evaluate_submission!(overlap_sub, now: @now)
    assert_equal "review_for_redo", res_overlap.outcome
    assert_nil res_overlap.suggested_grade
    assert_equal "required_check_failed", res_overlap.reason_code

    # 2d. Overlapping concurrent dummy passing job alongside skipped real job -> check_inconclusive (fail closed!)
    overlap_skip_sub = create_verified_submission
    create_check_run(
      overlap_skip_sub,
      external_id: 8030,
      name: "prework/111.rb",
      status: "completed",
      conclusion: "skipped",
      started_at: @now - 5.minutes,
      completed_at: @now - 1.minute
    )
    create_check_run(
      overlap_skip_sub,
      external_id: 8031,
      name: "prework/111.rb",
      status: "completed",
      conclusion: "success",
      started_at: @now - 4.minutes,
      completed_at: @now - 30.seconds
    )
    res_overlap_skip = GithubGradeSuggestionEvaluator.evaluate_submission!(overlap_skip_sub, now: @now)
    assert_equal "no_suggestion", res_overlap_skip.outcome
    assert_equal "check_inconclusive", res_overlap_skip.reason_code
  end

  test "re-evaluation clears prior human decision and archives it in evidence on material change while preserving unchanged decisions" do
    submission = create_verified_submission
    run = create_check_run(submission, external_id: 8050, name: "prework/111.rb", status: "completed", conclusion: "success")
    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now)

    decided_time = @now + 5.minutes
    suggestion.update!(
      decision: "overridden",
      override_reason: "Gave A for extra polish",
      decided_by: @admin,
      decided_at: decided_time
    )

    # Re-evaluating with identical outcome/policy/SHA preserves the human decision.
    unchanged = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now + 6.minutes)
    assert_equal "overridden", unchanged.decision
    assert_equal "Gave A for extra polish", unchanged.override_reason
    assert_equal @admin.id, unchanged.decided_by_id
    assert_equal decided_time, unchanged.decided_at

    # Material outcome change clears human decision attribution and archives prior_decision in evidence.
    run.update!(conclusion: "failure")
    changed = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: @now + 10.minutes)
    assert_equal "review_for_redo", changed.outcome
    assert_nil changed.decision
    assert_nil changed.override_reason
    assert_nil changed.decided_by_id
    assert_nil changed.decided_at
    prior = changed.evidence.fetch("prior_decision")
    assert_equal "overridden", prior.fetch("decision")
    assert_equal "Gave A for extra polish", prior.fetch("override_reason")
    assert_equal @admin.id, prior.fetch("decided_by_id")
    assert_equal "suggest_b", prior.fetch("prior_outcome")
    assert_equal "B", prior.fetch("prior_suggested_grade")
  end

  test "stale SHA, superseded submission, and policy version staleness are flagged as stale_evidence" do
    stale_sha_sub = create_verified_submission(commit_sha: SHA_TWO)
    create_check_run(stale_sha_sub, external_id: 8101, name: "prework/111.rb", head_sha: SHA_ONE, status: "completed", conclusion: "success")
    res_sha = GithubGradeSuggestionEvaluator.evaluate_submission!(stale_sha_sub, now: @now)
    assert_equal "stale_evidence", res_sha.outcome
    assert_nil res_sha.suggested_grade
    assert_equal "stale_sha", res_sha.reason_code

    newer = create_verified_submission(commit_sha: SHA_TWO)
    create_check_run(stale_sha_sub, external_id: 8102, name: "prework/111.rb", head_sha: SHA_TWO, status: "completed", conclusion: "success")
    res_sup = GithubGradeSuggestionEvaluator.evaluate_submission!(stale_sha_sub, now: @now)
    assert_equal "stale_evidence", res_sup.outcome
    assert_equal "superseded_submission", res_sup.reason_code
    assert_equal newer.id, res_sup.evidence.fetch("latest_submission_id")

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
      expected_workflow_path: WORKFLOW_PATH,
      created_by: @admin
    )

    assert_equal true, v1_suggestion.reload.stale_policy?

    archived_result = GithubGradeSuggestionEvaluator.evaluate_submission!(newer, now: @now, policy: @policy.reload)
    assert_equal "stale_evidence", archived_result.outcome
    assert_equal "stale_policy", archived_result.reason_code

    v2_result = GithubGradeSuggestionEvaluator.evaluate_submission!(newer, now: @now)
    assert_equal v2_policy.id, v2_result.exercise_check_policy_id
    assert_equal 2, v2_result.policy_version
    assert_equal "no_suggestion", v2_result.outcome
    assert_equal "missing_required_check", v2_result.reason_code
    assert_equal false, v2_result.stale_policy?
  end

  test "GithubCheckRunSyncService hooks evaluation after check-run commit, isolates evaluator errors, and skips Off cohorts" do
    submission = create_verified_submission(
      commit_sha: SHA_ONE,
      repo_url: "https://github.com/eval-student/prework"
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

    # Post-commit evaluator failure is isolated and still returns the committed check runs cleanly.
    original_eval = GithubGradeSuggestionEvaluator.method(:evaluate_submission!)
    begin
      GithubGradeSuggestionEvaluator.define_singleton_method(:evaluate_submission!) { |*| raise StandardError, "boom" }
      isolated = GithubCheckRunSyncService.new(submission: submission, token: nil, now: @now, app_client: fake_client).call
      assert_nil isolated[:error]
      assert_equal 1, isolated[:check_runs].size
      assert_nil isolated[:grade_suggestion]
    ensure
      GithubGradeSuggestionEvaluator.define_singleton_method(:evaluate_submission!, original_eval)
    end

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

  def create_verified_submission(content_block: @block, commit_sha: SHA_ONE, branch: "main", repo_url: "https://github.com/eval-student/prework",
    include_workflow_files: true, revision_overrides: {})
    revision = {
      "version" => 1,
      "binding_id" => @binding.id,
      "repository_id" => @binding.repository_id,
      "repository_full_name" => @binding.full_name,
      "paths" => [ content_block.filename || "111.rb" ],
      "content_digest" => Digest::SHA256.hexdigest("puts 1"),
      "source_bytes" => 6,
      "captured_at" => @now.iso8601(6)
    }
    if include_workflow_files
      revision["workflow_files"] = {
        WORKFLOW_PATH => { "present" => true, "oid" => WORKFLOW_OID, "sha256" => WORKFLOW_SHA256 }
      }
    end
    revision = revision.merge(revision_overrides)

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
    app_slug: "github-actions", workflow_name: "GitHub Actions", check_suite_id: nil, started_at: @now - 2.minutes, completed_at: @now - 1.minute, fetched_at: @now)
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
      fetched_at: fetched_at
    )
  end

  def capture_sql_queries
    queries = []
    callback = ->(*, payload) { queries << payload[:sql] unless %w[SCHEMA TRANSACTION].include?(payload[:name]) }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { yield }
    queries
  end
end
