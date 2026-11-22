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

  test "down raises IrreversibleMigration without altering schema when repurchase history rows exist" do
    migration = AddSeatLimitToCohorts.new
    connection = ActiveRecord::Base.connection
    curriculum = Curriculum.create!(name: "Migration Repurchase Curriculum", status: :active)
    cohort = Cohort.create!(curriculum: curriculum, name: "Migration Repurchase Cohort", start_date: Date.new(2026, 11, 22), status: :active, course_delivery: "guided")
    student = User.create!(clerk_id: "mig_repurchase_student", email: "mig-repurchase@example.invalid", first_name: "Mig", last_name: "Student", role: :student)
    first_purchase = CoursePurchase.create!(user: student, cohort: cohort, stripe_price_id: "price_mig_1", price_cents: 14_900, status: "paid", stripe_session_id: "cs_mig_1")
    second_purchase = CoursePurchase.create!(user: student, cohort: cohort, stripe_price_id: "price_mig_2", price_cents: 14_900, status: "pending", stripe_session_id: "cs_mig_2")

    error = assert_raises(ActiveRecord::IrreversibleMigration) { migration.migrate(:down) }
    assert_match(/repurchase history rows exist/i, error.message)
    assert connection.column_exists?(:course_purchases, :terms_snapshot)
    assert connection.index_name_exists?(:course_purchases, AddSeatLimitToCohorts::OPEN_ATTEMPT_INDEX)
  ensure
    CoursePurchase.where(id: [ first_purchase&.id, second_purchase&.id ].compact).delete_all
    cohort&.destroy
    curriculum&.destroy
    student&.destroy
    migration&.migrate(:up)
    clear_caches
  end

  private

  def clear_caches
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ Cohort, CoursePurchase ].each(&:reset_column_information)
  end
end
