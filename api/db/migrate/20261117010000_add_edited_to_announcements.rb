class AddEditedToAnnouncements < ActiveRecord::Migration[8.1]
  # Edits after publishing (W6 PR 6.4a, U-3.6): when the author or an admin
  # changes a posted update's title or body, readers see "Edited" with the
  # time. Like messages (`messages.edited_at`), only the latest edit and its
  # editor are kept; there is no revision history.
  #
  # Additive only, so the previous release keeps working during rollout:
  # both columns are nullable and the foreign key is added NOT VALID and
  # validated in its own short transaction. Each step runs in an explicit
  # transaction with SET LOCAL lock_timeout, so the timeout and the DDL share
  # one session through Neon's transaction-mode pooler (docs/DEPLOYMENT.md,
  # migration rules). No index on edited_by_id: the table holds a school's
  # updates (hundreds of rows), and nothing looks announcements up by editor.
  disable_ddl_transaction!

  TABLE = :announcements
  FOREIGN_KEY = "fk_announcements_edited_by"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column TABLE, :edited_at, :datetime unless column_exists?(TABLE, :edited_at)
      add_column TABLE, :edited_by_id, :bigint unless column_exists?(TABLE, :edited_by_id)
    end
    unless foreign_key_exists?(TABLE, name: FOREIGN_KEY)
      with_lock_timeout do
        add_foreign_key TABLE, :users, column: :edited_by_id, name: FOREIGN_KEY, on_delete: :nullify, validate: false
      end
    end
    with_lock_timeout { validate_foreign_key TABLE, name: FOREIGN_KEY }
  end

  def down
    with_lock_timeout do
      remove_foreign_key TABLE, name: FOREIGN_KEY if foreign_key_exists?(TABLE, name: FOREIGN_KEY)
      remove_column TABLE, :edited_by_id if column_exists?(TABLE, :edited_by_id)
      remove_column TABLE, :edited_at if column_exists?(TABLE, :edited_at)
    end
  end

  private

  # One transaction, so SET LOCAL and the DDL run on the same pooled session.
  def with_lock_timeout(&block)
    transaction do
      execute "SET LOCAL lock_timeout = '#{LOCK_TIMEOUT}'"
      block.call
    end
  end
end
