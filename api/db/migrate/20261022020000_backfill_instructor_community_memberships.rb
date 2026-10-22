class BackfillInstructorCommunityMemberships < ActiveRecord::Migration[8.1]
  def up
    # Track only inserted rows so rollback never removes pre-existing membership.
    unless column_exists?(:workspace_memberships, :instructor_access_backfilled)
      add_column :workspace_memberships, :instructor_access_backfilled, :boolean, default: false, null: false
    end

    execute <<~SQL
      INSERT INTO workspace_memberships
        (workspace_id, user_id, role, instructor_access_backfilled, created_at, updated_at)
      SELECT w.id, u.id, 0, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM workspaces w CROSS JOIN users u
      WHERE w.workspace_type = 1 AND w.status = 0
        AND u.role = 1 AND u.archived_at IS NULL
        AND LEFT(u.clerk_id, 8) <> 'pending_'
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    SQL
  end

  def down
    # Preserve a membership explicitly promoted after the backfill.
    execute "DELETE FROM workspace_memberships WHERE instructor_access_backfilled = TRUE AND role = 0"
    remove_column :workspace_memberships, :instructor_access_backfilled
  end
end
