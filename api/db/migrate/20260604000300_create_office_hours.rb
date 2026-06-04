class CreateOfficeHours < ActiveRecord::Migration[8.1]
  def change
    create_table :office_hours do |t|
      t.references :cohort, null: false, foreign_key: true
      t.string :title, null: false
      t.text :description
      t.datetime :starts_at, null: false
      t.datetime :ends_at, null: false
      t.string :meeting_url, null: false
      t.string :timezone, null: false, default: "Pacific/Guam"
      t.integer :recurrence, null: false, default: 0
      t.boolean :active, null: false, default: true
      t.references :created_by, foreign_key: { to_table: :users }
      t.timestamps
    end

    add_index :office_hours, [ :cohort_id, :active, :starts_at ]
  end
end
