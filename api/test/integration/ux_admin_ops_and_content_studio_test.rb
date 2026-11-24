require "test_helper"
require_relative "../support/github_app_fixtures"

class UxAdminOpsAndContentStudioTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures

  setup do
    @admin = User.create!(
      clerk_id: "ux_admin_ops_admin",
      email: "ux-admin@example.com",
      first_name: "Ada",
      last_name: "Admin",
      role: :admin
    )
    @instructor = User.create!(
      clerk_id: "ux_admin_ops_instructor",
      email: "ux-instructor@example.com",
      first_name: "Ira",
      last_name: "Instructor",
      role: :instructor
    )
    @student = User.create!(
      clerk_id: "ux_admin_ops_student",
      email: "ux-student@example.com",
      first_name: "Sam",
      last_name: "Student",
      role: :student
    )
    @curriculum = Curriculum.create!(name: "UX Ops Curriculum")
    @cohort = Cohort.create!(
      name: "UX Ops Cohort",
      curriculum: @curriculum,
      start_date: Date.current - 5.days,
      status: :active
    )
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @mod = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Module 1",
      position: 0,
      day_offset: 0,
      schedule_days: "daily"
    )
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)
  end

  test "admin can view feature switch change history scoped to school or cohort while non-admins are forbidden" do
    as_user(@admin) do
      patch "/api/v1/feature_settings",
        params: { features: { recordings: false } },
        headers: auth_headers,
        as: :json
      assert_response :success

      patch "/api/v1/cohorts/#{@cohort.id}/feature_settings",
        params: { features: { recordings: true } },
        headers: auth_headers,
        as: :json
      assert_response :success

      get "/api/v1/feature_settings/changes", headers: auth_headers
      assert_response :success
      changes = response.parsed_body.fetch("changes")
      assert_operator changes.length, :>=, 2
      cohort_change = changes.find { |row| row.dig("cohort", "id") == @cohort.id }
      assert_not_nil cohort_change
      assert_equal @admin.full_name, cohort_change.dig("actor", "full_name")
      assert_includes cohort_change["diff"].map { |d| d["key"] }, "recordings"

      get "/api/v1/cohorts/#{@cohort.id}/feature_settings/changes", headers: auth_headers
      assert_response :success
      scoped = response.parsed_body.fetch("changes")
      assert scoped.all? { |row| row.dig("cohort", "id") == @cohort.id }
    end

    [ @instructor, @student ].each do |user|
      as_user(user) do
        get "/api/v1/feature_settings/changes", headers: auth_headers
        assert_response :forbidden
      end
    end
  end

  test "admin can read school identity preview while non-admins are forbidden" do
    as_user(@admin) do
      get "/api/v1/school_identity", headers: auth_headers
      assert_response :success
      identity = response.parsed_body.fetch("school_identity")
      assert_equal SchoolBrand.current.name, identity["name"]
      assert_equal SchoolBrand.current.product_name, identity["product_name"]
      assert_equal SchoolBrand.current.support_email, identity["support_email"]
      assert identity["time_zone"].present?
      assert identity.key?("email_sender")
    end

    [ @instructor, @student ].each do |user|
      as_user(user) do
        get "/api/v1/school_identity", headers: auth_headers
        assert_response :forbidden
      end
    end
  end

  test "draft lessons stay hidden from students until published while staff can author and move them" do
    as_user(@admin) do
      post "/api/v1/modules/#{@mod.id}/exercises",
        params: {
          title: "Draft Practice Exercise",
          published: false,
          instructions: "Work in progress"
        },
        headers: auth_headers,
        as: :json
      assert_response :created
      draft_id = response.parsed_body.dig("lesson", "id")
      assert_equal false, response.parsed_body.dig("lesson", "published")

      # Staff sees the draft lesson in curriculum & module payloads.
      get "/api/v1/curricula/#{@curriculum.id}", headers: auth_headers
      assert_response :success
      mod_json = response.parsed_body.dig("curriculum", "modules").find { |m| m["id"] == @mod.id }
      assert_equal 1, mod_json["draft_lessons_count"]
      draft_row = mod_json["lessons"].find { |l| l["id"] == draft_id }
      assert_equal false, draft_row["published"]

      get "/api/v1/lessons/#{draft_id}", headers: auth_headers
      assert_response :success
      assert_equal false, response.parsed_body.dig("lesson", "published")

      # Students cannot read the draft lesson or see it in module listings.
      as_user(@student) do
        get "/api/v1/lessons/#{draft_id}", headers: auth_headers
        assert_response :forbidden

        get "/api/v1/modules/#{@mod.id}", headers: auth_headers
        assert_response :success
        student_lesson_ids = response.parsed_body.dig("module", "lessons").map { |l| l["id"] }
        assert_not_includes student_lesson_ids, draft_id
      end

      # Publishing makes the lesson visible to students.
      patch "/api/v1/lessons/#{draft_id}",
        params: { published: true, base_updated_at: Lesson.find(draft_id).updated_at.iso8601(6) },
        headers: auth_headers,
        as: :json
      assert_response :success
      assert_equal true, response.parsed_body.dig("lesson", "published")

      as_user(@student) do
        get "/api/v1/lessons/#{draft_id}", headers: auth_headers
        assert_response :success
        assert_equal true, response.parsed_body.dig("lesson", "published")
      end

      # Unpublishing hides it again.
      patch "/api/v1/lessons/#{draft_id}",
        params: { published: false, base_updated_at: Lesson.find(draft_id).updated_at.iso8601(6) },
        headers: auth_headers,
        as: :json
      assert_response :success
      assert_equal false, response.parsed_body.dig("lesson", "published")

      as_user(@student) do
        get "/api/v1/lessons/#{draft_id}", headers: auth_headers
        assert_response :forbidden
      end
    end
  end

  test "safety report resolution_note persists on update and appears in record detail" do
    channel = @cohort.channels.find_by!(name: "Class Chat")
    classmate = User.create!(
      clerk_id: "ux_safety_classmate",
      email: "ux-classmate@example.com",
      first_name: "Casey",
      last_name: "Peer",
      role: :student
    )
    Enrollment.create!(user: classmate, cohort: @cohort, status: :active)
    message = Message.create!(channel: channel, author: classmate, body: "Needs review")
    report = ContentReport.create!(
      reporter: @student,
      reported_user: classmate,
      message: message,
      reason: :inappropriate_content
    )

    as_user(@admin) do
      patch "/api/v1/content_reports/#{report.id}",
        params: {
          content_report: {
            status: "actioned",
            resolution_note: "Removed message and coached learner privately."
          }
        },
        headers: auth_headers,
        as: :json
      assert_response :success
      assert_equal "Removed message and coached learner privately.", response.parsed_body.dig("content_report", "resolution_note")

      get "/api/v1/records/content_report/#{report.id}/detail", headers: auth_headers
      assert_response :success
      assert_equal "Removed message and coached learner privately.", response.parsed_body.dig("detail", "resolution_note")
    end
  end

  test "cohort github_sync_health returns per-learner statuses and plain reasons for staff" do
    now = Time.utc(2026, 11, 24, 10, 0, 0)
    travel_to now do
      build_github_app_fixture
      SchoolSetting.current.update!(features: { "github_app" => true, "github_reconciliation" => true })
      @cohort.update!(settings: {
        "features" => { "github_app" => true, "github_reconciliation" => true },
        "module_github_config" => { @mod.id.to_s => { "requires_github" => true, "repository_name" => "prework-repo" } }
      })
      @binding.update!(
        repository_id: 55555,
        github_user_id: @student.github_user_id,
        github_username: "app-learner",
        verification_state: "verified",
        verified_at: now - 15.minutes,
        checked_at: now - 15.minutes
      )
      GithubReconciliationState.create!(
        github_repository_binding: @binding,
        activated_at: now - 20.minutes,
        last_status: "failed",
        last_error: "404 Not Found",
        last_reconciled_at: now - 5.minutes,
        next_reconcile_at: now + 10.minutes
      )

      other_student = User.create!(
        clerk_id: "ux_gh_unconnected",
        email: "ux-gh-unconnected@example.com",
        first_name: "Nora",
        last_name: "NoGithub",
        role: :student
      )
      Enrollment.create!(user: other_student, cohort: @cohort, status: :active)

      with_app_provider do
        as_app_user(@admin) do
          get "/api/v1/cohorts/#{@cohort.id}/github_sync_health", headers: app_headers
          assert_response :success
          health = response.parsed_body
          assert_equal true, health["app_configured"]
          assert_equal 2, health.dig("summary", "total_learners")
          assert_equal 1, health.dig("summary", "sync_error_count")
          assert_equal 1, health.dig("summary", "identity_missing_count")

          errored = health["learners"].find { |row| row["user_id"] == @student.id }
          assert_equal "sync_error", errored["status"]
          assert_includes errored["plain_reason"], "could not be found"

          missing = health["learners"].find { |row| row["user_id"] == other_student.id }
          assert_equal "identity_missing", missing["status"]
          assert_includes missing["plain_reason"], "Profile"
        end
      end

      as_app_user(@student) do
        get "/api/v1/cohorts/#{@cohort.id}/github_sync_health", headers: app_headers
        assert_response :forbidden
      end
    end
  end

  test "seat_capacity exposes occupied and pending breakdown and bulk enrollment includes user_id" do
    @cohort.update!(course_delivery: :guided, seat_limit: 5)
    cap = @cohort.seat_capacity
    assert_equal 1, cap[:occupied_enrollments_count]
    assert_equal 0, cap[:pending_checkouts_count]
    assert_equal 4, cap[:seats_remaining]

    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk",
        params: {
          rows: [
            { email: @student.email, first_name: "Sam", last_name: "Student" }
          ]
        },
        headers: auth_headers,
        as: :json
      assert_response :success
      already = response.parsed_body.fetch("results").sole
      assert_equal "already_enrolled", already["status"]
      assert_equal @student.id, already["user_id"]
      assert_equal @enrollment.id, already["enrollment_id"]
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
