require "test_helper"

class CommunicationTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp 2026")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.current, status: :upcoming)

    @student = User.create!(clerk_id: "clerk_student", email: "student@example.com", first_name: "Student", last_name: "User", role: :student)
    @other_student = User.create!(clerk_id: "clerk_other", email: "other@example.com", first_name: "Other", last_name: "User", role: :student)
    @admin = User.create!(clerk_id: "clerk_admin", email: "admin@example.com", first_name: "Admin", last_name: "User", role: :admin)

    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    Enrollment.create!(user: @other_student, cohort: @other_cohort, status: :active)
  end

  test "staff publishes cohort announcement and creates unread notification for enrolled students" do
    assert_enqueued_with(job: PushNotificationJob) do
      as_user(@admin) do
        post "/api/v1/announcements",
          params: {
            title: "Recording posted",
            body: "Class 3 recording is ready.",
            audience: "cohort",
            cohort_id: @cohort.id,
            pinned: true,
            send_push: true
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :created
    announcement = Announcement.last
    assert_equal "Recording posted", announcement.title
    assert announcement.pinned?
    assert_equal @cohort, announcement.cohort
    assert_equal 1, @student.notifications.unread.count
    assert_equal 0, @other_student.notifications.count
  end

  test "student only sees visible announcements for their active cohort and global announcements" do
    cohort_announcement = Announcement.create!(
      title: "Cohort update",
      body: "For your class",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    Announcement.create!(
      title: "Other update",
      body: "Different class",
      author: @admin,
      audience: :cohort,
      cohort: @other_cohort,
      status: :published
    )
    global_announcement = Announcement.create!(
      title: "All students",
      body: "Everyone sees this",
      author: @admin,
      audience: :global,
      status: :published
    )
    NotificationDeliveryService.announcement_published(cohort_announcement)
    NotificationDeliveryService.announcement_published(global_announcement)

    as_user(@student) do
      get "/api/v1/announcements", headers: auth_headers
    end

    assert_response :success
    titles = JSON.parse(response.body).fetch("announcements").map { |announcement| announcement.fetch("title") }
    assert_includes titles, "Cohort update"
    assert_includes titles, "All students"
    refute_includes titles, "Other update"
    assert_equal 2, JSON.parse(response.body).fetch("unread_count")
  end

  test "show announcement marks matching notification as read" do
    announcement = Announcement.create!(
      title: "Read me",
      body: "Please read this",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    NotificationDeliveryService.announcement_published(announcement)

    as_user(@student) do
      get "/api/v1/announcements/#{announcement.id}", headers: auth_headers
    end

    assert_response :success
    assert_equal 0, @student.notifications.unread.count
  end

  test "announcement index supports manage filters and pagination metadata" do
    published = Announcement.create!(
      title: "Published cohort",
      body: "Visible now",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    draft = Announcement.create!(
      title: "Draft cohort",
      body: "Not live yet",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :draft
    )
    Announcement.create!(
      title: "Global update",
      body: "Visible everywhere",
      author: @admin,
      audience: :global,
      status: :published
    )
    NotificationDeliveryService.announcement_published(published)
    NotificationDeliveryService.announcement_published(draft)

    as_user(@admin) do
      get "/api/v1/announcements",
        params: { scope: "manage", audience: "cohort", status: "published", cohort_id: @cohort.id, per_page: 1, page: 1 },
        headers: auth_headers
    end

    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal [ "Published cohort" ], payload.fetch("announcements").map { |announcement| announcement.fetch("title") }
    assert_equal 1, payload.fetch("meta").fetch("page")
    assert_equal 1, payload.fetch("meta").fetch("per_page")
    assert_equal 1, payload.fetch("meta").fetch("total_count")
  end

  test "announcement index can filter unread announcements" do
    read_announcement = Announcement.create!(
      title: "Read announcement",
      body: "Already read",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    unread_announcement = Announcement.create!(
      title: "Unread announcement",
      body: "Still unread",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    NotificationDeliveryService.announcement_published(read_announcement)
    NotificationDeliveryService.announcement_published(unread_announcement)
    @student.notifications.find_by!(notifiable: read_announcement).mark_read!

    as_user(@student) do
      get "/api/v1/announcements", params: { read: "unread" }, headers: auth_headers
    end

    assert_response :success
    titles = JSON.parse(response.body).fetch("announcements").map { |announcement| announcement.fetch("title") }
    assert_includes titles, "Unread announcement"
    refute_includes titles, "Read announcement"
  end

  test "staff can patch cohort announcement without resending audience or cohort id" do
    announcement = Announcement.create!(
      title: "Original",
      body: "Please read this",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )

    as_user(@admin) do
      patch "/api/v1/announcements/#{announcement.id}",
        params: { title: "Updated" },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    announcement.reload
    assert_equal "Updated", announcement.title
    assert_equal "cohort", announcement.audience
    assert_equal @cohort, announcement.cohort
  end

  test "announcement unread actions do not clear unrelated notification types" do
    announcement = Announcement.create!(
      title: "Read me",
      body: "Please read this",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    Notification.create!(
      user: @student,
      actor: @admin,
      notifiable: announcement,
      notification_type: :announcement,
      title: "Announcement",
      path: "/announcements/#{announcement.id}"
    )
    system_source = Announcement.create!(
      title: "System source",
      body: "Used for notification source",
      author: @admin,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )
    Notification.create!(
      user: @student,
      actor: @admin,
      notifiable: system_source,
      notification_type: :system,
      title: "System update",
      path: "/profile"
    )

    as_user(@student) do
      get "/api/v1/notifications", params: { notification_type: "announcement" }, headers: auth_headers
    end

    assert_response :success
    assert_equal 1, JSON.parse(response.body).fetch("unread_count")

    as_user(@student) do
      patch "/api/v1/notifications/mark_all_read", params: { notification_type: "announcement" }, headers: auth_headers
    end

    assert_response :success
    assert_equal 0, @student.notifications.announcement.unread.count
    assert_equal 1, @student.notifications.system.unread.count
  end

  test "notification index supports read filters, sorting, and pagination metadata" do
    older = Notification.create!(
      user: @student,
      actor: @admin,
      notifiable: Announcement.create!(
        title: "Older source",
        body: "Older source body",
        author: @admin,
        audience: :cohort,
        cohort: @cohort,
        status: :published
      ),
      notification_type: :announcement,
      title: "Older notification",
      path: "/announcements/older",
      created_at: 2.days.ago,
      updated_at: 2.days.ago
    )
    newer = Notification.create!(
      user: @student,
      actor: @admin,
      notifiable: Announcement.create!(
        title: "Newer source",
        body: "Newer source body",
        author: @admin,
        audience: :cohort,
        cohort: @cohort,
        status: :published
      ),
      notification_type: :announcement,
      title: "Newer notification",
      path: "/announcements/newer",
      created_at: 1.day.ago,
      updated_at: 1.day.ago
    )
    older.mark_read!

    as_user(@student) do
      get "/api/v1/notifications",
        params: {
          notification_type: "announcement",
          read: "unread",
          sort: "created_asc",
          per_page: 1,
          page: 1
        },
        headers: auth_headers
    end

    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal [ newer.id ], payload.fetch("notifications").map { |notification| notification.fetch("id") }
    assert_equal 1, payload.fetch("meta").fetch("page")
    assert_equal 1, payload.fetch("meta").fetch("per_page")
    assert_equal 1, payload.fetch("meta").fetch("total_count")
    assert_equal 1, payload.fetch("unread_count")
  end

  test "student cannot create announcement" do
    as_user(@student) do
      post "/api/v1/announcements",
        params: { title: "Nope", body: "Nope", audience: "global" },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
  end

  test "same user can refresh push subscription by endpoint" do
    as_user(@student) do
      post "/api/v1/push_subscriptions",
        params: {
          endpoint: "https://push.example/subscription-1",
          keys: {
            p256dh: "public-key",
            auth: "auth-secret"
          }
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    assert_equal 1, @student.push_subscriptions.count

    as_user(@student) do
      post "/api/v1/push_subscriptions",
        params: {
          endpoint: "https://push.example/subscription-1",
          keys: {
            p256dh: "new-public-key",
            auth: "new-auth-secret"
          }
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    subscription = PushSubscription.find_by!(endpoint: "https://push.example/subscription-1")
    assert_equal @student, subscription.user
    assert_equal "new-public-key", subscription.p256dh
  end

  test "push subscription cannot be claimed by a different user" do
    PushSubscription.create!(
      user: @student,
      endpoint: "https://push.example/subscription-1",
      p256dh: "public-key",
      auth: "auth-secret"
    )

    as_user(@admin) do
      post "/api/v1/push_subscriptions",
        params: {
          endpoint: "https://push.example/subscription-1",
          keys: {
            p256dh: "new-public-key",
            auth: "new-auth-secret"
          }
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    subscription = PushSubscription.find_by!(endpoint: "https://push.example/subscription-1")
    assert_equal @student, subscription.user
    assert_equal "public-key", subscription.p256dh
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

    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
