require "test_helper"
require Rails.root.join("db/migrate/20261119080000_preserve_extensions_when_lessons_are_deleted").to_s

class PreserveExtensionsWhenLessonsAreDeletedTest < ActiveSupport::TestCase
  test "lesson target foreign key round trips with pooled caches cleared" do
    migration = PreserveExtensionsWhenLessonsAreDeleted.new
    migration.migrate(:down)
    reset_cache
    assert_nil ActiveRecord::Base.connection.foreign_keys(:learner_extensions).find { |key| key.to_table == "lessons" }.on_delete
    migration.migrate(:up)
    reset_cache
    assert_equal :nullify, ActiveRecord::Base.connection.foreign_keys(:learner_extensions).find { |key| key.to_table == "lessons" }.on_delete
  ensure
    reset_cache
  end

  def reset_cache
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    LearnerExtension.reset_column_information
  end
end
