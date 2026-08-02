class CreateFeedbackSnippets < ActiveRecord::Migration[8.1]
  def change
    create_table :feedback_snippets do |t|
      t.references :created_by, null: false, foreign_key: { to_table: :users }
      t.string :title, null: false
      t.text :body, null: false
      t.boolean :active, null: false, default: true
      t.integer :usage_count, null: false, default: 0
      t.timestamps
    end

    add_check_constraint :feedback_snippets, "usage_count >= 0", name: "feedback_snippets_usage_count_nonnegative"
    add_index :feedback_snippets, [ :active, :usage_count ]
  end
end
