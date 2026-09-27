class CreateActivityHistory < ActiveRecord::Migration[8.1]
  def change
    create_table :auth_sessions do |t|
      t.references :user, null: false, foreign_key: true
      t.string :session_digest, null: false, limit: 64
      t.timestamps
    end
    add_index :auth_sessions, [ :user_id, :session_digest ], unique: true

    create_table :activity_events do |t|
      t.references :actor, null: false, foreign_key: { to_table: :users }
      t.references :subject_user, null: false, foreign_key: { to_table: :users }
      t.references :cohort, foreign_key: true
      t.string :event_type, null: false, limit: 48
      t.string :record_type, limit: 32
      t.bigint :record_id
      t.string :evidence, null: false, default: "server_record", limit: 32
      t.datetime :created_at, null: false
    end
    add_index :activity_events, [ :subject_user_id, :created_at, :id ], order: { created_at: :desc, id: :desc }, name: "index_activity_events_on_subject_and_time"
    add_index :activity_events, [ :actor_id, :created_at, :id ], name: "index_activity_events_on_actor_and_time"
    add_index :activity_events, [ :cohort_id, :created_at, :id ], name: "index_activity_events_on_cohort_and_time"
  end
end
