require "test_helper"
require Rails.root.join("db/migrate/20261116150000_create_curriculum_copies").to_s

class CreateCurriculumCopiesTest < ActiveSupport::TestCase
  # Concurrent index builds can't run inside the test transaction.
  self.use_transactional_tests = false

  test "adds the copy tables, the stale-write column and a shared course file key index, reruns safely and rolls back" do
    migration = CreateCurriculumCopies.new
    connection = ActiveRecord::Base.connection
    2.times do
      migration.migrate(:down)
      refute connection.table_exists?(:curriculum_copies)
      refute connection.table_exists?(:content_redirects)
      refute connection.column_exists?(:enrollments, :content_moved_at)
      assert connection.index_exists?(:curriculum_resources, :s3_key, unique: true, name: "index_curriculum_resources_on_s3_key")
      migration.migrate(:up)
      # A build that failed half way leaves an invalid index; a rerun rebuilds it.
      connection.execute("UPDATE pg_index SET indisvalid = false WHERE indexrelid = to_regclass('index_curriculum_resources_on_shared_s3_key')")
      migration.migrate(:up)
      connection.schema_cache.clear!
      assert connection.select_value("SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('index_curriculum_resources_on_shared_s3_key')")
      assert connection.column_exists?(:enrollments, :content_moved_at, :datetime, null: true)
      assert connection.index_exists?(:curriculum_copies, %i[cohort_id source_curriculum_id], unique: true)
      assert connection.index_exists?(:content_redirects, %i[cohort_id record_type old_id], unique: true)
      refute connection.index_name_exists?(:curriculum_resources, "index_curriculum_resources_on_s3_key")
      assert connection.index_exists?(:curriculum_resources, :s3_key, unique: false, name: "index_curriculum_resources_on_shared_s3_key")
      keys = connection.foreign_keys(:curriculum_copies).to_h { |key| [ key.column, key.on_delete ] }
      assert_equal({ "cohort_id" => :cascade, "source_curriculum_id" => :nullify, "copy_curriculum_id" => :cascade, "created_by_id" => :nullify }, keys)
      assert_equal({ "curriculum_copy_id" => :cascade, "cohort_id" => :cascade }, connection.foreign_keys(:content_redirects).to_h { |key| [ key.column, key.on_delete ] })
    end
  ensure
    migration&.migrate(:up)
    ActiveRecord::Base.connection_pool.connections.each(&:clear_cache!)
    [ Enrollment, CurriculumResource, CurriculumCopy, ContentRedirect ].each(&:reset_column_information)
  end
end
