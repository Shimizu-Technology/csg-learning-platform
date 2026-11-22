require "test_helper"
require_relative "../support/fake_github_app_client"

class ExerciseCheckPoliciesAndGradeSuggestionsTest < ActionDispatch::IntegrationTest
  SHA_ONE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".freeze
  WORKFLOW_PATH = ".github/workflows/prework-checks.yml".freeze
  WORKFLOW_TEXT = "name: Prework Exercise Checks\n".freeze
  WORKFLOW_OID = "1234567890abcdef1234567890abcdef12345678".freeze
  WORKFLOW_SHA256 = Digest::SHA256.hexdigest(WORKFLOW_TEXT).freeze

  setup do
    @now = Time.current
    @curriculum = Curriculum.create!(name: "Prework Policy Curriculum")
    @mod = @curriculum.modules.create!(name: "Prework", position: 0)
    @lesson = @mod.lessons.create!(title: "Day 1", position: 0, release_day: 0)
    @exercise = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Ex 111", filename: "111.rb", submission_type: :prework_github_sync)
    @text_block = @lesson.content_blocks.create!(block_type: :text, position: 1, title: "Reading", body: "Read this")

    @admin = User.create!(clerk_id: "pol_admin", email: "pol-admin@example.invalid", first_name: "Pol", last_name: "Admin", role: :admin)
    @editor_instructor = User.create!(clerk_id: "pol_editor", email: "pol-editor@example.invalid", first_name: "Pol", last_name: "Editor", role: :instructor)
    @other_instructor = User.create!(clerk_id: "pol_other", email: "pol-other@example.invalid", first_name: "Pol", last_name: "Other", role: :instructor)
    @student = User.create!(clerk_id: "pol_student", email: "pol-student@example.invalid", first_name: "Pol", last_name: "Student", role: :student, github_username: "pol-student")
    @student.record_verified_github_identity!(id: 88_001, login: "pol-student")

    SchoolSetting.current.update!(features: { "github_app" => true, "github_grade_suggestions" => true })

    @opted_in_cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Opted In Cohort",
      start_date: Date.current,
      status: :active,
      settings: { "features" => { "github_app" => true, "github_grade_suggestions" => true } }
    )
    @off_cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Cohort 3 Shape Off",
      start_date: Date.current - 30.days,
      status: :active,
      settings: { "features" => { "student_experience_v2" => false } }
    )

    @opted_in_cohort.cohort_instructor_assignments.create!(user: @editor_instructor, can_edit_lessons: true, edit_granted_by: @admin, edit_granted_at: @now)
    @off_cohort.cohort_instructor_assignments.create!(user: @editor_instructor, can_edit_lessons: true, edit_granted_by: @admin, edit_granted_at: @now)
    @off_cohort.cohort_instructor_assignments.create!(user: @other_instructor, can_edit_lessons: false)

    @enrollment = Enrollment.create!(user: @student, cohort: @opted_in_cohort, status: :active)
    @off_enrollment = Enrollment.create!(user: @student, cohort: @off_cohort, status: :active)

    @installation = GithubAppInstallation.create!(
      cohort: @opted_in_cohort,
      app_id: 12_345,
      installation_id: 51_001,
      account_login: "pol-student",
      account_id: 88_001,
      account_type: "User",
      repository_selection: "selected",
      connection_state: "connected",
      connected_at: @now,
      checked_at: @now
    )
    @binding = @enrollment.github_repository_bindings.create!(
      github_app_installation: @installation,
      curriculum_module: @mod,
      repository_id: 77_777,
      full_name: "pol-student/prework",
      github_username: "pol-student",
      github_user_id: "88001",
      verification_state: "verified",
      verified_at: @now
    )
  end

  test "staff reads policy history; admin and authorized editor version policies immutably; delete deactivates without losing historical FKs" do
    as_user(@student) { get "/api/v1/content_blocks/#{@exercise.id}/check_policy", headers: auth_headers }
    assert_response :forbidden

    as_user(@other_instructor) { get "/api/v1/content_blocks/#{@exercise.id}/check_policy", headers: auth_headers }
    assert_response :success
    assert_nil response.parsed_body.fetch("active_policy")
    assert_equal [], response.parsed_body.fetch("versions")

    as_user(@other_instructor) do
      put "/api/v1/content_blocks/#{@exercise.id}/check_policy",
        params: { required_checks: [ "prework/111.rb" ] },
        headers: auth_headers,
        as: :json
    end
    assert_response :forbidden

    as_user(@admin) do
      put "/api/v1/content_blocks/#{@text_block.id}/check_policy",
        params: { required_checks: [ "prework/111.rb" ] },
        headers: auth_headers,
        as: :json
    end
    assert_response :unprocessable_entity

    # Admin creates version 1.
    as_user(@admin) do
      put "/api/v1/content_blocks/#{@exercise.id}/check_policy",
        params: {
          required_checks: [ "prework/111.rb" ],
          allowed_app_slugs: [ "github-actions" ],
          allowed_branch: "main",
          expected_workflow_path: WORKFLOW_PATH,
          expected_workflow_sha: WORKFLOW_OID
        },
        headers: auth_headers,
        as: :json
    end
    assert_response :success
    v1 = response.parsed_body.fetch("active_policy")
    assert_equal 1, v1.fetch("version")
    assert_equal true, v1.fetch("active")
    assert_equal [ "prework/111.rb" ], v1.fetch("required_checks")
    assert_equal WORKFLOW_OID, v1.fetch("expected_workflow_sha")
    assert_equal 1, response.parsed_body.fetch("versions").size

    # Create a suggestion linked to v1.
    submission = create_verified_submission(@enrollment, @binding)
    submission.github_check_runs.create!(
      external_id: 901,
      name: "prework/111.rb",
      app_slug: "github-actions",
      head_sha: SHA_ONE,
      status: "completed",
      conclusion: "success",
      fetched_at: Time.current
    )
    suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(submission)
    assert_equal v1.fetch("id"), suggestion.exercise_check_policy_id

    # Invalid update does not deactivate v1.
    as_user(@editor_instructor) do
      put "/api/v1/content_blocks/#{@exercise.id}/check_policy",
        params: { required_checks: [] },
        headers: auth_headers,
        as: :json
    end
    assert_response :unprocessable_entity
    assert_equal true, ExerciseCheckPolicy.find(v1.fetch("id")).active?

    # Authorized editor creates version 2; v1 is deactivated immutably.
    as_user(@editor_instructor) do
      put "/api/v1/content_blocks/#{@exercise.id}/check_policy",
        params: { required_checks: [ "prework/111.rb", "prework/111-edge.rb" ], allowed_branch: "main" },
        headers: auth_headers,
        as: :json
    end
    assert_response :success
    v2 = response.parsed_body.fetch("active_policy")
    assert_equal 2, v2.fetch("version")
    assert_equal [ 2, 1 ], response.parsed_body.fetch("versions").map { |row| row.fetch("version") }
    assert_equal false, ExerciseCheckPolicy.find(v1.fetch("id")).active?
    assert_equal true, suggestion.reload.stale_policy?

    # DELETE deactivates v2 without deleting historical rows or nullifying suggestion FK.
    as_user(@other_instructor) { delete "/api/v1/content_blocks/#{@exercise.id}/check_policy", headers: auth_headers }
    assert_response :forbidden

    as_user(@admin) { delete "/api/v1/content_blocks/#{@exercise.id}/check_policy", headers: auth_headers }
    assert_response :success
    assert_nil response.parsed_body.fetch("active_policy")
    assert_equal 2, response.parsed_body.fetch("versions").size
    assert response.parsed_body.fetch("versions").none? { |row| row.fetch("active") }
    assert_equal v1.fetch("id"), suggestion.reload.exercise_check_policy_id
  end

  test "PUT /api/v1/content_blocks/:id/check_policy rejects malformed param types, control characters, unsafe paths, and sha without path" do
    invalid_payloads = [
      { required_checks: "prework/111.rb" },
      { required_checks: [ { name: "prework/111.rb" } ] },
      { required_checks: [ "prework/111.rb" ], allowed_app_slugs: "github-actions" },
      { required_checks: [ "prework/111.rb" ], allowed_app_slugs: [ 123 ] },
      { required_checks: [ "prework/111.rb" ], allowed_app_slugs: [] },
      { required_checks: [ "prework/111.rb\n" ] },
      { required_checks: [ "prework/111.rb\u0000" ] },
      { required_checks: [ "prework/111.rb" ], allowed_branch: "main\r\n" },
      { required_checks: [ "prework/111.rb" ], expected_workflow_path: ".github//workflows/prework.yml" },
      { required_checks: [ "prework/111.rb" ], expected_workflow_path: ".github\\workflows\\prework.yml" },
      { required_checks: [ "prework/111.rb" ], expected_workflow_path: "./.github/workflows/prework.yml" },
      { required_checks: [ "prework/111.rb" ], expected_workflow_path: ".github/../workflows/prework.yml" },
      { required_checks: [ "prework/111.rb" ], expected_workflow_sha: WORKFLOW_OID }
    ]

    as_user(@admin) do
      invalid_payloads.each do |payload|
        put "/api/v1/content_blocks/#{@exercise.id}/check_policy", params: payload, headers: auth_headers, as: :json
        assert_response :unprocessable_entity, "expected 422 for payload #{payload.inspect}"
      end
    end
    assert_equal 0, ExerciseCheckPolicy.count
  end

  test "changing block_type away from exercise deactivates active policy and LessonDuplicate copies policies" do
    v1 = ExerciseCheckPolicy.create_version!(
      content_block: @exercise,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      created_by: @admin
    )
    v2 = ExerciseCheckPolicy.create_version!(
      content_block: @exercise,
      required_checks: [ "prework/111.rb", "prework/111-edge.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      created_by: @admin
    )

    duplicated_lesson = LessonDuplicate.new(lesson: @lesson, user: @admin).duplicate!
    duplicated_exercise = duplicated_lesson.content_blocks.find_by!(title: "Ex 111")
    copied_policies = duplicated_exercise.exercise_check_policies.order(:version).to_a
    assert_equal [ 1, 2 ], copied_policies.map(&:version)
    assert_equal [ false, true ], copied_policies.map(&:active)
    assert_equal v2.required_checks, copied_policies.last.required_checks

    # Converting original block (with no learner work) from exercise to text deactivates active policy.
    @exercise.update!(block_type: :text)
    assert_equal false, v1.reload.active?
    assert_equal false, v2.reload.active?
    # Duplicated lesson's policy stays intact.
    assert_equal true, copied_policies.last.reload.active?
  end

  test "X-6.3 revision sync captures active policy expected_workflow_path OID/SHA-256 and evaluator fails closed when missing or modified" do
    ExerciseCheckPolicy.create_version!(
      content_block: @exercise,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: WORKFLOW_PATH,
      expected_workflow_sha: WORKFLOW_SHA256,
      created_by: @admin
    )

    fake = FakeGithubAppClient.new
    fake.repository_owner = "pol-student"
    fake.repository_owner_id = 88_001
    fake.commit_sha = SHA_ONE
    fake.source_text = "puts 'matching workflow'"
    fake.workflow_files = { WORKFLOW_PATH => { "text" => WORKFLOW_TEXT, "oid" => WORKFLOW_OID } }

    sync_result = GithubSyncService.new(github_token: nil, app_client: fake).sync_student(
      user: @student,
      cohort: @opted_in_cohort,
      curriculum_module: @mod
    )
    assert_equal({ synced: 1, errors: [] }, sync_result)
    matching_sub = @enrollment.submissions.order(:id).last
    captured_wf = matching_sub.github_revision.dig("workflow_files", WORKFLOW_PATH)
    assert_equal true, captured_wf.fetch("present")
    assert_equal WORKFLOW_OID, captured_wf.fetch("oid")
    assert_equal WORKFLOW_SHA256, captured_wf.fetch("sha256")

    matching_sub.github_check_runs.create!(
      external_id: 9201,
      name: "prework/111.rb",
      app_slug: "github-actions",
      head_sha: SHA_ONE,
      status: "completed",
      conclusion: "success",
      fetched_at: Time.current
    )
    assert_equal "suggest_b", GithubGradeSuggestionEvaluator.evaluate_submission!(matching_sub).outcome

    # Modified workflow on next revision fails closed as workflow_tampered.
    fake.source_text = "puts 'tampered workflow'"
    fake.commit_sha = "b" * 40
    fake.workflow_files = { WORKFLOW_PATH => { "text" => "name: Fake Pass\n", "oid" => "f" * 40 } }
    assert_equal 1, GithubSyncService.new(github_token: nil, app_client: fake).sync_student(
      user: @student,
      cohort: @opted_in_cohort,
      curriculum_module: @mod
    )[:synced]
    tampered_sub = @enrollment.submissions.order(:id).last
    tampered_sub.github_check_runs.create!(
      external_id: 9202,
      name: "prework/111.rb",
      app_slug: "github-actions",
      head_sha: "b" * 40,
      status: "completed",
      conclusion: "success",
      fetched_at: Time.current
    )
    tampered_eval = GithubGradeSuggestionEvaluator.evaluate_submission!(tampered_sub)
    assert_equal "no_suggestion", tampered_eval.outcome
    assert_equal "workflow_tampered", tampered_eval.reason_code

    # Missing workflow on next revision also fails closed as workflow_tampered.
    fake.source_text = "puts 'deleted workflow'"
    fake.commit_sha = "c" * 40
    fake.workflow_files = {}
    assert_equal 1, GithubSyncService.new(github_token: nil, app_client: fake).sync_student(
      user: @student,
      cohort: @opted_in_cohort,
      curriculum_module: @mod
    )[:synced]
    missing_wf_sub = @enrollment.submissions.order(:id).last
    assert_equal false, missing_wf_sub.github_revision.dig("workflow_files", WORKFLOW_PATH, "present")
    missing_wf_sub.github_check_runs.create!(
      external_id: 9203,
      name: "prework/111.rb",
      app_slug: "github-actions",
      head_sha: "c" * 40,
      status: "completed",
      conclusion: "success",
      fetched_at: Time.current
    )
    assert_equal "workflow_tampered", GithubGradeSuggestionEvaluator.evaluate_submission!(missing_wf_sub).reason_code
  end

  test "POST /api/v1/submissions/:id/evaluate_grade_suggestion enforces StaffCohortScope, no student existence oracle, cohort opt-in, and zero grade writes" do
    ExerciseCheckPolicy.create_version!(
      content_block: @exercise,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: WORKFLOW_PATH,
      created_by: @admin
    )

    opt_in_sub = create_verified_submission(@enrollment, @binding)
    opt_in_sub.github_check_runs.create!(
      external_id: 951,
      name: "prework/111.rb",
      app_slug: "github-actions",
      head_sha: SHA_ONE,
      status: "completed",
      conclusion: "success",
      fetched_at: Time.current
    )

    off_sub = create_verified_submission(@off_enrollment, @binding)
    off_sub.github_check_runs.create!(
      external_id: 952,
      name: "prework/111.rb",
      app_slug: "github-actions",
      head_sha: SHA_ONE,
      status: "completed",
      conclusion: "success",
      fetched_at: Time.current
    )

    # Student -> 403 for BOTH existing and non-existent IDs (no existence oracle!).
    as_user(@student) { post "/api/v1/submissions/#{opt_in_sub.id}/evaluate_grade_suggestion", headers: auth_headers }
    assert_response :forbidden
    as_user(@student) { post "/api/v1/submissions/999999999/evaluate_grade_suggestion", headers: auth_headers }
    assert_response :forbidden

    # Instructor not assigned to @opted_in_cohort -> 403 (StaffCohortScope)
    as_user(@other_instructor) { post "/api/v1/submissions/#{opt_in_sub.id}/evaluate_grade_suggestion", headers: auth_headers }
    assert_response :forbidden

    # Off cohort (Cohort 3 shape), even for admin with school switch On -> 403 feature_disabled & zero writes!
    as_user(@admin) { post "/api/v1/submissions/#{off_sub.id}/evaluate_grade_suggestion", headers: auth_headers }
    assert_response :forbidden
    assert_equal "feature_disabled", response.parsed_body.fetch("code")
    assert_equal 0, SubmissionGradeSuggestion.where(submission_id: off_sub.id).count

    # Concurrent switch-off TOCTOU returning nil from evaluator renders 403 feature_disabled cleanly instead of 500.
    original_eval = GithubGradeSuggestionEvaluator.method(:evaluate_submission!)
    begin
      GithubGradeSuggestionEvaluator.define_singleton_method(:evaluate_submission!) { |*| nil }
      as_user(@editor_instructor) { post "/api/v1/submissions/#{opt_in_sub.id}/evaluate_grade_suggestion", headers: auth_headers }
      assert_response :forbidden
      assert_equal "feature_disabled", response.parsed_body.fetch("code")
    ensure
      GithubGradeSuggestionEvaluator.define_singleton_method(:evaluate_submission!, original_eval)
    end

    # Assigned instructor on opted-in cohort -> 200 with suggest_b and zero grade mutations.
    as_user(@editor_instructor) { post "/api/v1/submissions/#{opt_in_sub.id}/evaluate_grade_suggestion", headers: auth_headers }
    assert_response :success
    payload = response.parsed_body.fetch("grade_suggestion")
    assert_equal "suggest_b", payload.fetch("outcome")
    assert_equal "B", payload.fetch("suggested_grade")
    assert_equal "all_required_checks_passed", payload.fetch("reason_code")
    assert_equal false, payload.fetch("stale_for_current_policy")
    assert_nil opt_in_sub.reload.grade
    assert_nil opt_in_sub.graded_at
    assert_nil opt_in_sub.graded_by_id
  end

  test "CurriculumCopyForCohort copies exercise_check_policies and remaps submission_grade_suggestions for the copied cohort only" do
    v1 = ExerciseCheckPolicy.create_version!(
      content_block: @exercise,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      created_by: @admin
    )
    v2 = ExerciseCheckPolicy.create_version!(
      content_block: @exercise,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      expected_workflow_path: WORKFLOW_PATH,
      created_by: @admin
    )

    other_opted_in = Cohort.create!(
      curriculum: @curriculum,
      name: "Other Opted In",
      start_date: Date.current,
      status: :active,
      settings: { "features" => { "github_app" => true, "github_grade_suggestions" => true } }
    )
    other_student = User.create!(clerk_id: "pol_other_student", email: "pol-other-student@example.invalid", first_name: "Other", last_name: "Learner", role: :student, github_username: "other-learner")
    other_student.record_verified_github_identity!(id: 88_002, login: "other-learner")
    other_enrollment = Enrollment.create!(user: other_student, cohort: other_opted_in, status: :active)
    other_installation = GithubAppInstallation.create!(
      cohort: other_opted_in,
      app_id: 12_345,
      installation_id: 51_002,
      account_login: "other-learner",
      account_id: 88_002,
      account_type: "User",
      repository_selection: "selected",
      connection_state: "connected",
      connected_at: @now,
      checked_at: @now
    )
    other_binding = other_enrollment.github_repository_bindings.create!(
      github_app_installation: other_installation,
      curriculum_module: @mod,
      repository_id: 77_778,
      full_name: "other-learner/prework",
      github_username: "other-learner",
      github_user_id: "88002",
      verification_state: "verified",
      verified_at: @now
    )

    copied_sub = create_verified_submission(@enrollment, @binding)
    copied_sub.github_check_runs.create!(external_id: 961, name: "prework/111.rb", app_slug: "github-actions", head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: Time.current)
    copied_suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(copied_sub)
    assert_equal "suggest_b", copied_suggestion.outcome

    untouched_sub = create_verified_submission(other_enrollment, other_binding)
    untouched_sub.github_check_runs.create!(external_id: 962, name: "prework/111.rb", app_slug: "github-actions", head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: Time.current)
    untouched_suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(untouched_sub)
    assert_equal "suggest_b", untouched_suggestion.outcome

    service = CurriculumCopyForCohort.new(cohort: @opted_in_cohort, user: @admin, source_curriculum_id: @curriculum.id)
    preview = service.preview
    assert_equal 2, preview.dig(:counts, "exercise_check_policies")
    assert_equal 1, preview.dig(:counts, "submission_grade_suggestions")

    result = service.copy!
    assert_equal 2, result.counts.fetch("exercise_check_policies")
    assert_equal 1, result.counts.fetch("submission_grade_suggestions")

    copied_block = @opted_in_cohort.reload.curriculum.modules.first.lessons.first.content_blocks.find_by!(title: "Ex 111")
    refute_equal @exercise.id, copied_block.id
    copied_policies = copied_block.exercise_check_policies.order(:version).to_a
    assert_equal [ 1, 2 ], copied_policies.map(&:version)
    assert_equal [ false, true ], copied_policies.map(&:active)

    copied_suggestion.reload
    assert_equal copied_block.id, copied_suggestion.content_block_id
    assert_equal copied_policies.last.id, copied_suggestion.exercise_check_policy_id
    assert_equal false, copied_suggestion.stale_policy?

    untouched_suggestion.reload
    assert_equal @exercise.id, untouched_suggestion.content_block_id
    assert_equal v2.id, untouched_suggestion.exercise_check_policy_id
    assert_equal [ v1.id, v2.id ], @exercise.exercise_check_policies.order(:version).pluck(:id)
  end

  private

  def create_verified_submission(enrollment, binding)
    Submission.create!(
      user: enrollment.user,
      enrollment: enrollment,
      content_block: @exercise,
      submission_type: :prework_github_sync,
      text: "puts 1",
      commit_sha: SHA_ONE,
      branch: "main",
      github_revision: {
        "version" => 1,
        "binding_id" => binding.id,
        "repository_id" => binding.repository_id,
        "repository_full_name" => binding.full_name,
        "paths" => [ "111.rb" ],
        "content_digest" => Digest::SHA256.hexdigest("puts 1"),
        "source_bytes" => 6,
        "workflow_files" => {
          WORKFLOW_PATH => { "present" => true, "oid" => WORKFLOW_OID, "sha256" => WORKFLOW_SHA256 }
        },
        "captured_at" => Time.current.iso8601(6)
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
