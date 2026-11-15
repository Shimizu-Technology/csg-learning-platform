class CreateSchoolSettings < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    create_table :school_settings do |t|
      t.jsonb :features, null: false, default: {}
      t.string :public_catalog_mode, null: false, default: "automatic"
      t.timestamps
    end
    add_check_constraint :school_settings, "id = 1", name: "school_settings_singleton"
    create_table :feature_switch_changes do |t|
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.references :cohort, foreign_key: true
      t.jsonb :before, null: false
      t.jsonb :after, null: false
      t.timestamps
    end
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    drop_table :feature_switch_changes
    drop_table :school_settings
  end
end
