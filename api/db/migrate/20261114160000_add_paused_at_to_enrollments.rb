class AddPausedAtToEnrollments < ActiveRecord::Migration[8.1]
  def change
    add_column :enrollments, :paused_at, :datetime
  end
end
