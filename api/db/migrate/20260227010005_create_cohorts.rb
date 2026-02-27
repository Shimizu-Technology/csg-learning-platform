class CreateCohorts < ActiveRecord::Migration[8.1]
  def change
    create_table :cohorts do |t|
      t.string :name, null: false
      t.integer :cohort_type, default: 0, null: false
      t.references :curriculum, null: false, foreign_key: { to_table: :curricula }
      t.date :start_date, null: false
      t.date :end_date
      t.string :github_organization_name
      t.string :repository_name, default: "prework-exercises"
      t.boolean :requires_github, default: false, null: false
      t.integer :status, default: 0, null: false
      t.jsonb :settings, default: {}, null: false

      t.timestamps
    end

    add_index :cohorts, :status
  end
end
