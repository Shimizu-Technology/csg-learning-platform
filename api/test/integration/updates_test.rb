require "test_helper"

class UpdatesTest < ActionDispatch::IntegrationTest
  setup do
    curriculum = Curriculum.create!(name: "Updates curriculum")
    @a = Cohort.create!(curriculum: curriculum, name: "Cohort A", start_date: Date.current, status: :active)
    @b = Cohort.create!(curriculum: curriculum, name: "Cohort B", start_date: Date.current, status: :active)
    @student = User.create!(clerk_id: "updates_student", email: "updates-student@example.com", role: :student)
    @admin = User.create!(clerk_id: "updates_admin", email: "updates-admin@example.com", role: :admin)
    [ @a, @b ].each { |cohort| Enrollment.create!(user: @student, cohort: cohort, status: :active) }
  end

  test "reader context includes school-wide and selected cohort with matching unread count independent of paging and read filter" do
    a = publish("A", @a)
    b = publish("B", @b)
    global = publish("School-wide")
    archived = publish("Archived", @a)
    archived.archived!
    as_user(@student) do
      get "/api/v1/announcements", params: { cohort_id: @a.id, per_page: 1 }, headers: headers
      assert_response :success
      assert_equal 2, response.parsed_body["meta"]["total_count"]
      assert_equal 2, response.parsed_body["unread_count"]
      get "/api/v1/announcements/#{global.id}", headers: headers
      assert response.parsed_body["announcement"]["read_at"]
      refute response.parsed_body["announcement"]["unread"]
      get "/api/v1/announcements", params: { cohort_id: @a.id, read: "read" }, headers: headers
      assert_equal [ global.id ], response.parsed_body["announcements"].map { |item| item["id"] }
      assert_equal 1, response.parsed_body["unread_count"]
      get "/api/v1/announcements", params: { cohort_id: @a.id, audience: "cohort" }, headers: headers
      assert_equal [ a.id ], response.parsed_body["announcements"].map { |item| item["id"] }
      assert_equal 1, response.parsed_body["unread_count"]
      assert @student.notifications.find_by!(notifiable: b).read_at.nil?
    end
  end

  test "staff reader includes school-wide but management cohort filter stays exact" do
    a = publish("A", @a)
    publish("B", @b)
    global = publish("School-wide")
    [ a, global ].each { |item| @admin.notifications.find_or_create_by!(notifiable: item) { |notification| notification.assign_attributes(notification_type: :announcement, title: item.title, path: "/announcements/#{item.id}") } }
    as_user(@admin) do
      get "/api/v1/announcements", params: { cohort_id: @a.id }, headers: headers
      assert_equal [ a.id, global.id ].sort, response.parsed_body["announcements"].map { |item| item["id"] }.sort
      get "/api/v1/announcements", params: { scope: "manage", cohort_id: @a.id }, headers: headers
      assert_equal [ a.id ], response.parsed_body["announcements"].map { |item| item["id"] }
      assert_equal 1, response.parsed_body["unread_count"]
    end
  end

  test "announcement without delivery is readable history rather than a phantom unread item" do
    old = Announcement.create!(title: "Before enrollment", body: "Details", author: @admin, audience: :global, status: :published)
    as_user(@student) do
      get "/api/v1/announcements", headers: headers
      assert_equal 0, response.parsed_body["unread_count"]
      refute response.parsed_body["announcements"].find { |item| item["id"] == old.id }["unread"]
      get "/api/v1/announcements", params: { read: "unread" }, headers: headers
      assert_empty response.parsed_body["announcements"]
    end
  end

  test "both endpoints expose older pages and notification mark-all includes unloaded pages" do
    52.times { |index| publish("Notice #{index}", @a) }
    (Notification.notification_types.keys - [ "announcement" ]).each do |kind|
      source = Announcement.create!(title: kind, body: "Notification source", author: @admin, audience: :global, status: :draft)
      @student.notifications.create!(notifiable: source, notification_type: kind, title: kind, path: "/profile")
    end
    as_user(@student) do
      %w[announcements notifications].each do |endpoint|
        get "/api/v1/#{endpoint}", params: { per_page: 50 }, headers: headers
        first = response.parsed_body.fetch(endpoint).map { |item| item["id"] }
        assert_equal 50, first.length
        assert response.parsed_body["meta"]["has_next_page"]
        get "/api/v1/#{endpoint}", params: { per_page: 50, page: 2 }, headers: headers
        second = response.parsed_body.fetch(endpoint).map { |item| item["id"] }
        assert_empty first & second
        assert second.any?
        refute response.parsed_body["meta"]["has_next_page"]
      end
      patch "/api/v1/notifications/mark_all_read", headers: headers
      assert_equal 0, response.parsed_body["unread_count"]
      assert_equal 0, @student.notifications.unread.count
      get "/api/v1/announcements", params: { cohort_id: @a.id, page: 2, per_page: 50 }, headers: headers
      assert_equal 0, response.parsed_body["unread_count"]
      assert response.parsed_body["announcements"].all? { |item| !item["unread"] && item["read_at"] }
    end
  end

  test "deleted notification targets remain readable inbox history without a dead destination" do
    announcement = publish("Gone", @a)
    notification = @student.notifications.find_by!(notifiable: announcement)
    announcement.delete
    as_user(@student) do
      get "/api/v1/notifications", headers: headers
      item = response.parsed_body["notifications"].find { |row| row["id"] == notification.id }
      refute item["target_available"]
      patch "/api/v1/notifications/#{notification.id}/read", headers: headers
      assert_response :success
      assert response.parsed_body["notification"]["read_at"]
      assert_equal 0, response.parsed_body["unread_count"]
    end
  end

  test "management detail permits drafts and archives only for staff authorized for their audience" do
    instructor = User.create!(clerk_id: "updates_instructor", email: "updates-instructor@example.com", role: :instructor)
    CohortInstructorAssignment.create!(user: instructor, cohort: @a)
    %i[draft archived].each do |status|
      own = Announcement.create!(title: "Own #{status}", body: "Management detail", author: @admin, audience: :cohort, cohort: @a, status: status)
      other = Announcement.create!(title: "Other #{status}", body: "Private detail", author: @admin, audience: :cohort, cohort: @b, status: status)
      global = Announcement.create!(title: "Global #{status}", body: "Private detail", author: @admin, audience: :global, status: status)
      staff = Announcement.create!(title: "Staff #{status}", body: "Private detail", author: @admin, audience: :staff, status: status)
      as_user(instructor) do
        get "/api/v1/announcements/#{own.id}", headers: headers
        assert_response :success
        assert_equal status.to_s, response.parsed_body["announcement"]["status"]
        [ other, global, staff ].each do |item|
          get "/api/v1/announcements/#{item.id}", params: { scope: "manage" }, headers: headers
          assert_response :forbidden
        end
      end
      as_user(@admin) do
        [ own, other, global, staff ].each do |item|
          get "/api/v1/announcements/#{item.id}", headers: headers
          assert_response :success
        end
      end
      as_user(@student) do
        [ own, other, global, staff ].each do |item|
          get "/api/v1/announcements/#{item.id}", params: { scope: "manage" }, headers: headers
          assert_response :forbidden
        end
      end
    end
  end

  test "Today and Updates share scoped delivered unread state across cohort changes and reads" do
    a = publish("A", @a)
    b = publish("B", @b)
    global = publish("School-wide")
    history = Announcement.create!(title: "Pinned history", body: "Before delivery", author: @admin, audience: :global, status: :published, pinned: true)
    archived = publish("Archived", @a)
    archived.archived!
    future = publish("Future", @a)
    future.update!(published_at: 1.day.from_now)
    as_user(@student) do
      [ @a, @b ].each do |cohort|
        get "/api/v1/dashboard", params: { cohort_id: cohort.id }, headers: headers
        assert_response :success
        dashboard = response.parsed_body["dashboard"]["cohort"]
        assert_equal 2, dashboard["unread_notifications_count"]
        expected = cohort == @a ? a : b
        assert_equal [ expected.id, global.id, history.id ].sort, dashboard["announcements"].map { |item| item["id"] }.sort
        assert_equal false, dashboard["announcements"].find { |item| item["id"] == history.id }["unread"]
        assert_equal true, dashboard["announcements"].find { |item| item["id"] == expected.id }["unread"]
        get "/api/v1/announcements", params: { cohort_id: cohort.id }, headers: headers
        assert_equal 2, response.parsed_body["unread_count"]
      end
      get "/api/v1/announcements/#{a.id}", headers: headers
      get "/api/v1/dashboard", params: { cohort_id: @a.id }, headers: headers
      assert_equal 1, response.parsed_body["dashboard"]["cohort"]["unread_notifications_count"]
      refute_includes response.parsed_body["dashboard"]["cohort"]["announcements"].map { |item| item["id"] }, a.id
      notification = @student.notifications.find_by!(notifiable: global)
      patch "/api/v1/notifications/#{notification.id}/read", headers: headers
      get "/api/v1/dashboard", params: { cohort_id: @a.id }, headers: headers
      assert_equal 0, response.parsed_body["dashboard"]["cohort"]["unread_notifications_count"]
      get "/api/v1/dashboard", params: { cohort_id: @b.id }, headers: headers
      assert_equal 1, response.parsed_body["dashboard"]["cohort"]["unread_notifications_count"]
      patch "/api/v1/notifications/mark_all_read", headers: headers
      get "/api/v1/dashboard", params: { cohort_id: @b.id }, headers: headers
      assert_equal 0, response.parsed_body["dashboard"]["cohort"]["unread_notifications_count"]
      assert response.parsed_body["dashboard"]["cohort"]["announcements"].all? { |item| item["unread"] == false }
    end
  end

  private

  def publish(title, cohort = nil)
    announcement = Announcement.create!(title: title, body: "Details", author: @admin, audience: cohort ? :cohort : :global, cohort: cohort, status: :published)
    NotificationDeliveryService.announcement_published(announcement)
    announcement
  end

  def headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
