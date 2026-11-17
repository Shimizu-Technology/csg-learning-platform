require "test_helper"
require_relative "../support/query_counter"

class DailyUnlockNotificationsTest < ActiveSupport::TestCase
  include QueryCounter

  setup do
    travel_to Time.utc(2026, 11, 17, 14, 5) # Nov 18 00:05 Guam, UTC Nov 17
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

  test "missed school days catch up in one digest but initial activation does not replay history" do
    @cohort.update!(start_date: LearningCalendar.today - 2)
    yesterday = @mod.lessons.create!(title: "Yesterday lesson", position: 1, release_day: 1)
    current = @mod.lessons.create!(title: "Current lesson", position: 2, release_day: 2)
    DailyUnlockNotifications.new.call
    assert_equal 1, @sent.size
    assert_includes @sent.last[:html], current.title
    assert_not_includes @sent.last[:html], yesterday.title
    ScheduledNotificationAttempt.delete_all
    @sent.clear
    DailyUnlockNotifications.new.call(last_date: LearningCalendar.today - 2)
    assert_equal 1, @sent.size
    assert_includes @sent.last[:html], yesterday.title
    assert_includes @sent.last[:html], current.title
    assert_not_includes @sent.last[:html], @lesson.title
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
    assert_equal 1, ScheduledNotificationAttempt.count
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
