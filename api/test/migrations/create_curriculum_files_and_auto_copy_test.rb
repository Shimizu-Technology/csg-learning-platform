require "test_helper"
require Rails.root.join("db/migrate/20261126130000_create_curriculum_files_and_auto_copy").to_s

class CreateCurriculumFilesAndAutoCopyTest < ActiveSupport::TestCase
  test "rollback refuses while any template exists, then removes the table and the cohort file columns" do
    migration = CreateCurriculumFilesAndAutoCopy.new
    connection = ActiveRecord::Base.connection
    curriculum = Curriculum.create!(name: "Templates rollback course")
    curriculum.curriculum_files.create!(kind: "link", title: "Link", external_url: "https://example.com/a", ready: true)

    error = assert_raises(ActiveRecord::IrreversibleMigration) { migration.migrate(:down) }
    assert_match(/before rolling back/, error.message)
    assert connection.column_exists?(:cohort_files, :auto_copy_to_students), "nothing dropped"
    CurriculumFile.delete_all

    migration.migrate(:down)
    reset_cache
    assert_not connection.table_exists?(:curriculum_files)
    assert_not connection.column_exists?(:cohort_files, :source_curriculum_file_id)
    migration.migrate(:up)
    reset_cache
    assert connection.index_exists?(:cohort_files, [ :cohort_id, :source_curriculum_file_id ], unique: true, name: "index_cohort_files_one_import_per_template")
  ensure
    reset_cache
  end

  private

  def reset_cache
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ CohortFile, CurriculumFile ].each(&:reset_column_information)
  end
end
