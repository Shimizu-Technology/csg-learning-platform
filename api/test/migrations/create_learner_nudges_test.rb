require "test_helper"
require Rails.root.join("db/migrate/20261119081000_create_learner_nudges").to_s

class CreateLearnerNudgesTest < ActiveSupport::TestCase
  test "reminder table and preference round trip with pooled statement caches cleared" do
    user = User.create!(clerk_id: "migration_nudges", email: "migration_nudges@example.com", role: :student)
    migration = CreateLearnerNudges.new
    migration.migrate(:down)
    reset_cache
    assert_not ActiveRecord::Base.connection.table_exists?(:learner_nudges)
    assert_not User.column_names.include?("learner_nudges_enabled")
    migration.migrate(:up)
    reset_cache
    assert_equal 0, LearnerNudge.count
    assert user.reload.learner_nudges_enabled?, "existing learners keep optional reminders on"
    assert ActiveRecord::Base.connection.index_exists?(:learner_nudges, :key, unique: true)
    assert ActiveRecord::Base.connection.check_constraint_exists?(:learner_nudges, name: "learner_nudges_kind_valid")
  ensure
    reset_cache
  end

  def reset_cache
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ LearnerNudge, User ].each(&:reset_column_information)
  end
end
