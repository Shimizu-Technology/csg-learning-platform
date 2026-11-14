class AddPausedAtToEnrollments < ActiveRecord::Migration[8.1]
  def up
    add_column :enrollments, :paused_at, :datetime unless column_exists?(:enrollments, :paused_at)
    add_column :enrollments, :read_cutoff_at, :datetime unless column_exists?(:enrollments, :read_cutoff_at)
    execute "UPDATE enrollments SET read_cutoff_at = updated_at WHERE status = 1 AND paused_at IS NULL AND read_cutoff_at IS NULL"
  end

  def down
    remove_column :enrollments, :read_cutoff_at if column_exists?(:enrollments, :read_cutoff_at)
    remove_column :enrollments, :paused_at if column_exists?(:enrollments, :paused_at)
  end
end
