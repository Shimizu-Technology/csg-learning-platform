class AddSeatLimitToCohorts < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  CONSTRAINT_NAME = "cohorts_seat_limit_positive".freeze

  def up
    with_lock_timeout do
      add_column :cohorts, :seat_limit, :integer unless column_exists?(:cohorts, :seat_limit)
      unless check_constraint_exists?(:cohorts, name: CONSTRAINT_NAME)
        add_check_constraint :cohorts, "seat_limit IS NULL OR seat_limit > 0", name: CONSTRAINT_NAME, validate: false
      end
      add_column :cohorts, :unlisted, :boolean, default: false, null: false unless column_exists?(:cohorts, :unlisted)
    end

    with_lock_timeout do
      validate_check_constraint :cohorts, name: CONSTRAINT_NAME if check_constraint_exists?(:cohorts, name: CONSTRAINT_NAME)
    end

    with_lock_timeout do
      add_column :course_purchases, :over_capacity, :boolean, default: false, null: false unless column_exists?(:course_purchases, :over_capacity)
    end
  end

  def down
    with_lock_timeout do
      remove_column :course_purchases, :over_capacity if column_exists?(:course_purchases, :over_capacity)
    end

    with_lock_timeout do
      remove_column :cohorts, :unlisted if column_exists?(:cohorts, :unlisted)
      remove_check_constraint :cohorts, name: CONSTRAINT_NAME if check_constraint_exists?(:cohorts, name: CONSTRAINT_NAME)
      remove_column :cohorts, :seat_limit if column_exists?(:cohorts, :seat_limit)
    end
  end

  private

  def with_lock_timeout
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      yield
    end
  end
end
