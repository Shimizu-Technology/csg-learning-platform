class CreateKnowledgeChecks < ActiveRecord::Migration[8.1]
  def change
    create_table :knowledge_checks do |t|
      t.references :content_block, null: false, foreign_key: true, index: { unique: true }
      t.references :learning_objective, foreign_key: true
      t.text :prompt, null: false
      t.jsonb :options, null: false, default: []
      t.integer :correct_option, null: false
      t.text :explanation, null: false
      t.timestamps
    end
    add_check_constraint :knowledge_checks, "correct_option >= 0", name: "knowledge_checks_correct_option_nonnegative"

    create_table :knowledge_check_attempts do |t|
      t.references :knowledge_check, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.integer :selected_option, null: false
      t.boolean :correct, null: false
      t.timestamps
    end
    add_check_constraint :knowledge_check_attempts, "selected_option >= 0", name: "knowledge_check_attempts_selected_option_nonnegative"
    add_index :knowledge_check_attempts, [ :user_id, :knowledge_check_id, :created_at ], name: "idx_knowledge_check_attempts_user_check_time"
  end
end
