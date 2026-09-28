class TrackCohortMembershipJoin < ActiveRecord::Migration[8.1]
  def up
    add_column :enrollments, :invited_at, :datetime
    add_column :enrollments, :joined_at, :datetime
    execute "UPDATE enrollments SET invited_at = COALESCE(enrolled_at, created_at)"
    execute <<~SQL
      UPDATE enrollments
      SET joined_at = COALESCE(enrollments.enrolled_at, enrollments.created_at)
      FROM users
      WHERE users.id = enrollments.user_id
        AND users.last_sign_in_at IS NOT NULL
        AND users.last_sign_in_at >= COALESCE(enrollments.enrolled_at, enrollments.created_at)
    SQL
  end

  def down
    remove_column :enrollments, :joined_at
    remove_column :enrollments, :invited_at
  end
end
