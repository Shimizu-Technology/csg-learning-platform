require "test_helper"

class WebHandoffsTest < ActionDispatch::IntegrationTest
  def setup
    @user = User.create!(clerk_id: "clerk_handoff", email: "handoff@example.com", first_name: "Mobile", last_name: "Student", role: :student)
  end

  test "authenticated users can create an allowlisted handoff" do
    service = Object.new
    expected_user = @user
    service.define_singleton_method(:create) do |user:, redirect_url:|
      raise unless user == expected_user && redirect_url.end_with?("/lessons/42")
      { success: true, url: "https://accounts.example.com/one-time" }
    end

    original_new = ClerkWebHandoffService.method(:new)
    ClerkWebHandoffService.define_singleton_method(:new) { service }
    begin
      as_user do
        post "/api/v1/web_handoffs", params: { destination: "/lessons/42" }, headers: auth_headers, as: :json
      end
    ensure
      ClerkWebHandoffService.define_singleton_method(:new, original_new)
    end

    assert_response :success
    assert_equal "https://accounts.example.com/one-time", JSON.parse(response.body)["url"]
  end

  test "learners can open their private meetings page on the web" do
    destination = nil
    service = Object.new
    service.define_singleton_method(:create) do |user:, redirect_url:|
      destination = redirect_url
      { success: true, url: "https://accounts.example.com/meetings" }
    end

    original_new = ClerkWebHandoffService.method(:new)
    ClerkWebHandoffService.define_singleton_method(:new) { service }
    begin
      as_user do
        post "/api/v1/web_handoffs", params: { destination: "/meetings?cohort_id=7" }, headers: auth_headers, as: :json
      end
    ensure
      ClerkWebHandoffService.define_singleton_method(:new, original_new)
    end

    assert_response :success
    assert_equal "#{FrontendUrlResolver.resolve.delete_suffix('/')}/meetings?cohort_id=7", destination
  end

  test "exact recording and anchored lesson handoffs retain their complete destination" do
    captured = []
    service = Object.new
    service.define_singleton_method(:create) do |user:, redirect_url:|
      captured << redirect_url
      { success: true, url: "https://accounts.example.com/context" }
    end
    original = ClerkWebHandoffService.method(:new)
    ClerkWebHandoffService.define_singleton_method(:new) { service }
    [ "/recordings?cohort_id=2&recording=9", "/recordings?cohort_id=2&recording=legacy-2-1", "/lessons/42?cohort_id=2#block-8" ].each do |destination|
      as_user { post "/api/v1/web_handoffs", params: { destination: destination }, headers: auth_headers, as: :json }
      assert_response :success
      assert captured.last.end_with?(destination)
    end
    [ "/recordings", "/recordings?cohort_id=2&recording=9&next=https://evil.test", "/admin/meetings" ].each do |destination|
      as_user { post "/api/v1/web_handoffs", params: { destination: destination }, headers: auth_headers, as: :json }
      assert_includes [ 403, 422 ], response.status
    end
  ensure
    ClerkWebHandoffService.define_singleton_method(:new, original) if original
  end

  test "rejects lookalike meeting destinations" do
    as_user do
      post "/api/v1/web_handoffs", params: { destination: "/meetings/../admin" }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
  end

  test "rejects external and unsupported destinations before calling Clerk" do
    as_user do
      post "/api/v1/web_handoffs", params: { destination: "https://evil.example" }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
  end

  test "staff can create a handoff to a supported mobile administration fallback" do
    staff = User.create!(clerk_id: "clerk_handoff_staff", email: "handoff-staff@example.com", role: :instructor)
    destination = nil
    service = Object.new
    service.define_singleton_method(:create) do |user:, redirect_url:|
      destination = [ user, redirect_url ]
      { success: true, url: "https://accounts.example.com/staff-handoff" }
    end
    original_new = ClerkWebHandoffService.method(:new)
    ClerkWebHandoffService.define_singleton_method(:new) { service }

    as_user(staff) do
      post "/api/v1/web_handoffs", params: { destination: "/admin/students/42" }, headers: auth_headers, as: :json
    end

    assert_response :success
    assert_equal "https://accounts.example.com/staff-handoff", JSON.parse(response.body).fetch("url")
    assert_equal [ staff, "#{FrontendUrlResolver.resolve.delete_suffix('/')}/admin/students/42" ], destination
  ensure
    ClerkWebHandoffService.define_singleton_method(:new, original_new) if defined?(original_new) && original_new
  end

  test "staff handoffs include connected intervention and student workspace records" do
    staff = User.create!(clerk_id: "clerk_connected_staff", email: "connected-staff@example.com", role: :instructor)
    service = Object.new
    service.define_singleton_method(:create) { |user:, redirect_url:| { success: true, url: "https://accounts.example.com/connected?user=#{user.id}&destination=#{redirect_url}" } }
    original_new = ClerkWebHandoffService.method(:new)
    ClerkWebHandoffService.define_singleton_method(:new) { service }

    [ "/admin/cohorts/4?tab=schedule", "/admin/cohorts/4?tab=recordings", "/admin/meetings?cohort_id=4&booking_id=9&week=2", "/admin/interventions/61", "/admin/help-requests/41", "/admin/submissions/31", "/admin/cohorts/4/students/18/support", "/admin/students/18?legacy=1&cohort_id=4" ].each do |destination|
      as_user(staff) { post "/api/v1/web_handoffs", params: { destination: destination }, headers: auth_headers, as: :json }
      assert_response :success, destination
    end
  ensure
    ClerkWebHandoffService.define_singleton_method(:new, original_new) if defined?(original_new) && original_new
  end

  test "legacy cohort settings handoffs support both staff roles and validate the cohort id" do
    service = Object.new
    service.define_singleton_method(:create) { |user:, redirect_url:| { success: true, url: redirect_url } }
    original_new = ClerkWebHandoffService.method(:new)
    ClerkWebHandoffService.define_singleton_method(:new) { service }
    %i[admin instructor].each do |role|
      staff = User.create!(clerk_id: "settings_#{role}", email: "settings-#{role}@example.com", role: role)
      as_user(staff) { post "/api/v1/web_handoffs", params: { destination: "/admin/cohorts/4/settings" }, headers: auth_headers, as: :json }
      assert_response :success
      assert_equal "#{FrontendUrlResolver.resolve.delete_suffix('/')}/admin/cohorts/4/settings", JSON.parse(response.body).fetch("url")
      %w[0 -1 abc 4oops].each do |id|
        as_user(staff) { post "/api/v1/web_handoffs", params: { destination: "/admin/cohorts/#{id}/settings" }, headers: auth_headers, as: :json }
        assert_response :unprocessable_entity
      end
    end
  ensure
    ClerkWebHandoffService.define_singleton_method(:new, original_new) if defined?(original_new) && original_new
  end

  test "students cannot create an administration handoff" do
    as_user do
      post "/api/v1/web_handoffs", params: { destination: "/admin/grading" }, headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  test "meeting handoffs reject unconsumed queries, duplicate or nonpositive ids and fragments" do
    staff = User.create!(clerk_id: "strict_meetings_staff", email: "strict-meetings@example.com", role: :instructor)
    [ "?next=https://evil.test", "?cohort_id=2&cohort_id=3", "?booking_id=0", "?week=-1", "?cohort_id=1.2", "?cohort_id=", "?", "?week=2?week=3", "#booking-3", "?cohort_id=2#unexpected" ].each do |suffix|
      as_user(staff) { post "/api/v1/web_handoffs", params: { destination: "/admin/meetings#{suffix}" }, headers: auth_headers, as: :json }
      assert_response :unprocessable_entity, suffix
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user = @user)
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) do |_token|
      { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    end
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
