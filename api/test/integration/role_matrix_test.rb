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
    Progress.create!(user: @student, content_block: exercise_block, status: :completed)

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

  test "instructor gets admin dashboard" do
    as_user(@instructor) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    data = JSON.parse(response.body)["dashboard"]
    assert data.key?("cohorts") || data.key?("cohort")
  end

  test "admin gets admin dashboard" do
    as_user(@admin) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
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
