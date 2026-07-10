require "test_helper"

class OfficeHoursTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Live Class",
      position: 0,
      day_offset: 0,
      schedule_days: "weekdays",
      module_type: :live_class
    )
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Intro", position: 0, release_day: 0)
    ContentBlock.create!(lesson: @lesson, block_type: :video, position: 0, title: "Watch")

    @student = User.create!(
      clerk_id: "clerk_office_student",
      email: "office_student@example.com",
      first_name: "Student",
      last_name: "One",
      role: :student
    )
    @instructor = User.create!(
      clerk_id: "clerk_office_instructor",
      email: "office_instructor@example.com",
      first_name: "Instructor",
      last_name: "One",
      role: :instructor
    )

    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort", start_date: Date.current, status: :active)
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)
  end

  test "instructor can create weekly office hours and students see upcoming sessions on dashboard" do
    starts_at = 1.day.from_now.change(usec: 0)
    ends_at = starts_at + 1.hour

    as_user(@instructor) do
      post "/api/v1/cohorts/#{@cohort.id}/office_hours",
        params: {
          title: "Instructor Office Hours",
          description: "Bring questions from the week.",
          starts_at: starts_at.iso8601,
          ends_at: ends_at.iso8601,
          meeting_url: "https://zoom.example.com/j/123",
          recurrence: "weekly",
          timezone: "Pacific/Guam"
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    office_hour = JSON.parse(response.body).fetch("office_hour")
    assert_equal "weekly", office_hour.fetch("recurrence")
    assert_equal 3, office_hour.fetch("occurrences").length

    as_user(@student) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    dashboard = JSON.parse(response.body).fetch("dashboard")
    upcoming = dashboard.fetch("office_hours")
    assert_equal "Instructor Office Hours", upcoming.first.fetch("title")
    assert_equal "https://zoom.example.com/j/123", upcoming.first.fetch("meeting_url")
  end

  test "students cannot create office hours" do
    as_user(@student) do
      post "/api/v1/cohorts/#{@cohort.id}/office_hours",
        params: {
          title: "Student Office Hours",
          starts_at: 1.day.from_now.iso8601,
          ends_at: (1.day.from_now + 1.hour).iso8601,
          meeting_url: "https://zoom.example.com/j/123"
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
  end

  test "local wall times are interpreted in the selected timezone" do
    as_user(@instructor) do
      post "/api/v1/cohorts/#{@cohort.id}/office_hours",
        params: {
          title: "Guam Evening Help",
          starts_at: "2030-07-10T18:00",
          ends_at: "2030-07-10T19:00",
          meeting_url: "https://meet.example.com/guam",
          recurrence: "weekly",
          timezone: "Pacific/Guam"
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    office_hour = OfficeHour.find(JSON.parse(response.body).dig("office_hour", "id"))
    assert_equal Time.utc(2030, 7, 10, 8), office_hour.starts_at.utc
    assert_equal Time.utc(2030, 7, 10, 9), office_hour.ends_at.utc
  end

  test "nonexistent daylight saving wall times are rejected" do
    as_user(@instructor) do
      post "/api/v1/cohorts/#{@cohort.id}/office_hours",
        params: {
          title: "Skipped Time",
          starts_at: "2026-03-08T02:30",
          ends_at: "2026-03-08T03:30",
          meeting_url: "https://meet.example.com/dst",
          recurrence: "once",
          timezone: "America/Los_Angeles"
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
    assert_includes JSON.parse(response.body).fetch("errors").first, "Start time is invalid"
  end

  test "students cannot read another cohort's office hours" do
    other_cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Other Cohort",
      start_date: Date.current,
      status: :active
    )

    as_user(@student) do
      get "/api/v1/cohorts/#{other_cohort.id}/office_hours", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "staff can update and delete office hours while students cannot" do
    office_hour = @cohort.office_hours.create!(
      title: "Managed Help",
      starts_at: 2.days.from_now,
      ends_at: 2.days.from_now + 1.hour,
      meeting_url: "https://meet.example.com/managed",
      timezone: "Pacific/Guam",
      recurrence: :once,
      created_by: @instructor
    )

    as_user(@student) do
      patch "/api/v1/cohorts/#{@cohort.id}/office_hours/#{office_hour.id}",
        params: { title: "Student Edit" },
        headers: auth_headers,
        as: :json
    end
    assert_response :forbidden

    as_user(@instructor) do
      patch "/api/v1/cohorts/#{@cohort.id}/office_hours/#{office_hour.id}",
        params: { title: "Updated Help" },
        headers: auth_headers,
        as: :json
    end
    assert_response :success
    assert_equal "Updated Help", office_hour.reload.title

    as_user(@instructor) do
      delete "/api/v1/cohorts/#{@cohort.id}/office_hours/#{office_hour.id}", headers: auth_headers
    end
    assert_response :no_content
    refute OfficeHour.exists?(office_hour.id)
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = {
      "sub" => user.clerk_id,
      "email" => user.email,
      "first_name" => user.first_name,
      "last_name" => user.last_name
    }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
