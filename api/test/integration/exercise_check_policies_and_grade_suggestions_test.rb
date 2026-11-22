require "test_helper"

class ExerciseCheckPoliciesAndGradeSuggestionsTest < ActionDispatch::IntegrationTest
  SHA_ONE = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa".freeze
  WORKFLOW_SHA = "1234567890abcdef1234567890abcdef12345678".freeze

  setup do
    @curriculum = Curriculum.create!(name: "Prework Policy Curriculum")
    @mod = @curriculum.modules.create!(name: "Prework", position: 0)
    @lesson = @mod.lessons.create!(title: "Day 1", position: 0, release_day: 0)
    @exercise = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Ex 111", filename: "111.rb", submission_type: :prework_github_sync)
    @text_block = @lesson.content_blocks.create!(block_type: :text, position: 1, title: "Reading", body: "Read this")

    @admin = User.create!(clerk_id: "pol_admin", email: "pol-admin@example.invalid", first_name: "Pol", last_name: "Admin", role: :admin)
    @editor_instructor = User.create!(clerk_id: "pol_editor", email: "pol-editor@example.invalid", first_name: "Pol", last_name: "Editor", role: :instructor)
    @other_instructor = User.create!(clerk_id: "pol_other", email: "pol-other@example.invalid", first_name: "Pol", last_name: "Other", role: :instructor)
    @student = User.create!(clerk_id: "pol_student", email: "pol-student@example.invalid", first_name: "Pol", last_name: "Student", role: :student)

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

    @opted_in_cohort.cohort_instructor_assignments.create!(user: @editor_instructor, can_edit_lessons: true, edit_granted_by: @admin, edit_granted_at: Time.current)
    @off_cohort.cohort_instructor_assignments.create!(user: @editor_instructor, can_edit_lessons: true, edit_granted_by: @admin, edit_granted_at: Time.current)
    @off_cohort.cohort_instructor_assignments.create!(user: @other_instructor, can_edit_lessons: false)

    @enrollment = Enrollment.create!(user: @student, cohort: @opted_in_cohort, status: :active)
    @off_enrollment = Enrollment.create!(user: @student, cohort: @off_cohort, status: :active)
  end

  test "staff reads policy history; admin and authorized editor version policies immutably; delete deactivates without losing historical FKs" do
    as_user(@student) { get "/api/v1/content_blocks/#{@exercise.id}/check_policy", headers: auth_headers }
    assert_response :forbidden

    as_user(@other_instructor) { get "/api/v1/content_blocks/#{@exercise.id}/check_policy", headers: auth_headers }
    assert_response :success
    assert_nil response.parsed_body.fetch("active_policy")
    assert_equal [], response.parsed_body.fetch("versions")

    # Unauthorized instructor (without lesson editing grant) cannot write or delete policies.
    as_user(@other_instructor) do
      put "/api/v1/content_blocks/#{@exercise.id}/check_policy",
        params: { required_checks: [ "prework/111.rb" ] },
        headers: auth_headers,
        as: :json
    end
    assert_response :forbidden

    # Non-exercise block cannot have a check policy.
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
          expected_workflow_path: ".github/workflows/prework-checks.yml",
          expected_workflow_sha: WORKFLOW_SHA
        },
        headers: auth_headers,
        as: :json
    end
    assert_response :success
    v1 = response.parsed_body.fetch("active_policy")
    assert_equal 1, v1.fetch("version")
    assert_equal true, v1.fetch("active")
    assert_equal [ "prework/111.rb" ], v1.fetch("required_checks")
    assert_equal WORKFLOW_SHA, v1.fetch("expected_workflow_sha")
    assert_equal 1, response.parsed_body.fetch("versions").size

    # Create a suggestion linked to v1.
    submission = create_verified_submission(@enrollment)
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

  test "POST /api/v1/submissions/:id/evaluate_grade_suggestion enforces StaffCohortScope, cohort opt-in, and zero grade writes" do
    ExerciseCheckPolicy.create_version!(
      content_block: @exercise,
      required_checks: [ "prework/111.rb" ],
      allowed_app_slugs: [ "github-actions" ],
      allowed_branch: "main",
      created_by: @admin
    )

    opt_in_sub = create_verified_submission(@enrollment)
    opt_in_sub.github_check_runs.create!(
      external_id: 951,
      name: "prework/111.rb",
      app_slug: "github-actions",
      head_sha: SHA_ONE,
      status: "completed",
      conclusion: "success",
      fetched_at: Time.current
    )

    off_sub = create_verified_submission(@off_enrollment)
    off_sub.github_check_runs.create!(
      external_id: 952,
      name: "prework/111.rb",
      app_slug: "github-actions",
      head_sha: SHA_ONE,
      status: "completed",
      conclusion: "success",
      fetched_at: Time.current
    )

    # Student -> 403
    as_user(@student) { post "/api/v1/submissions/#{opt_in_sub.id}/evaluate_grade_suggestion", headers: auth_headers }
    assert_response :forbidden

    # Instructor not assigned to @opted_in_cohort -> 403 (StaffCohortScope)
    as_user(@other_instructor) { post "/api/v1/submissions/#{opt_in_sub.id}/evaluate_grade_suggestion", headers: auth_headers }
    assert_response :forbidden

    # Off cohort (Cohort 3 shape), even for admin with school switch On -> 403 feature_disabled & zero writes!
    as_user(@admin) { post "/api/v1/submissions/#{off_sub.id}/evaluate_grade_suggestion", headers: auth_headers }
    assert_response :forbidden
    assert_equal "feature_disabled", response.parsed_body.fetch("code")
    assert_equal 0, SubmissionGradeSuggestion.where(submission_id: off_sub.id).count

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
      created_by: @admin
    )

    # Second opted-in cohort sharing @curriculum to prove other cohort's rows stay untouched.
    other_opted_in = Cohort.create!(
      curriculum: @curriculum,
      name: "Other Opted In",
      start_date: Date.current,
      status: :active,
      settings: { "features" => { "github_app" => true, "github_grade_suggestions" => true } }
    )
    other_student = User.create!(clerk_id: "pol_other_student", email: "pol-other-student@example.invalid", first_name: "Other", last_name: "Learner", role: :student)
    other_enrollment = Enrollment.create!(user: other_student, cohort: other_opted_in, status: :active)

    copied_sub = create_verified_submission(@enrollment)
    copied_sub.github_check_runs.create!(external_id: 961, name: "prework/111.rb", app_slug: "github-actions", head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: Time.current)
    copied_suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(copied_sub)

    untouched_sub = create_verified_submission(other_enrollment)
    untouched_sub.github_check_runs.create!(external_id: 962, name: "prework/111.rb", app_slug: "github-actions", head_sha: SHA_ONE, status: "completed", conclusion: "success", fetched_at: Time.current)
    untouched_suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(untouched_sub)

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

    # Shared curriculum & other cohort rows remain untouched.
    untouched_suggestion.reload
    assert_equal @exercise.id, untouched_suggestion.content_block_id
    assert_equal v2.id, untouched_suggestion.exercise_check_policy_id
    assert_equal [ v1.id, v2.id ], @exercise.exercise_check_policies.order(:version).pluck(:id)
  end

  private

  def create_verified_submission(enrollment)
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
        "binding_id" => 101,
        "repository_id" => 77_777,
        "repository_full_name" => "pol-student/prework",
        "paths" => [ "111.rb" ],
        "content_digest" => Digest::SHA256.hexdigest("puts 1"),
        "source_bytes" => 6,
        "workflow_sha" => WORKFLOW_SHA,
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
