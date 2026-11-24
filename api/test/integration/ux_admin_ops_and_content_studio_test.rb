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

      get "/api/v1/content_reports/#{report.id}", headers: auth_headers
      assert_response :success
      assert_equal "Removed message and coached learner privately.", response.parsed_body.dig("content_report", "resolution_note")
    end

    # Student re-reporting the same message (normal lookup path) never sees resolution_note.
    as_user(@student) do
      post "/api/v1/content_reports",
        params: { content_report: { message_id: message.id, reason: "inappropriate_content" } },
        headers: auth_headers,
        as: :json
      assert_response :created
      student_report = response.parsed_body.fetch("content_report")
      assert_equal report.id, student_report["id"]
      refute student_report.key?("resolution_note")
    end

    # Duplicate-insert race recovery (ActiveRecord::RecordNotUnique) also never leaks resolution_note.
    original_save = ContentReport.instance_method(:save!)
    ContentReport.define_method(:save!) { |*args, **kwargs| raise ActiveRecord::RecordNotUnique, "duplicate" }
    begin
      as_user(@student) do
        post "/api/v1/content_reports",
          params: { content_report: { message_id: message.id, reason: "inappropriate_content" } },
          headers: auth_headers,
          as: :json
        assert_response :created
        recovered_report = response.parsed_body.fetch("content_report")
        assert_equal report.id, recovered_report["id"]
        refute recovered_report.key?("resolution_note")
      end
    ensure
      ContentReport.define_method(:save!, original_save)
    end
  end

  test "draft lessons block paused video stream and active video_progress without mutating duration or progress" do
    lesson = Lesson.create!(
      curriculum_module: @mod,
      title: "Published Then Unpublished Video",
      position: 0,
      release_day: 0,
      published: true
    )
    video_block = lesson.content_blocks.create!(
      block_type: :video,
      position: 0,
      title: "Lecture",
      s3_video_key: "content_videos/22222222-2222-4222-8222-222222222222/lecture.mp4",
      s3_video_duration_seconds: nil
    )

    # Pause a second student while the lesson is published so it enters paused_lesson_ids.
    paused_student = User.create!(
      clerk_id: "ux_paused_draft_student",
      email: "ux-paused-draft@example.com",
      first_name: "Pat",
      last_name: "Paused",
      role: :student
    )
    paused_enrollment = Enrollment.create!(user: paused_student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: paused_enrollment, curriculum_module: @mod, unlocked: true)
    paused_enrollment.update!(status: :paused, paused_at: Time.current)
    assert_includes paused_enrollment.reload.paused_lesson_ids, lesson.id

    # Move the lesson back to draft.
    lesson.update!(published: false)

    # Paused student cannot get a fresh signed playback URL for the draft lesson.
    as_user(paused_student) do
      get "/api/v1/content_blocks/#{video_block.id}/video_stream",
        params: { cohort_id: @cohort.id },
        headers: auth_headers
      assert_response :forbidden
    end

    # Active student cannot write duration or watch progress on the draft lesson.
    as_user(@student) do
      patch "/api/v1/content_blocks/#{video_block.id}/video_progress",
        params: { last_position_seconds: 90, total_watched_seconds: 90, duration_seconds: 300 },
        headers: auth_headers,
        as: :json
      assert_response :forbidden
    end
    assert_nil video_block.reload.s3_video_duration_seconds
    assert_equal 0, Progress.where(enrollment: @enrollment, content_block: video_block).count

    # Published lessons that become schedule-locked mid-playback still allow video_progress.
    lesson.update!(published: true, release_day: 30)
    as_user(@student) do
      patch "/api/v1/content_blocks/#{video_block.id}/video_progress",
        params: { last_position_seconds: 45, total_watched_seconds: 45, duration_seconds: 300 },
        headers: auth_headers,
        as: :json
      assert_response :success
    end
    assert_equal 300, video_block.reload.s3_video_duration_seconds
    assert_equal 1, Progress.where(enrollment: @enrollment, content_block: video_block).count
  end

  test "manual GithubSyncService skips unpublished draft lessons" do
    @student.update!(github_username: "sam-student")
    @cohort.update!(repository_name: "prework-repo", settings: { "features" => { "github_sync" => true, "github_app" => false } })

    published_lesson = Lesson.create!(curriculum_module: @mod, title: "Published Exercise", position: 0, release_day: 0, published: true)
    published_block = published_lesson.content_blocks.create!(
      block_type: :exercise,
      position: 0,
      title: "Published Ex",
      filename: "published.rb",
      submission_type: :prework_github_sync
    )
    draft_lesson = Lesson.create!(curriculum_module: @mod, title: "Draft Exercise", position: 1, release_day: 0, published: false)
    draft_block = draft_lesson.content_blocks.create!(
      block_type: :exercise,
      position: 0,
      title: "Draft Ex",
      filename: "draft.rb",
      submission_type: :prework_github_sync
    )

    service = GithubSyncService.new(github_token: "test_token")
    requested_filenames = nil
    service.define_singleton_method(:fetch_exercise_files) do |_username, _repo, filenames|
      requested_filenames = filenames
      {
        commit_hash: "a" * 40,
        files: [
          { "name" => "published.rb", "text" => "puts :published" },
          { "name" => "draft.rb", "text" => "puts :draft" }
        ]
      }
    end

    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)
    assert_equal 1, result[:synced]
    assert_equal [ "published.rb" ], requested_filenames
    assert_equal 1, Submission.where(enrollment: @enrollment, content_block: published_block).count
    assert_equal 0, Submission.where(enrollment: @enrollment, content_block: draft_block).count
  end

  test "cohort github_sync_health reflects manual-sync-only mode, disabled github_sync, and partial module bindings" do
    now = Time.utc(2026, 11, 24, 12, 0, 0)
    travel_to now do
      build_github_app_fixture
      second_mod = CurriculumModule.create!(
        curriculum: @curriculum,
        name: "Capstone Repo",
        position: 1,
        day_offset: 7,
        schedule_days: "daily"
      )
      SchoolSetting.current.update!(features: { "github_app" => true, "github_sync" => true, "github_webhooks" => false, "github_reconciliation" => false })
      @cohort.update!(settings: {
        "features" => { "github_app" => true, "github_sync" => true, "github_webhooks" => false, "github_reconciliation" => false },
        "module_github_config" => {
          @mod.id.to_s => { "requires_github" => true, "repository_name" => "prework-repo" },
          second_mod.id.to_s => { "requires_github" => true, "repository_name" => "capstone-repo" }
        }
      })
      # Bind ONLY the first module (no cohort default binding), leaving second_mod unbound.
      @binding.update!(
        curriculum_module_id: @mod.id,
        repository_id: 77777,
        github_user_id: @student.github_user_id,
        github_username: "app-learner",
        verification_state: "verified",
        verified_at: now - 10.minutes,
        checked_at: now - 10.minutes
      )

      with_app_provider do
        as_app_user(@admin) do
          get "/api/v1/cohorts/#{@cohort.id}/github_sync_health", headers: app_headers
          assert_response :success
          learner = response.parsed_body.fetch("learners").sole
          assert_equal "not_bound", learner["status"]
          assert_includes learner["plain_reason"], "Capstone Repo"

          # Now add a verified binding for the second module too; automatic sync is still OFF.
          GithubRepositoryBinding.create!(
            enrollment: @enrollment,
            curriculum_module: second_mod,
            github_app_installation: @installation,
            repository_id: 88888,
            full_name: "app-learner/capstone-repo",
            github_user_id: @student.github_user_id,
            github_username: "app-learner",
            verification_state: "verified",
            verified_at: now - 5.minutes,
            checked_at: now - 5.minutes
          )

          get "/api/v1/cohorts/#{@cohort.id}/github_sync_health", headers: app_headers
          assert_response :success
          learner = response.parsed_body.fetch("learners").sole
          assert_equal "healthy", learner["status"]
          assert_includes learner["plain_reason"], "manual sync"
          refute_includes learner["plain_reason"], "syncing automatically"

          # Turning github_sync OFF marks learners app_not_ready with explicit reason.
          @cohort.update!(settings: @cohort.settings.merge("features" => @cohort.settings["features"].merge("github_sync" => false)))
          get "/api/v1/cohorts/#{@cohort.id}/github_sync_health", headers: app_headers
          assert_response :success
          learner = response.parsed_body.fetch("learners").sole
          assert_equal "app_not_ready", learner["status"]
          assert_includes learner["plain_reason"], "GitHub sync is turned off"
        end
      end
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
