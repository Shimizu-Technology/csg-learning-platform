class CreatePrivateMeetings < ActiveRecord::Migration[8.1]
  def change
    enable_extension "btree_gist"

    create_table :private_meeting_configs do |t|
      t.references :cohort, null: false, foreign_key: true, index: { unique: true }
      t.references :instructor, null: false, foreign_key: { to_table: :users }
      t.string :timezone, null: false, default: "Pacific/Guam"
      t.integer :duration_minutes, null: false, default: 60
      t.integer :weeks, null: false, default: 3
      t.integer :reschedule_cutoff_hours, null: false, default: 24
      t.integer :max_student_changes, null: false, default: 1
      t.boolean :enabled, null: false, default: true
      t.timestamps
    end
    add_check_constraint :private_meeting_configs, "duration_minutes > 0 AND weeks > 0 AND reschedule_cutoff_hours >= 0 AND max_student_changes >= 0", name: "private_meeting_config_positive_policy"

    create_table :private_meeting_slots do |t|
      t.references :private_meeting_config, null: false, foreign_key: true
      t.references :instructor, null: false, foreign_key: { to_table: :users }
      t.datetime :starts_at, null: false
      t.datetime :ends_at, null: false
      t.boolean :active, null: false, default: true
      t.timestamps
    end
    add_check_constraint :private_meeting_slots, "ends_at > starts_at", name: "private_meeting_slot_positive_duration"
    add_index :private_meeting_slots, [ :private_meeting_config_id, :starts_at ]
    execute <<~SQL
      ALTER TABLE private_meeting_slots ADD CONSTRAINT private_meeting_slots_no_instructor_overlap
      EXCLUDE USING gist (
        instructor_id WITH =,
        tsrange(starts_at, ends_at + interval '15 minutes', '[)') WITH &&
      ) WHERE (active = true)
    SQL

    create_table :private_meeting_bookings do |t|
      t.references :private_meeting_slot, null: false, foreign_key: true
      t.references :enrollment, null: false, foreign_key: true
      t.references :cohort, null: false, foreign_key: true
      t.references :instructor, null: false, foreign_key: { to_table: :users }
      t.references :student, null: false, foreign_key: { to_table: :users }
      t.integer :week_number, null: false
      t.integer :status, null: false, default: 0
      t.datetime :starts_at, null: false
      t.datetime :ends_at, null: false
      t.string :zoom_url
      t.integer :student_change_count, null: false, default: 0
      t.timestamps
    end
    add_check_constraint :private_meeting_bookings, "ends_at > starts_at AND week_number > 0 AND student_change_count >= 0", name: "private_meeting_booking_valid_range"
    add_index :private_meeting_bookings, [ :enrollment_id, :week_number ], unique: true, where: "status = 0", name: "private_meeting_one_confirmed_per_week"
    add_index :private_meeting_bookings, :private_meeting_slot_id, unique: true, where: "status = 0", name: "private_meeting_one_confirmed_per_slot"
    execute <<~SQL
      ALTER TABLE private_meeting_bookings ADD CONSTRAINT private_meeting_bookings_no_instructor_overlap
      EXCLUDE USING gist (
        instructor_id WITH =,
        tsrange(starts_at, ends_at + interval '15 minutes', '[)') WITH &&
      ) WHERE (status = 0)
    SQL
    execute <<~SQL
      ALTER TABLE private_meeting_bookings ADD CONSTRAINT private_meeting_bookings_no_student_overlap
      EXCLUDE USING gist (
        student_id WITH =,
        tsrange(starts_at, ends_at, '[)') WITH &&
      ) WHERE (status = 0)
    SQL

    create_table :private_meeting_booking_events do |t|
      t.references :private_meeting_booking, null: false, foreign_key: true, index: { name: "idx_private_meeting_events_booking" }
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.string :action, null: false
      t.jsonb :details, null: false, default: {}
      t.timestamps
    end
  end
end
