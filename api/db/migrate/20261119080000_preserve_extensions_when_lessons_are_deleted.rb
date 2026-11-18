class PreserveExtensionsWhenLessonsAreDeleted < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      remove_foreign_key :learner_extensions, :lessons
      remove_check_constraint :learner_extensions, name: "learner_extensions_scope_valid"
      # Deleted lesson targets become inert; their revisions retain the old id.
      add_check_constraint :learner_extensions, "(scope = 'final' AND lesson_id IS NULL AND module_id IS NULL AND week_number IS NULL) OR (scope = 'lesson' AND module_id IS NULL AND week_number IS NULL) OR (scope = 'module' AND lesson_id IS NULL AND module_id IS NOT NULL AND week_number IS NOT NULL AND week_number > 0)", name: "learner_extensions_scope_valid"
      add_foreign_key :learner_extensions, :lessons, on_delete: :nullify
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      # A deleted target has no valid FK to restore. Keep its history rather
      # than silently deleting audit rows during a rollback.
      raise ActiveRecord::IrreversibleMigration, "Deleted lesson targets must be reconciled before restoring the required-target constraint" if select_value("SELECT 1 FROM learner_extensions WHERE scope = 'lesson' AND lesson_id IS NULL LIMIT 1")

      remove_foreign_key :learner_extensions, :lessons
      remove_check_constraint :learner_extensions, name: "learner_extensions_scope_valid"
      add_check_constraint :learner_extensions, "(scope = 'final' AND lesson_id IS NULL AND module_id IS NULL AND week_number IS NULL) OR (scope = 'lesson' AND lesson_id IS NOT NULL AND module_id IS NULL AND week_number IS NULL) OR (scope = 'module' AND lesson_id IS NULL AND module_id IS NOT NULL AND week_number IS NOT NULL AND week_number > 0)", name: "learner_extensions_scope_valid"
      add_foreign_key :learner_extensions, :lessons
    end
  end
end
