class AddSubmissionTypesAndArtifacts < ActiveRecord::Migration[8.1]
  def change
    add_column :content_blocks, :submission_type, :integer
    add_column :content_blocks, :submission_config, :jsonb, default: {}, null: false

    add_column :submissions, :submission_type, :integer
    add_column :submissions, :repo_url, :string
    add_column :submissions, :pr_url, :string
    add_column :submissions, :live_url, :string
    add_column :submissions, :branch, :string
    add_column :submissions, :commit_sha, :string
    add_column :submissions, :notes, :text

    add_index :content_blocks, :submission_type
    add_index :submissions, :submission_type
  end
end
