class CreateGithubCheckRuns < ActiveRecord::Migration[8.1]
  def change
    create_table :github_check_runs do |t|
      t.references :submission, null: false, foreign_key: true
      t.bigint :external_id, null: false
      t.string :name, null: false
      t.string :workflow_name
      t.string :app_slug
      t.string :head_sha, null: false
      t.string :status, null: false
      t.string :conclusion
      t.string :details_url
      t.datetime :started_at
      t.datetime :completed_at
      t.datetime :fetched_at, null: false
      t.timestamps
    end

    add_index :github_check_runs, [ :submission_id, :external_id ], unique: true
    add_index :github_check_runs, [ :submission_id, :head_sha ]
  end
end
