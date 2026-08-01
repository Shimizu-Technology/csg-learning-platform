class CreateHelpRequests < ActiveRecord::Migration[8.1]
  def change
    create_table :help_requests do |t|
      t.references :student, null: false, foreign_key: { to_table: :users }
      t.references :cohort, null: false, foreign_key: true
      t.references :owner, foreign_key: { to_table: :users }
      t.integer :context_type, null: false
      t.integer :context_source, null: false, default: 0
      t.bigint :context_id, null: false
      t.string :context_label, null: false
      t.string :context_path, null: false
      t.integer :category, null: false
      t.integer :urgency, null: false, default: 0
      t.integer :status, null: false, default: 0
      t.text :message, null: false
      t.text :staff_response
      t.datetime :acknowledged_at
      t.datetime :resolved_at
      t.datetime :canceled_at
      t.timestamps
    end

    add_index :help_requests, [ :cohort_id, :status, :urgency, :created_at ], name: "index_help_requests_queue"
    add_index :help_requests, [ :student_id, :status, :created_at ], name: "index_help_requests_student_state"
    add_index :help_requests,
      [ :student_id, :cohort_id, :context_type, :context_source, :context_id ],
      unique: true,
      where: "status IN (0, 1)",
      name: "index_help_requests_one_active_context"
  end
end
