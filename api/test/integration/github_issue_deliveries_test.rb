require "test_helper"
require_relative "../support/github_app_fixtures"
require_relative "../support/query_counter"

class GithubIssueDeliveriesTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  include QueryCounter

  setup do
    build_github_app_fixture
    SchoolSetting.current.update!(features: { github_app: true, github_issue_delivery_v2: true })
    @cohort.update!(settings: { features: { github_app: true, github_issue_delivery_v2: true } })
    GithubRepositoryAccess.new(@binding, client: @fake).verify!
    @fake.calls.clear
    @submission = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "puts 'attempt 1'",
      notes: "PRIVATE STAFF NOTE DO NOT POST",
      num_submissions: 1
    )
  end

  test "grade R records pending delivery inside transaction with zero provider HTTP and never runs legacy path" do
    previous_token = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
    ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = "legacy-token-should-not-be-used"
    legacy_called = false
    original_legacy = GithubIssueService.method(:handle_grade)
    GithubIssueService.define_singleton_method(:handle_grade) { |**| legacy_called = true }

    with_app_provider do
      as_app_user(@instructor) do
        patch "/api/v1/submissions/#{@submission.id}/grade",
          params: grade_params(@submission, grade: "R", feedback: "Handle negative inputs."),
          headers: app_headers, as: :json
      end
    end

    assert_response :success
    assert_not legacy_called, "v2 cohort must never invoke legacy GithubIssueService"
    assert_empty @fake.calls, "grade save must perform zero provider HTTP"

    delivery = GithubIssueDelivery.sole
    assert_equal "pending", delivery.status
    assert_equal "open_or_comment", delivery.action
    assert_equal "R", delivery.grade
    assert_equal "Handle negative inputs.", delivery.feedback_body
    assert_equal @enrollment.id, delivery.enrollment_id
    assert_equal @block.id, delivery.content_block_id
    assert_equal @binding.id, delivery.github_repository_binding_id
    assert_equal 98765, delivery.repository_id
    assert_equal "app-learner/prework-exercises", delivery.repository_full_name
    assert_equal 0, delivery.attempts
    assert delivery.dedupe_token.present?

    payload = response.parsed_body.fetch("submission")
    assert_equal "pending", payload.dig("github_issue_delivery", "status")
    assert_equal "open_or_comment", payload.dig("github_issue_delivery", "action")

    # Students never see staff-only github_issue_delivery metadata
    as_app_user(@student) do
      get "/api/v1/submissions/#{@submission.id}", headers: app_headers
    end
    assert_response :success
    assert_not response.parsed_body.fetch("submission").key?("github_issue_delivery")
  ensure
    GithubIssueService.define_singleton_method(:handle_grade, original_legacy) if original_legacy
    ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = previous_token
  end

  test "full lifecycle: R creates issue without private notes, repeat R comments, B closes, later R reopens and comments" do
    # 1. Initial R -> create issue
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Fix edge case 1."),
        headers: app_headers, as: :json
    end
    assert_response :success

    metrics = {}
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current, metrics: metrics)
    assert_equal({ claimed: 1, sent: 1, failed: 0 }, metrics)

    first_delivery = GithubIssueDelivery.order(:id).last
    assert_equal "delivered", first_delivery.status
    assert_equal 1, first_delivery.issue_number
    assert_equal "https://github.com/app-learner/prework-exercises/issues/1", first_delivery.issue_url
    assert_equal first_delivery.issue_url, @submission.reload.github_issue_url

    issue = @fake.issues.dig(98765, 1)
    assert_equal "open", issue[:state]
    assert_includes issue[:body], "Fix edge case 1."
    assert_includes issue[:body], first_delivery.marker
    assert_not_includes issue[:body], "PRIVATE STAFF NOTE"

    # 2. Attempt 2 with repeat R -> comments on open issue #1 (no duplicate issue)
    attempt2 = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "puts 'attempt 2'",
      num_submissions: 2,
      created_at: 1.minute.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{attempt2.id}/grade",
        params: grade_params(attempt2, grade: "R", feedback: "Still missing empty input."),
        headers: app_headers, as: :json
    end
    assert_response :success

    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    assert_equal 1, @fake.issues[98765].size
    assert_equal 1, issue[:comments].size
    assert_includes issue[:comments].last[:body], "Still missing empty input."
    assert_equal "https://github.com/app-learner/prework-exercises/issues/1", attempt2.reload.github_issue_url

    # 3. Attempt 3 with passing grade B -> closes issue #1
    attempt3 = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "puts 'attempt 3'",
      num_submissions: 3,
      created_at: 2.minutes.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{attempt3.id}/grade",
        params: grade_params(attempt3, grade: "B", feedback: "Nice fix!"),
        headers: app_headers, as: :json
    end
    assert_response :success

    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    assert_equal "closed", issue[:state]
    assert_equal 2, issue[:comments].size
    assert_includes issue[:comments].last[:body], "Graded **B** - Nice fix!"

    # 4. Attempt 4 with another R -> explicitly reopens closed issue #1 and posts new comment
    attempt4 = Submission.create!(
      user: @student,
      enrollment: @enrollment,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "puts 'attempt 4'",
      num_submissions: 4,
      created_at: 3.minutes.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{attempt4.id}/grade",
        params: grade_params(attempt4, grade: "R", feedback: "Regression introduced."),
        headers: app_headers, as: :json
    end
    assert_response :success

    @fake.calls.clear
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    assert_equal "open", issue[:state]
    assert @fake.calls.any? { |call| call[0] == :reopen_issue && call[4] == 1 }
    assert_equal 1, @fake.issues[98765].size
    assert_equal 3, issue[:comments].size
    assert_includes issue[:comments].last[:body], "Regression introduced."
  end

  test "passing grade without prior tracked issue creates no delivery" do
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "A", feedback: "Great work!"),
        headers: app_headers, as: :json
    end
    assert_response :success
    assert_equal 0, GithubIssueDelivery.count
    assert_not response.parsed_body.fetch("submission").key?("github_issue_delivery")
  end

  test "multi-cohort student isolation never leaks cohort, binding, or prior issue across enrollments" do
    # Second cohort for the SAME student and SAME curriculum/block, with its own installation & repo
    cohort_b = Cohort.create!(
      name: "Second cohort",
      curriculum: @curriculum,
      start_date: Date.current,
      status: :active,
      repository_name: "cohort-b-repo",
      settings: { features: { github_app: true, github_issue_delivery_v2: true } }
    )
    cohort_b.cohort_instructor_assignments.create!(user: @instructor)
    enrollment_b = Enrollment.create!(cohort: cohort_b, user: @student, status: :active, enrolled_at: 1.day.from_now)
    installation_b = cohort_b.github_app_installations.create!(
      app_id: 12345, installation_id: 456, account_id: 24680, account_login: "app-learner",
      account_type: "User", repository_selection: "selected", connected_at: Time.current, checked_at: Time.current
    )
    binding_b = enrollment_b.github_repository_bindings.create!(
      github_app_installation: installation_b, full_name: "app-learner/cohort-b-repo"
    )
    GithubRepositoryAccess.new(binding_b, client: @fake).verify!
    assert_equal 98766, binding_b.reload.repository_id

    # Create & deliver Redo issue in Cohort A (repo 98765)
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Cohort A redo"),
        headers: app_headers, as: :json
    end
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    assert_equal 1, @fake.issues[98765].size

    # Passing grade in Cohort B must NOT see or close Cohort A's issue!
    sub_b = Submission.create!(
      user: @student, enrollment: enrollment_b, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'b'", num_submissions: 1
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{sub_b.id}/grade",
        params: grade_params(sub_b, grade: "A", feedback: "Cohort B pass"),
        headers: app_headers, as: :json
    end
    assert_response :success
    assert_equal 0, GithubIssueDelivery.where(enrollment: enrollment_b).count

    # Redo in Cohort B targets strictly Cohort B's binding (repo 98766), not Cohort A's (98765)
    sub_b2 = Submission.create!(
      user: @student, enrollment: enrollment_b, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'b2'", num_submissions: 2, created_at: 1.minute.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{sub_b2.id}/grade",
        params: grade_params(sub_b2, grade: "R", feedback: "Cohort B redo"),
        headers: app_headers, as: :json
    end
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    assert_equal 1, @fake.issues[98765].size
    assert_equal 1, @fake.issues[98766].size
    assert_equal "open", @fake.issues[98765][1][:state]
    assert_includes @fake.issues[98766].values.sole[:body], "Cohort B redo"
  end

  test "permission denial marks delivery failed while Learn grade and feedback remain intact, and staff retry recovers" do
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Clarify loop condition."),
        headers: app_headers, as: :json
    end
    assert_response :success

    @fake.issue_failure = GithubAppClient::Error.new(
      "GitHub installation cannot access this repository; check selected repositories and reconnect",
      status: 403
    )
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)

    delivery = GithubIssueDelivery.sole
    assert_equal "failed", delivery.status
    assert_equal 1, delivery.attempts
    assert_nil delivery.next_retry_at
    assert_includes delivery.last_error, "cannot access this repository"
    assert_equal "R", @submission.reload.grade
    assert_equal "Clarify loop condition.", @submission.feedback

    # Student cannot call retry endpoint
    as_app_user(@student) do
      post "/api/v1/submissions/#{@submission.id}/retry_github_issue", headers: app_headers
    end
    assert_response :forbidden

    # Unassigned instructor cannot call retry endpoint
    other_instructor = User.create!(clerk_id: "other-inst", email: "other-inst@example.invalid", role: :instructor)
    as_app_user(other_instructor) do
      post "/api/v1/submissions/#{@submission.id}/retry_github_issue", headers: app_headers
    end
    assert_response :forbidden

    # Fix permissions -> assigned instructor clicks Retry
    @fake.issue_failure = nil
    with_app_provider do
      as_app_user(@instructor) do
        post "/api/v1/submissions/#{@submission.id}/retry_github_issue", headers: app_headers
      end
    end
    assert_response :success
    body = response.parsed_body
    assert_equal "delivered", body.dig("github_issue_delivery", "status")
    assert_equal 2, body.dig("github_issue_delivery", "attempts")
    assert_equal "https://github.com/app-learner/prework-exercises/issues/1", body.dig("github_issue_delivery", "issue_url")
    assert_equal "https://github.com/app-learner/prework-exercises/issues/1", body.dig("submission", "github_issue_url")
    assert_equal "delivered", body.dig("submission", "github_issue_delivery", "status")

    # Retrying an already-delivered submission returns 422
    with_app_provider do
      as_app_user(@instructor) do
        post "/api/v1/submissions/#{@submission.id}/retry_github_issue", headers: app_headers
      end
    end
    assert_response :unprocessable_entity
  end

  test "ambiguous timeout after issue create reconciles via marker on retry without creating duplicate issues" do
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Avoid global state."),
        headers: app_headers, as: :json
    end
    assert_response :success

    @fake.timeout_after_create = true
    now = Time.current
    GithubIssueDeliveryDrain.new(client: @fake).call(now: now)

    delivery = GithubIssueDelivery.sole
    assert_equal "pending", delivery.status
    assert_equal 1, delivery.attempts
    assert_equal now + 5.minutes, delivery.next_retry_at
    assert_equal 1, @fake.issues[98765].size # GitHub actually created issue #1 before timeout!

    # Second attempt after backoff must reconcile via marker and NOT call create_issue again
    @fake.calls.clear
    GithubIssueDeliveryDrain.new(client: @fake).call(now: now + 6.minutes)

    delivery.reload
    assert_equal "delivered", delivery.status
    assert_equal 2, delivery.attempts
    assert_equal 1, delivery.issue_number
    assert_equal 1, @fake.issues[98765].size, "must never create duplicate GitHub issues"
    assert @fake.calls.any? { |call| call[0] == :find_issue_by_marker }
    assert @fake.calls.none? { |call| call[0] == :create_issue }
  end

  test "transient failures back off exponentially and mark failed after 5 attempts" do
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Check syntax."),
        headers: app_headers, as: :json
    end

    @fake.issue_failure = GithubAppClient::Error.new(GithubAppClient::PROVIDER_ERROR, status: 503)
    clock = Time.current
    [ 5.minutes, 15.minutes, 1.hour, 4.hours ].each_with_index do |expected_backoff, idx|
      GithubIssueDeliveryDrain.new(client: @fake).call(now: clock)
      delivery = GithubIssueDelivery.sole
      assert_equal "pending", delivery.status
      assert_equal idx + 1, delivery.attempts
      assert_equal clock + expected_backoff, delivery.next_retry_at
      clock = delivery.next_retry_at
    end

    GithubIssueDeliveryDrain.new(client: @fake).call(now: clock)
    delivery = GithubIssueDelivery.sole
    assert_equal "failed", delivery.status
    assert_equal 5, delivery.attempts
    assert_nil delivery.next_retry_at
  end

  test "obsolete queued intent after resubmission or superseding grade never calls GitHub" do
    # Case 1: Superseding grade B before tick runs
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Redo"),
        headers: app_headers, as: :json
    end
    first_delivery = GithubIssueDelivery.sole
    assert_equal "pending", first_delivery.status

    @submission.reload
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "B", feedback: "Actually passes!"),
        headers: app_headers, as: :json
    end
    assert_equal "obsolete", first_delivery.reload.status
    assert_equal 1, GithubIssueDelivery.count

    # Case 2: Resubmission arrives before tick drains an R intent
    @submission.reload
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Redo again"),
        headers: app_headers, as: :json
    end
    second_delivery = GithubIssueDelivery.order(:id).last
    assert_equal "pending", second_delivery.status

    # Newer submission arrives directly (e.g. sync/resubmit)
    Submission.create!(
      user: @student, enrollment: @enrollment, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'fixed'", num_submissions: 2, created_at: 1.minute.from_now
    )

    @fake.calls.clear
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    assert_equal "obsolete", second_delivery.reload.status
    assert_empty @fake.calls

    # Retrying an obsolete delivery returns 422
    as_app_user(@instructor) do
      post "/api/v1/submissions/#{@submission.id}/retry_github_issue", headers: app_headers
    end
    assert_response :unprocessable_entity
  end

  test "Off cohort (Cohort 3 shape) uses legacy path untouched, creates zero deliveries, and tick is 1-query no-op when school switch off" do
    off_cohort = Cohort.create!(
      name: "Cohort 3 Off", curriculum: @curriculum, start_date: Date.current, status: :active,
      repository_name: "cohort-3-prework", settings: { features: { student_experience_v2: false } }
    )
    off_cohort.cohort_instructor_assignments.create!(user: @instructor)
    off_enrollment = Enrollment.create!(cohort: off_cohort, user: @student, status: :active)
    off_sub = Submission.create!(
      user: @student, enrollment: off_enrollment, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'c3'", num_submissions: 1
    )

    previous_token = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
    ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = "legacy-token"
    legacy_calls = []
    original_legacy = GithubIssueService.method(:handle_grade)
    GithubIssueService.define_singleton_method(:handle_grade) { |**kwargs| legacy_calls << kwargs; nil }

    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{off_sub.id}/grade",
        params: grade_params(off_sub, grade: "R", feedback: "Cohort 3 feedback"),
        headers: app_headers, as: :json
    end
    assert_response :success
    assert_equal 1, legacy_calls.size
    assert_equal 0, GithubIssueDelivery.where(enrollment: off_enrollment).count
    assert_not response.parsed_body.fetch("submission").key?("github_issue_delivery")

    # Retrying when no delivery exists returns 404
    as_app_user(@instructor) do
      post "/api/v1/submissions/#{off_sub.id}/retry_github_issue", headers: app_headers
    end
    assert_response :not_found

    # When school switch is Off, drain does only 1 query (school_settings) and touches no deliveries
    SchoolSetting.current.update!(features: { github_app: false, github_issue_delivery_v2: false })
    queries = capture_queries { GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current) }
    assert_equal 1, queries.size
    assert_match(/school_settings/, queries.sole)
    assert_equal({ would_claim: 0, enabled: false }, GithubIssueDeliveryDrain.preview(Time.current))
  ensure
    GithubIssueService.define_singleton_method(:handle_grade, original_legacy) if original_legacy
    ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = previous_token
  end

  test "curriculum copy remaps github_issue_deliveries content_block_id for copied cohort only" do
    other_cohort = Cohort.create!(name: "Shared peer", curriculum: @curriculum, start_date: Date.current, status: :active)
    other_enrollment = Enrollment.create!(cohort: other_cohort, user: @other, status: :active)
    other_sub = Submission.create!(user: @other, enrollment: other_enrollment, content_block: @block, submission_type: :prework_github_sync, text: "other")
    other_delivery = GithubIssueDelivery.create!(
      submission: other_sub, enrollment: other_enrollment, content_block: @block,
      action: "open_or_comment", grade: "R", feedback_body: "Other", dedupe_token: SecureRandom.hex(16), status: "pending"
    )
    own_delivery = GithubIssueDelivery.create!(
      submission: @submission, enrollment: @enrollment, content_block: @block,
      github_repository_binding: @binding, repository_id: 98765, repository_full_name: @binding.full_name,
      action: "open_or_comment", grade: "R", feedback_body: "Own", dedupe_token: SecureRandom.hex(16), status: "pending"
    )

    result = CurriculumCopyForCohort.new(cohort: @cohort, user: @admin, source_curriculum_id: @curriculum.id).copy!
    copied_block_id = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: "ContentBlock", old_id: @block.id).new_id

    assert_equal 1, result.counts.fetch("github_issue_deliveries")
    assert_equal copied_block_id, own_delivery.reload.content_block_id
    assert_equal @block.id, other_delivery.reload.content_block_id
  end

  private

  def grade_params(submission, grade:, feedback:)
    {
      grade: grade,
      feedback: feedback,
      base_submission_updated_at: submission.updated_at.iso8601(6)
    }
  end
end
