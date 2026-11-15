# What a direct message is about (a lesson, submission or help request), so the
# learner sees the same context the staff member wrote from (L-1.8).
#
# Runs inside the migration transaction: Neon's transaction-mode pooler drops
# session settings, so the lock timeout is SET LOCAL. Nullable columns without a
# default are metadata-only; the check constraint is added NOT VALID (no table
# scan under the exclusive lock) and validated by the next migration.
class AddSourceToMessages < ActiveRecord::Migration[8.1]
  CONSTRAINT = "messages_source_pair"

  def up
    execute "SET LOCAL lock_timeout = '5s'"
    add_column :messages, :source_type, :string, limit: 32 unless column_exists?(:messages, :source_type)
    add_column :messages, :source_id, :bigint unless column_exists?(:messages, :source_id)
    return if check_constraint_exists?(:messages, name: CONSTRAINT)

    add_check_constraint :messages,
      "(source_type IS NULL) = (source_id IS NULL) AND (source_type IS NULL OR source_type IN ('Lesson', 'Submission', 'HelpRequest'))",
      name: CONSTRAINT,
      validate: false
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    remove_check_constraint :messages, name: CONSTRAINT if check_constraint_exists?(:messages, name: CONSTRAINT)
    remove_column :messages, :source_id if column_exists?(:messages, :source_id)
    remove_column :messages, :source_type if column_exists?(:messages, :source_type)
  end
end
