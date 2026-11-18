class CreateLearnerExtensions < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      create_table :learner_extensions do |t|
        t.references :enrollment, null: false, foreign_key: true
        t.string :scope, null: false
        t.references :lesson, foreign_key: true
        t.bigint :module_id
        t.integer :week_number
        t.datetime :submissions_close_at, null: false
        t.text :reason, null: false
        t.references :granted_by, null: false, foreign_key: { to_table: :users }
        t.datetime :granted_at, null: false
        t.datetime :removed_at
        t.jsonb :revisions, null: false, default: []
        t.timestamps
      end
      add_foreign_key :learner_extensions, :modules, column: :module_id
      add_check_constraint :learner_extensions, "(scope = 'final' AND lesson_id IS NULL AND module_id IS NULL AND week_number IS NULL) OR (scope = 'lesson' AND lesson_id IS NOT NULL AND module_id IS NULL AND week_number IS NULL) OR (scope = 'module' AND lesson_id IS NULL AND module_id IS NOT NULL AND week_number IS NOT NULL AND week_number > 0)", name: 'learner_extensions_scope_valid'
      add_check_constraint :learner_extensions, "length(trim(reason)) > 0", name: 'learner_extensions_reason_required'
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      drop_table :learner_extensions
    end
  end
end
