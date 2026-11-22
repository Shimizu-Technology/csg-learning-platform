class AddGuidedRelativeTermsAndReviewSla < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  TERMS = %i[guided_access_months guided_support_weeks review_sla_business_days].freeze

  def up
    with_lock_timeout do
      TERMS.each do |column|
        add_column :cohorts, column, :integer unless column_exists?(:cohorts, column)
        name = "cohorts_#{column}_positive"
        unless check_constraint_exists?(:cohorts, name: name)
          add_check_constraint :cohorts, "#{column} IS NULL OR #{column} > 0", name: name
        end
      end
    end

    with_lock_timeout do
      unless column_exists?(:school_settings, :review_sla_holidays)
        add_column :school_settings, :review_sla_holidays, :date, array: true, default: [], null: false
      end
    end
  end

  def down
    with_lock_timeout do
      remove_column :school_settings, :review_sla_holidays if column_exists?(:school_settings, :review_sla_holidays)
    end

    with_lock_timeout do
      TERMS.each do |column|
        name = "cohorts_#{column}_positive"
        remove_check_constraint :cohorts, name: name if check_constraint_exists?(:cohorts, name: name)
        remove_column :cohorts, column if column_exists?(:cohorts, column)
      end
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
