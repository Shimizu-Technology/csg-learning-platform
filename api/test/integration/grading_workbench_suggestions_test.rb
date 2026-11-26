require "test_helper"
require_relative "../support/query_counter"

class GradingWorkbenchSuggestionsTest < ActionDispatch::IntegrationTest
  include QueryCounter

  SHA_ONE = "a" * 40
  SHA_TWO = "b" * 40
  WORKFLOW_PATH = ".github/workflows/prework-checks.yml".freeze

  setup do
    @now = Time.current
    @curriculum = Curriculum.create!(name: "X6.7 Workbench Curriculum")
    @mod = @curriculum.modules.create!(name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = @mod.lessons.create!(title: "Day 1", position: 0, release_day: 0, requires_submission: true)
    @exercise_1 = @lesson.content_blocks.create!(
      block_type: :exercise, position: 0, title: "Ex 111", filename: "111.rb", submission_type: :prework_github_sync
    )
    @exercise_2 = @lesson.content_blocks.create!(
      block_type: :exercise, position: 1, title: "Ex 112", filename: "112.rb", submission_type: :prework_github_sync
    )

    @admin = User.create!(clerk_id: "x67_admin", email: "x67-admin@example.invalid", first_name: "Ada", last_name: "Admin", role: :admin)
    @instructor = User.create!(clerk_id: "x67_inst", email: "x67-inst@example.invalid", first_name: "Ina", last_name: "Teach", role: :instructor)
    @student = User.create!(clerk_id: "x67_student", email: "x67-student@example.invalid", first_name: "Stu", last_name: "Learner", role: :student, github_username: "stu-learner")
    @student.record_verified_github_identity!(id: 99_001, login: "stu-learner")

    SchoolSetting.current.update!(features: { "github_app" => true, "github_grade_suggestions" => true })

    @opted_in_cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Opted In Workbench Cohort",
      start_date: Date.current - 7.days,
      status: :active,
      settings: { "features" => { "github_app" => true, "github_grade_suggestions" => true } }
    )
    @off_cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Cohort 3 Off Parity",
      start_date: Date.current - 30.days,
      status: :active,
      settings: { "features" => { "student_experience_v2" => false } }
    )

    @opted_in_cohort.cohort_instructor_assignments.create!(user: @instructor)
    @off_cohort.cohort_instructor_assignments.create!(user: @instructor)

    @enrollment = Enrollment.create!(user: @student, cohort: @opted_in_cohort, status: :active)
    @off_enrollment = Enrollment.create!(user: @student, cohort: @off_cohort, status: :active)

    @installation = GithubAppInstallation.create!(
      cohort: @opted_in_cohort,
      app_id: 12_345,
      installation_id: 61_001,
      account_login: "stu-learner",
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
      repository_id: 88_888,
      full_name: "stu-learner/prework",
      github_username: "stu-learner",
      github_user_id: "99001",
      verification_state: "verified",
      verified_at: @now
    )

    @policy = ExerciseCheckPolicy.create_version!(
      content_block: @exercise_1,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      created_by: @admin
    )
  end

  test "staff sees grade_suggestion for opted-in cohort, students never see it, and Off cohort (Cohort 3) omits it completely" do
    opt_in_sub = create_verified_submission(@enrollment, @exercise_1, sha: SHA_ONE)
    opt_in_sub.github_check_runs.create!(
      external_id: 1001, name: "prework/111.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(opt_in_sub)
    assert_equal "suggest_b", suggestion.outcome

    # Off cohort submission (even if a historical suggestion row exists in DB, Off gate MUST omit it!)
    off_sub = create_verified_submission(@off_enrollment, @exercise_1, sha: SHA_ONE)
    SubmissionGradeSuggestion.create!(
      submission: off_sub,
      enrollment: @off_enrollment,
      content_block: @exercise_1,
      exercise_check_policy: @policy,
      policy_version: @policy.version,
      commit_sha: SHA_ONE,
      outcome: "suggest_b",
      suggested_grade: "B",
      reason_code: "all_required_checks_passed",
      reason_summary: "Historical row that must stay hidden on Off cohort.",
      evidence: {},
      evaluated_at: @now
    )

    # 1. Student detail & list NEVER include grade_suggestion (even on opted-in cohort).
    as_user(@student) { get "/api/v1/submissions/#{opt_in_sub.id}", headers: auth_headers }
    assert_response :success
    assert_not response.parsed_body.fetch("submission").key?("grade_suggestion")

    as_user(@student) { get "/api/v1/submissions", headers: auth_headers }
    assert_response :success
    response.parsed_body.fetch("submissions").each do |row|
      assert_not row.key?("grade_suggestion"), "student submission list must never expose grade_suggestion"
    end

    # 2. Staff sees grade_suggestion on opted-in submission detail, list, and grading_queue.
    as_user(@instructor) { get "/api/v1/submissions/#{opt_in_sub.id}", headers: auth_headers }
    assert_response :success
    detail_suggestion = response.parsed_body.dig("submission", "grade_suggestion")
    assert_equal "suggest_b", detail_suggestion.fetch("outcome")
    assert_equal "B", detail_suggestion.fetch("suggested_grade")
    assert_equal false, detail_suggestion.fetch("stale")
    assert_equal false, detail_suggestion.fetch("stale_for_current_policy")

    as_user(@instructor) { get "/api/v1/grading_queue", params: { cohort_id: @opted_in_cohort.id }, headers: auth_headers }
    assert_response :success
    queue_item = response.parsed_body.fetch("submissions").find { |row| row.fetch("id") == opt_in_sub.id }
    assert_equal "suggest_b", queue_item.dig("grade_suggestion", "outcome")
    assert_equal false, queue_item.dig("grade_suggestion", "stale")

    # 3. Off cohort (Cohort 3 shape) completely omits grade_suggestion on detail, list, queue, and grade save.
    as_user(@instructor) { get "/api/v1/submissions/#{off_sub.id}", headers: auth_headers }
    assert_response :success
    assert_not response.parsed_body.fetch("submission").key?("grade_suggestion")

    as_user(@instructor) { get "/api/v1/grading_queue", params: { cohort_id: @off_cohort.id }, headers: auth_headers }
    assert_response :success
    off_queue_item = response.parsed_body.fetch("submissions").find { |row| row.fetch("id") == off_sub.id }
    assert_not off_queue_item.key?("grade_suggestion")

    as_user(@instructor) do
      patch "/api/v1/submissions/#{off_sub.id}/grade",
        params: { grade: "A", feedback: "Nice", base_submission_updated_at: off_sub.updated_at.iso8601(6), suggestion_override_reason: "Should be ignored" },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_not response.parsed_body.fetch("submission").key?("grade_suggestion")
    assert_nil off_sub.submission_grade_suggestion.reload.decision
  end

  test "PATCH /grade persists accepted, overridden (with trimmed reason), and dismissed decisions across suggest_b and review_for_redo" do
    # suggest_b -> grade B => accepted, override_reason nil
    sub_accept_b = create_verified_submission(@enrollment, @exercise_1, sha: SHA_ONE)
    sub_accept_b.github_check_runs.create!(
      external_id: 2001, name: "prework/111.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    GithubGradeSuggestionEvaluator.evaluate_submission!(sub_accept_b)

    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub_accept_b.id}/grade",
        params: {
          grade: "B",
          feedback: "Looks good",
          base_submission_updated_at: sub_accept_b.updated_at.iso8601(6),
          suggestion_override_reason: "Ignored when accepted"
        },
        headers: auth_headers, as: :json
    end
    assert_response :success
    s = response.parsed_body.dig("submission", "grade_suggestion")
    assert_equal "accepted", s.fetch("decision")
    assert_nil s.fetch("override_reason")
    assert_equal @instructor.id, s.fetch("decided_by_id")
    assert s.fetch("decided_at").present?

    # suggest_b -> grade A with override reason => overridden + trimmed reason
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub_accept_b.id}/grade",
        params: {
          grade: "A",
          feedback: "Exceeds expectations",
          base_submission_updated_at: sub_accept_b.reload.updated_at.iso8601(6),
          suggestion_override_reason: "   Clean helper decomposition   "
        },
        headers: auth_headers, as: :json
    end
    assert_response :success
    s = response.parsed_body.dig("submission", "grade_suggestion")
    assert_equal "overridden", s.fetch("decision")
    assert_equal "Clean helper decomposition", s.fetch("override_reason")

    # suggest_b -> grade R => overridden ("Checks passed · Grade R")
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub_accept_b.id}/grade",
        params: {
          grade: "R",
          feedback: "Avoid hardcoding the expected output.",
          base_submission_updated_at: sub_accept_b.reload.updated_at.iso8601(6),
          suggestion_override_reason: "Hardcoded test outputs"
        },
        headers: auth_headers, as: :json
    end
    assert_response :success
    s = response.parsed_body.dig("submission", "grade_suggestion")
    assert_equal "R", response.parsed_body.dig("submission", "grade")
    assert_equal "overridden", s.fetch("decision")
    assert_equal "Hardcoded test outputs", s.fetch("override_reason")

    # review_for_redo -> grade R => accepted; grade B => overridden; explicit dismissed => dismissed
    ExerciseCheckPolicy.create_version!(
      content_block: @exercise_2,
      required_checks: [ "prework/112.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      created_by: @admin
    )
    sub_redo = create_verified_submission(@enrollment, @exercise_2, sha: SHA_ONE)
    sub_redo.github_check_runs.create!(
      external_id: 2002, name: "prework/112.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "failure", fetched_at: @now
    )
    assert_equal "review_for_redo", GithubGradeSuggestionEvaluator.evaluate_submission!(sub_redo).outcome

    # Redo feedback is STILL strictly required even when accepting review_for_redo!
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub_redo.id}/grade",
        params: { grade: "R", feedback: "   ", base_submission_updated_at: sub_redo.updated_at.iso8601(6) },
        headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_nil sub_redo.reload.grade
    assert_nil sub_redo.submission_grade_suggestion.reload.decision

    # Accept review_for_redo with written feedback
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub_redo.id}/grade",
        params: { grade: "R", feedback: "Handle negative numbers too.", base_submission_updated_at: sub_redo.updated_at.iso8601(6) },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "accepted", response.parsed_body.dig("submission", "grade_suggestion", "decision")
    assert_nil response.parsed_body.dig("submission", "grade_suggestion", "override_reason")

    # Override review_for_redo with B
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub_redo.id}/grade",
        params: {
          grade: "B",
          feedback: "Runner flaked; verified locally.",
          base_submission_updated_at: sub_redo.reload.updated_at.iso8601(6),
          suggestion_override_reason: "CI flake verified locally"
        },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "overridden", response.parsed_body.dig("submission", "grade_suggestion", "decision")
    assert_equal "CI flake verified locally", response.parsed_body.dig("submission", "grade_suggestion", "override_reason")

    # Explicit dismissed decision
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub_redo.id}/grade",
        params: {
          grade: "C",
          feedback: "Passing with minor issues.",
          base_submission_updated_at: sub_redo.reload.updated_at.iso8601(6),
          suggestion_decision: "dismissed",
          suggestion_override_reason: "Old check harness"
        },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "dismissed", response.parsed_body.dig("submission", "grade_suggestion", "decision")
    assert_equal "Old check harness", response.parsed_body.dig("submission", "grade_suggestion", "override_reason")
  end

  test "saving Pass on a Pass / Redo curriculum records accepting its suggest_pass suggestion" do
    @curriculum.update!(grading_scale: "pass_redo")
    sub = create_verified_submission(@enrollment, @exercise_1, sha: SHA_ONE)
    sub.github_check_runs.create!(external_id: 2101, name: "prework/111.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now)
    assert_equal "suggest_pass", GithubGradeSuggestionEvaluator.evaluate_submission!(sub).outcome

    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade", params: { grade: "P", feedback: "Nice", base_submission_updated_at: sub.updated_at.iso8601(6) },
        headers: auth_headers, as: :json
    end
    assert_response :success
    suggestion = response.parsed_body.dig("submission", "grade_suggestion")
    assert_equal [ "suggest_pass", "P", "accepted", false ], suggestion.values_at("outcome", "suggested_grade", "decision", "stale")
    assert_equal "accepted", sub.submission_grade_suggestion.reload.decision
  end

  test "a suggestion off the curriculum's new scale is out of date everywhere and never counts as an override" do
    sub = create_verified_submission(@enrollment, @exercise_1, sha: SHA_ONE)
    sub.github_check_runs.create!(external_id: 2201, name: "prework/111.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now)
    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(sub)
    assert_equal "suggest_b", suggestion.outcome
    refute suggestion.off_scale?

    @curriculum.update!(grading_scale: "pass_redo")
    assert suggestion.reload.off_scale?
    assert suggestion.stale_for?(grading_scale: "pass_redo")
    assert suggestion.to_staff_json(grading_scale: "pass_redo")[:stale]

    as_user(@instructor) { get "/api/v1/submissions/#{sub.id}", headers: auth_headers }
    assert_response :success
    assert_equal [ "suggest_b", true ], response.parsed_body.dig("submission", "grade_suggestion").values_at("outcome", "stale")

    queue = ->(outcome) do
      as_user(@instructor) { get "/api/v1/grading_queue", params: { cohort_id: @opted_in_cohort.id, suggestion_outcome: outcome }, headers: auth_headers }
      assert_response :success
      response.parsed_body.fetch("submissions").map { |item| item["id"] }
    end
    assert_not_includes queue.call("suggest_b"), sub.id, "B suggested no longer lists it on Pass / Redo"
    assert_includes queue.call("stale_evidence"), sub.id, "it shows as Out of date instead"
    as_user(@instructor) { get "/api/v1/grading_queue", params: { cohort_id: @opted_in_cohort.id }, headers: auth_headers }
    item = response.parsed_body.fetch("submissions").find { |row| row["id"] == sub.id }
    assert_equal true, item.dig("grade_suggestion", "stale")

    # Saving Pass is not an override of the old B suggestion, and claiming one is refused.
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade", params: { grade: "P", feedback: "Nice", base_submission_updated_at: sub.reload.updated_at.iso8601(6), suggestion_decision: "overridden" },
        headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade", params: { grade: "P", feedback: "Nice", base_submission_updated_at: sub.reload.updated_at.iso8601(6) },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_nil sub.submission_grade_suggestion.reload.decision

    # A fresh check run on the new scale suggests Pass again.
    sub.update_columns(grade: nil)
    assert_equal "suggest_pass", GithubGradeSuggestionEvaluator.evaluate_submission!(sub.reload).outcome
    refute sub.submission_grade_suggestion.reload.off_scale?
  end

  test "PATCH /grade rejects invalid suggestion_decision and override_reason before any write and preserves stale-tab protection" do
    sub = create_verified_submission(@enrollment, @exercise_1, sha: SHA_ONE)
    sub.github_check_runs.create!(
      external_id: 3001, name: "prework/111.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(sub)
    opened_at = sub.updated_at.iso8601(6)

    invalid_payloads = [
      { suggestion_decision: "bogus" },
      { suggestion_decision: 123 },
      { suggestion_override_reason: "Line1\nLine2" },
      { suggestion_override_reason: "\r" },
      { suggestion_override_reason: "null\u0000byte" },
      { suggestion_override_reason: "a" * 501 },
      { suggestion_override_reason: [ "not a string" ] }
    ]

    invalid_payloads.each do |extra|
      as_user(@instructor) do
        patch "/api/v1/submissions/#{sub.id}/grade",
          params: { grade: "A", feedback: "Good", base_submission_updated_at: opened_at }.merge(extra),
          headers: auth_headers, as: :json
      end
      assert_response :unprocessable_entity, "expected 422 for #{extra.inspect}"
      assert_nil sub.reload.grade
      assert_nil suggestion.reload.decision
    end

    # Two-grader stale updated_at conflict must NOT overwrite suggestion decision!
    as_user(@admin) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "B", feedback: "First grader", base_submission_updated_at: opened_at },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "accepted", suggestion.reload.decision

    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: {
          grade: "A",
          feedback: "Stale second grader",
          base_submission_updated_at: opened_at,
          suggestion_override_reason: "Stale override"
        },
        headers: auth_headers, as: :json
    end
    assert_response :conflict
    assert_equal "stale_submission", response.parsed_body.fetch("code")
    assert_equal "B", sub.reload.grade
    assert_equal "accepted", suggestion.reload.decision
    assert_nil suggestion.override_reason
  end

  test "grading_queue filters by suggestion_outcome without leaking Off cohorts or superseded attempts, and marks stale policy" do
    sub_b = create_verified_submission(@enrollment, @exercise_1, sha: SHA_ONE)
    sub_b.github_check_runs.create!(
      external_id: 4001, name: "prework/111.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    GithubGradeSuggestionEvaluator.evaluate_submission!(sub_b)

    # Newer attempt on @exercise_1 supersedes sub_b and has review_for_redo
    sub_latest_redo = create_verified_submission(@enrollment, @exercise_1, sha: SHA_TWO, num_submissions: 2, created_at: @now + 1.minute)
    sub_latest_redo.github_check_runs.create!(
      external_id: 4002, name: "prework/111.rb", app_slug: "github-actions",
      head_sha: SHA_TWO, status: "completed", conclusion: "failure", fetched_at: @now + 1.minute
    )
    GithubGradeSuggestionEvaluator.evaluate_submission!(sub_latest_redo)

    # Exercise 2 has suggest_b as latest attempt
    ExerciseCheckPolicy.create_version!(
      content_block: @exercise_2, required_checks: [ "prework/112.rb" ], allowed_app_slugs: [ "github-actions" ], created_by: @admin
    )
    sub_ex2_b = create_verified_submission(@enrollment, @exercise_2, sha: SHA_ONE)
    sub_ex2_b.github_check_runs.create!(
      external_id: 4003, name: "prework/112.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    GithubGradeSuggestionEvaluator.evaluate_submission!(sub_ex2_b)

    # Filtering waiting queue by suggest_b returns ONLY sub_ex2_b (NOT superseded sub_b!)
    as_user(@instructor) do
      get "/api/v1/grading_queue",
        params: { cohort_id: @opted_in_cohort.id, filter: "ungraded", suggestion_outcome: "suggest_b" },
        headers: auth_headers
    end
    assert_response :success
    assert_equal [ sub_ex2_b.id ], response.parsed_body.fetch("submissions").map { |row| row.fetch("id") }

    # Filtering waiting queue by review_for_redo returns ONLY sub_latest_redo
    as_user(@instructor) do
      get "/api/v1/grading_queue",
        params: { cohort_id: @opted_in_cohort.id, filter: "ungraded", suggestion_outcome: "review_for_redo" },
        headers: auth_headers
    end
    assert_response :success
    assert_equal [ sub_latest_redo.id ], response.parsed_body.fetch("submissions").map { |row| row.fetch("id") }

    # Updating @exercise_2's policy marks sub_ex2_b's suggestion stale_for_current_policy & stale = true
    ExerciseCheckPolicy.create_version!(
      content_block: @exercise_2, required_checks: [ "prework/112.rb", "prework/112-extra.rb" ], allowed_app_slugs: [ "github-actions" ], created_by: @admin
    )
    as_user(@instructor) do
      get "/api/v1/grading_queue", params: { cohort_id: @opted_in_cohort.id, filter: "ungraded" }, headers: auth_headers
    end
    assert_response :success
    ex2_row = response.parsed_body.fetch("submissions").find { |row| row.fetch("id") == sub_ex2_b.id }
    assert_equal true, ex2_row.dig("grade_suggestion", "stale_for_current_policy")
    assert_equal true, ex2_row.dig("grade_suggestion", "stale")
  end

  test "grading_queue and submissions index execute flat O(1) queries with grade suggestions (zero N+1)" do
    queue_counts = []
    index_counts = []

    [ 1, 5 ].each do |target|
      while Submission.where(enrollment: @enrollment).count < target
        idx = Submission.where(enrollment: @enrollment).count + 1
        block = @lesson.content_blocks.create!(
          block_type: :exercise, position: 10 + idx, title: "Query Ex #{idx}", filename: "q#{idx}.rb", submission_type: :prework_github_sync
        )
        ExerciseCheckPolicy.create_version!(
          content_block: block, required_checks: [ "prework/q#{idx}.rb" ], allowed_app_slugs: [ "github-actions" ], created_by: @admin
        )
        sub = create_verified_submission(@enrollment, block, sha: SHA_ONE)
        sub.github_check_runs.create!(
          external_id: 5000 + idx, name: "prework/q#{idx}.rb", app_slug: "github-actions",
          head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
        )
        GithubGradeSuggestionEvaluator.evaluate_submission!(sub)
      end

      # Warm caches
      as_user(@instructor) { get "/api/v1/grading_queue", params: { cohort_id: @opted_in_cohort.id }, headers: auth_headers }
      assert_response :success
      queue_counts << count_queries do
        as_user(@instructor) { get "/api/v1/grading_queue", params: { cohort_id: @opted_in_cohort.id }, headers: auth_headers }
      end
      assert_response :success
      assert_equal target, response.parsed_body.fetch("submissions").count { |row| row["grade_suggestion"].present? }

      as_user(@instructor) { get "/api/v1/submissions", params: { cohort_id: @opted_in_cohort.id }, headers: auth_headers }
      assert_response :success
      index_counts << count_queries do
        as_user(@instructor) { get "/api/v1/submissions", params: { cohort_id: @opted_in_cohort.id }, headers: auth_headers }
      end
      assert_response :success
      assert_equal target, response.parsed_body.fetch("submissions").count { |row| row["grade_suggestion"].present? }
    end

    assert_equal queue_counts.first, queue_counts.last, "GET /grading_queue grew queries: #{queue_counts.inspect}"
    assert_equal index_counts.first, index_counts.last, "GET /submissions grew queries: #{index_counts.inspect}"
  end

  test "grading a stale suggestion archives prior decision, does not record accepted/overridden, and rejects contradicting suggestion_decision" do
    sub = create_verified_submission(@enrollment, @exercise_1, sha: SHA_ONE)
    sub.github_check_runs.create!(
      external_id: 6001, name: "prework/111.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(sub)
    assert_equal "suggest_b", suggestion.outcome

    # Reject contradicting suggestion_decision before any write (accept on grade A, override on grade B)
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "A", feedback: "Great", base_submission_updated_at: sub.updated_at.iso8601(6), suggestion_decision: "accepted" },
        headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_nil sub.reload.grade
    assert_nil suggestion.reload.decision

    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "B", feedback: "Solid", base_submission_updated_at: sub.updated_at.iso8601(6), suggestion_decision: "overridden" },
        headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_nil sub.reload.grade
    assert_nil suggestion.reload.decision

    # Override cleanly with reason, then verify mobile re-grade (omitting suggestion_override_reason) preserves it
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "A", feedback: "Great", base_submission_updated_at: sub.updated_at.iso8601(6), suggestion_override_reason: "Clean design" },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "Clean design", suggestion.reload.override_reason

    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "C", feedback: "Adjusted on mobile", base_submission_updated_at: sub.reload.updated_at.iso8601(6) },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "overridden", suggestion.reload.decision
    assert_equal "Clean design", suggestion.override_reason

    # Explicitly sending empty string clears saved override_reason
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "C", feedback: "Cleared note", base_submission_updated_at: sub.reload.updated_at.iso8601(6), suggestion_override_reason: "" },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_nil suggestion.reload.override_reason

    # Re-record an override before policy changes, then bump policy to v2 -> suggestion goes stale
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "A", feedback: "Before stale", base_submission_updated_at: sub.reload.updated_at.iso8601(6), suggestion_override_reason: "Prior v1 note" },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "overridden", suggestion.reload.decision

    ExerciseCheckPolicy.create_version!(
      content_block: @exercise_1, required_checks: [ "prework/111.rb", "prework/111-v2.rb" ], allowed_app_slugs: [ "github-actions" ], created_by: @admin
    )

    # Reject accepted/overridden on stale suggestion
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "B", feedback: "Should reject", base_submission_updated_at: sub.reload.updated_at.iso8601(6), suggestion_decision: "accepted" },
        headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal "A", sub.reload.grade

    # Ordinary grade save on stale suggestion archives prior decision and clears active decision fields
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "B", feedback: "Graded while stale", base_submission_updated_at: sub.reload.updated_at.iso8601(6) },
        headers: auth_headers, as: :json
    end
    assert_response :success
    suggestion.reload
    assert_nil suggestion.decision
    assert_nil suggestion.override_reason
    assert_nil suggestion.decided_by_id
    assert_nil suggestion.decided_at
    assert_equal "overridden", suggestion.evidence.dig("prior_decision", "decision")
    assert_equal "Prior v1 note", suggestion.evidence.dig("prior_decision", "override_reason")

    # Explicit dismissed still records dismissed on a stale suggestion
    as_user(@instructor) do
      patch "/api/v1/submissions/#{sub.id}/grade",
        params: { grade: "B", feedback: "Dismissed stale", base_submission_updated_at: sub.reload.updated_at.iso8601(6), suggestion_decision: "dismissed" },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "dismissed", suggestion.reload.decision
  end

  test "grading_queue suggestion_outcome aligns SQL freshness for policy-bumped, deactivated-policy, SHA-stale, and superseded rows" do
    # 1. Policy-bumped stale row
    sub_policy_stale = create_verified_submission(@enrollment, @exercise_1, sha: SHA_ONE)
    sub_policy_stale.github_check_runs.create!(
      external_id: 7001, name: "prework/111.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    GithubGradeSuggestionEvaluator.evaluate_submission!(sub_policy_stale)
    ExerciseCheckPolicy.create_version!(
      content_block: @exercise_1, required_checks: [ "prework/111.rb", "prework/111-new.rb" ], allowed_app_slugs: [ "github-actions" ], created_by: @admin
    )

    # 2. Deactivated-policy stale row (tests SQL NULL three-valued logic)
    ExerciseCheckPolicy.create_version!(
      content_block: @exercise_2, required_checks: [ "prework/112.rb" ], allowed_app_slugs: [ "github-actions" ], created_by: @admin
    )
    sub_deactivated = create_verified_submission(@enrollment, @exercise_2, sha: SHA_ONE)
    sub_deactivated.github_check_runs.create!(
      external_id: 7002, name: "prework/112.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    GithubGradeSuggestionEvaluator.evaluate_submission!(sub_deactivated)
    ExerciseCheckPolicy.deactivate_active!(content_block: @exercise_2)

    # 3. SHA-mismatched stale row
    ex3 = @lesson.content_blocks.create!(block_type: :exercise, position: 3, title: "Ex 113", filename: "113.rb", submission_type: :prework_github_sync)
    ExerciseCheckPolicy.create_version!(
      content_block: ex3, required_checks: [ "prework/113.rb" ], allowed_app_slugs: [ "github-actions" ], created_by: @admin
    )
    sub_sha_stale = create_verified_submission(@enrollment, ex3, sha: SHA_ONE)
    sub_sha_stale.github_check_runs.create!(
      external_id: 7003, name: "prework/113.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    GithubGradeSuggestionEvaluator.evaluate_submission!(sub_sha_stale)
    sub_sha_stale.submission_grade_suggestion.update!(commit_sha: SHA_TWO)

    # 4. Fresh suggest_b row
    ex4 = @lesson.content_blocks.create!(block_type: :exercise, position: 4, title: "Ex 114", filename: "114.rb", submission_type: :prework_github_sync)
    ExerciseCheckPolicy.create_version!(
      content_block: ex4, required_checks: [ "prework/114.rb" ], allowed_app_slugs: [ "github-actions" ], created_by: @admin
    )
    sub_fresh = create_verified_submission(@enrollment, ex4, sha: SHA_ONE)
    sub_fresh.github_check_runs.create!(
      external_id: 7004, name: "prework/114.rb", app_slug: "github-actions",
      head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: @now
    )
    GithubGradeSuggestionEvaluator.evaluate_submission!(sub_fresh)

    # suggest_b filter returns ONLY sub_fresh
    as_user(@instructor) do
      get "/api/v1/grading_queue", params: { cohort_id: @opted_in_cohort.id, filter: "ungraded", suggestion_outcome: "suggest_b" }, headers: auth_headers
    end
    assert_response :success
    assert_equal [ sub_fresh.id ], response.parsed_body.fetch("submissions").map { |row| row.fetch("id") }

    # stale_evidence filter returns ALL THREE stale rows (policy bumped, deactivated, SHA mismatch)
    as_user(@instructor) do
      get "/api/v1/grading_queue", params: { cohort_id: @opted_in_cohort.id, filter: "ungraded", suggestion_outcome: "stale_evidence" }, headers: auth_headers
    end
    assert_response :success
    assert_equal [ sub_policy_stale.id, sub_deactivated.id, sub_sha_stale.id ].sort,
      response.parsed_body.fetch("submissions").map { |row| row.fetch("id") }.sort
  end

  test "instructor enrolled as a learner in a cohort they do not teach never sees grade_suggestion or staff fields on their own submission" do
    unassigned_instructor = User.create!(
      clerk_id: "x67_unassigned_inst", email: "x67-unassigned@example.invalid",
      first_name: "Ursa", last_name: "LearnerInst", role: :instructor, github_username: "ursa-inst"
    )
    unassigned_instructor.record_verified_github_identity!(id: 99_009, login: "ursa-inst")
    learner_enrollment = Enrollment.create!(user: unassigned_instructor, cohort: @opted_in_cohort, status: :active)
    sub = create_verified_submission(learner_enrollment, @exercise_1, sha: SHA_ONE)
    SubmissionGradeSuggestion.create!(
      submission: sub,
      enrollment: learner_enrollment,
      content_block: @exercise_1,
      exercise_check_policy: @policy,
      policy_version: @policy.version,
      commit_sha: SHA_ONE,
      outcome: "suggest_b",
      suggested_grade: "B",
      reason_code: "all_required_checks_passed",
      reason_summary: "Staff-only suggestion",
      evidence: {},
      evaluated_at: @now
    )

    as_user(unassigned_instructor) { get "/api/v1/submissions/#{sub.id}", headers: auth_headers }
    assert_response :success
    payload = response.parsed_body.fetch("submission")
    assert_not payload.key?("grade_suggestion")
    assert_not payload.key?("github_revision")
    assert_not payload.key?("solution")
  end

  test "FeatureSwitches.school(read_only: true) reuses SchoolSetting::RequestCache without extra school_settings queries" do
    SchoolSetting::RequestCache.enabled = true
    SchoolSetting::RequestCache.school_setting = SchoolSetting.current

    queries = []
    cb = ->(*, payload) { queries << payload[:sql] if payload[:sql].include?("school_settings") }
    ActiveSupport::Notifications.subscribed(cb, "sql.active_record") do
      features = FeatureSwitches.school(read_only: true)
      assert_equal true, features["github_grade_suggestions"]
    end
    assert_empty queries
  ensure
    SchoolSetting::RequestCache.reset
  end

  private

  def create_verified_submission(enrollment, block, sha:, num_submissions: 1, created_at: @now)
    Submission.create!(
      user: enrollment.user,
      enrollment: enrollment,
      content_block: block,
      submission_type: :prework_github_sync,
      text: "puts #{num_submissions}",
      commit_sha: sha,
      branch: "main",
      num_submissions: num_submissions,
      created_at: created_at,
      updated_at: created_at,
      github_revision: {
        "version" => 1,
        "binding_id" => @binding.id,
        "repository_id" => @binding.repository_id,
        "repository_full_name" => @binding.full_name,
        "paths" => [ block.filename || "111.rb" ],
        "content_digest" => Digest::SHA256.hexdigest("puts #{num_submissions}"),
        "source_bytes" => 6,
        "captured_at" => created_at.iso8601(6)
      }
    )
  end

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
