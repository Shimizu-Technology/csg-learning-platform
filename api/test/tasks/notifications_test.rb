require "test_helper"
require "rake"

class NotificationsTaskTest < ActiveSupport::TestCase
  test "legacy unlock command uses scheduler checkpoints and dry run" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("notifications:send_daily_unlocks")
    task = Rake::Task["notifications:send_daily_unlocks"]
    previous = ENV["SCHEDULED_TICK_DRY_RUN"]
    ENV["SCHEDULED_TICK_DRY_RUN"] = "1"
    assert_no_difference("ScheduledTaskRun.count") { task.reenable; task.invoke }
    ENV["SCHEDULED_TICK_DRY_RUN"] = nil
    original = NotificationEmailService.method(:configured?)
    NotificationEmailService.define_singleton_method(:configured?) { true }
    task.reenable
    task.invoke
    state = ScheduledTaskRun.find_by!(name: "daily_unlocks")
    assert_equal LearningCalendar.today, state.last_school_date
    assert_no_difference("ScheduledTaskRun.count") { task.reenable; task.invoke }
  ensure
    NotificationEmailService.define_singleton_method(:configured?, original) if original
    ENV["SCHEDULED_TICK_DRY_RUN"] = previous
  end

  test "failed tick command exits nonzero after running independent tasks" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("scheduled:tick")
    original = NotificationEmailService.method(:configured?)
    NotificationEmailService.define_singleton_method(:configured?) { false }
    task = Rake::Task["scheduled:tick"]
    error = assert_raises(SystemExit) { task.reenable; capture_io { task.invoke } }
    assert_equal 1, error.status
    assert ScheduledTaskRun.find_by(name: "expo_push_receipts")
  ensure
    NotificationEmailService.define_singleton_method(:configured?, original) if original
  end
end
