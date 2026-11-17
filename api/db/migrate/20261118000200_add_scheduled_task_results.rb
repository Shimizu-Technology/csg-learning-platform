class AddScheduledTaskResults < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    add_column :scheduled_task_runs, :last_attempted_at, :datetime
    add_column :scheduled_task_runs, :last_result, :jsonb, default: {}, null: false
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    remove_column :scheduled_task_runs, :last_result
    remove_column :scheduled_task_runs, :last_attempted_at
  end
end
