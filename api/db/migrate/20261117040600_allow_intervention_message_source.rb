# Lets a direct message say it's about a follow-up plan (Intervention), so
# "Message" on a follow-up plan opens the conversation with that plan as its
# source (L-2.5). Same pattern as AddSourceToMessages: SET LOCAL for the
# transaction-mode pooler, and the widened constraint is added NOT VALID (no
# scan under the exclusive lock) and validated by the next migration. Every
# existing row satisfies the narrower constraint, so there is no gap.
class AllowInterventionMessageSource < ActiveRecord::Migration[8.1]
  CONSTRAINT = "messages_source_pair"
  WITH_INTERVENTION = "(source_type IS NULL) = (source_id IS NULL) AND (source_type IS NULL OR source_type IN ('Lesson', 'Submission', 'HelpRequest', 'Intervention'))"
  WITHOUT_INTERVENTION = "(source_type IS NULL) = (source_id IS NULL) AND (source_type IS NULL OR source_type IN ('Lesson', 'Submission', 'HelpRequest'))"

  def up
    execute "SET LOCAL lock_timeout = '5s'"
    remove_check_constraint :messages, name: CONSTRAINT if check_constraint_exists?(:messages, name: CONSTRAINT)
    add_check_constraint :messages, WITH_INTERVENTION, name: CONSTRAINT, validate: false
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    # The messages stay; they just lose the follow-up plan they were about.
    execute "UPDATE messages SET source_type = NULL, source_id = NULL WHERE source_type = 'Intervention'"
    remove_check_constraint :messages, name: CONSTRAINT if check_constraint_exists?(:messages, name: CONSTRAINT)
    add_check_constraint :messages, WITHOUT_INTERVENTION, name: CONSTRAINT, validate: false
  end
end
