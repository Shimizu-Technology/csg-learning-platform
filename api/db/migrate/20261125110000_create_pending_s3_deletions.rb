# Stored objects whose deletion failed, retried by ScheduledTick so a storage
# outage during cleanup never leaves a file orphaned for good.
class CreatePendingS3Deletions < ActiveRecord::Migration[8.1]
  def change
    create_table :pending_s3_deletions do |t|
      t.string :key, null: false, limit: 1024
      t.string :reason, null: false, limit: 80
      t.integer :attempts, null: false, default: 0
      t.datetime :next_attempt_at, null: false
      t.string :last_error, limit: 200
      t.timestamps
    end
    add_index :pending_s3_deletions, :key, unique: true
    add_index :pending_s3_deletions, :next_attempt_at
  end
end
