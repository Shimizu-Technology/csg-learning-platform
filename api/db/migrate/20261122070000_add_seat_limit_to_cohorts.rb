class AddSeatLimitToCohorts < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  CONSTRAINT_NAME = "cohorts_seat_limit_positive".freeze
  OLD_USER_COHORT_INDEX = "index_course_purchases_on_user_id_and_cohort_id".freeze
  OPEN_ATTEMPT_INDEX = "index_course_purchases_one_open_attempt_per_user_cohort".freeze
  USER_COHORT_LOOKUP_INDEX = "index_course_purchases_on_user_id_and_cohort_id_lookup".freeze

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
      add_column :course_purchases, :terms_snapshot, :jsonb, default: {} unless column_exists?(:course_purchases, :terms_snapshot)
    end

    with_lock_timeout do
      unless index_name_exists?(:course_purchases, OPEN_ATTEMPT_INDEX)
        add_index :course_purchases, [ :user_id, :cohort_id ],
          unique: true,
          where: "status IN ('pending', 'failed', 'expired')",
          name: OPEN_ATTEMPT_INDEX
      end
      unless index_name_exists?(:course_purchases, USER_COHORT_LOOKUP_INDEX)
        add_index :course_purchases, [ :user_id, :cohort_id ], name: USER_COHORT_LOOKUP_INDEX
      end
      if index_name_exists?(:course_purchases, OLD_USER_COHORT_INDEX)
        remove_index :course_purchases, name: OLD_USER_COHORT_INDEX
      end
    end
  end

  def down
    if connection.select_value("SELECT 1 FROM course_purchases GROUP BY user_id, cohort_id HAVING COUNT(*) > 1 LIMIT 1")
      raise ActiveRecord::IrreversibleMigration,
        "Cannot restore unique (user_id, cohort_id) index on course_purchases while repurchase history rows exist"
    end

    with_lock_timeout do
      unless index_name_exists?(:course_purchases, OLD_USER_COHORT_INDEX)
        add_index :course_purchases, [ :user_id, :cohort_id ], unique: true, name: OLD_USER_COHORT_INDEX
      end
      remove_index :course_purchases, name: OPEN_ATTEMPT_INDEX if index_name_exists?(:course_purchases, OPEN_ATTEMPT_INDEX)
      remove_index :course_purchases, name: USER_COHORT_LOOKUP_INDEX if index_name_exists?(:course_purchases, USER_COHORT_LOOKUP_INDEX)
      remove_column :course_purchases, :terms_snapshot if column_exists?(:course_purchases, :terms_snapshot)
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
