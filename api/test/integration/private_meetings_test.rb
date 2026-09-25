require "test_helper"

class PrivateMeetingsTest < ActionDispatch::IntegrationTest
  def setup
    curriculum = Curriculum.create!(name: "Python Fundamentals")
    @cohort = Cohort.create!(
      curriculum: curriculum,
      name: "Python pilot",
      cohort_type: :workshop,
      status: :upcoming,
      start_date: Date.current + 30,
      end_date: Date.current + 50
    )
    @admin = user("admin", :admin)
    @instructor = user("instructor", :instructor)
    @other_instructor = user("other_instructor", :instructor)
    @student = user("student", :student)
    @other_student = user("other_student", :student)
    Enrollment.create!(user: @student, cohort: @cohort)
    Enrollment.create!(user: @other_student, cohort: @cohort)
    @start_time = Time.find_zone!("Pacific/Guam").local(@cohort.start_date.year, @cohort.start_date.month, @cohort.start_date.day, 18)

    as_user(@admin) do
      post "/api/v1/staff/private_meeting_configs", params: { cohort_id: @cohort.id, instructor_id: @instructor.id }, headers: auth_headers, as: :json
    end
    assert_response :created
  end

  test "student can book one private meeting per week without seeing another learner's details" do
    slot = publish_slot(@start_time)

    as_user(@student) do
      get "/api/v1/private_meetings", headers: auth_headers
    end
    assert_response :success
    cohort = JSON.parse(response.body).fetch("cohorts").first
    assert_equal @cohort.id, cohort.fetch("id")
    assert_equal 24, cohort.fetch("reschedule_cutoff_hours")
    assert_equal 1, cohort.fetch("max_student_changes")
    assert_equal true, cohort.fetch("slots").first.fetch("available")
    refute cohort.fetch("slots").first.key?("zoom_url")

    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: slot.id }, headers: auth_headers, as: :json
    end
    assert_response :created
    booking = JSON.parse(response.body).fetch("booking")
    assert_equal 1, booking.fetch("week_number")
    assert_nil booking.fetch("zoom_url")

    as_user(@other_student) do
      get "/api/v1/private_meetings", headers: auth_headers
    end
    assert_response :success
    other_view = JSON.parse(response.body).fetch("cohorts").first
    assert_empty other_view.fetch("bookings")
    assert_equal false, other_view.fetch("slots").first.fetch("available")

    as_user(@other_student) do
      post "/api/v1/private_meetings", params: { slot_id: slot.id }, headers: auth_headers, as: :json
      patch "/api/v1/private_meetings/#{booking.fetch('id')}", params: { slot_id: slot.id }, headers: auth_headers, as: :json
    end
    assert_response :not_found
    assert_equal 1, PrivateMeetingBooking.confirmed.count
  end

  test "booking conflicts, one weekly entitlement, and instructor ownership are enforced" do
    first = publish_slot(@start_time)
    second = publish_slot(@start_time + 2.hours)

    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: first.id }, headers: auth_headers, as: :json
    end
    assert_response :created
    booking_id = JSON.parse(response.body).dig("booking", "id")

    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: second.id }, headers: auth_headers, as: :json
    end
    assert_response :conflict

    as_user(@other_instructor) do
      patch "/api/v1/staff/private_meetings/#{booking_id}", params: { zoom_url: "https://zoom.example.com/j/private" }, headers: auth_headers, as: :json
    end
    assert_response :forbidden

    as_user(@instructor) do
      patch "/api/v1/staff/private_meetings/#{booking_id}", params: { zoom_url: "https://zoom.example.com/j/private" }, headers: auth_headers, as: :json
    end
    assert_response :success

    as_user(@student) do
      get "/api/v1/private_meetings", headers: auth_headers
    end
    assert_equal "https://zoom.example.com/j/private", JSON.parse(response.body).dig("cohorts", 0, "bookings", 0, "zoom_url")

    as_user(@other_student) do
      get "/api/v1/private_meetings", headers: auth_headers
    end
    refute_includes response.body, "zoom.example.com/j/private"

    as_user(@student) do
      patch "/api/v1/private_meetings/#{booking_id}", params: { slot_id: second.id }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal 1, PrivateMeetingBooking.find(booking_id).student_change_count

    as_user(@student) do
      patch "/api/v1/private_meetings/#{booking_id}", params: { slot_id: first.id }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity

    as_user(@student) do
      delete "/api/v1/private_meetings/#{booking_id}", headers: auth_headers
    end
    assert_response :success
    assert PrivateMeetingBooking.find(booking_id).canceled?
  end

  test "overlapping published slots are rejected and booked slots cannot be removed" do
    first = publish_slot(@start_time)

    as_user(@instructor) do
      post "/api/v1/staff/private_meeting_slots", params: { cohort_id: @cohort.id, starts_at: (@start_time + 30.minutes).iso8601 }, headers: auth_headers, as: :json
    end
    assert_response :conflict
    assert_equal 1, PrivateMeetingSlot.active.count

    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: first.id }, headers: auth_headers, as: :json
    end
    assert_response :created

    as_user(@instructor) do
      delete "/api/v1/staff/private_meeting_slots/#{first.id}", headers: auth_headers
    end
    assert_response :conflict
    assert first.reload.active?
  end

  test "a meeting must finish inside its course week" do
    last_half_hour = @start_time + 6.days + 5.hours + 30.minutes
    as_user(@instructor) do
      post "/api/v1/staff/private_meeting_slots", params: { cohort_id: @cohort.id, starts_at: last_half_hour.iso8601 }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal 0, PrivateMeetingSlot.count
  end

  test "unenrolled students cannot book a private slot" do
    slot = publish_slot(@start_time)
    stranger = user("stranger", :student)

    as_user(stranger) do
      post "/api/v1/private_meetings", params: { slot_id: slot.id }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal 0, PrivateMeetingBooking.count
  end

  test "weekly publishing, learner cancellation, and rebooking preserve the change limit" do
    as_user(@instructor) do
      post "/api/v1/staff/private_meeting_slots", params: { cohort_id: @cohort.id, starts_at: @start_time.iso8601, repeat_weeks: 3 }, headers: auth_headers, as: :json
    end
    assert_response :created
    slots = JSON.parse(response.body).fetch("slots")
    assert_equal 3, slots.length
    assert_equal [ 1, 2, 3 ], PrivateMeetingSlot.order(:starts_at).map { |slot| @cohort.private_meeting_config.week_for(slot.starts_at) }

    first = PrivateMeetingSlot.find(slots.first.fetch("id"))
    replacement = publish_slot(@start_time + 2.hours)
    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: first.id }, headers: auth_headers, as: :json
    end
    assert_response :created
    booking_id = JSON.parse(response.body).dig("booking", "id")

    as_user(@student) do
      delete "/api/v1/private_meetings/#{booking_id}", headers: auth_headers
    end
    assert_response :success
    assert_equal 0, PrivateMeetingBooking.find(booking_id).student_change_count

    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: replacement.id }, headers: auth_headers, as: :json
    end
    assert_response :created
    new_booking_id = JSON.parse(response.body).dig("booking", "id")
    assert_equal 1, PrivateMeetingBooking.find(new_booking_id).student_change_count

    as_user(@student) do
      delete "/api/v1/private_meetings/#{new_booking_id}", headers: auth_headers
    end
    assert_response :success
    assert PrivateMeetingBooking.find(new_booking_id).canceled?

    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: first.id }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
  end

  test "staff updates reject mixed actions without moving the meeting" do
    first = publish_slot(@start_time)
    second = publish_slot(@start_time + 2.hours)
    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: first.id }, headers: auth_headers, as: :json
    end
    booking_id = JSON.parse(response.body).dig("booking", "id")

    as_user(@instructor) do
      patch "/api/v1/staff/private_meetings/#{booking_id}", params: { slot_id: second.id, zoom_url: "invalid" }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal first.id, PrivateMeetingBooking.find(booking_id).private_meeting_slot_id
    assert_equal 1, PrivateMeetingBookingEvent.where(private_meeting_booking_id: booking_id).count
  end

  test "staff cancellation restores booking even after the learner used a change" do
    first = publish_slot(@start_time)
    second = publish_slot(@start_time + 2.hours)
    third = publish_slot(@start_time + 4.hours)
    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: first.id }, headers: auth_headers, as: :json
    end
    first_booking_id = JSON.parse(response.body).dig("booking", "id")
    as_user(@student) do
      delete "/api/v1/private_meetings/#{first_booking_id}", headers: auth_headers
      post "/api/v1/private_meetings", params: { slot_id: second.id }, headers: auth_headers, as: :json
    end
    assert_response :created
    second_booking_id = JSON.parse(response.body).dig("booking", "id")
    assert_equal 1, PrivateMeetingBooking.find(second_booking_id).student_change_count

    as_user(@instructor) do
      patch "/api/v1/staff/private_meetings/#{second_booking_id}", params: { status: "canceled" }, headers: auth_headers, as: :json
    end
    assert_response :success

    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: third.id }, headers: auth_headers, as: :json
    end
    assert_response :created
    assert_equal 1, PrivateMeetingBooking.find(JSON.parse(response.body).dig("booking", "id")).student_change_count
  end

  test "deletion reports a conflict when meeting history must be retained" do
    slot = publish_slot(@start_time)
    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: slot.id }, headers: auth_headers, as: :json
    end
    enrollment = @student.enrollments.find_by!(cohort: @cohort)

    as_user(@admin) do
      delete "/api/v1/enrollments/#{enrollment.id}", headers: auth_headers
    end
    assert_response :conflict
    assert enrollment.reload.persisted?

    as_user(@admin) do
      delete "/api/v1/cohorts/#{@cohort.id}", headers: auth_headers
    end
    assert_response :conflict
    assert @cohort.reload.persisted?
  end

  test "a paused enrollment cannot change or book meetings" do
    first = publish_slot(@start_time)
    second = publish_slot(@start_time + 2.hours)
    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: first.id }, headers: auth_headers, as: :json
    end
    assert_response :created
    booking_id = JSON.parse(response.body).dig("booking", "id")
    @student.enrollments.find_by!(cohort: @cohort).paused!

    as_user(@student) do
      patch "/api/v1/private_meetings/#{booking_id}", params: { slot_id: second.id }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    as_user(@student) do
      post "/api/v1/private_meetings", params: { slot_id: second.id }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
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

  def user(name, role)
    User.create!(clerk_id: "clerk_private_#{name}", email: "#{name}@example.com", first_name: name.capitalize, role: role)
  end

  def publish_slot(starts_at)
    as_user(@instructor) do
      post "/api/v1/staff/private_meeting_slots", params: { cohort_id: @cohort.id, starts_at: starts_at.iso8601 }, headers: auth_headers, as: :json
    end
    assert_response :created
    PrivateMeetingSlot.find(JSON.parse(response.body).dig("slots", 0, "id"))
  end
end
