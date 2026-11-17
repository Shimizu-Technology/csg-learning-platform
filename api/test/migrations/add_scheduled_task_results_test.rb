require "test_helper"
require Rails.root.join("db/migrate/20261118000200_add_scheduled_task_results").to_s

class AddScheduledTaskResultsTest < ActiveSupport::TestCase
  test "additive results migration preserves existing checkpoints" do
    migration = AddScheduledTaskResults.new
    migration.migrate(:down)
    ScheduledTaskRun.reset_column_information
    row = ScheduledTaskRun.create!(name: "existing", last_school_date: Date.new(2026, 11, 17))
    migration.migrate(:up)
    ScheduledTaskRun.reset_column_information
    assert_equal({}, row.reload.last_result)
    assert_equal Date.new(2026, 11, 17), row.last_school_date
    assert_nil row.last_attempted_at
  ensure
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    ScheduledTaskRun.reset_column_information
  end
end
