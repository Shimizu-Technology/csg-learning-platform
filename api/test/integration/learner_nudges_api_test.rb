require "test_helper"
require_relative "../support/query_counter"

class LearnerNudgesApiTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    SchoolSetting.current.update!(features: { "learner_nudges" => true })
    @curriculum = Curriculum.create!(name: "Reminders")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Reminder cohort", start_date: Date.current, status: :active,
      course_delivery: "guided", settings: { "features" => { "learner_nudges" => true } })
    @teacher = person("teacher", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @student = person("student", :student)
    @enrollment = Enrollment.create!(cohort: @cohort, user: @student, status: :active)
    @path = "/api/v1/enrollments/#{@enrollment.id}/nudges"
  end

  test "staff see the reminders sent, newest first, with delivery and read state" do
    older = nudge("inactive/older", kind: "inactive", threshold: "7d", created_at: 2.days.ago, email_status: "sent")
    newer = nudge("access/newer", kind: "access_ending", threshold: "14d", essential: true, created_at: 1.hour.ago,
      push_requested_at: 1.hour.ago, push_settled_at: 1.hour.ago, web_push_attempted_notification_ids: [ 1 ], expo_push_attempted_notification_ids: [ 1 ])
    Notification.create!(user: @student, notifiable: older, notification_type: :system, title: older.title, path: older.path, read_at: 1.day.ago)
    get @path, headers: headers(@teacher)
    assert_response :success
    body = response.parsed_body
    assert_equal [ true, false ], [ body["enabled"], body["learner_opted_out"] ]
    assert_equal [ newer.id, older.id ], body["nudges"].map { |item| item["id"] }
    assert_equal [ "attempted", true, nil ], body["nudges"].first.values_at("push_status", "essential", "read_at")
    assert_equal [ "not_requested", "sent" ], body["nudges"].last.values_at("push_status", "email_status")
    assert body["nudges"].last["read_at"]

    @student.update!(learner_nudges_enabled: false)
    @cohort.update!(settings: { "features" => {} })
    get @path, headers: headers(@teacher)
    assert_equal [ false, true ], response.parsed_body.values_at("enabled", "learner_opted_out")
  end

  test "learners and staff outside the cohort get not found" do
    [ @student, person("outsider", :instructor) ].each do |user|
      get @path, headers: headers(user)
      assert_response :not_found
      assert_equal({ "error" => "Not found" }, response.parsed_body)
    end
  end

  test "the staff list reads a fixed number of queries as reminders grow" do
    get @path, headers: headers(@teacher) # warm the authentication path
    counts = [ 1, 6 ].map do |size|
      LearnerNudge.delete_all
      size.times do |index|
        item = nudge("grow/#{size}/#{index}", created_at: index.minutes.ago)
        Notification.create!(user: @student, notifiable: item, notification_type: :system, title: item.title, path: item.path)
      end
      count_queries { get @path, headers: headers(@teacher) }
    end
    assert_equal counts.first, counts.last
  end

  test "learners turn optional reminders off and on" do
    get "/api/v1/nudge_preferences", headers: headers(@student)
    assert_equal({ "learner_nudges_enabled" => true }, response.parsed_body)
    patch "/api/v1/nudge_preferences", params: { learner_nudges_enabled: false }, headers: headers(@student), as: :json
    assert_response :success
    assert_equal({ "learner_nudges_enabled" => false }, response.parsed_body)
    assert_not @student.reload.learner_nudges_enabled?
    patch "/api/v1/nudge_preferences", params: { learner_nudges_enabled: "off" }, headers: headers(@student), as: :json
    assert_response :unprocessable_entity
    assert_not @student.reload.learner_nudges_enabled?
    patch "/api/v1/nudge_preferences", params: { learner_nudges_enabled: true }, headers: headers(@student), as: :json
    assert @student.reload.learner_nudges_enabled?
  end

  test "profile and staff progress flag only enrollments whose cohort sends reminders" do
    off = Cohort.create!(curriculum: @curriculum, name: "Off cohort", start_date: Date.current, status: :active)
    off.cohort_instructor_assignments.create!(user: @teacher)
    off_enrollment = Enrollment.create!(cohort: off, user: @student, status: :active)
    get "/api/v1/profile", headers: headers(@student)
    flags = response.parsed_body["enrollments"].to_h { |item| [ item["id"], item["learner_nudges_enabled"] ] }
    assert_equal({ @enrollment.id => true, off_enrollment.id => nil }, flags)
    assert_not response.parsed_body["enrollments"].find { |item| item["id"] == off_enrollment.id }.key?("learner_nudges_enabled")

    get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_equal true, response.parsed_body.dig("enrollment", "learner_nudges_enabled")
    get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: off.id }, headers: headers(@teacher)
    assert_not response.parsed_body.fetch("enrollment").key?("learner_nudges_enabled")
    # An explicit Off with no history omits the flag and avoids a history request.
    @cohort.update!(settings: { "features" => { "learner_nudges" => false } })
    get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_not response.parsed_body.fetch("enrollment").key?("learner_nudges_enabled")
  end

  test "staff keep reminder history when an opted-in cohort switches to Inherit and then Off" do
    item = nudge("history/retained", push_requested_at: 2.hours.ago, push_settled_at: 1.hour.ago,
      web_push_attempted_notification_ids: [ 1 ])
    admin = person("admin", :admin)
    [ nil, false ].each do |override|
      patch "/api/v1/cohorts/#{@cohort.id}/feature_settings", params: { features: { learner_nudges: override } }, headers: headers(admin), as: :json
      assert_response :success
      assert_equal false, response.parsed_body.dig("features", "learner_nudges")

      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @cohort.id }, headers: headers(@teacher)
      assert_equal false, response.parsed_body.dig("enrollment", "learner_nudges_enabled")
      get @path, headers: headers(@teacher)
      assert_equal false, response.parsed_body.fetch("enabled")
      assert_equal [ item.id, "partial" ], response.parsed_body.fetch("nudges").sole.values_at("id", "push_status")
    end
  end

  test "deleting an enrollment removes its reminders and their notifications" do
    item = nudge("gone/1")
    Notification.create!(user: @student, notifiable: item, notification_type: :system, title: item.title, path: item.path)
    @enrollment.destroy!
    assert_equal 0, LearnerNudge.count
    assert_equal 0, Notification.where(notifiable_type: "LearnerNudge").count
  end

  private

  def nudge(key, kind: "due_soon", threshold: "24h", essential: false, created_at: Time.current, **attributes)
    LearnerNudge.create!(enrollment: @enrollment, kind: kind, threshold: threshold, key: key, essential: essential,
      event_at: 1.day.from_now, school_date: LearningCalendar.today, title: "Reminder #{key}", body: "Body",
      path: "/cohorts/#{@cohort.id}", created_at: created_at, **attributes)
  end

  def person(name, role)
    user = User.create!(clerk_id: "nudges_api_#{name}", email: "nudges_api_#{name}@example.com", role: role)
    user.clerk_identities.create!(issuer: ClerkEnvironment.primary&.issuer || "https://test.clerk.invalid", clerk_user_id: user.clerk_id)
    user
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
end
