# Validating a NOT VALID check constraint scans the table under SHARE UPDATE
# EXCLUSIVE, which doesn't block reads or writes. Every existing row has no
# source, so the scan only confirms that. SET LOCAL keeps the lock timeout inside
# the migration transaction (transaction-mode pooler).
class ValidateMessagesSourcePair < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    validate_check_constraint :messages, name: "messages_source_pair"
  end

  def down
    # Nothing to undo: a validated constraint is dropped with the columns.
  end
end
