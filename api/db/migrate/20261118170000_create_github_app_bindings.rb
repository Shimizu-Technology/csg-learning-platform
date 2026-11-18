class CreateGithubAppBindings < ActiveRecord::Migration[8.1]
  # Additive tables only; SET LOCAL and all DDL share a transaction on PgBouncer.
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"

      create_table :github_app_installations do |t|
        t.references :cohort, null: false, foreign_key: true
        t.bigint :app_id, null: false
        t.bigint :installation_id, null: false
        t.bigint :account_id, null: false
        t.string :account_login, null: false
        t.string :account_type, null: false
        t.string :repository_selection, null: false
        t.jsonb :permissions, null: false, default: {}
        t.string :connection_state, null: false, default: "connected"
        t.string :failure_reason
        t.datetime :connected_at, null: false
        t.datetime :checked_at, null: false
        t.timestamps
      end
      add_index :github_app_installations, [ :cohort_id, :installation_id ], unique: true, name: "index_github_installations_on_cohort_and_external_id"

      create_table :github_repository_bindings do |t|
        t.references :enrollment, null: false, foreign_key: true
        t.references :curriculum_module, foreign_key: { to_table: :modules }
        t.references :github_app_installation, null: false, foreign_key: true
        t.bigint :repository_id
        t.string :full_name, null: false
        t.string :github_username
        t.string :verification_state, null: false, default: "pending"
        t.string :failure_reason
        t.datetime :verified_at
        t.datetime :checked_at
        t.timestamps
      end
      add_index :github_repository_bindings, :enrollment_id, unique: true, where: "curriculum_module_id IS NULL", name: "index_github_bindings_on_enrollment_default"
      add_index :github_repository_bindings, [ :enrollment_id, :curriculum_module_id ], unique: true, where: "curriculum_module_id IS NOT NULL", name: "index_github_bindings_on_enrollment_and_module"
    end
  end
  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      drop_table :github_repository_bindings
      drop_table :github_app_installations
    end
  end
end
