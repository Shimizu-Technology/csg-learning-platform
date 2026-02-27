class CreateSubmissions < ActiveRecord::Migration[8.1]
  def change
    create_table :submissions do |t|
      t.references :content_block, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.text :text
      t.integer :grade
      t.text :feedback
      t.bigint :graded_by_id
      t.datetime :graded_at
      t.string :github_issue_url
      t.string :github_code_url
      t.integer :num_submissions, default: 1, null: false

      t.timestamps
    end

    add_index :submissions, [:content_block_id, :user_id]
    add_index :submissions, :graded_by_id
    add_foreign_key :submissions, :users, column: :graded_by_id
  end
end
