require "test_helper"
require_relative "../support/query_counter"

class SetupWizardTest < ActionDispatch::IntegrationTest
  include QueryCounter
  setup do
    @admin = User.create!(email: "setup-admin@example.test", clerk_id: "setup-admin", role: :admin)
    @curriculum = Curriculum.create!(name: "Synthetic curriculum", status: :active)
    @cohort = Cohort.create!(name: "Internal pilot", curriculum: @curriculum, start_date: LearningCalendar.today, course_delivery: "self_paced")
  end

  test "inline provider failures are isolated in bulk and single enrollment" do
    previous_adapter = SendUserInviteEmailJob.queue_adapter
    SendUserInviteEmailJob.queue_adapter = :inline
    original_send = UserInviteEmailService.method(:send_invite)
    original_clerk = ClerkInvitationService.method(:new)
    clerk = Object.new
    clerk.define_singleton_method(:configured?) { true }
    clerk.define_singleton_method(:create_invitation) do |email:, **|
      raise IOError, "secret clerk token" if email.start_with?("clerkbad")
      { success: true, url: "https://example.test/invite" }
    end
    ClerkInvitationService.define_singleton_method(:new) { clerk }
    sends = []
    UserInviteEmailService.define_singleton_method(:send_invite) do |user:, **|
      sends << user.email
      raise IOError, "secret resend token" if user.email.start_with?("resendbad")
      true
    end
    as_user(@admin) do
      %w[resendbad clerkbad].each do |bad|
        rows = [ "good1#{bad}", bad, "good2#{bad}" ].map { |name| { email: "#{name}@example.test" } }
        ApplicationJob.enqueue_within_transaction do
          post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: rows, send_invite: true }, headers: auth_headers, as: :json
        end
        assert_response :success
        assert_equal %w[sent failed sent], response.parsed_body["results"].map { |r| r["invitation_status"] }
        refute_includes response.body, "secret"
        assert_equal "IOError", User.find_by!(email: "#{bad}@example.test").invite_last_error
        before = sends.count { |email| email.start_with?("good") }
        ApplicationJob.enqueue_within_transaction do
          post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: rows, send_invite: true }, headers: auth_headers, as: :json
        end
        assert_equal before, sends.count { |email| email.start_with?("good") }
        user = User.create!(email: "#{bad}single@example.test", clerk_id: "pending_#{bad}")
        ApplicationJob.enqueue_within_transaction do
          post "/api/v1/cohorts/#{@cohort.id}/enrollments", params: { user_id: user.id, send_invite: true }, headers: auth_headers, as: :json
        end
        assert_response :created
        assert_equal "failed", response.parsed_body.dig("invitation", "status")
      end
    end
  ensure
    SendUserInviteEmailJob.queue_adapter = previous_adapter
    UserInviteEmailService.define_singleton_method(:send_invite, original_send)
    ClerkInvitationService.define_singleton_method(:new, original_clerk)
  end

  test "25 enrollment rows have bounded queries and no provider work" do
    mod = @curriculum.modules.create!(name: "Assigned", position: 0)
    @cohort.update!(content_defaults: { mod.id.to_s => { assigned: true, unlocked: true } })
    as_user(@admin) do
      queries = count_queries do
        post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: 25.times.map { |i| { email: "bounded#{i}@example.test" } } }, headers: auth_headers, as: :json
      end
      assert_response :success
      assert_equal 25, @cohort.enrollments.count
      assert_equal 25, ModuleAssignment.where(enrollment_id: @cohort.enrollments.select(:id), module_id: mod.id, unlocked: true).count
      assert_operator queries, :<, 250
      assert_equal 25, User.where("email LIKE 'bounded%'").where(invite_delivery_status: "not_sent").count
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: 4.times.map { |i| { email: "bounded#{i}@example.test" } }, dispatch_only: true, send_invite: true }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
    end
  end

  test "started cohort refuses upcoming until its date moves into the future" do
    @cohort.update_columns(public_checkout_enabled: true)
    get "/api/v1/course_offerings"
    assert_includes response.parsed_body["offerings"].map { |row| row["id"] }, @cohort.id
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}", params: { status: "upcoming" }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      assert_includes response.body, "Move the start date to hold this cohort"
      patch "/api/v1/cohorts/#{@cohort.id}", params: { status: "upcoming", start_date: LearningCalendar.today + 1 }, headers: auth_headers, as: :json
      assert_response :success
      refute @cohort.reload.active?
      get "/api/v1/course_offerings"
      refute_includes response.parsed_body["offerings"].map { |row| row["id"] }, @cohort.id
    end
  end

  test "record summary labels arrived upcoming cohorts Active" do
    @cohort.update_columns(status: Cohort.statuses.fetch("upcoming"), course_delivery: "program")
    summary = RecordSummary.for(viewer: @admin, type: "cohort", id: @cohort.id)
    assert_includes summary[:subtitle], "Active"
    refute_includes summary[:subtitle], "Upcoming"
  end

  test "server readiness exposes booleans and previews catalog copy without saving" do
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/setup_readiness",
        params: { public_title: "Public course", public_description: "Learn useful skills", public_image_url: "https://example.test/course.png" }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert response.parsed_body.dig("readiness", "catalog_copy")
    assert_equal false, response.parsed_body.dig("school_checkout", "enabled")
    assert response.parsed_body["school_checkout"].values.all? { |value| value == true || value == false }
    assert_nil @cohort.reload.public_title
  end

  test "future cohort defaults upcoming and current cohort active" do
    assert @cohort.active?
    future = Cohort.create!(name: "Future", curriculum: @curriculum, start_date: LearningCalendar.today + 10)
    assert future.upcoming?
  end

  test "catalog returns public copy and never internal name" do
    @cohort.update!(public_checkout_enabled: true, public_title: "Learn Ruby", public_description: "Build a project", public_image_url: "https://example.test/ruby.png")
    get "/api/v1/course_offerings"
    assert_response :success
    offering = response.parsed_body["offerings"].find { |row| row["id"] == @cohort.id }
    assert_equal "Learn Ruby", offering["name"]
    assert_equal "Build a project", offering["description"]
    assert_equal "https://example.test/ruby.png", offering["image_url"]
    refute_includes response.body, "Internal pilot"
  end

  test "batch enrollment reports rows and is idempotent" do
    rows = [ { email: "new@example.test", first_name: "New", last_name: "Learner" }, { email: "NEW@example.test" }, { email: "invalid" }, { email: @admin.email } ]
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: rows }, headers: auth_headers, as: :json
      assert_response :success
      assert_equal %w[enrolled duplicate error error], response.parsed_body["results"].map { |r| r["status"] }
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: rows.first(1) }, headers: auth_headers, as: :json
      assert_equal "already_enrolled", response.parsed_body["results"].first["status"]
    end
    assert_equal 1, @cohort.enrollments.count
    assert_equal "New", User.find_by!(email: "new@example.test").first_name
  end

  test "cap and admin permissions" do
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: Array.new(201) { { email: "cap@example.test" } } }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
    end
    instructor = User.create!(email: "setup-instructor@example.test", clerk_id: "setup-instructor", role: :instructor)
    as_user(instructor) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: [ { email: "no@example.test" } ] }, headers: auth_headers, as: :json
      assert_response :forbidden
      post "/api/v1/cohorts/#{@cohort.id}/setup_readiness", headers: auth_headers, as: :json
      assert_response :forbidden
    end
  end
  test "publish rejects boolean and string flags when school checkout is off" do
    as_user(@admin) do
      [ true, "true" ].each do |flag|
        patch "/api/v1/cohorts/#{@cohort.id}", params: { public_checkout_enabled: flag }, headers: auth_headers, as: :json
        assert_response :unprocessable_entity
        refute @cohort.reload.public_checkout_enabled?
      end
    end
  end

  test "all readiness checks pass with published content assigned instructor and school ready" do
    instructor = User.create!(email: "ready-instructor@example.test", clerk_id: "ready-instructor", role: :instructor)
    @cohort.instructors << instructor
    mod = @curriculum.modules.create!(name: "Synthetic module", position: 0)
    lesson = mod.lessons.create!(title: "Synthetic lesson", position: 0)
    lesson.content_blocks.create!(block_type: :text, body: "Synthetic content", position: 0)
    @cohort.update!(support_instructor: instructor, public_price_cents: 14900, stripe_price_id: "price_synthetic",
      public_title: "Synthetic course", public_description: "Learn with a project", public_image_url: "https://example.test/course.png",
      content_defaults: { mod.id.to_s => { "assigned" => true } })
    original = CourseCheckout.method(:enabled?)
    CourseCheckout.define_singleton_method(:enabled?) { true }
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/setup_readiness", headers: auth_headers, as: :json
      assert_response :success
      assert response.parsed_body["readiness"].values.all?
      patch "/api/v1/cohorts/#{@cohort.id}", params: { public_checkout_enabled: true }, headers: auth_headers, as: :json
      assert_response :success
      assert @cohort.reload.public_checkout_enabled?
    end
  ensure
    CourseCheckout.define_singleton_method(:enabled?, original) if original
  end

  test "upcoming becomes effectively active without changing stored status and explicit upcoming survives create" do
    cohort = Cohort.create!(name: "Explicit", curriculum: @curriculum, start_date: LearningCalendar.today + 1, status: :upcoming)
    travel 2.days do
      assert cohort.reload.active?
      assert_includes Cohort.active, cohort
      assert_equal "upcoming", cohort.status
    end
    explicit = Cohort.create!(name: "Past explicit", curriculum: @curriculum, start_date: LearningCalendar.today - 1, status: :upcoming)
    assert explicit.upcoming?
  end

  test "curriculum swaps reset selection and enrolled cohorts reject changes" do
    other = Curriculum.create!(name: "Other", status: :active)
    mod = other.modules.create!(name: "New module", position: 0)
    @cohort.update!(curriculum: other)
    assert_equal [ mod.id.to_s ], @cohort.reload.content_defaults.keys
    learner = User.create!(email: "swap@example.test", clerk_id: "swap", role: :student)
    @cohort.enrollments.create!(user: learner)
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}", params: { curriculum_id: @curriculum.id }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      assert_includes response.body, "cannot change while students are enrolled"
    end
    assert_equal other.id, @cohort.reload.curriculum_id
  end

  test "bulk retries recover invitations and dropped learners stay dropped" do
    pending = User.create!(email: "pending-retry@example.test", clerk_id: "pending_retry", role: :student)
    @cohort.enrollments.create!(user: pending)
    dispatched = []
    original = UserInvitationDispatchService.instance_method(:call)
    UserInvitationDispatchService.define_method(:call) do
      dispatched << @user.id
      UserInvitationDispatchService::Result.new(status: "queued", error: nil)
    end
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: [ { email: pending.email } ], send_invite: true }, headers: auth_headers, as: :json
      assert_response :success
      assert_equal [ pending.id ], dispatched
      assert_equal "already_enrolled", response.parsed_body["results"].first["status"]
      @cohort.enrollments.find_by!(user: pending).update!(status: :dropped)
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: [ { email: pending.email } ], send_invite: true }, headers: auth_headers, as: :json
      assert_equal "previously_dropped", response.parsed_body["results"].first["status"]
      assert_equal 1, dispatched.length
    end
  ensure
    UserInvitationDispatchService.define_method(:call, original) if original
  end

  test "bulk notifies accepted learners after enrollment and charges row budget" do
    accepted = User.create!(email: "accepted-bulk@example.test", clerk_id: "accepted-bulk", role: :student)
    as_user(@admin) do
      assert_difference "Notification.count", 1 do
        post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: [ { email: accepted.email } ] }, headers: auth_headers, as: :json
        assert_response :success
      end
      key = "bulk-enrollment-rows:#{@admin.id}:#{Time.current.to_i / 10.minutes.to_i}"
      ApiRateLimits::STORE.write(key, 999)
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: [ { email: accepted.email }, { email: "limited@example.test" } ] }, headers: auth_headers, as: :json
      assert_response :too_many_requests
      assert_equal 999, ApiRateLimits::STORE.read(key)
      assert_nil User.find_by(email: "limited@example.test")
    end
  end

  test "account creation rolls back when enrollment fails and uniqueness races retry" do
    original = Api::V1::EnrollmentsController.instance_method(:assign_bulk_content_defaults)
    calls = 0
    Api::V1::EnrollmentsController.define_method(:assign_bulk_content_defaults) do |enrollment|
      calls += 1
      raise ActiveRecord::RecordNotUnique if calls == 1
      original.bind_call(self, enrollment)
    end
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: [ { email: "raced@example.test" } ] }, headers: auth_headers, as: :json
      assert_response :success
      assert_equal "enrolled", response.parsed_body["results"].first["status"]
    end
    assert_equal 1, User.where(email: "raced@example.test").count
    assert_equal 1, @cohort.enrollments.count
    Api::V1::EnrollmentsController.define_method(:assign_bulk_content_defaults) { |enrollment| raise ActiveRecord::RecordInvalid.new(enrollment) }
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: [ { email: "rollback@example.test" } ] }, headers: auth_headers, as: :json
      assert_equal "error", response.parsed_body["results"].first["status"]
    end
    assert_nil User.find_by(email: "rollback@example.test")
  ensure
    Api::V1::EnrollmentsController.define_method(:assign_bulk_content_defaults, original) if original
  end

  test "checkout status uses public title with safe fallback" do
    student = User.create!(email: "buyer@example.test", clerk_id: "buyer", role: :student)
    purchase = CoursePurchase.create!(user: student, cohort: @cohort, stripe_price_id: "price_synthetic", status: "pending")
    as_user(student) do
      get "/api/v1/course_checkouts/#{purchase.id}/status", headers: auth_headers
      assert_response :success
      assert_equal "Self-paced course", response.parsed_body.dig("cohort", "name")
      @cohort.update!(public_title: "Public learning")
      get "/api/v1/course_checkouts/#{purchase.id}/status", headers: auth_headers
      assert_equal "Public learning", response.parsed_body.dig("cohort", "name")
      refute_includes response.body, "Internal pilot"
    end
  end

  test "unrelated settings save on published courses even while readiness is missing" do
    @cohort.update!(public_checkout_enabled: true)
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}", params: { name: "New internal name", public_checkout_enabled: true }, headers: auth_headers, as: :json
      assert_response :success
      assert_equal "New internal name", @cohort.reload.name
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
