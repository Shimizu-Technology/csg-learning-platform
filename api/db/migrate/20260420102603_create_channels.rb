class CreateChannels < ActiveRecord::Migration[8.1]
  def change
    create_table :channels do |t|
      t.references :cohort, null: false, foreign_key: true
      t.string :name, null: false
      t.text :description
      t.integer :visibility, null: false, default: 0
      t.integer :status, null: false, default: 0
      t.integer :position, null: false, default: 0

      t.timestamps
    end

    add_index :channels, [ :cohort_id, :name ], unique: true
    add_index :channels, [ :cohort_id, :status, :position ]

    reversible do |dir|
      dir.up do
        execute <<~SQL.squish
          INSERT INTO channels (cohort_id, name, description, visibility, status, position, created_at, updated_at)
          SELECT id, 'Class Chat', 'General class discussion for this cohort.', 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          FROM cohorts
        SQL
      end
    end
  end
end
