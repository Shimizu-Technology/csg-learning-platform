class CreateLessonRecordings < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      create_table :lesson_recordings, if_not_exists: true do |t|
        t.references :recording, null: false, index: false, foreign_key: { on_delete: :cascade }
        t.references :lesson, null: false, index: false, foreign_key: { on_delete: :cascade }
        t.integer :position, null: false, default: 0
        t.timestamps
      end
      add_index :lesson_recordings, [ :recording_id, :lesson_id ], unique: true, if_not_exists: true
      add_index :lesson_recordings, [ :lesson_id, :position ], if_not_exists: true
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      drop_table :lesson_recordings, if_exists: true
    end
  end
end
