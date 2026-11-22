require "test_helper"
require_relative "../support/github_app_fixtures"
require_relative "../support/non_transactional_test_cleanup"
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
    now = Time.current.change(usec: 0)
    GithubIssueDeliveryDrain.new(client: @fake).call(now: now)

    delivery = GithubIssueDelivery.sole
    assert_equal "pending", delivery.status
    assert_equal 1, delivery.attempts
    assert_in_delta now + 5.minutes, delivery.next_retry_at, 0.001
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
    clock = Time.current.change(usec: 0)
    [ 5.minutes, 15.minutes, 1.hour, 4.hours ].each_with_index do |expected_backoff, idx|
      GithubIssueDeliveryDrain.new(client: @fake).call(now: clock)
      delivery = GithubIssueDelivery.sole
      assert_equal "pending", delivery.status
      assert_equal idx + 1, delivery.attempts
      assert_in_delta clock + expected_backoff, delivery.next_retry_at, 0.001
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

  test "v2 ignores learner-supplied github_issue_url and isolates two enrollments sharing one repository" do
    cohort_b = Cohort.create!(
      name: "Shared repo cohort B",
      curriculum: @curriculum,
      start_date: Date.current,
      status: :active,
      repository_name: "prework-exercises",
      settings: { features: { github_app: true, github_issue_delivery_v2: true } }
    )
    cohort_b.cohort_instructor_assignments.create!(user: @instructor)
    enrollment_b = Enrollment.create!(cohort: cohort_b, user: @student, status: :active, enrolled_at: 1.day.from_now)
    installation_b = cohort_b.github_app_installations.create!(
      app_id: 12345, installation_id: 457, account_id: 24680, account_login: "app-learner",
      account_type: "User", repository_selection: "selected", connected_at: Time.current, checked_at: Time.current
    )
    binding_b = enrollment_b.github_repository_bindings.create!(
      github_app_installation: installation_b, full_name: "app-learner/prework-exercises"
    )
    GithubRepositoryAccess.new(binding_b, client: @fake).verify!
    assert_equal 98765, binding_b.reload.repository_id

    # Enrollment A creates issue #1 in shared repo 98765
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Enrollment A redo"),
        headers: app_headers, as: :json
    end
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    assert_equal 1, @fake.issues[98765].size
    enrollment_a_issue_url = "https://github.com/app-learner/prework-exercises/issues/1"
    assert_equal enrollment_a_issue_url, @submission.reload.github_issue_url

    # Learner supplies Enrollment A's issue URL on an Enrollment B submission
    sub_b = Submission.create!(
      user: @student, enrollment: enrollment_b, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'spoofed'",
      github_issue_url: enrollment_a_issue_url, num_submissions: 1
    )

    # Passing grade in Enrollment B must NOT trust learner-supplied github_issue_url or close Enrollment A's issue
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{sub_b.id}/grade",
        params: grade_params(sub_b, grade: "A", feedback: "Enrollment B pass"),
        headers: app_headers, as: :json
    end
    assert_response :success
    assert_equal 0, GithubIssueDelivery.where(enrollment: enrollment_b).count
    assert_equal "open", @fake.issues[98765][1][:state]

    # Redo grade in Enrollment B must create a separate issue #2 instead of commenting on Enrollment A's issue #1
    sub_b2 = Submission.create!(
      user: @student, enrollment: enrollment_b, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'b2'",
      github_issue_url: enrollment_a_issue_url, num_submissions: 2, created_at: 1.minute.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{sub_b2.id}/grade",
        params: grade_params(sub_b2, grade: "R", feedback: "Enrollment B redo"),
        headers: app_headers, as: :json
    end
    assert_response :success
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)

    assert_equal 2, @fake.issues[98765].size
    assert_empty @fake.issues[98765][1][:comments]
    assert_equal "https://github.com/app-learner/prework-exercises/issues/2", sub_b2.reload.github_issue_url
  end

  test "verified repository_id is persisted before first GitHub write, uncertain predecessors reconcile, and inconclusive search fails safely" do
    # 1. Verified repository_id persisted BEFORE first write
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Initial feedback"),
        headers: app_headers, as: :json
    end
    delivery1 = GithubIssueDelivery.sole
    delivery1.update_columns(repository_id: nil, repository_full_name: nil)

    seen_repo_id_before_write = nil
    seen_full_name_before_write = nil
    @fake.on_create_issue = lambda do |**|
      reloaded = GithubIssueDelivery.find(delivery1.id)
      seen_repo_id_before_write = reloaded.repository_id
      seen_full_name_before_write = reloaded.repository_full_name
    end
    @fake.timeout_after_create = true

    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    @fake.on_create_issue = nil

    assert_equal 98765, seen_repo_id_before_write
    assert_equal "app-learner/prework-exercises", seen_full_name_before_write
    assert_equal 1, @fake.issues[98765].size
    assert_nil delivery1.reload.issue_number
    assert_equal 1, delivery1.attempts

    # 2. Resubmission obsoletes uncertain attempt 1, then attempt 2 R reconciles predecessor marker instead of duplicating
    attempt2 = Submission.create!(
      user: @student, enrollment: @enrollment, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'attempt 2'", num_submissions: 2, created_at: 1.minute.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{attempt2.id}/grade",
        params: grade_params(attempt2, grade: "R", feedback: "Still needs work"),
        headers: app_headers, as: :json
    end
    assert_equal "obsolete", delivery1.reload.status

    @fake.calls.clear
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)

    assert_equal 1, @fake.issues[98765].size, "must reuse issue discovered from uncertain predecessor marker"
    assert_equal 1, @fake.issues[98765][1][:comments].size
    assert_includes @fake.issues[98765][1][:comments].last[:body], "Still needs work"
    assert_equal 1, delivery1.reload.issue_number
    assert_equal "obsolete", delivery1.status
    assert @fake.calls.none? { |call| call[0] == :create_issue }

    # 3. Inconclusive marker search fails safely without blindly creating a duplicate issue
    block2 = ContentBlock.create!(lesson: @lesson, block_type: :exercise, position: 1, title: "Ex 2", filename: "ex2.rb", submission_type: :prework_github_sync)
    sub_inc = Submission.create!(user: @student, enrollment: @enrollment, content_block: block2, submission_type: :prework_github_sync, text: "x")
    delivery_inc = GithubIssueDelivery.create!(
      submission: sub_inc, enrollment: @enrollment, content_block: block2,
      github_repository_binding: @binding, repository_id: 98765, repository_full_name: @binding.full_name,
      action: "open_or_comment", grade: "R", feedback_body: "Check bounds", dedupe_token: SecureRandom.hex(16),
      status: "pending", attempts: 1
    )
    sub_inc.update_columns(grade: "R", feedback: "Check bounds")

    @fake.calls.clear
    @fake.inconclusive_marker_search = true
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    @fake.inconclusive_marker_search = false

    delivery_inc.reload
    assert_equal "failed", delivery_inc.status
    assert_includes delivery_inc.last_error, "Could not confirm"
    assert @fake.calls.none? { |call| call[0] == :create_issue }
  end

  test "transient repo lookup 503 preserves verified binding and 403 rate limit retries honoring Retry-After" do
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Fix nil check."),
        headers: app_headers, as: :json
    end
    now = Time.current.change(usec: 0)

    # 1. Transient 503 on repository lookup must NOT invalidate verified binding
    @fake.failure = GithubAppClient::Error.new(GithubAppClient::PROVIDER_ERROR, status: 503)
    GithubIssueDeliveryDrain.new(client: @fake).call(now: now)

    delivery = GithubIssueDelivery.sole
    assert_equal "verified", @binding.reload.verification_state
    assert_equal "pending", delivery.status
    assert_equal 1, delivery.attempts
    assert_in_delta now + 5.minutes, delivery.next_retry_at, 0.001

    # 2. 403 rate limit on issue create is retryable and honors Retry-After
    @fake.failure = nil
    @fake.issue_failure = GithubAppClient::Error.new(
      "GitHub rate limit reached; try again later",
      status: 403,
      retry_after: 90,
      rate_limited: true
    )
    t2 = now + 6.minutes
    GithubIssueDeliveryDrain.new(client: @fake).call(now: t2)

    delivery.reload
    assert_equal "pending", delivery.status
    assert_equal 2, delivery.attempts
    assert_in_delta t2 + 90.seconds, delivery.next_retry_at, 0.001

    # 3. Recovery succeeds cleanly after Retry-After elapses
    @fake.issue_failure = nil
    GithubIssueDeliveryDrain.new(client: @fake).call(now: t2 + 91.seconds)

    delivery.reload
    assert_equal "delivered", delivery.status
    assert_equal 3, delivery.attempts
    assert_equal 1, delivery.issue_number
  end

  test "drain respects wall-clock max_duration budget and leaves remaining rows pending" do
    block2 = ContentBlock.create!(lesson: @lesson, block_type: :exercise, position: 1, title: "Ex 2", filename: "ex2.rb", submission_type: :prework_github_sync)
    sub2 = Submission.create!(user: @student, enrollment: @enrollment, content_block: block2, submission_type: :prework_github_sync, text: "y")

    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade", params: grade_params(@submission, grade: "R", feedback: "Fix 1"), headers: app_headers, as: :json
      patch "/api/v1/submissions/#{sub2.id}/grade", params: grade_params(sub2, grade: "R", feedback: "Fix 2"), headers: app_headers, as: :json
    end

    ticks = [ 0.0, 0.1, 25.0 ]
    metrics = {}
    GithubIssueDeliveryDrain.new(client: @fake, max_duration: 20.seconds, monotonic: -> { ticks.shift || 30.0 }).call(now: Time.current, metrics: metrics)

    assert_equal({ claimed: 1, sent: 1, failed: 0 }, metrics)
    assert_equal 1, GithubIssueDelivery.where(status: "delivered").count
    assert_equal 1, GithubIssueDelivery.where(status: "pending").count
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

