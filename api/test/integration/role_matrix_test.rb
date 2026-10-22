require "test_helper"

class RoleMatrixTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort", start_date: Date.current, status: :active
    )

    @student = User.create!(
      clerk_id: "clerk_role_student", email: "role_student@example.com",
      first_name: "Student", last_name: "One", role: :student
    )
    @instructor = User.create!(
      clerk_id: "clerk_role_instructor", email: "role_instructor@example.com",
      first_name: "Instructor", last_name: "One", role: :instructor
    )
    @admin = User.create!(
      clerk_id: "clerk_role_admin", email: "role_admin@example.com",
      first_name: "Admin", last_name: "One", role: :admin
    )
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
  end

  test "privacy administration is admin only while students retain request creation" do
    [ @student, @instructor, @admin ].each do |user|
      as_user(user) do
        get "/api/v1/content_reports", headers: auth_headers
        assert_response(user.admin? ? :success : :forbidden)
        get "/api/v1/data_deletion_requests", headers: auth_headers
        assert_response(user.admin? ? :success : :forbidden)
      end
    end
    as_user(@student) { post "/api/v1/data_deletion_requests", headers: auth_headers, as: :json }
    assert_response :created
  end

  # --- Dashboard ---

  test "student gets student dashboard" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)

    as_user(@student) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    data = JSON.parse(response.body)["dashboard"]
    assert_equal "student", data["user"]["role"]
  end

  test "student dashboard orders lessons chronologically and excludes archived lessons" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)
    later = Lesson.create!(curriculum_module: @mod, title: "Week 2", position: 0, release_day: 7)
    early = Lesson.create!(curriculum_module: @mod, title: "Week 1", position: 5, release_day: 0)
    archived = Lesson.create!(curriculum_module: @mod, title: "Retired", position: 1, release_day: 0)
    [ later, early, archived ].each do |lesson|
      ContentBlock.create!(lesson: lesson, block_type: :text, position: 0, title: lesson.title)
    end
    archived.archive!

    as_user(@student) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    dashboard = JSON.parse(response.body).fetch("dashboard")
    assert_equal [ "Week 1", "Week 2" ], dashboard.dig("modules", 0, "lessons").map { |lesson| lesson.fetch("title") }
    assert_equal "Week 1", dashboard.dig("continue_lesson", "title")
  end

  test "student dashboard only shows pinned or unread announcements" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)
    pinned_announcement = Announcement.create!(
      title: "Pinned notice",
      body: "Keep this visible",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published,
      pinned: true
    )
    read_announcement = Announcement.create!(
      title: "Read notice",
      body: "Should leave the dashboard",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    unread_announcement = Announcement.create!(
      title: "Unread notice",
      body: "Should stay visible",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    NotificationDeliveryService.announcement_published(pinned_announcement)
    NotificationDeliveryService.announcement_published(read_announcement)
    NotificationDeliveryService.announcement_published(unread_announcement)
    @student.notifications.find_by!(notifiable: read_announcement).mark_read!

    as_user(@student) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    titles = JSON.parse(response.body).dig("dashboard", "cohort", "announcements").map { |announcement| announcement.fetch("title") }
    assert_includes titles, "Pinned notice"
    assert_includes titles, "Unread notice"
    refute_includes titles, "Read notice"
  end

  test "student dashboard still surfaces older unread announcements beyond newer read items" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)

    20.times do |index|
      announcement = Announcement.create!(
        title: "Recent read notice #{index}",
        body: "Already handled",
        author: @admin,
        audience: :cohort,
        cohort: @cohort,
        status: :published,
        published_at: (index + 1).minutes.ago
      )
      NotificationDeliveryService.announcement_published(announcement)
      @student.notifications.find_by!(notifiable: announcement).mark_read!
    end

    older_unread = Announcement.create!(
      title: "Older unread notice",
      body: "Should still appear",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published,
      published_at: 30.minutes.ago
    )
    NotificationDeliveryService.announcement_published(older_unread)

    as_user(@student) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    titles = JSON.parse(response.body).dig("dashboard", "cohort", "announcements").map { |announcement| announcement.fetch("title") }
    assert_includes titles, "Older unread notice"
  end

  test "student dashboard treats assignment block as lesson completion driver when lesson also has video" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)
    lesson = Lesson.create!(curriculum_module: @mod, title: "Live Day", position: 0, release_day: 0, requires_submission: true)
    ContentBlock.create!(lesson: lesson, block_type: :video, position: 0, title: "Watch")
    exercise_block = ContentBlock.create!(
      lesson: lesson,
      block_type: :exercise,
      position: 1,
      title: "Submit",
      submission_type: :repo_url_submission
    )
    Progress.create!(user: @student, enrollment: enrollment, content_block: exercise_block, status: :completed)

    as_user(@student) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    data = JSON.parse(response.body)["dashboard"]
    module_data = data["modules"].find { |mod| mod["id"] == @mod.id }
    lesson_data = module_data["lessons"].find { |item| item["id"] == lesson.id }

    assert_equal 1, module_data["total_blocks"]
    assert_equal 1, module_data["completed_blocks"]
    assert_equal 1, lesson_data["total_blocks"]
    assert_equal 1, lesson_data["completed_blocks"]
    assert_equal true, lesson_data["completed"]
  end

  test "student dashboard includes only the current student's recently graded passing work" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)
    lesson = Lesson.create!(curriculum_module: @mod, title: "Portfolio", position: 0, release_day: 0)
    block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "Ship it")
    Submission.create!(user: @student, enrollment: enrollment, content_block: block, text: "redo", grade: "R", feedback: "Try again", grader: @instructor, graded_at: 1.hour.ago)
    Submission.create!(user: @student, enrollment: enrollment, content_block: block, text: "done", grade: "A", feedback: "Strong work", grader: @instructor, graded_at: 30.minutes.ago)

    as_user(@student) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    graded = JSON.parse(response.body).dig("dashboard", "recently_graded")
    assert_equal 1, graded.length
    assert_equal "A", graded.first["grade"]
    assert_equal "Portfolio", graded.first["lesson_title"]
    assert_empty JSON.parse(response.body).dig("dashboard", "action_items")
  end

  test "instructor gets admin dashboard" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)
    lesson = Lesson.create!(curriculum_module: @mod, title: "Attention", position: 0, release_day: 0)
    ungraded_block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "Review me")
    redo_block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 1, title: "Redo me")
    Submission.create!(user: @student, enrollment: enrollment, content_block: ungraded_block, text: "ready")
    Submission.create!(user: @student, enrollment: enrollment, content_block: redo_block, text: "again", grade: "R")

    as_user(@instructor) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    data = JSON.parse(response.body)["dashboard"]
    assert data.key?("cohorts") || data.key?("cohort")
    student = data.fetch("cohorts").first.fetch("students").first
    assert_equal 1, student.fetch("ungraded_count")
    assert_equal 1, student.fetch("redo_count")
  end

  test "admin gets admin dashboard" do
    as_user(@admin) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
  end

  test "staff can browse resources across active cohorts without student enrollment" do
    @cohort.update!(settings: { "class_resources" => [ { "title" => "Staff guide", "url" => "https://example.com/guide", "category" => "reference" } ] })

    as_user(@instructor) do
      get "/api/v1/resources", headers: auth_headers
    end

    assert_response :success
    resource = JSON.parse(response.body).fetch("resources").first
    assert_equal "Staff guide", resource.fetch("title")
    assert_equal @cohort.id, resource.fetch("cohort_id")
    assert_equal @cohort.name, resource.fetch("cohort_name")
  end

  # --- Cohorts (staff = instructor + admin) ---

  test "student cannot list cohorts" do
    as_user(@student) do
      get "/api/v1/cohorts", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "instructor can list cohorts" do
    as_user(@instructor) do
      get "/api/v1/cohorts", headers: auth_headers
    end

    assert_response :success
  end

  test "only staff can inspect GitHub organization access" do
    as_user(@student) do
      get "/api/v1/cohorts/#{@cohort.id}/github_access", headers: auth_headers
    end
    assert_response :forbidden

    as_user(@instructor) do
      get "/api/v1/cohorts/#{@cohort.id}/github_access", headers: auth_headers
    end
    assert_response :bad_gateway
    assert_equal "GitHub organization status is unavailable", JSON.parse(response.body).fetch("error")
  end

  test "instructor can inspect current GitHub access for enrolled students" do
    @cohort.update!(github_organization_name: "Code-School-of-Guam-Alumni")
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    lookup = Object.new
    lookup.define_singleton_method(:status_for) { |users| users.to_h { |user| [ user.id, "invited" ] } }

    original_new = GithubOrganizationAccessService.method(:new)
    GithubOrganizationAccessService.define_singleton_method(:new) { |**| lookup }
    as_user(@instructor) do
      get "/api/v1/cohorts/#{@cohort.id}/github_access", headers: auth_headers
    end

    assert_response :success
    data = JSON.parse(response.body)
    assert_equal "Code-School-of-Guam-Alumni", data.fetch("organization")
    assert_equal "invited", data.fetch("statuses").fetch(@student.id.to_s)
    assert Time.iso8601(data.fetch("checked_at"))
  ensure
    GithubOrganizationAccessService.define_singleton_method(:new, original_new) if original_new
  end

  test "instructor cannot create cohort (admin-only)" do
    as_user(@instructor) do
      post "/api/v1/cohorts",
        params: { name: "New", curriculum_id: @curriculum.id, start_date: Date.current },
        headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  test "admin can create cohort" do
    as_user(@admin) do
      post "/api/v1/cohorts",
        params: { name: "New", curriculum_id: @curriculum.id, start_date: Date.current },
        headers: auth_headers, as: :json
    end

    assert_response :created
  end

  test "only an admin can configure a cohort GitHub organization" do
    as_user(@instructor) do
      patch "/api/v1/cohorts/#{@cohort.id}",
        params: { github_organization_name: "Code-School-of-Guam-Alumni" }, headers: auth_headers, as: :json
    end
    assert_response :forbidden
    assert_nil @cohort.reload.github_organization_name

    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}",
        params: { github_organization_name: "Code-School-of-Guam-Alumni" }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "Code-School-of-Guam-Alumni", JSON.parse(response.body).dig("cohort", "github_organization_name")

    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}",
        params: { github_organization_name: "https://github.com/invalid" }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal "Code-School-of-Guam-Alumni", @cohort.reload.github_organization_name
  end

  test "student cannot view cohort student view" do
    as_user(@student) do
      get "/api/v1/cohorts/#{@cohort.id}/student_view", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "instructor can view read-only cohort student view" do
    @cohort.update!(
      settings: {
        "class_resources" => [
          { "title" => "Class Zoom", "url" => "https://example.com/zoom", "category" => "meeting" }
        ]
      }
    )
    lesson = Lesson.create!(curriculum_module: @mod, title: "Intro", position: 0, release_day: 0)
    ContentBlock.create!(lesson: lesson, block_type: :text, position: 0, title: "Welcome")
    CohortModuleSchedule.create!(
      cohort: @cohort,
      curriculum_module: @mod,
      start_date: @mod.next_start_date_on_or_after(Date.current - 7.days)
    )
    Announcement.create!(
      title: "Class note",
      body: "Visible to this cohort",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )

    as_user(@instructor) do
      get "/api/v1/cohorts/#{@cohort.id}/student_view", headers: auth_headers
    end

    assert_response :success
    data = JSON.parse(response.body).fetch("student_view")
    mod = data.fetch("modules").first

    assert_equal @cohort.id, data.dig("cohort", "id")
    assert_equal true, data.fetch("read_only")
    assert_equal true, mod.fetch("assigned")
    assert_equal 1, mod.fetch("lessons_count")
    assert_equal "Intro", mod.fetch("lessons").first.fetch("title")
    assert_equal [ "Class note" ], data.fetch("announcements").map { |announcement| announcement.fetch("title") }
    assert_equal "Student Preview", data.dig("dashboard", "user", "full_name")
    assert_equal "Intro", data.dig("dashboard", "continue_lesson", "title")
    assert_equal "Class Zoom", data.dig("dashboard", "resources").first.fetch("title")
  end

  test "cohort student view handles announcements without authors" do
    announcement = Announcement.create!(
      title: "Old notice",
      body: "Author was deleted",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    announcement.define_singleton_method(:author) { nil }

    json = Api::V1::CohortsController.new.send(:cohort_student_view_announcement_json, announcement)

    assert_nil json.fetch(:author)
  end

  test "cohort student view handles unassigned modules without start dates" do
    Lesson.create!(curriculum_module: @mod, title: "Hidden Intro", position: 0, release_day: 0)

    as_user(@instructor) do
      get "/api/v1/cohorts/#{@cohort.id}/student_view", headers: auth_headers
    end

    assert_response :success
    mod = JSON.parse(response.body).dig("student_view", "modules").first

    assert_equal false, mod.fetch("assigned")
    assert_nil mod.fetch("module_start_date")
    assert_equal false, mod.fetch("lessons").first.fetch("available")
    assert_nil mod.fetch("lessons").first.fetch("unlock_date")
  end

  test "cohort student view does not mark unlocked assignments available without a start date" do
    cohort = Cohort.new(curriculum: @curriculum, name: "Unsaved", start_date: Date.current, status: :active)
    schedule = nil
    assignment = ModuleAssignment.new(unlocked: true, curriculum_module: @mod)

    controller = Api::V1::CohortsController.new
    available = controller.send(:cohort_student_view_module_available?, cohort, [ assignment ], schedule&.start_date)

    assert_equal false, available
  end

  test "alumni cohort template previews the permanent learning library without enrollments" do
    @cohort.update!(cohort_type: :alumni)
    recorded_lesson = Lesson.create!(curriculum_module: @mod, title: "Alumni lesson", position: 0, release_day: 0)
    ContentBlock.create!(lesson: recorded_lesson, block_type: :recording, position: 0, title: "Class recording", video_url: "https://example.com/recording")
    text_lesson = Lesson.create!(curriculum_module: @mod, title: "Reading only", position: 1, release_day: 1)
    ContentBlock.create!(lesson: text_lesson, block_type: :text, position: 0, title: "Notes")
    CohortModuleSchedule.create!(
      cohort: @cohort,
      curriculum_module: @mod,
      start_date: @mod.next_start_date_on_or_after(@cohort.start_date.to_date + 7.days)
    )

    as_user(@instructor) do
      get "/api/v1/cohorts/#{@cohort.id}/student_view", headers: auth_headers
    end

    assert_response :success
    data = JSON.parse(response.body).fetch("student_view")
    mod = data.fetch("modules").first

    assert_equal "alumni", data.dig("cohort", "cohort_type")
    assert_equal true, mod.fetch("assigned")
    assert_equal true, mod.fetch("available")
    assert_equal @cohort.start_date.to_date.iso8601, mod.fetch("module_start_date")
    assert_equal @cohort.start_date.to_date.iso8601, mod.fetch("lessons").first.fetch("unlock_date")
    assert_equal true, mod.fetch("lessons").first.fetch("available")
    assert_equal "library", data.dig("weekly_plan", "mode")
    assert_equal 1, data.dig("weekly_plan", "library_summary", "module_count")
    assert_equal 2, data.dig("weekly_plan", "library_summary", "lesson_count")
    assert_equal 1, data.dig("weekly_plan", "library_summary", "recording_count")
    assert_equal "Alumni lesson", data.dig("dashboard", "continue_lesson", "title")
  end

  # --- Curricula (staff for read, admin for write) ---

  test "student cannot list curricula" do
    as_user(@student) do
      get "/api/v1/curricula", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "instructor can list curricula" do
    as_user(@instructor) do
      get "/api/v1/curricula", headers: auth_headers
    end

    assert_response :success
  end

  # --- Users (admin-only) ---

  test "student cannot list users" do
    as_user(@student) do
      get "/api/v1/users", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "instructor can list users (staff read access)" do
    as_user(@instructor) do
      get "/api/v1/users", headers: auth_headers
    end

    assert_response :success
  end

  test "instructor cannot create users (admin-only)" do
    as_user(@instructor) do
      post "/api/v1/users",
        params: { user: { email: "new@example.com", first_name: "New", role: "student" } },
        headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  test "admin can list users" do
    as_user(@admin) do
      get "/api/v1/users", headers: auth_headers
    end

    assert_response :success
  end

  # --- Submissions grade (staff-only) ---

  test "student cannot access grade endpoint" do
    lesson = Lesson.create!(curriculum_module: @mod, title: "L", position: 0, release_day: 0)
    block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "E", body: "B")
    submission = Submission.create!(user: @student, content_block: block, text: "code")

    as_user(@student) do
      patch "/api/v1/submissions/#{submission.id}/grade",
        params: { grade: "A" }, headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  test "instructor cannot mutate any shared authoring surface" do
    lesson = Lesson.create!(curriculum_module: @mod, title: "Shared lesson", position: 0, release_day: 0)
    block = lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Exercise", solution: "staff solution")
    resource = @curriculum.curriculum_resources.create!(title: "ZIP", filename: "course.zip", file_size: 12,
      s3_key: "course_resources/test/course.zip", upload_key: "course_resource_uploads/test/course.zip", upload_expires_at: 1.hour.from_now)
    objective = @curriculum.learning_objectives.create!(code: "AUTH.1", title: "Understand authority", success_criteria: "I can explain roles")
    rubric = @curriculum.rubrics.new(title: "Shared rubric")
    rubric.rubric_criteria.build(title: "Correctness", description: "Correct", position: 0)
    rubric.save!
    requests = [
      [ :post, "/modules/#{@mod.id}/lessons", { title: "Unauthorized", position: 1, release_day: 1 } ],
      [ :post, "/modules/#{@mod.id}/exercises", { title: "Unauthorized", instructions: "Changed" } ],
      [ :patch, "/lessons/#{lesson.id}", { title: "Changed", position: 5, release_day: 7, base_updated_at: lesson.updated_at.iso8601(6) } ],
      [ :patch, "/lessons/#{lesson.id}/editor", { title: "Changed", base_updated_at: lesson.updated_at.iso8601(6) } ],
      [ :patch, "/lessons/#{lesson.id}/archive", { base_updated_at: lesson.updated_at.iso8601(6) } ],
      [ :patch, "/lessons/#{lesson.id}/restore", { base_updated_at: lesson.updated_at.iso8601(6) } ],
      [ :delete, "/lessons/#{lesson.id}", {} ],
      [ :post, "/lessons/#{lesson.id}/content_blocks", { block_type: "text", title: "Changed", position: 2 } ],
      [ :patch, "/content_blocks/#{block.id}", { body: "Changed", solution: "Changed", submission_config: { code_runner: { enabled: true } } } ],
      [ :delete, "/content_blocks/#{block.id}", {} ],
      [ :post, "/content_blocks/#{block.id}/video_presign", { filename: "video.mp4" } ],
      [ :post, "/video_presign", { filename: "video.mp4" } ],
      [ :post, "/curricula/#{@curriculum.id}/resources", { filename: "course.zip", file_size: 12, title: "ZIP" } ],
      [ :post, "/curricula/#{@curriculum.id}/resources/#{resource.id}/complete", {} ],
      [ :delete, "/curricula/#{@curriculum.id}/resources/#{resource.id}", {} ],
      [ :post, "/learning_objectives", { learning_objective: { curriculum_id: @curriculum.id, code: "BAD", title: "Changed" } } ],
      [ :patch, "/learning_objectives/#{objective.id}", { learning_objective: { title: "Changed" } } ],
      [ :delete, "/learning_objectives/#{objective.id}", {} ],
      [ :put, "/lessons/#{lesson.id}/objective_alignments", { alignments: [] } ],
      [ :post, "/rubrics", { rubric: { curriculum_id: @curriculum.id, title: "Changed" } } ],
      [ :patch, "/rubrics/#{rubric.id}", { rubric: { title: "Changed", criteria: [] } } ],
      [ :delete, "/rubrics/#{rubric.id}", {} ],
      [ :post, "/course_packages/preview", {} ],
      [ :post, "/course_packages", {} ],
      [ :post, "/uploads/multipart/initiate", { filename: "video.mp4", file_size: 12, content_block_id: block.id } ],
      [ :post, "/uploads/multipart/part_url", { s3_key: "content_videos/block_#{block.id}/20261022000000_video.mp4" } ],
      [ :post, "/uploads/multipart/complete", { s3_key: "content_videos/block_#{block.id}/20261022000000_video.mp4" } ],
      [ :delete, "/uploads/multipart/abort", { s3_key: "content_videos/block_#{block.id}/20261022000000_video.mp4" } ],
      [ :delete, "/uploads/abandon", { s3_key: "content_videos/block_#{block.id}/20261022000000_video.mp4" } ]
    ]
    as_user(@instructor) do
      requests.each do |method, path, payload|
        public_send(method, "/api/v1#{path}", params: payload, headers: auth_headers, as: :json)
        assert_response :forbidden, "#{method.upcase} #{path} must be admin-only"
      end
      get "/api/v1/lessons/#{lesson.id}", headers: auth_headers
      assert_response :success
      assert_equal "staff solution", JSON.parse(response.body).dig("lesson", "content_blocks", 0, "solution")
    end
    assert_equal "Shared lesson", lesson.reload.title
    assert_nil lesson.archived_at
    assert_equal "staff solution", block.reload.solution
  end

  test "admin can create move reorder and edit shared lesson blocks" do
    as_user(@admin) do
      post "/api/v1/modules/#{@mod.id}/lessons", params: { title: "Admin lesson", lesson_type: "exercise", position: 0, release_day: 0 }, headers: auth_headers, as: :json
      assert_response :created
      lesson = Lesson.find(response.parsed_body.dig("lesson", "id"))
      patch "/api/v1/lessons/#{lesson.id}", params: { title: "Moved lesson", position: 4, release_day: 7, base_updated_at: lesson.updated_at.iso8601(6) }, headers: auth_headers, as: :json
      assert_response :success
      assert_equal [ "Moved lesson", 4, 7 ], lesson.reload.values_at(:title, :position, :release_day)
      post "/api/v1/lessons/#{lesson.id}/content_blocks", params: { block_type: "exercise", position: 0, title: "Shared exercise", body: "Instructions", solution: "Solution" }, headers: auth_headers, as: :json
      assert_response :created
      block = ContentBlock.find(response.parsed_body.dig("content_block", "id"))
      patch "/api/v1/content_blocks/#{block.id}", params: { body: "Updated instructions", solution: "Updated solution", position: 3 }, headers: auth_headers, as: :json
      assert_response :success
      assert_equal [ "Updated instructions", "Updated solution", 3 ], block.reload.values_at(:body, :solution, :position)
      delete "/api/v1/content_blocks/#{block.id}", headers: auth_headers
      assert_response :no_content
      refute ContentBlock.exists?(block.id)
      delete "/api/v1/lessons/#{lesson.id}", headers: auth_headers
      assert_response :no_content
      refute Lesson.exists?(lesson.id)
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = {
      "sub" => user.clerk_id, "email" => user.email,
      "first_name" => user.first_name, "last_name" => user.last_name
    }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
