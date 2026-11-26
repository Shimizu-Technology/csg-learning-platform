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

  test "both directions set a short lock timeout before touching tables" do
    migration = CreateCurriculumFilesAndAutoCopy.new
    curriculum_file_count = CurriculumFile.count
    statements = []
    collect = ->(*, payload) { statements << payload[:sql] }
    ActiveSupport::Notifications.subscribed(collect, "sql.active_record") do
      ActiveRecord::Base.transaction(requires_new: true) do
        migration.migrate(:down) if curriculum_file_count.zero?
        migration.migrate(:up)
      end
    end
    reset_cache
    timeouts = statements.each_index.select { |index| statements[index].include?("SET LOCAL lock_timeout = '5s'") }
    assert_equal 2, timeouts.size, "up and down each set the timeout"
    first_table_statement = statements.index { |sql| sql.match?(/\A\s*(LOCK TABLE|CREATE TABLE|ALTER TABLE|DROP TABLE)/) }
    assert_operator timeouts.first, :<, first_table_statement
  ensure
    reset_cache
  end

  private

  def reset_cache
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ CohortFile, CurriculumFile ].each(&:reset_column_information)
  end
end
