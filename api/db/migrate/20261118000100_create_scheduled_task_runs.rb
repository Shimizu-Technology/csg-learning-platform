class CreateScheduledTaskRuns < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    create_table :scheduled_task_runs do |t|
      t.string :name, null: false
      t.datetime :last_succeeded_at
      t.date :last_school_date
      t.timestamps
      t.index :name, unique: true
    end

    # Durable at-most-once claims, committed before external email attempts.
    # No foreign key: removing an enrollment must not erase delivery history.
    create_table :scheduled_notification_attempts do |t|
      t.string :key, null: false
      t.datetime :created_at, null: false
      t.index :key, unique: true
    end
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    drop_table :scheduled_notification_attempts
    drop_table :scheduled_task_runs
  end
end
