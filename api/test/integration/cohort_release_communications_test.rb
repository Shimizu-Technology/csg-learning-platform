require "test_helper"
require_relative "../support/query_counter"

class CohortReleaseCommunicationsTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    travel_to Time.utc(2026, 11, 17, 20, 30) # Nov 18 06:30 Guam (before 07:00 unlock hour)
    @env = ENV.to_h.slice("RESEND_API_KEY", "RESEND_FROM_EMAIL", "PUBLIC_FRONTEND_URL", "FRONTEND_URL")
    ENV["RESEND_API_KEY"] = "re_secret_do_not_leak"
    ENV["RESEND_FROM_EMAIL"] = "CSG Learn <notifications@codeschoolofguam.com>"
    ENV["PUBLIC_FRONTEND_URL"] = "https://learn.codeschoolofguam.com"

    @curriculum = Curriculum.create!(name: "Prework Foundations")
    @mod = @curriculum.modules.create!(name: "Week 1 Ruby", position: 0, day_offset: 0, schedule_days: "daily")
    @today_a = @mod.lessons.create!(title: "Variables and Strings", position: 0, release_day: 0, lesson_type: :exercise)
    @today_b = @mod.lessons.create!(title: "String Methods", position: 1, release_day: 0, lesson_type: :exercise)
    @tomorrow = @mod.lessons.create!(title: "Conditionals", position: 2, release_day: 1, lesson_type: :exercise)
    @archived_lesson = @mod.lessons.create!(title: "Archived Draft", position: 3, release_day: 0, archived_at: 1.day.ago)

    @cohort = Cohort.create!(curriculum: @curriculum, name: "Prework Cohort A", start_date: LearningCalendar.today, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Prework Cohort B", start_date: LearningCalendar.today, status: :active)

    @admin = create_user("rc_admin", "rc-admin@example.test", :admin)
    @instructor = create_user("rc_instructor", "rc-instructor@example.test", :instructor)
    @other_instructor = create_user("rc_other_instructor", "rc-other-instructor@example.test", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort.cohort_instructor_assignments.create!(user: @other_instructor)

    @active_student = enroll_student("rc_active", @cohort)
    @paused_student = enroll_student("rc_paused", @cohort, status: :paused)
    @dropped_student = enroll_student("rc_dropped", @cohort, status: :dropped)
    @invited_student = enroll_student("rc_invited", @cohort, clerk_id: "pending_rc_invited")
    @other_student = enroll_student("rc_other_active", @other_cohort)
  end

  teardown do
    %w[RESEND_API_KEY RESEND_FROM_EMAIL PUBLIC_FRONTEND_URL FRONTEND_URL].each { |key| ENV[key] = @env[key] }
    travel_back
  end

  test "requires authentication, staff role, and StaffCohortScope visibility" do
    get "/api/v1/cohorts/#{@cohort.id}/release_communications"
    assert_response :unauthorized

    as_user(@active_student.user) { get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers }
    assert_response :forbidden

    as_user(@other_instructor) { get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers }
    assert_response :forbidden

    as_user(@admin) { get "/api/v1/cohorts/999999/release_communications", headers: auth_headers }
    assert_response :not_found

    as_user(@instructor) { get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers }
    assert_response :success
    assert_equal @cohort.id, response.parsed_body.dig("release_communications", "cohort_id")
  end

  test "returns configuration, recipient breakdown, unique-day upcoming preview, and safe deep links without leaking secrets" do
    SchoolSetting.delete_all

    assert_no_difference("SchoolSetting.count") do
      as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers }
    end

    assert_response :success
    refute_includes response.body, "re_secret_do_not_leak"

    payload = response.parsed_body.fetch("release_communications")
    config = payload.fetch("configuration")
    assert_equal "Pacific/Guam", config.fetch("school_time_zone")
    assert_equal "ChST", config.fetch("school_time_zone_label")
    assert_equal "email", config.fetch("channel")
    assert_equal true, config.fetch("email_configured")
    assert_equal "CSG Learn <notifications@codeschoolofguam.com>", config.fetch("sender_identity")
    assert_equal "CSG Learn", config.fetch("sender_display_name")
    assert_equal "notifications@codeschoolofguam.com", config.fetch("sender_address")
    assert_equal "https://learn.codeschoolofguam.com", config.fetch("frontend_origin")
    assert_equal "program", config.fetch("course_delivery")
    assert_equal "scheduled_daily_unlock", config.fetch("lesson_release_mode")
    assert_equal true, config.fetch("daily_unlocks_apply")
    assert_includes config.fetch("grade_publication_separation_note"), "Grades and instructor feedback are published separately"

    recipients = payload.fetch("recipients")
    assert_equal 4, recipients.fetch("total_enrollments")
    assert_equal 1, recipients.fetch("eligible_active_count")
    excluded = recipients.fetch("excluded")
    assert_equal 1, excluded.fetch("paused")
    assert_equal 1, excluded.fetch("dropped")
    assert_equal 1, excluded.fetch("invite_pending")
    assert_equal 0, excluded.fetch("opted_out")
    assert_equal 0, excluded.fetch("cohort_ineligible")

    upcoming = payload.fetch("upcoming_releases")
    assert_equal 2, upcoming.size
    first_day = upcoming.first
    assert_equal LearningCalendar.today.iso8601, first_day.fetch("release_date")
    assert_equal true, first_day.fetch("is_today")
    assert_equal 1, first_day.fetch("eligible_recipient_count")
    assert_equal [ @today_a.id, @today_b.id ], first_day.fetch("lessons").map { |lesson| lesson.fetch("id") }
    assert_equal "https://learn.codeschoolofguam.com/lessons/#{@today_a.id}?cohort_id=#{@cohort.id}",
      first_day.fetch("lessons").first.fetch("deep_link")
    refute_includes response.body, @archived_lesson.title

    preview = payload.fetch("sample_preview")
    assert_equal "New content unlocked - Code School of Guam", preview.fetch("subject")
    assert_equal "2 new lessons unlocked!", preview.fetch("headline")
    assert_equal "https://learn.codeschoolofguam.com/materials?cohort_id=#{@cohort.id}", preview.fetch("cta_url")

    deliveries = payload.fetch("recent_deliveries")
    assert_equal 1, deliveries.size
    assert_equal "pending", deliveries.first.fetch("status")
    assert_equal 1, deliveries.first.fetch("recipient_count")
  end

  test "isolates recent delivery attempts per cohort and reflects sent and failed states" do
    today_iso = LearningCalendar.today.iso8601
    yesterday_iso = (LearningCalendar.today - 1).iso8601

    ScheduledNotificationAttempt.create!(key: DailyUnlockNotifications.digest_key(@active_student.id, LearningCalendar.today - 1), created_at: 1.day.ago)
    ScheduledNotificationAttempt.create!(key: DailyUnlockNotifications.claim_key(@active_student.id, @today_a.id), created_at: 1.day.ago)
    # Other cohort's attempt must NEVER appear in @cohort's summary.
    ScheduledNotificationAttempt.create!(key: DailyUnlockNotifications.digest_key(@other_student.id, LearningCalendar.today), created_at: Time.current)
    ScheduledNotificationAttempt.create!(key: DailyUnlockNotifications.claim_key(@other_student.id, @today_a.id), created_at: Time.current)

    ScheduledTaskRun.create!(
      name: "daily_unlocks",
      last_attempted_at: 1.day.ago,
      last_succeeded_at: 1.day.ago,
      last_school_date: LearningCalendar.today - 1,
      last_result: { "status" => "run", "sent" => 2, "failed" => 0, "claimed" => 2 }
    )

    as_user(@instructor) { get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers }
    assert_response :success
    deliveries = response.parsed_body.dig("release_communications", "recent_deliveries")
    sent_row = deliveries.find { |row| row["date"] == yesterday_iso }
    assert_equal "sent", sent_row.fetch("status")
    assert_equal 1, sent_row.fetch("recipient_count")
    assert_equal 1, sent_row.fetch("lesson_claim_count")
    assert_nil sent_row.fetch("error_message")
    # Today is still pending for @cohort despite @other_cohort having a claim today.
    today_row = deliveries.find { |row| row["date"] == today_iso }
    assert_equal "pending", today_row.fetch("status")
    refute_includes response.body, @other_cohort.name

    # Simulate an unresolved failure on today's run (e.g., provider rejection released claims).
    ScheduledTaskRun.find_by!(name: "daily_unlocks").update!(
      last_attempted_at: Time.current,
      last_result: { "status" => "error", "error" => "DailyUnlockNotifications::DeliveryFailed", "failed" => 1, "sent" => 0 }
    )
    as_user(@instructor) { get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers }
    assert_response :success
    failed_row = response.parsed_body.dig("release_communications", "recent_deliveries").find { |row| row["date"] == today_iso }
    assert_equal "failed", failed_row.fetch("status")
    assert_includes failed_row.fetch("error_message"), "DeliveryFailed"
  end

  test "explains when self-paced and personal-pace cohorts are skipped" do
    self_paced = Cohort.create!(curriculum: @curriculum, name: "Self-paced track", start_date: LearningCalendar.today, course_delivery: "self_paced", status: :active)
    enroll_student("rc_sp_learner", self_paced)
    ScheduledTaskRun.create!(
      name: "daily_unlocks",
      last_attempted_at: Time.current,
      last_succeeded_at: Time.current,
      last_school_date: LearningCalendar.today,
      last_result: { "status" => "run", "sent" => 0, "failed" => 0 }
    )

    as_user(@admin) { get "/api/v1/cohorts/#{self_paced.id}/release_communications", headers: auth_headers }
    assert_response :success
    payload = response.parsed_body.fetch("release_communications")
    assert_equal false, payload.dig("configuration", "daily_unlocks_apply")
    assert_equal "self_paced_open", payload.dig("configuration", "lesson_release_mode")
    assert_includes payload.dig("configuration", "eligibility_reason"), "Self-paced"
    assert_equal 0, payload.dig("recipients", "eligible_active_count")
    assert_equal 1, payload.dig("recipients", "excluded", "cohort_ineligible")
    assert_empty payload.fetch("upcoming_releases")
    assert_nil payload.fetch("sample_preview")
    assert_equal "skipped", payload.fetch("recent_deliveries").first.fetch("status")
  end

  test "query count stays flat as enrolled learners grow" do
    as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers }
    small = count_queries do
      as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers }
      assert_response :success
    end

    5.times { |idx| enroll_student("rc_growth_#{idx}", @cohort) }
    large = count_queries do
      as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/release_communications", headers: auth_headers }
      assert_response :success
    end
    assert_equal small, large, "Query count grew with learners: #{small} vs #{large}"
  end

  private

  def create_user(clerk_id, email, role)
    User.create!(clerk_id: clerk_id, email: email, first_name: clerk_id.capitalize, last_name: "Test", role: role)
  end

  def enroll_student(slug, cohort, status: :active, clerk_id: slug)
    user = create_user(clerk_id, "#{slug}@example.test", :student)
    enrollment = Enrollment.create!(cohort: cohort, user: user, status: status)
    enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    enrollment
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
