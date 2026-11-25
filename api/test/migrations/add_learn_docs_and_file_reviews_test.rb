require "test_helper"
require Rails.root.join("db/migrate/20261126120000_add_learn_docs_and_file_reviews").to_s

class AddLearnDocsAndFileReviewsTest < ActiveSupport::TestCase
  test "rollback refuses while any doc, review, revision or comment exists, before dropping anything" do
    migration = AddLearnDocsAndFileReviews.new
    connection = ActiveRecord::Base.connection
    cohort = Cohort.create!(name: "Docs rollback", curriculum: Curriculum.create!(name: "Docs rollback course"), start_date: Date.current, status: :active)
    user = User.create!(clerk_id: "docs_rollback", email: "docs-rollback@example.test", first_name: "Rollback", role: :admin)
    link = cohort.cohort_files.create!(kind: "link", title: "Link", external_url: "https://example.com/a", uploaded_by: user, ready: true, review_status: "reviewed")
    doc = cohort.cohort_files.create!(kind: "doc", title: "Doc", doc_content: "x", doc_updated_at: Time.current, ready: true, uploaded_by: user)
    doc.doc_revisions.create!(revision_number: 1, title: "Doc", content: "x", created_at: Time.current)
    doc.comments.create!(user: user, body: "Hi")

    [
      -> { doc.update_columns(kind: "link", external_url: "https://example.com/b") },
      -> { CohortDocRevision.delete_all },
      -> { CohortFileComment.delete_all },
      -> { link.update_columns(review_status: "none") }
    ].each_with_index do |clear_one, index|
      error = assert_raises(ActiveRecord::IrreversibleMigration) { migration.migrate(:down) }
      assert_match(/before rolling back/, error.message, index)
      assert connection.table_exists?(:cohort_doc_revisions), "nothing dropped (#{index})"
      assert connection.column_exists?(:cohort_files, :doc_version)
      clear_one.call
    end
    migration.migrate(:down)
    reset_cache
    assert_not connection.table_exists?(:cohort_doc_revisions)
    assert_not connection.table_exists?(:cohort_file_comments)
    assert_not connection.column_exists?(:cohort_files, :doc_version)
    migration.migrate(:up)
    reset_cache
    assert_equal 1, CohortFile.columns_hash.fetch("doc_version").default.to_i
    assert connection.index_exists?(:cohort_doc_revisions, [ :cohort_file_id, :revision_number ], unique: true)
  ensure
    reset_cache
  end

  private

  def reset_cache
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ CohortFile, CohortDocRevision, CohortFileComment ].each(&:reset_column_information)
  end
end
