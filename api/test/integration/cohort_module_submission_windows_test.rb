require "test_helper"

class CohortModuleSubmissionWindowsTest < ActionDispatch::IntegrationTest
  def setup
    curriculum = Curriculum.create!(name: "Submission Window Curriculum")
    @curriculum_module = CurriculumModule.create!(
      curriculum: curriculum,
      name: "Two Week Module",
      position: 0,
      day_offset: 0,
      schedule_days: "weekdays"
    )
    Lesson.create!(curriculum_module: @curriculum_module, title: "Week 1", position: 0, release_day: 0)
    Lesson.create!(curriculum_module: @curriculum_module, title: "Week 2", position: 1, release_day: 7)
    @cohort = Cohort.create!(curriculum: curriculum, name: "Cohort", start_date: Date.current)
    @instructor = User.create!(
      clerk_id: "clerk_window_instructor",
      email: "window_instructor@example.com",
      role: :instructor
    )
    @student = User.create!(
      clerk_id: "clerk_window_student",
      email: "window_student@example.com",
      role: :student
    )
  end

  test "staff can save and clear a valid weekly close time" do
    close_at = 2.days.from_now.change(usec: 0)

    as_user(@instructor) do
      patch endpoint,
        params: { submission_windows: [ { week_number: 2, submissions_close_at: close_at.iso8601 } ] },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    window = @cohort.cohort_module_submission_windows.find_by!(module_id: @curriculum_module.id, week_number: 2)
    assert_equal close_at.to_i, window.submissions_close_at.to_i

    as_user(@instructor) do
      patch endpoint,
        params: { submission_windows: [ { week_number: 2, submissions_close_at: nil } ] },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    assert_nil @cohort.cohort_module_submission_windows.find_by(module_id: @curriculum_module.id, week_number: 2)
  end

  test "an out-of-range week rolls back the whole batch" do
    as_user(@instructor) do
      patch endpoint,
        params: {
          submission_windows: [
            { week_number: 1, submissions_close_at: 1.day.from_now.iso8601 },
            { week_number: 3, submissions_close_at: 2.days.from_now.iso8601 }
          ]
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
    assert_empty @cohort.cohort_module_submission_windows
    assert_includes JSON.parse(response.body).fetch("errors"), "Week number must be between 1 and 2"
  end

  test "bare close times are rejected and roll back the whole batch" do
    as_user(@instructor) do
      patch endpoint,
        params: {
          submission_windows: [
            { week_number: 1, submissions_close_at: "2030-07-10T08:00:00Z" },
            { week_number: 2, submissions_close_at: "2030-07-17T18:00:00" }
          ]
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
    assert_empty @cohort.cohort_module_submission_windows
    assert_includes JSON.parse(response.body).fetch("errors").first, "must include a UTC offset"
  end

  test "students cannot manage submission windows" do
    as_user(@student) do
      patch endpoint,
        params: { submission_windows: [ { week_number: 1, submissions_close_at: 1.day.from_now.iso8601 } ] },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
  end

  private

  def endpoint
    "/api/v1/cohorts/#{@cohort.id}/modules/#{@curriculum_module.id}/submission_windows"
  end

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