# Real committed connections for multi-thread lease, barrier, and race tests.
class GithubIssueDeliveriesConcurrencyTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  include NonTransactionalTestCleanup
  self.use_transactional_tests = false

  setup do
    @suffix = SecureRandom.hex(4)
    @admin = User.create!(clerk_id: "conc-admin-#{@suffix}", email: "conc-admin-#{@suffix}@example.invalid", role: :admin)
    @instructor = User.create!(clerk_id: "conc-inst-#{@suffix}", email: "conc-inst-#{@suffix}@example.invalid", role: :instructor)
    @student = User.create!(clerk_id: "conc-stu-#{@suffix}", email: "conc-stu-#{@suffix}@example.invalid", role: :student, github_username: "app-learner")
    @student.record_verified_github_identity!(id: "24680", login: "app-learner")

    @curriculum = Curriculum.create!(name: "Concurrency Curriculum #{@suffix}")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Lesson 1", position: 0, release_day: 0)
    @block = ContentBlock.create!(lesson: @lesson, block_type: :exercise, position: 0, title: "Ex 1", filename: "111.rb", submission_type: :prework_github_sync)

    @previous_school_features = SchoolSetting.current.features.dup
    SchoolSetting.current.update!(features: { github_app: true, github_issue_delivery_v2: true })
    @cohort = Cohort.create!(
      name: "Concurrency Cohort #{@suffix}",
      curriculum: @curriculum,
      start_date: Date.current,
      status: :active,
      repository_name: "prework-exercises",
      settings: { features: { github_app: true, github_issue_delivery_v2: true } }
    )
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @enrollment = Enrollment.create!(cohort: @cohort, user: @student, status: :active)
    @installation = @cohort.github_app_installations.create!(
      app_id: 12345, installation_id: 700 + rand(10_000), account_id: 24680, account_login: "app-learner",
      account_type: "User", repository_selection: "selected", connected_at: Time.current, checked_at: Time.current
    )
    @binding = @enrollment.github_repository_bindings.create!(
      github_app_installation: @installation, full_name: "app-learner/prework-exercises"
    )
    @fake = FakeGithubAppClient.new
    GithubRepositoryAccess.new(@binding, client: @fake).verify!
    @fake.calls.clear

    @submission = Submission.create!(
      user: @student, enrollment: @enrollment, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'v1'", num_submissions: 1
    )
    @threads = []
  end

  teardown do
    finish_test_threads(@threads)
    GithubIssueDelivery.where(enrollment_id: @enrollment&.id).delete_all
    Submission.where(enrollment_id: @enrollment&.id).delete_all
    Progress.where(enrollment_id: @enrollment&.id).delete_all
    ActivityEvent.where(cohort_id: @cohort&.id).delete_all
    @binding&.destroy
    @installation&.destroy
    @enrollment&.destroy
    @cohort&.destroy
    @curriculum&.destroy
    delete_test_users(@student, @instructor, @admin)
    SchoolSetting.current.update!(features: @previous_school_features) if defined?(@previous_school_features)
  end

  test "active claim lease blocks concurrent staff retries and staff retry during active tick, and stale claim_token cannot overwrite" do
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Fix race"),
        headers: app_headers, as: :json
    end
    assert_response :success
    delivery = GithubIssueDelivery.find_by!(submission_id: @submission.id)

    # 1. Tick paused in create_issue -> staff retry_github_issue returns 409 Conflict with zero concurrent writes
    entered = Queue.new
    release = Queue.new
    @fake.on_create_issue = lambda do |**|
      entered << true
      release.pop
    end

    worker = Thread.new do
      Rails.application.executor.wrap do
        GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
      end
    end
    @threads << worker
    assert entered.pop

    with_app_provider do
      as_app_user(@instructor) do
        post "/api/v1/submissions/#{@submission.id}/retry_github_issue", headers: app_headers
      end
    end
    assert_response :conflict
    assert_equal 1, @fake.calls.count { |c| c[0] == :create_issue }

    release << true
    assert worker.join(10)
    assert_equal "delivered", delivery.reload.status
    assert_equal 1, @fake.issues[98765].size

    # 2. Concurrent staff retries on a second failed delivery -> exactly one succeeds, one gets 409
    sub2 = Submission.create!(
      user: @student, enrollment: @enrollment, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'v2'", num_submissions: 2, created_at: 1.minute.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{sub2.id}/grade",
        params: grade_params(sub2, grade: "R", feedback: "Retry race"),
        headers: app_headers, as: :json
    end
    delivery2 = GithubIssueDelivery.find_by!(submission_id: sub2.id)
    delivery2.update!(status: "failed", last_error: "Temporary error")

    entered2 = Queue.new
    release2 = Queue.new
    @fake.on_create_issue = nil
    original_add_comment = @fake.method(:add_issue_comment)
    @fake.define_singleton_method(:add_issue_comment) do |**kwargs|
      entered2 << true
      release2.pop
      original_add_comment.call(**kwargs)
    end

    first_retry = Thread.new do
      Rails.application.executor.wrap do
        GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(delivery2.id, force: true)
      end
    end
    @threads << first_retry
    assert entered2.pop

    second_outcome = GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(delivery2.id, force: true)
    assert_equal :in_flight, second_outcome

    # Also test stale claim_token: if lease expires and a new worker takes over, old worker cannot overwrite
    release2 << true
    assert first_retry.join(10)
    assert_equal :delivered, first_retry.value
    assert_equal 1, @fake.issues[98765][1][:comments].size
    @fake.define_singleton_method(:add_issue_comment, original_add_comment)

    # 3. Stale claim_token protection directly
    sub3 = Submission.create!(
      user: @student, enrollment: @enrollment, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'v3'", num_submissions: 3, created_at: 2.minutes.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{sub3.id}/grade",
        params: grade_params(sub3, grade: "R", feedback: "Stale claim test"),
        headers: app_headers, as: :json
    end
    delivery3 = GithubIssueDelivery.find_by!(submission_id: sub3.id)

    stale_entered = Queue.new
    stale_release = Queue.new
    hit_count = 0
    @fake.define_singleton_method(:add_issue_comment) do |**kwargs|
      hit_count += 1
      if hit_count == 1
        stale_entered << true
        stale_release.pop
        raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 403)
      end
      original_add_comment.call(**kwargs)
    end

    stale_worker = Thread.new do
      Rails.application.executor.wrap do
        GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(delivery3.id, force: false)
      end
    end
    @threads << stale_worker
    assert stale_entered.pop

    # Expire lease so a fresh worker takes over and delivers cleanly
    delivery3.update_columns(claimed_until: 1.minute.ago)
    fresh_outcome = GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(delivery3.id, force: false)
    assert_equal :delivered, fresh_outcome
    assert_equal "delivered", delivery3.reload.status

    # Now let the stale worker fail and try to finalize — it MUST NOT overwrite delivered status!
    stale_release << true
    assert stale_worker.join(10)
    assert_equal :stale_claim, stale_worker.value
    assert_equal "delivered", delivery3.reload.status
    assert_nil delivery3.last_error
  ensure
    release << true if defined?(release) && release
    release2 << true if defined?(release2) && release2
    stale_release << true if defined?(stale_release) && stale_release
  end

  test "passing grade during in-flight R create persists close intent, keeps obsolete R obsolete, and closes the created issue" do
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Initial redo"),
        headers: app_headers, as: :json
    end
    redo_delivery = GithubIssueDelivery.find_by!(submission_id: @submission.id)

    entered = Queue.new
    release = Queue.new
    @fake.on_create_issue = lambda do |**|
      entered << true
      release.pop
    end

    worker = Thread.new do
      Rails.application.executor.wrap do
        GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(redo_delivery.id)
      end
    end
    @threads << worker
    assert entered.pop

    # Passing grade B commits while first R create is paused in flight
    @submission.reload
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "B", feedback: "Actually passes!"),
        headers: app_headers, as: :json
    end
    assert_response :success

    assert_equal "obsolete", redo_delivery.reload.status
    assert redo_delivery.claimed?, "active lease must stay intact while worker is in flight"

    close_delivery = GithubIssueDelivery.where(submission_id: @submission.id, action: "close").sole
    assert_equal "pending", close_delivery.status
    assert_nil close_delivery.issue_number

    # While R is still in flight, close delivery MUST NOT run concurrently in the same scope
    assert_equal :scope_busy, GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(close_delivery.id)

    # Release R create -> finishes creating issue #1, stays obsolete, records issue_number: 1
    release << true
    assert worker.join(10)
    assert_equal :obsolete, worker.value

    redo_delivery.reload
    assert_equal "obsolete", redo_delivery.status, "obsolete row must NEVER revert to delivered"
    assert_equal 1, redo_delivery.issue_number
    assert_nil redo_delivery.claim_token
    assert_nil redo_delivery.claimed_until
    assert_equal "open", @fake.issues[98765][1][:state]

    # Now drain closes issue #1 using the issue_number recorded by the obsolete R delivery
    @fake.on_create_issue = nil
    assert_equal :delivered, GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(close_delivery.id)
    assert_equal "delivered", close_delivery.reload.status
    assert_equal 1, close_delivery.issue_number
    assert_equal "closed", @fake.issues[98765][1][:state]
  ensure
    release << true if defined?(release) && release
  end

  test "newer R during in-flight close is serialized and reopens the issue without being clobbered by older close" do
    # Deliver initial R -> creates issue #1
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "First redo"),
        headers: app_headers, as: :json
    end
    GithubIssueDeliveryDrain.new(client: @fake).call(now: Time.current)
    assert_equal "open", @fake.issues[98765][1][:state]

    # Grade attempt 2 B -> queues close delivery
    attempt2 = Submission.create!(
      user: @student, enrollment: @enrollment, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'v2'", num_submissions: 2, created_at: 1.minute.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{attempt2.id}/grade",
        params: grade_params(attempt2, grade: "B", feedback: "Looks good"),
        headers: app_headers, as: :json
    end
    close_delivery = GithubIssueDelivery.find_by!(submission_id: attempt2.id, action: "close")

    entered = Queue.new
    release = Queue.new
    @fake.on_close_issue = lambda do |**|
      entered << true
      release.pop
    end

    worker = Thread.new do
      Rails.application.executor.wrap do
        GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(close_delivery.id)
      end
    end
    @threads << worker
    assert entered.pop

    # While close is in flight, attempt 3 is graded R
    attempt3 = Submission.create!(
      user: @student, enrollment: @enrollment, content_block: @block,
      submission_type: :prework_github_sync, text: "puts 'v3'", num_submissions: 3, created_at: 2.minutes.from_now
    )
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{attempt3.id}/grade",
        params: grade_params(attempt3, grade: "R", feedback: "Regression found"),
        headers: app_headers, as: :json
    end
    assert_response :success
    newer_redo = GithubIssueDelivery.find_by!(submission_id: attempt3.id, action: "open_or_comment")

    assert_equal "obsolete", close_delivery.reload.status
    assert_equal :scope_busy, GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(newer_redo.id)

    # Release older close -> finishes closing issue #1, stays obsolete, does NOT clobber newer R
    release << true
    assert worker.join(10)
    assert_equal :obsolete, worker.value
    assert_equal "obsolete", close_delivery.reload.status
    assert_equal "pending", newer_redo.reload.status
    assert_equal "closed", @fake.issues[98765][1][:state]

    # Drain newer R -> sees issue closed, explicitly reopens it, posts comment, delivers cleanly
    @fake.on_close_issue = nil
    assert_equal :delivered, GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(newer_redo.id)
    assert_equal "delivered", newer_redo.reload.status
    assert_equal "open", @fake.issues[98765][1][:state]
    assert_includes @fake.issues[98765][1][:comments].last[:body], "Regression found"
  ensure
    release << true if defined?(release) && release
  end

  test "superseded claim detected during repository verification aborts before mutating GitHub" do
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "R", feedback: "Will be superseded before write"),
        headers: app_headers, as: :json
    end
    redo_delivery = GithubIssueDelivery.find_by!(submission_id: @submission.id)

    entered = Queue.new
    release = Queue.new
    @fake.on_repository = lambda do |**|
      entered << true
      release.pop
    end

    worker = Thread.new do
      Rails.application.executor.wrap do
        GithubIssueDeliveryDrain.new(client: @fake).deliver_one!(redo_delivery.id)
      end
    end
    @threads << worker
    assert entered.pop

    # Supersede R with passing B while repository verification is in flight (before any issue write!)
    @submission.reload
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grade_params(@submission, grade: "A", feedback: "Great!"),
        headers: app_headers, as: :json
    end
    assert_response :success

    release << true
    assert worker.join(10)
    assert_equal :obsolete, worker.value
    assert_equal "obsolete", redo_delivery.reload.status
    assert_nil redo_delivery.claim_token
    assert_empty @fake.issues, "superseded claim must abort BEFORE creating any GitHub issue"
  ensure
    release << true if defined?(release) && release
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
