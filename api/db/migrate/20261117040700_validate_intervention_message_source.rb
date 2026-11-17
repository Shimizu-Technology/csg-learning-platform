# Validates the widened messages_source_pair constraint under SHARE UPDATE
# EXCLUSIVE, which doesn't block reads or writes. SET LOCAL keeps the lock
# timeout inside the migration transaction (transaction-mode pooler).
class ValidateInterventionMessageSource < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    validate_check_constraint :messages, name: "messages_source_pair"
  end

  def down
    # Nothing to undo: the previous migration's down restores the narrower constraint.
  end
end
