require "test_helper"
require Rails.root.join("db/migrate/20261119050000_create_learner_extensions").to_s

class CreateLearnerExtensionsTest < ActiveSupport::TestCase
  test "extension tables round trip with pooled statement caches cleared" do
    migration = CreateLearnerExtensions.new
    migration.migrate(:down)
    reset_cache
    assert_not ActiveRecord::Base.connection.table_exists?(:learner_extensions)
    migration.migrate(:up)
    reset_cache
    assert_equal 0, LearnerExtension.count
    assert ActiveRecord::Base.connection.check_constraint_exists?(:learner_extensions, name: "learner_extensions_reason_required")
  ensure
    reset_cache
  end

  def reset_cache
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    LearnerExtension.reset_column_information
  end
end
