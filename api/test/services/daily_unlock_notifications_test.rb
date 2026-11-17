require "test_helper"
require_relative "../support/query_counter"

class DailyUnlockNotificationsTest < ActiveSupport::TestCase
  include QueryCounter

  setup do
    travel_to Time.utc(2026, 11, 17, 21, 5) # Nov 18 07:05 Guam, UTC Nov 17
    @env = ENV.to_h.slice("RESEND_API_KEY", "RESEND_FROM_EMAIL")
    ENV["RESEND_API_KEY"] = "re_test"
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@example.test>"
    @send = Resend::Emails.method(:send)
    @sent = []
    sent = @sent
    Resend::Emails.define_singleton_method(:send) { |params, options: {}| sent << params; { id: "scheduled-test" } }
    @curriculum = Curriculum.create!(name: "Scheduled course")
    @mod = @curriculum.modules.create!(name: "Daily", position: 0, day_offset: 0, schedule_days: "daily")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Daily cohort", start_date: LearningCalendar.today, status: :active)
    @lesson = @mod.lessons.create!(title: "Today lesson", position: 0, release_day: 0)
    @enrollment = enroll("first")
  end

  teardown do
    Resend::Emails.define_singleton_method(:send, @send)
    %w[RESEND_API_KEY RESEND_FROM_EMAIL].each { |key| ENV[key] = @env[key] }
    travel_back
  end

  test "school-local midnight sends today's lesson exactly once on repeat" do
    assert_not_equal Date.current, LearningCalendar.today
    2.times { DailyUnlockNotifications.new.call }
    assert_equal 1, @sent.size
    assert_includes @sent.first[:html], "/lessons/#{@lesson.id}?cohort_id=#{@cohort.id}"
  end

  test "lesson-only overrides, personal required scope, pauses, expired access and self-paced rules" do
    @enrollment.module_assignments.destroy_all
    @enrollment.lesson_assignments.create!(lesson: @lesson, unlock_date_override: LearningCalendar.today)
    optional = @mod.lessons.create!(title: "Optional lesson", position: 1, release_day: 0)
    @enrollment.lesson_assignments.create!(lesson: optional, unlock_date_override: LearningCalendar.today)
    @cohort.update!(settings: { "features" => { "learning_plans" => true } })
    SchoolSetting.current.update!(features: { "learning_plans" => true })
    @enrollment.create_learning_plan!(title: "Personal", active: true,
      lesson_overrides: [ { "lesson_id" => optional.id, "required" => false, "reason" => "Not in plan" } ])
    paused = enroll("paused")
    paused.update!(status: :paused)
    expired = enroll("expired")
    expired.update_columns(access_expires_at: 1.second.ago)
    locked = enroll("locked")
    locked.lesson_assignments.create!(lesson: @lesson, unlocked: false)
    locked.lesson_assignments.create!(lesson: optional, unlocked: false)
    self_paced = Cohort.create!(curriculum: @curriculum, name: "Self-paced", start_date: LearningCalendar.today, course_delivery: "self_paced", status: :active)
    enroll("self_paced", cohort: self_paced)
    DailyUnlockNotifications.new.call
    assert_equal [ @enrollment.user.email ], @sent.map { |mail| mail[:to] }
    assert_includes @sent.first[:html], "Today lesson"
    assert_not_includes @sent.first[:html], "Optional lesson"
  end

  test "catch-up is capped at three school days and includes late releases on the next digest" do
    @cohort.update!(start_date: LearningCalendar.today - 3)
    recent = 3.times.map { |index| @mod.lessons.create!(title: "Recent #{index}", position: index + 1, release_day: index + 1) }
    metrics = {}
    DailyUnlockNotifications.new.call(last_date: LearningCalendar.today - 10, metrics: metrics)
    assert_equal 1, @sent.size
    recent.each { |lesson| assert_includes @sent.last[:html], lesson.title }
    assert_not_includes @sent.last[:html], @lesson.title
    assert_equal 3, metrics[:catch_up_days]
    late = @mod.lessons.create!(title: "Late yesterday", position: 5, release_day: 3)
    travel 1.day
    DailyUnlockNotifications.new.call(last_date: LearningCalendar.today - 1)
    assert_equal 2, @sent.size
    assert_includes @sent.last[:html], late.title
    assert_not_includes @sent.last[:html], recent.last.title
  end

  test "uncertain provider delivery retains claims across failure and next-day catch-up" do
    attempts = 0
    sent = @sent
    Resend::Emails.define_singleton_method(:send) do |params, options: {}|
      attempts += 1
      sent << params
      raise "connection lost after acceptance"
    end
    assert_raises(DailyUnlockNotifications::DeliveryFailed) { DailyUnlockNotifications.new.call }
    assert_equal 2, ScheduledNotificationAttempt.count
    DailyUnlockNotifications.new.call
    travel 1.day
    DailyUnlockNotifications.new.call(last_date: LearningCalendar.today - 2)
    assert_equal 1, attempts
  end

  test "provider claims survive a failed checkpoint" do
    task = ScheduledTick::TASKS.find { |entry| entry.name == "daily_unlocks" }
    original = ScheduledTaskRun.instance_method(:update!)
    ScheduledTaskRun.define_method(:update!) { |*| raise "checkpoint lost" }
    assert_not ScheduledTick.new(tasks: [ task ]).call
    assert_equal 1, @sent.size
    ScheduledTaskRun.define_method(:update!, original)
    assert ScheduledTick.new(tasks: [ task ]).call
    assert_equal 1, @sent.size
  ensure
    ScheduledTaskRun.define_method(:update!, original) if original
  end

  test "queries including writes stay flat as recipients grow" do
    DailyUnlockNotifications.new.call
    ScheduledNotificationAttempt.delete_all
    @sent.clear
    small = capture_queries { DailyUnlockNotifications.new.call }
    9.times { |index| enroll("growth#{index}") }
    ScheduledNotificationAttempt.delete_all
    @sent.clear
    large = capture_queries { DailyUnlockNotifications.new.call }
    assert_equal 10, @sent.size
    assert_equal small.size, large.size, "1 recipient: #{small.size}; 10 recipients: #{large.size}\n#{large.join("\n")}"
  end

  test "upcoming cohorts whose start date arrived use Learn's active scope" do
    @cohort.update_columns(status: Cohort.statuses.fetch("upcoming"))
    DailyUnlockNotifications.new.call
    assert_equal 1, @sent.size
  end

  private

  def enroll(name, cohort: @cohort)
    user = User.create!(clerk_id: "scheduled_#{name}", email: "scheduled-#{name}@example.test", role: :student)
    enrollment = Enrollment.create!(cohort: cohort, user: user)
    enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    enrollment
  end
