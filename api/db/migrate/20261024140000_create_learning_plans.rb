class CreateLearningPlans < ActiveRecord::Migration[8.1]
  def change
    create_table :learning_plans do |t|
      t.references :enrollment, null: false, foreign_key: true, index: { unique: true }
      t.boolean :active, null: false, default: true
      t.string :title, null: false
      t.text :description
      t.date :target_date
      t.date :next_check_in_on
      t.jsonb :milestones, null: false, default: []
      t.jsonb :lesson_overrides, null: false, default: []
      t.integer :lock_version, null: false, default: 0
      t.timestamps
    end

    create_table :learning_plan_revisions do |t|
      t.references :learning_plan, null: false, foreign_key: true
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.jsonb :snapshot, null: false
      t.timestamps
    end
  end
end
