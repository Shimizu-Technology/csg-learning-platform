class PreserveGithubSubmittedRevisions < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      # Nullable, without a default or backfill: historical source is not proof
      # of a captured revision. Source itself remains in submissions.text.
      add_column :submissions, :github_revision, :jsonb unless column_exists?(:submissions, :github_revision)
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      remove_column :submissions, :github_revision if column_exists?(:submissions, :github_revision)
    end
  end
end
