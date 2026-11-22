require "test_helper"
require Rails.root.join("db/migrate/20261122070000_add_seat_limit_to_cohorts").to_s

class AddSeatLimitToCohortsTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "migration is additive, reversible, and idempotent under transaction pooling" do
    migration = AddSeatLimitToCohorts.new
    connection = ActiveRecord::Base.connection

    migration.migrate(:down)
    migration.migrate(:down)
    clear_caches
    assert_not connection.column_exists?(:cohorts, :seat_limit)
    assert_not connection.column_exists?(:cohorts, :unlisted)
    assert_not connection.column_exists?(:course_purchases, :over_capacity)
    assert_not connection.column_exists?(:course_purchases, :terms_snapshot)
    assert connection.index_name_exists?(:course_purchases, AddSeatLimitToCohorts::OLD_USER_COHORT_INDEX)
    assert_not connection.index_name_exists?(:course_purchases, AddSeatLimitToCohorts::OPEN_ATTEMPT_INDEX)

    migration.migrate(:up)
    migration.migrate(:up)
    clear_caches
    assert connection.column_exists?(:cohorts, :seat_limit)
    assert connection.check_constraint_exists?(:cohorts, name: AddSeatLimitToCohorts::CONSTRAINT_NAME)
    assert connection.column_exists?(:cohorts, :unlisted)
    assert connection.column_exists?(:course_purchases, :over_capacity)
    assert connection.column_exists?(:course_purchases, :terms_snapshot)
    assert connection.index_name_exists?(:course_purchases, AddSeatLimitToCohorts::OPEN_ATTEMPT_INDEX)
    assert connection.index_name_exists?(:course_purchases, AddSeatLimitToCohorts::USER_COHORT_LOOKUP_INDEX)
    assert_not connection.index_name_exists?(:course_purchases, AddSeatLimitToCohorts::OLD_USER_COHORT_INDEX)
  ensure
    migration&.migrate(:up)
    clear_caches
  end

  private

  def clear_caches
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ Cohort, CoursePurchase ].each(&:reset_column_information)
  end
end
