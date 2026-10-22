require "test_helper"

class LearnerCapabilitiesTest < ActionDispatch::IntegrationTest
  setup do
    @curriculum = Curriculum.create!(name: "P8 entitlement course")
    @mod = @curriculum.modules.create!(name: "Foundations", position: 0, schedule_days: "daily")
    @lesson = @mod.lessons.create!(title: "Practice", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, submission_type: :text_submission)
    @student = User.create!(clerk_id: "p8_student", email: "p8-student@example.com", first_name: "Learner", role: :student)
    @instructor = User.create!(clerk_id: "p8_staff", email: "p8-staff@example.com", first_name: "Guide", role: :instructor)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "P8 guided", start_date: Date.current, status: :active, course_delivery: "guided")
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 3.months.from_now, support_expires_at: 1.month.from_now)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
  end

  test "active guided enrollment shares one writable contextual help contract" do
    assert_contract(can_submit: true, support_mode: "guided_help")
    assert_equal @cohort, HelpRequestContext.resolve!(student: @student, cohort_id: @cohort.id, context_type: "lesson", context_id: @lesson.id).cohort

    as_student { post "/api/v1/help_requests", params: help_params, headers: headers, as: :json }
    assert_response :created
  end

  test "support expiry preserves learning writes but disables help writes and preserves responses" do
    request = previous_request
    @enrollment.update!(support_expires_at: 1.second.ago)

    assert_contract(can_submit: true, support_mode: "none")
    assert_help_forbidden
    assert_previous_response_readable(request)
  end

  test "completed enrollment retains work and feedback with review-only capabilities" do
    request = previous_request
    submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @block, text: "Saved answer", grade: :R, feedback: "Try again")
    @enrollment.update!(status: :completed)

    assert_contract(can_submit: false, support_mode: "none")
    as_student { get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: @cohort.id }, headers: headers }
    saved = response.parsed_body.dig("lesson", "content_blocks").sole.fetch("submissions").sole
    assert_equal submission.id, saved.fetch("id")
    assert_equal "Try again", saved.fetch("feedback")
    assert_help_forbidden
    assert_previous_response_readable(request)
  end

  test "completed enrollment cannot cancel an old open help request" do
    request = previous_request(resolved: false)
    @enrollment.update!(status: :completed)

    as_student { patch "/api/v1/help_requests/#{request.id}", params: { help_request: { status: "canceled" } }, headers: headers, as: :json }
    assert_response :forbidden
    assert request.reload.status_open?
  end

  test "self-paced lesson first open starts support once and exposes course questions" do
    self_paced!
    @enrollment.update!(support_expires_at: nil)
    travel_to Time.current.change(usec: 0) do
      as_student { get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: @cohort.id }, headers: headers }
      assert_response :success
      assert_equal "course_question", response.parsed_body.dig("lesson", "capabilities", "support_mode")
      assert_equal Time.current, @enrollment.reload.first_opened_at
      expires = @enrollment.support_expires_at
      assert_equal Time.current + @cohort.self_paced_support_weeks.weeks, expires
      travel 1.day
      assert_contract(can_submit: true, support_mode: "course_question")
      assert_equal expires, @enrollment.reload.support_expires_at
    end
    # Self-paced questions use the assigned instructor conversation, never guided help.
    assert_help_forbidden
  end

  test "self-paced support never points into a closed or blocked instructor conversation" do
    self_paced!
    @enrollment.update!(first_opened_at: Time.current, support_expires_at: 1.month.from_now)
    [ :completed, :archived ].each do |status|
      @cohort.update!(status: status)
      assert_contract(can_submit: true, support_mode: "none")
    end
    @cohort.update!(status: :active)
    @cohort.workspace.update!(status: :archived)
    assert_contract(can_submit: true, support_mode: "none")
    @cohort.workspace.update!(status: :active)
    block = UserBlock.create!(blocker: @student, blocked_user: @instructor)
    assert_contract(can_submit: true, support_mode: "none")
    block.destroy!
    @instructor.update!(archived_at: Time.current)
    assert_contract(can_submit: true, support_mode: "none")
  end

  test "self-paced support expiry or missing assigned instructor never advertises course questions" do
    self_paced!
    @enrollment.update!(first_opened_at: 2.months.ago, support_expires_at: 1.second.ago)
    assert_contract(can_submit: true, support_mode: "none")
    assert_previous_response_readable(previous_request)

    @enrollment.update!(support_expires_at: 1.month.from_now)
    @cohort.update!(support_instructor: nil)
    assert_contract(can_submit: true, support_mode: "none")
    assert_help_forbidden
  end

  test "paused and dropped enrollments cannot advertise learner capabilities" do
    %i[paused dropped].each do |status|
      @enrollment.update!(status: status)
      capabilities = EnrollmentCapabilities.for(@enrollment.reload)
      refute capabilities[:can_submit]
      assert capabilities[:read_only]
      assert_equal "none", capabilities[:support_mode]
      as_student { get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: @cohort.id }, headers: headers }
      assert_response :forbidden
    end
  end

  test "completed self-paced reads do not start or renew support" do
    self_paced!
    @enrollment.update!(status: :completed, support_expires_at: nil)

    assert_contract(can_submit: false, support_mode: "none")
    assert_nil @enrollment.reload.first_opened_at
    assert_nil @enrollment.support_expires_at
    assert_help_forbidden
  end

  test "access expiry denies all course surfaces and all capabilities become read-only" do
    [ "guided", "self_paced" ].each do |delivery|
      @cohort.update!(course_delivery: delivery, support_instructor: @instructor)
      @enrollment.update!(access_expires_at: 1.second.ago)
      capabilities = EnrollmentCapabilities.for(@enrollment.reload)
      assert_equal false, capabilities[:can_submit]
      assert_equal true, capabilities[:read_only]
      assert_equal "none", capabilities[:support_mode]
      %W[/api/v1/lessons/#{@lesson.id} /api/v1/dashboard /api/v1/weekly_plan].each do |path|
        as_student { get path, params: { cohort_id: @cohort.id }, headers: headers }
        assert_response :forbidden
      end
      assert_help_forbidden
    end
  end

  private

  def assert_contract(can_submit:, support_mode:)
    %W[/api/v1/lessons/#{@lesson.id} /api/v1/dashboard /api/v1/weekly_plan].zip(%w[lesson dashboard weekly_plan]).each do |path, root|
      as_student { get path, params: { cohort_id: @cohort.id }, headers: headers }
      assert_response :success
      actual = response.parsed_body.fetch(root).fetch("capabilities")
      @enrollment.reload
      assert_equal({
        "can_submit" => can_submit, "read_only" => !can_submit, "support_mode" => support_mode,
        "support_expires_at" => @enrollment.support_expires_at&.iso8601(3),
        "access_expires_at" => @enrollment.access_expires_at&.iso8601(3),
        "support_instructor_id" => @cohort.support_instructor_id
      }, actual)
    end
  end

  def assert_help_forbidden
    as_student { post "/api/v1/help_requests", params: help_params, headers: headers, as: :json }
    assert_response :forbidden
  end

  def previous_request(resolved: true)
    request = @student.help_requests.create!(cohort: @cohort, context_type: :exercise, context_id: @block.id,
      context_label: "Practice", context_path: "/lessons/#{@lesson.id}", category: :concept, message: "Where do I start?")
    request.resolve!(@instructor, response: "Review the saved example.") if resolved
    request
  end

  def assert_previous_response_readable(request)
    as_student { get "/api/v1/help_requests/#{request.id}", headers: headers }
    assert_response :success
    assert_equal "Review the saved example.", response.parsed_body.dig("help_request", "staff_response")
    as_student { get "/api/v1/help_requests", params: { cohort_id: @cohort.id }, headers: headers }
    assert_response :success
    assert_equal request.id, response.parsed_body.fetch("help_requests").sole.fetch("id")
  end

  def self_paced!
    @cohort.update!(course_delivery: "self_paced", support_instructor: @instructor)
  end

  def help_params
    { help_request: { cohort_id: @cohort.id, context_type: "lesson", context_id: @lesson.id, category: "concept", message: "Help me practice" } }
  end

  def headers = { "Authorization" => "Bearer test_token" }

  def as_student
    original = ClerkAuth.method(:verify)
    payload = { "sub" => @student.clerk_id, "email" => @student.email }
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
