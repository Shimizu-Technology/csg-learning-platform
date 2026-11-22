require "test_helper"
require "digest"
require "openssl"
require_relative "../support/fake_github_app_client"

# Wave 3 X-6.10: End-to-end rehearsal integration test protecting the complete
# X-6.3 + X-6.4 + X-6.5 + X-6.6 + X-6.7 + X-6.8 + X-6.9 prework grader loop
# and verifying that Cohort 3 (Off) stays 100% untouched.
class X6ActualizeDemoRehearsalTest < ActionDispatch::IntegrationTest
  WEBHOOK_PATH = "/api/v1/webhooks/github".freeze
  WEBHOOK_SECRET = "synthetic-x6-demo-rehearsal-secret".freeze
  WORKFLOW_PATH = ".github/workflows/prework-checks.yml".freeze
  WORKFLOW_YAML = "name: Synthetic Prework Checks\non: [push]\n".freeze
  WORKFLOW_SHA256 = Digest::SHA256.hexdigest(WORKFLOW_YAML).freeze

  SHA_PROGRAM_1 = "1111111111111111111111111111111111110001".freeze
  SHA_BEHIND_1 = "2222222222222222222222222222222222220001".freeze
  SHA_BEHIND_2 = "2222222222222222222222222222222222220002".freeze
  SHA_BEHIND_EARLY = "2222222222222222222222222222222222220009".freeze
  SHA_STALE_OLD = "9999999999999999999999999999999999990001".freeze
  SHA_PAUSED_1 = "5555555555555555555555555555555555550001".freeze

  setup do
    @prev_webhook_secret = ENV["GITHUB_WEBHOOK_SECRET"]
    @prev_app_webhook_secret = ENV["GITHUB_APP_WEBHOOK_SECRET"]
    ENV["GITHUB_WEBHOOK_SECRET"] = WEBHOOK_SECRET
    ENV.delete("GITHUB_APP_WEBHOOK_SECRET")
    ApiRateLimits::STORE.clear

    @now = Time.current
    @admin = User.create!(clerk_id: "x610_admin", email: "x610-admin@example.invalid", first_name: "Ada", last_name: "Admin", role: :admin)
    @instructor = User.create!(clerk_id: "x610_inst", email: "x610-inst@example.invalid", first_name: "Ina", last_name: "Instructor", role: :instructor)
    @program_student = User.create!(clerk_id: "x610_prog", email: "x610-prog@example.invalid", first_name: "Pat", last_name: "Program", role: :student, github_username: "demo-program")
    @behind_student = User.create!(clerk_id: "x610_behind", email: "x610-behind@example.invalid", first_name: "Ben", last_name: "Behind", role: :student, github_username: "demo-behind")
    @paused_student = User.create!(clerk_id: "x610_paused", email: "x610-paused@example.invalid", first_name: "Pia", last_name: "Paused", role: :student, github_username: "demo-paused")
    @unrelated_student = User.create!(clerk_id: "x610_unrelated", email: "x610-unrelated@example.invalid", first_name: "Uma", last_name: "Unrelated", role: :student, github_username: "demo-unrelated")

    @program_student.record_verified_github_identity!(id: "51003", login: "demo-program")
    @behind_student.record_verified_github_identity!(id: "51004", login: "demo-behind")
    @paused_student.record_verified_github_identity!(id: "51005", login: "demo-paused")

    SchoolSetting.current.update!(
      features: {
        "github_sync" => true,
        "github_app" => true,
        "github_grade_suggestions" => true,
        "github_webhooks" => true,
        "github_reconciliation" => true,
        "github_issue_delivery_v2" => true,
        "student_experience_v2" => true
      }
    )

    @curriculum = Curriculum.create!(name: "Prework Demo — synthetic")
    @rubric = @curriculum.rubrics.create!(
      title: "Ruby Prework Clarity Rubric",
      rubric_criteria_attributes: [ { title: "Handles edge cases cleanly", description: "Guards nil/empty inputs", position: 0 } ]
    )
    @objective = @curriculum.learning_objectives.create!(
      code: "PREWORK-RUBY-1",
      title: "Write edge-case-safe Ruby methods",
      success_criteria: "Guards blank and empty inputs cleanly.",
      position: 0,
      active: true
    )

    @mod = @curriculum.modules.create!(name: "Prework Week 1", position: 0, day_offset: 0, module_type: :prework, schedule_days: "weekdays")
    @day1 = @mod.lessons.create!(title: "Day 1: Ruby Methods", position: 0, release_day: 0, required: true, requires_submission: true)
    @day2 = @mod.lessons.create!(title: "Day 2: Arrays", position: 0, release_day: 8, required: true, requires_submission: false)

    @ex111 = @day1.content_blocks.create!(
      block_type: :exercise, position: 0, title: "Greeting Badge (111.rb)", filename: "111.rb",
      submission_type: :prework_github_sync, rubric: @rubric, body: "Write greeting_badge(name)."
    )
    @ex112 = @day1.content_blocks.create!(
      block_type: :exercise, position: 1, title: "Score Summary (112.rb)", filename: "112.rb",
      submission_type: :prework_github_sync, rubric: @rubric, body: "Write score_summary(scores)."
    )
    @ex113 = @day1.content_blocks.create!(
      block_type: :exercise, position: 2, title: "Daily Streaks (113.rb)", filename: "113.rb",
      submission_type: :prework_github_sync, body: "Write daily_streaks(days)."
    )

    ObjectiveAlignment.create!(learning_objective: @objective, lesson: @day1, content_block: @ex111, position: 0)
    ObjectiveAlignment.create!(learning_objective: @objective, lesson: @day1, content_block: @ex112, position: 1)

    @policy_111 = ExerciseCheckPolicy.create_version!(
      content_block: @ex111, required_checks: [ "prework/111.rb" ], allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main", expected_workflow_path: WORKFLOW_PATH, expected_workflow_sha: WORKFLOW_SHA256, created_by: @admin
    )
    @policy_112 = ExerciseCheckPolicy.create_version!(
      content_block: @ex112, required_checks: [ "prework/112.rb" ], allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main", expected_workflow_path: WORKFLOW_PATH, expected_workflow_sha: WORKFLOW_SHA256, created_by: @admin
    )

    @cohort = Cohort.create!(
      name: "Prework Demo — synthetic",
      curriculum: @curriculum,
      start_date: LearningCalendar.today - 7,
      status: :active,
      course_delivery: "program",
      repository_name: "prework-exercises",
      settings: {
        "features" => {
          "github_sync" => true,
          "github_app" => true,
          "github_grade_suggestions" => true,
          "github_webhooks" => true,
          "github_reconciliation" => true,
          "github_issue_delivery_v2" => true,
          "student_experience_v2" => true
        },
        "module_github_config" => {
          @mod.id.to_s => { "requires_github" => true, "repository_name" => "prework-exercises" }
        }
      }
    )
    @cohort.instructors << @instructor

    @program_enrollment = Enrollment.create!(user: @program_student, cohort: @cohort, status: :active)
    @program_enrollment.assign_cohort_content_defaults!
    @behind_enrollment = Enrollment.create!(user: @behind_student, cohort: @cohort, status: :active)
    @behind_enrollment.assign_cohort_content_defaults!
    @paused_enrollment = Enrollment.create!(user: @paused_student, cohort: @cohort, status: :active)
    @paused_enrollment.assign_cohort_content_defaults!
    @paused_enrollment.update!(status: :paused)

    @program_inst = create_installation(@cohort, 88003, 51003, "demo-program")
    @behind_inst = create_installation(@cohort, 88004, 51004, "demo-behind")
    @paused_inst = create_installation(@cohort, 88005, 51005, "demo-paused")

    @program_binding = create_binding(@program_enrollment, @program_inst, 99003, "demo-program/prework-exercises", "51003", "demo-program")
    @behind_binding = create_binding(@behind_enrollment, @behind_inst, 99004, "demo-behind/prework-exercises", "51004", "demo-behind")
    @paused_binding = create_binding(@paused_enrollment, @paused_inst, 99005, "demo-paused/prework-exercises", "51005", "demo-paused")

    # Separate Cohort 3 Off regression cohort (no X-6 switches, student_experience_v2: false).
    @off_cohort = Cohort.create!(
      name: "Cohort 3 Off Synthetic",
      curriculum: @curriculum,
      start_date: LearningCalendar.today - 60,
      status: :active,
      course_delivery: "program",
      repository_name: "cohort3-prework",
      settings: {
        "features" => {
          "student_experience_v2" => false
        }
      }
    )
    @off_cohort.instructors << @instructor
    @off_enrollment = Enrollment.create!(user: @unrelated_student, cohort: @off_cohort, status: :active)
    @off_enrollment.assign_cohort_content_defaults!
  end

  teardown do
    ENV["GITHUB_WEBHOOK_SECRET"] = @prev_webhook_secret
    ENV["GITHUB_APP_WEBHOOK_SECRET"] = @prev_app_webhook_secret
    ApiRateLimits::STORE.clear
  end

  test "full X-6.3 through X-6.9 demo loop: sync, webhooks, reconciliation, suggestions, Redo issue retry/closure, outage recovery, refusals, and Cohort 3 Off isolation" do
    # Configure simulated repo files & checks keyed by repository_id + commit SHA
    fake_client = build_demo_fake_client

    with_stubbed_github_client(fake_client) do
      # 1. Instructor Sync GitHub for Program student (111.rb) & Behind student (112.rb)
      post "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/sync_github", headers: auth_headers(@instructor)
      assert_response :ok
      sync_body = response.parsed_body
      assert_equal 2, sync_body["synced"]
      assert_equal 2, sync_body["students_processed"] # Paused student is excluded!

      program_111 = Submission.find_by!(enrollment: @program_enrollment, content_block: @ex111)
      behind_112_v1 = Submission.find_by!(enrollment: @behind_enrollment, content_block: @ex112)
      assert_equal SHA_PROGRAM_1, program_111.commit_sha
      assert_nil program_111.grade
      assert_equal SHA_BEHIND_1, behind_112_v1.commit_sha
      assert_nil behind_112_v1.grade
      assert_nil Submission.find_by(enrollment: @paused_enrollment, content_block: @ex111), "Paused learner must not sync"

      # Paused learner explicit sync refusal
      post "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/sync_github/#{@paused_student.id}", headers: auth_headers(@instructor)
      assert_response :not_found

      # Unrelated student refusal on demo cohort lesson/submission access
      get "/api/v1/submissions/#{program_111.id}", headers: auth_headers(@unrelated_student)
      assert_response :forbidden

      # 2. Signed webhook (passing check_run) -> check attached -> evaluate -> suggest_b (NO grade written!)
      pass_payload = check_run_webhook_payload(
        installation_id: 88003, repo_id: 99003, full_name: "demo-program/prework-exercises",
        external_id: 911101, name: "prework/111.rb", sha: SHA_PROGRAM_1, conclusion: "success"
      )
      post_signed_webhook(pass_payload, delivery_id: "del-pass-111")
      assert_response :ok
      assert_equal "processed", response.parsed_body["status"]

      # Duplicate webhook idempotency: second delivery must NOT duplicate check runs
      assert_no_difference "GithubCheckRun.count" do
        post_signed_webhook(pass_payload, delivery_id: "del-pass-111")
        assert_response :ok
        assert_equal true, response.parsed_body["duplicate"]
      end

      # Evaluate suggestion via staff endpoint -> suggest_b; grade stays nil!
      post "/api/v1/submissions/#{program_111.id}/evaluate_grade_suggestion", headers: auth_headers(@instructor)
      assert_response :ok
      assert_equal "suggest_b", response.parsed_body.dig("grade_suggestion", "outcome")
      assert_nil program_111.reload.grade

      # 3. Instructor overrides suggest_b with A + override_reason
      patch "/api/v1/submissions/#{program_111.id}/grade",
        params: {
          grade: "A",
          feedback: "Clean nil guard and readable helper.",
          criterion_results: [ { rubric_criterion_id: @rubric.rubric_criteria.first.id, rating: "exceeds" } ],
          suggestion_decision: "overridden",
          suggestion_override_reason: "Exceeded expectations with clear edge-case guards",
          base_submission_updated_at: program_111.updated_at.iso8601(6)
        },
        headers: auth_headers(@instructor),
        as: :json
      assert_response :ok
      assert_equal "A", response.parsed_body.dig("submission", "grade")
      assert_equal "overridden", response.parsed_body.dig("submission", "grade_suggestion", "decision")
      assert_equal "Exceeded expectations with clear edge-case guards", response.parsed_body.dig("submission", "grade_suggestion", "override_reason")

      # 4. Signed webhook (failed check_run) on behind_112_v1 -> review_for_redo
      fail_payload = check_run_webhook_payload(
        installation_id: 88004, repo_id: 99004, full_name: "demo-behind/prework-exercises",
        external_id: 911201, name: "prework/112.rb", sha: SHA_BEHIND_1, conclusion: "failure"
      )
      post_signed_webhook(fail_payload, delivery_id: "del-fail-112")
      assert_response :ok
      assert_equal "processed", response.parsed_body["status"]

      post "/api/v1/submissions/#{behind_112_v1.id}/evaluate_grade_suggestion", headers: auth_headers(@instructor)
      assert_response :ok
      assert_equal "review_for_redo", response.parsed_body.dig("grade_suggestion", "outcome")

      # 5. Redo feedback validation: blank feedback rejected
      patch "/api/v1/submissions/#{behind_112_v1.id}/grade",
        params: { grade: "R", feedback: "   ", base_submission_updated_at: behind_112_v1.reload.updated_at.iso8601(6) },
        headers: auth_headers(@instructor),
        as: :json
      assert_response :unprocessable_entity

      # Save Redo with meaningful feedback -> durable outbox intent queued (pending), zero HTTP in request
      patch "/api/v1/submissions/#{behind_112_v1.id}/grade",
        params: {
          grade: "R",
          feedback: "Return 0 when scores is empty so you never divide by zero.",
          base_submission_updated_at: behind_112_v1.reload.updated_at.iso8601(6)
        },
        headers: auth_headers(@instructor),
        as: :json
      assert_response :ok
      assert_equal "R", response.parsed_body.dig("submission", "grade")
      assert_equal "pending", response.parsed_body.dig("submission", "github_issue_delivery", "status")
      delivery_r = GithubIssueDelivery.find_by!(submission: behind_112_v1)

      # 6. Simulated provider outage -> permanent failure shows failed status while grade stays saved
      fake_client.issue_failure = GithubAppClient::Error.new("Simulated GitHub API failure", status: 422)
      GithubIssueDeliveryDrain.new(client: fake_client).deliver_one!(delivery_r, force: true)
      assert_equal "failed", delivery_r.reload.status
      assert_equal "R", behind_112_v1.reload.grade

      # Recover with timeout_after_create -> issue created on provider, first retry reconciles by marker -> EXACTLY ONE issue created!
      fake_client.issue_failure = nil
      fake_client.timeout_after_create = true
      post "/api/v1/submissions/#{behind_112_v1.id}/retry_github_issue", headers: auth_headers(@instructor)
      assert_response :ok
      assert_equal "pending", delivery_r.reload.status
      assert_equal 1, fake_client.issues.fetch(99004).size

      # Retry again -> marker found, still EXACTLY ONE issue, now delivered!
      post "/api/v1/submissions/#{behind_112_v1.id}/retry_github_issue", headers: auth_headers(@instructor)
      assert_response :ok
      assert_equal "delivered", delivery_r.reload.status
      assert_equal 1, fake_client.issues.fetch(99004).size
      assert_equal 1, delivery_r.issue_number
      assert_equal "open", fake_client.issues.fetch(99004).fetch(1).fetch(:state)

      # 7. Event-before-sync recovery + corrected resubmission!
      # First, webhook arrives BEFORE revision SHA_BEHIND_2 is synced -> staged!
      early_pass_payload = check_run_webhook_payload(
        installation_id: 88004, repo_id: 99004, full_name: "demo-behind/prework-exercises",
        external_id: 911202, name: "prework/112.rb", sha: SHA_BEHIND_2, conclusion: "success"
      )
      post_signed_webhook(early_pass_payload, delivery_id: "del-early-112-fixed")
      assert_response :ok
      assert_equal "staged", response.parsed_body["status"]

      # Now simulated repo advances to SHA_BEHIND_2 (fixed 112.rb) and hourly reconciliation runs!
      @repo_heads[99004] = SHA_BEHIND_2
      metrics = {}
      GithubReconciliationService.new(client: fake_client).call(now: Time.current, metrics: metrics)
      assert_operator metrics[:revisions_synced], :>=, 1
      assert_operator metrics[:webhooks_replayed], :>=, 1
      assert_operator metrics[:suggestions_evaluated], :>=, 1

      # New attempt created, prior attempt (behind_112_v1) grade/feedback preserved!
      attempts = Submission.where(enrollment: @behind_enrollment, content_block: @ex112).order(:id).to_a
      assert_equal 2, attempts.size
      behind_112_v2 = attempts.last
      assert_equal SHA_BEHIND_2, behind_112_v2.commit_sha
      assert_nil behind_112_v2.grade
      assert_equal "R", behind_112_v1.reload.grade
      assert_equal "Return 0 when scores is empty so you never divide by zero.", behind_112_v1.feedback
      assert_equal "suggest_b", behind_112_v2.submission_grade_suggestion.outcome
      assert_equal "processed", GithubWebhookDelivery.find_by!(delivery_id: "del-early-112-fixed").processing_state

      # 8. Instructor confirms B on fixed resubmission -> close intent drained -> issue closed ONCE!
      patch "/api/v1/submissions/#{behind_112_v2.id}/grade",
        params: {
          grade: "B",
          feedback: "Empty array guard looks solid!",
          criterion_results: [ { rubric_criterion_id: @rubric.rubric_criteria.first.id, rating: "meets" } ],
          suggestion_decision: "accepted",
          base_submission_updated_at: behind_112_v2.reload.updated_at.iso8601(6)
        },
        headers: auth_headers(@instructor),
        as: :json
      assert_response :ok
      assert_equal "B", response.parsed_body.dig("submission", "grade")
      assert_equal "accepted", response.parsed_body.dig("submission", "grade_suggestion", "decision")

      drain_metrics = {}
      GithubIssueDeliveryDrain.new(client: fake_client).call(now: Time.current, metrics: drain_metrics)
      assert_equal 1, drain_metrics[:sent]
      assert_equal "closed", fake_client.issues.fetch(99004).fetch(1).fetch(:state)
      close_calls = fake_client.calls.count { |c| c.first == :close_issue }
      assert_equal 1, close_calls

      # Stale check on old SHA cannot alter the passed grade or reopen the issue
      stale_payload = check_run_webhook_payload(
        installation_id: 88004, repo_id: 99004, full_name: "demo-behind/prework-exercises",
        external_id: 911299, name: "prework/112.rb", sha: SHA_STALE_OLD, conclusion: "failure"
      )
      post_signed_webhook(stale_payload, delivery_id: "del-stale-old-sha")
      assert_response :ok
      assert_equal "B", behind_112_v2.reload.grade
      assert_equal "closed", fake_client.issues.fetch(99004).fetch(1).fetch(:state)

      # 9. Exercise with no check policy (113.rb) -> no_suggestion
      @repo_heads[99003] = SHA_BEHIND_EARLY
      @repo_files[[ 99003, SHA_BEHIND_EARLY ]] = {
        "111.rb" => "def greeting_badge(name); name.to_s.strip; end\n",
        "113.rb" => "def daily_streaks(days); Array(days).count(true); end\n"
      }
      post "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/sync_github/#{@program_student.id}", headers: auth_headers(@instructor)
      assert_response :ok
      sub_113 = Submission.find_by!(enrollment: @program_enrollment, content_block: @ex113)
      post "/api/v1/submissions/#{sub_113.id}/evaluate_grade_suggestion", headers: auth_headers(@instructor)
      assert_response :ok
      assert_equal "no_suggestion", response.parsed_body.dig("grade_suggestion", "outcome")
      assert_equal "missing_policy", response.parsed_body.dig("grade_suggestion", "reason_code")

      # Stale SHA check: record only an old-SHA check run on a policy-bearing exercise -> stale_evidence
      stale_sub = Submission.create!(
        user: @program_student, enrollment: @program_enrollment, content_block: @ex112,
        submission_type: :prework_github_sync, text: "def score_summary(s); 0; end",
        commit_sha: SHA_BEHIND_2, branch: "main", github_repository_id: 99003, num_submissions: 1,
        github_revision: {
          "version" => 1, "binding_id" => @program_binding.id, "repository_id" => 99003,
          "repository_full_name" => "demo-program/prework-exercises", "paths" => [ "112.rb" ],
          "content_digest" => Digest::SHA256.hexdigest("def score_summary(s); 0; end"), "source_bytes" => 28,
          "workflow_files" => { WORKFLOW_PATH => { "present" => true, "sha256" => WORKFLOW_SHA256 } }
        }
      )
      stale_sub.github_check_runs.create!(
        external_id: 999001, name: "prework/112.rb", app_slug: "github-actions",
        workflow_path: WORKFLOW_PATH, head_sha: SHA_STALE_OLD, status: "completed", conclusion: "success", fetched_at: Time.current
      )
      post "/api/v1/submissions/#{stale_sub.id}/evaluate_grade_suggestion", headers: auth_headers(@instructor)
      assert_response :ok
      assert_equal "stale_evidence", response.parsed_body.dig("grade_suggestion", "outcome")
      assert_equal "stale_sha", response.parsed_body.dig("grade_suggestion", "reason_code")

      # 10. Closed submission window refusal
      CohortModuleSubmissionWindow.create!(
        cohort: @cohort, curriculum_module: @mod, week_number: 1,
        submissions_close_at: 1.hour.ago, created_by: @admin, updated_by: @admin
      )
      @repo_files[[ 99003, SHA_BEHIND_EARLY ]]["113.rb"] = "def daily_streaks(days); Array(days).count(true) + 0; end\n"
      assert_no_difference "Submission.count" do
        post "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/sync_github/#{@program_student.id}", headers: auth_headers(@instructor)
        assert_response :ok
        assert_equal 0, response.parsed_body["synced"]
        assert_includes response.parsed_body["errors"].join(" "), "closed"
      end

      # 11. Release communications preview & insights
      get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers(@instructor)
      assert_response :ok
      rc = response.parsed_body.fetch("release_communications")
      assert_equal 2, rc.dig("recipients", "eligible_active_count")
      assert_equal 1, rc.dig("recipients", "excluded", "paused")
      assert rc["upcoming_releases"].any? { |rel| rel["lessons"].any? { |l| l["id"] == @day2.id } }
      assert_not_nil rc["sample_preview"]

      get "/api/v1/cohorts/#{@cohort.id}/learning_insights", headers: auth_headers(@instructor)
      assert_response :ok
      insights = response.parsed_body.fetch("learning_insights")
      assert insights["objectives"].any? { |obj| obj["code"] == "PREWORK-RUBY-1" }

      # 12. Cohort 3 Off regression: zero X-6 automation writes, zero suggestions leaked!
      off_sub = Submission.create!(
        user: @unrelated_student, enrollment: @off_enrollment, content_block: @ex111,
        submission_type: :prework_github_sync, text: "puts 'cohort 3 off'", num_submissions: 1
      )
      assert_nil GithubGradeSuggestionEvaluator.evaluate_submission!(off_sub)
      assert_equal 0, SubmissionGradeSuggestion.where(enrollment: @off_enrollment).count
      assert_equal 0, GithubIssueDelivery.where(enrollment: @off_enrollment).count

      get "/api/v1/submissions/#{off_sub.id}", headers: auth_headers(@instructor)
      assert_response :ok
      assert_nil response.parsed_body.dig("submission", "grade_suggestion")
      assert_nil response.parsed_body.dig("submission", "github_issue_delivery")
    end
  end

  private

  def create_installation(cohort, inst_id, account_id, login)
    cohort.github_app_installations.create!(
      app_id: 12_345, installation_id: inst_id, account_id: account_id, account_login: login,
      account_type: "User", repository_selection: "selected",
      permissions: { "contents" => "read", "checks" => "read", "metadata" => "read", "issues" => "write" },
      connection_state: "connected", connected_at: 10.minutes.ago, checked_at: 10.minutes.ago
    )
  end

  def create_binding(enrollment, inst, repo_id, full_name, gh_user_id, gh_login)
    enrollment.github_repository_bindings.create!(
      github_app_installation: inst, curriculum_module: @mod, full_name: full_name,
      repository_id: repo_id, github_user_id: gh_user_id, github_username: gh_login,
      verification_state: "verified", verified_at: 10.minutes.ago, checked_at: 10.minutes.ago
    )
  end

  def build_demo_fake_client
    @repo_heads = {
      99003 => SHA_PROGRAM_1,
      99004 => SHA_BEHIND_1,
      99005 => SHA_PAUSED_1
    }
    @repo_files = {
      [ 99003, SHA_PROGRAM_1 ] => { "111.rb" => "def greeting_badge(name); name.to_s.strip; end\n" },
      [ 99004, SHA_BEHIND_1 ] => { "112.rb" => "def score_summary(s); s.sum / s.length; end\n" },
      [ 99004, SHA_BEHIND_2 ] => { "112.rb" => "def score_summary(s); return 0 if s.empty?; s.sum.to_f / s.length; end\n" },
      [ 99005, SHA_PAUSED_1 ] => { "111.rb" => "def greeting_badge(name); 'paused'; end\n" }
    }
    repo_meta = {
      99003 => { "id" => 99003, "full_name" => "demo-program/prework-exercises", "fork" => false, "owner" => { "id" => 51003, "login" => "demo-program", "type" => "User" } },
      99004 => { "id" => 99004, "full_name" => "demo-behind/prework-exercises", "fork" => false, "owner" => { "id" => 51004, "login" => "demo-behind", "type" => "User" } },
      99005 => { "id" => 99005, "full_name" => "demo-paused/prework-exercises", "fork" => false, "owner" => { "id" => 51005, "login" => "demo-paused", "type" => "User" } }
    }

    client = FakeGithubAppClient.new
    client.workflow_files = { WORKFLOW_PATH => { "text" => WORKFLOW_YAML, "sha256" => WORKFLOW_SHA256 } }
    client.on_repository = ->(repository_id:, full_name:, **) do
      repo_meta[repository_id.to_i] || repo_meta.values.find { |r| r["full_name"].casecmp?(full_name.to_s) }
    end
    client.on_default_branch_head = ->(repository:, **) do
      sha = @repo_heads.fetch(repository.fetch("id").to_i)
      { commit_hash: sha, branch: "main", committed_at: Time.current }
    end
    client.on_files_at_commit = ->(repository:, sha:, branch:, filenames:, workflow_paths:, **) do
      rid = repository.fetch("id").to_i
      files_map = @repo_files[[ rid, sha ]] || {}
      resolved = filenames.filter_map { |name| files_map[name] ? { "name" => name, "text" => files_map[name] } : nil }
      wf = Array(workflow_paths).each_with_object({}) do |wp, h|
        h[wp] = wp == WORKFLOW_PATH ? { "present" => true, "sha256" => WORKFLOW_SHA256 } : { "present" => false }
      end
      { files: resolved, workflow_files: wf, commit_hash: sha, branch: branch || "main", error: nil }
    end
    client.define_singleton_method(:files) do |installation:, repository:, filenames:, workflow_paths: [], timeout: nil|
      head = default_branch_head(installation: installation, repository: repository, timeout: timeout)
      files_at_commit(installation: installation, repository: repository, sha: head[:commit_hash], branch: head[:branch], filenames: filenames, workflow_paths: workflow_paths, timeout: timeout)
    end
    client.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }
    client
  end

  def with_stubbed_github_client(client)
    original_new = GithubAppClient.method(:new)
    GithubAppClient.define_singleton_method(:new) { |**| client }
    yield
  ensure
    GithubAppClient.define_singleton_method(:new, original_new)
  end

  def check_run_webhook_payload(installation_id:, repo_id:, full_name:, external_id:, name:, sha:, conclusion:, status: "completed")
    {
      action: "completed",
      installation: { id: installation_id },
      repository: { id: repo_id, full_name: full_name },
      check_run: {
        id: external_id,
        name: name,
        head_sha: sha,
        status: status,
        conclusion: conclusion,
        details_url: "https://example.invalid/simulated-github/#{full_name}/runs/#{external_id}",
        started_at: 30.seconds.ago.utc.iso8601,
        completed_at: 5.seconds.ago.utc.iso8601,
        workflow_path: WORKFLOW_PATH,
        app: { slug: "github-actions" },
        check_suite: { id: 7001, app: { name: "Simulated GitHub Actions" }, workflow_path: WORKFLOW_PATH }
      }
    }
  end

  def post_signed_webhook(payload, delivery_id:)
    body = JSON.generate(payload)
    sig = "sha256=#{OpenSSL::HMAC.hexdigest('SHA256', WEBHOOK_SECRET.b, body.b)}"
    post WEBHOOK_PATH, params: body, headers: {
      "CONTENT_TYPE" => "application/json",
      "X-Hub-Signature-256" => sig,
      "X-GitHub-Delivery" => delivery_id,
      "X-GitHub-Event" => "check_run"
    }
  end

  def auth_headers(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end
end
