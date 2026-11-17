require "test_helper"
require Rails.root.join("db/migrate/20261118000100_create_scheduled_task_runs").to_s

class CreateScheduledTaskRunsTest < ActiveSupport::TestCase
  test "round trip creates unique task checkpoints and durable notification claims" do
    migration = CreateScheduledTaskRuns.new
    migration.migrate(:down)
    migration.migrate(:up)
    [ ScheduledTaskRun, ScheduledNotificationAttempt ].each(&:reset_column_information)
    ScheduledTaskRun.create!(name: "test")
    assert_raises(ActiveRecord::RecordNotUnique) do
      ScheduledTaskRun.transaction(requires_new: true) { ScheduledTaskRun.create!(name: "test") }
    end
    2.times do
      ScheduledNotificationAttempt.insert_all([ { key: "same", created_at: Time.current } ], unique_by: :index_scheduled_notification_attempts_on_key)
    end
    assert_equal 1, ScheduledNotificationAttempt.where(key: "same").count
  ensure
    ActiveRecord::Base.connection_handler.connection_pool_list.each do |pool|
      pool.connections.each(&:clear_cache!)
    end
    [ ScheduledTaskRun, ScheduledNotificationAttempt ].each(&:reset_column_information)
  end
end
