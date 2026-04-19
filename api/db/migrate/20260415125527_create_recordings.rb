class CreateRecordings < ActiveRecord::Migration[8.1]
  def change
    create_table :recordings do |t|
      t.references :cohort, null: false, foreign_key: true
      t.references :uploaded_by, null: false, foreign_key: { to_table: :users }
      t.string :title, null: false
      t.text :description
      t.string :s3_key, null: false
      t.string :content_type, null: false
      t.bigint :file_size, null: false
      t.integer :duration_seconds
      t.integer :position, null: false, default: 0
      t.datetime :recorded_date
      t.timestamps
    end

    add_index :recordings, :s3_key, unique: true
    add_index :recordings, [ :cohort_id, :position ]

    create_table :watch_progresses do |t|
      t.references :user, null: false, foreign_key: true
      t.references :recording, null: false, foreign_key: true
      t.integer :last_position_seconds, null: false, default: 0
      t.integer :total_watched_seconds, null: false, default: 0
      t.integer :duration_seconds
      t.boolean :completed, null: false, default: false
      t.datetime :last_watched_at
      t.timestamps
    end

    add_index :watch_progresses, [ :user_id, :recording_id ], unique: true
  end
end
