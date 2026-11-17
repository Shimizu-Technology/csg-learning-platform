class AddEditorPreferencesToUsers < ActiveRecord::Migration[8.1]
  # Shared editor preferences (U-6.8) follow a person across devices: the mode
  # every editor opens in ("rich" or "markdown") and whether Enter sends in the
  # message composer. NULL means the person hasn't chosen on the server yet, so
  # a client that remembered a choice locally uploads it once instead of having
  # it reset to the default.
  #
  # Additive only, so the previous release keeps working during rollout: both
  # columns are nullable, and the check constraint is added NOT VALID and
  # validated in its own short transaction. Each step runs in an explicit
  # transaction with SET LOCAL lock_timeout, so the timeout and the DDL share
  # one session through Neon's transaction-mode pooler (docs/DEPLOYMENT.md,
  # migration rules).
  disable_ddl_transaction!

  TABLE = :users
  CONSTRAINT = "users_editor_mode_known"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column TABLE, :editor_mode, :string unless column_exists?(TABLE, :editor_mode)
      add_column TABLE, :editor_enter_sends, :boolean unless column_exists?(TABLE, :editor_enter_sends)
    end
    unless check_constraint_exists?(TABLE, name: CONSTRAINT)
      with_lock_timeout do
        add_check_constraint TABLE, "editor_mode IS NULL OR editor_mode IN ('rich', 'markdown')", name: CONSTRAINT, validate: false
      end
    end
    with_lock_timeout { validate_check_constraint TABLE, name: CONSTRAINT }
  end

  def down
    with_lock_timeout do
      remove_check_constraint TABLE, name: CONSTRAINT if check_constraint_exists?(TABLE, name: CONSTRAINT)
      remove_column TABLE, :editor_enter_sends if column_exists?(TABLE, :editor_enter_sends)
      remove_column TABLE, :editor_mode if column_exists?(TABLE, :editor_mode)
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
