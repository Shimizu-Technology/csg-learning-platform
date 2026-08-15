class CreateInterventionsAndRecoveryPlans < ActiveRecord::Migration[8.1]
  def change
    create_table :interventions do |t|
      t.references :enrollment, null: false, foreign_key: true
      t.references :help_request, foreign_key: true
      t.references :owner, null: false, foreign_key: { to_table: :users }
      t.references :created_by, null: false, foreign_key: { to_table: :users }
      t.integer :trigger_type, null: false
      t.integer :severity, null: false, default: 0
      t.integer :status, null: false, default: 0
      t.jsonb :evidence_snapshot, null: false, default: {}
      t.text :action_summary
      t.datetime :next_follow_up_at
      t.datetime :follow_up_notified_at
      t.integer :outcome
      t.text :resolution_summary
      t.datetime :resolved_at
      t.timestamps
    end

    add_index :interventions, [ :status, :next_follow_up_at ], name: "index_interventions_due_follow_up"
    add_index :interventions, [ :enrollment_id, :created_at ], name: "index_interventions_enrollment_history"
    add_index :interventions, [ :enrollment_id, :trigger_type ], unique: true, where: "status IN (0, 1, 2, 3)", name: "index_interventions_one_active_trigger"

    create_table :intervention_notes do |t|
      t.references :intervention, null: false, foreign_key: true
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.text :body, null: false
      t.timestamps
    end

    add_index :intervention_notes, [ :intervention_id, :created_at ], name: "index_intervention_notes_history"

    create_table :recovery_plans do |t|
      t.references :enrollment, null: false, foreign_key: true
      t.references :enrollment_restart, foreign_key: true
      t.references :intervention, foreign_key: true
      t.references :owner, null: false, foreign_key: { to_table: :users }
      t.references :created_by, null: false, foreign_key: { to_table: :users }
      t.integer :source, null: false
      t.integer :status, null: false, default: 0
      t.string :target_pace, null: false
      t.text :required_scope, null: false
      t.text :optional_scope
      t.string :check_in_cadence, null: false, default: "weekly"
      t.datetime :next_check_in_at, null: false
      t.datetime :last_check_in_at
      t.text :outcome
      t.datetime :completed_at
      t.timestamps
    end

    add_index :recovery_plans, [ :status, :next_check_in_at ], name: "index_recovery_plans_due_check_in"
    add_index :recovery_plans, :enrollment_id, unique: true, where: "status = 0", name: "index_recovery_plans_one_active"

    create_table :recovery_plan_check_ins do |t|
      t.references :recovery_plan, null: false, foreign_key: true
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.text :body, null: false
      t.datetime :next_check_in_at
      t.timestamps
    end

    add_index :recovery_plan_check_ins, [ :recovery_plan_id, :created_at ], name: "index_recovery_plan_check_ins_history"
  end
end
