class AddLessonEditingGrantsToCohortInstructorAssignments < ActiveRecord::Migration[8.1]
  # Per-cohort lesson editing access for instructors (W5 PR 5.3 part 2,
  # decision 1 in docs/design/2026-11-platform-redesign/README.md §12).
  # Editing stays admin-only unless an admin turns this on for one
  # instructor on one cohort, and it lives on the assignment row so removing
  # the instructor from the cohort removes the access with it.
  #
  # Additive only, so the previous release keeps working during rollout:
  # the boolean has a constant default (a metadata-only change in
  # PostgreSQL 11+), the other two columns are nullable, and the foreign key
  # is added NOT VALID and validated in its own short transaction. Each step
  # runs in an explicit transaction with SET LOCAL lock_timeout, so the
  # timeout and the DDL share one session through Neon's transaction-mode
  # pooler (docs/DEPLOYMENT.md, migration rules).
  disable_ddl_transaction!

  TABLE = :cohort_instructor_assignments
  FOREIGN_KEY = "fk_cohort_instructor_assignments_edit_granted_by"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column TABLE, :can_edit_lessons, :boolean, default: false, null: false unless column_exists?(TABLE, :can_edit_lessons)
      add_column TABLE, :edit_granted_by_id, :bigint unless column_exists?(TABLE, :edit_granted_by_id)
      add_column TABLE, :edit_granted_at, :datetime unless column_exists?(TABLE, :edit_granted_at)
    end
    unless foreign_key_exists?(TABLE, name: FOREIGN_KEY)
      with_lock_timeout do
        add_foreign_key TABLE, :users, column: :edit_granted_by_id, name: FOREIGN_KEY, on_delete: :nullify, validate: false
      end
    end
    with_lock_timeout { validate_foreign_key TABLE, name: FOREIGN_KEY }
  end

  def down
    with_lock_timeout do
      remove_foreign_key TABLE, name: FOREIGN_KEY if foreign_key_exists?(TABLE, name: FOREIGN_KEY)
      remove_column TABLE, :edit_granted_at if column_exists?(TABLE, :edit_granted_at)
      remove_column TABLE, :edit_granted_by_id if column_exists?(TABLE, :edit_granted_by_id)
      remove_column TABLE, :can_edit_lessons if column_exists?(TABLE, :can_edit_lessons)
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