end

class DailyUnlockNotificationsTest
  test "digest waits until school 07:00 and records counts once that day" do
    task = ScheduledTick::TASKS.find { |entry| entry.name == "daily_unlocks" }
    assert ScheduledTick.new(now: Time.utc(2026, 11, 17, 20, 59), tasks: [ task ]).call
    assert_empty @sent
    assert ScheduledTick.new(now: Time.utc(2026, 11, 17, 21), tasks: [ task ]).call
    assert_equal 1, @sent.size
    result = ScheduledTaskRun.find_by!(name: "daily_unlocks").last_result
    assert_equal 1, result["claimed"]
    assert_equal 1, result["sent"]
    assert_equal 0, result["failed"]
    assert ScheduledTick.new(now: Time.utc(2026, 11, 18, 1), tasks: [ task ]).call
    assert_equal 1, @sent.size
  end

  test "supplied time governs upcoming cohort, expiry and school-day eligibility" do
    target = Time.current + 1.day
    @cohort.update_columns(status: Cohort.statuses.fetch("upcoming"), start_date: LearningCalendar.today(at: target))
    @enrollment.update_columns(access_expires_at: target + 1.hour)
    expired = enroll("target_expired")
    expired.update_columns(access_expires_at: target - 1.hour)
    DailyUnlockNotifications.new.call(now: target)
    assert_equal [ @enrollment.user.email ], @sent.map { |mail| mail[:to] }
  end

  test "optional lessons remain eligible without an active personal plan" do
    @lesson.update!(required: false)
    DailyUnlockNotifications.new.call
    assert_equal 1, @sent.size
    assert_includes @sent.first[:html], @lesson.title
  end

  [ 422, 429, 500, 503, 408, nil ].each do |status|
    test "HTTP #{status || 'timeout'} releases only definite rejection claims" do
      attempts = 0
      original = @send
      Resend::Emails.define_singleton_method(:send) do |*, **|
        attempts += 1
        raise(status ? Resend::Error::ERRORS.fetch(status, Resend::Error).new("provider failure", status) : Timeout::Error.new("uncertain timeout"))
      end
      metrics = {}
      assert_raises(DailyUnlockNotifications::DeliveryFailed) { DailyUnlockNotifications.new.call(metrics: metrics) }
      retryable = [ 422, 429 ].include?(status)
      assert_equal(retryable ? 0 : 2, ScheduledNotificationAttempt.count)
      assert_equal 1, metrics[:failed]
      Resend::Emails.define_singleton_method(:send) { |*, **| attempts += 1; { id: "success" } }
      DailyUnlockNotifications.new.call
      assert_equal(retryable ? 2 : 1, attempts)
    ensure
      Resend::Emails.define_singleton_method(:send, original) if original
    end
  end

  test "partial failure retries cannot send a second same-day digest after a late release" do
    other = enroll("partial_retry")
    accepted = []
    first = @enrollment.user.email
    Resend::Emails.define_singleton_method(:send) do |params, **|
      raise Resend::Error::RateLimitExceededError.new("reject", 429) unless params[:to] == first

      accepted << params
      { id: "accepted" }
    end
    assert_raises(DailyUnlockNotifications::DeliveryFailed) { DailyUnlockNotifications.new.call }
    late = @mod.lessons.create!(title: "Late release", position: 10, release_day: 0)
    Resend::Emails.define_singleton_method(:send) { |params, **| accepted << params; { id: "accepted" } }
    DailyUnlockNotifications.new.call
    assert_equal 1, accepted.count { |params| params[:to] == first }
    assert_equal 1, accepted.count { |params| params[:to] == other.user.email }
    travel 1.day
    DailyUnlockNotifications.new.call
    first_later = accepted.select { |params| params[:to] == first }.last
    assert_includes first_later[:html], late.title
    assert_equal 2, accepted.count { |params| params[:to] == first }
    assert_equal 1, accepted.count { |params| params[:to] == other.user.email }
  end

  test "dry preview reports only unclaimed recipients and lessons with no writes or sends" do
    SchoolSetting.delete_all
    assert_no_difference("SchoolSetting.count") { DailyUnlockNotifications.new.preview }
    preview = DailyUnlockNotifications.new.preview
    assert_equal 1, preview[:recipients]
    assert_equal 1, preview[:lessons]
    assert_empty @sent
    assert_equal 0, ScheduledNotificationAttempt.count
    DailyUnlockNotifications.new.call
    assert_equal 0, DailyUnlockNotifications.new.preview[:would_claim]
  end
end
