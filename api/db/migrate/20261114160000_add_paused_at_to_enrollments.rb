class AddPausedAtToEnrollments < ActiveRecord::Migration[8.1]
  def change
    add_column :enrollments, :paused_at, :datetime
    reversible do |dir|
      dir.up { execute "UPDATE enrollments SET paused_at = updated_at WHERE status = 1 AND paused_at IS NULL" }
    end
  end
end
