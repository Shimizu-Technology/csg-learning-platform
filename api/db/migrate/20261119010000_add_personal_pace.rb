class AddPersonalPace < ActiveRecord::Migration[8.1]
  # W9.1: a personal start date per enrollment and a learner-chosen pace.
  # Additive and nullable or constant-default only, so nothing existing moves:
  # - cohorts.learner_pace_weeks: the pace choices a guided or self-paced
  #   cohort offers (for example {3,4,6}). NULL means off, which is every
  #   existing cohort, so no release date or payload changes on deploy.
  # - enrollments.starts_on: a start date staff set for one learner. NULL means
  #   the learner's own start (cohort start, or their first open if later).
  # - learning_plans.source / pace_weeks / pace_changes_count: whether a plan is
  #   a staff plan (every existing plan) or one generated from a chosen pace.
  # Each DDL step and SET LOCAL share one transaction on PgBouncer; no session
  # settings or advisory locks.
  disable_ddl_transaction!

  LOCK_TIMEOUT = "5s"
  SOURCE_CHECK = "learning_plans_source_valid"
  PACE_CHECK = "learning_plans_pace_weeks_positive"

  def up
    with_lock_timeout do
      add_column :cohorts, :learner_pace_weeks, :integer, array: true unless column_exists?(:cohorts, :learner_pace_weeks)
    end
    with_lock_timeout do
      add_column :enrollments, :starts_on, :date unless column_exists?(:enrollments, :starts_on)
    end
    with_lock_timeout do
      add_column :learning_plans, :source, :string, default: "staff", null: false unless column_exists?(:learning_plans, :source)
      add_column :learning_plans, :pace_weeks, :integer unless column_exists?(:learning_plans, :pace_weeks)
      add_column :learning_plans, :pace_changes_count, :integer, default: 0, null: false unless column_exists?(:learning_plans, :pace_changes_count)
      unless check_constraint_exists?(:learning_plans, name: SOURCE_CHECK)
        add_check_constraint :learning_plans, "source IN ('staff', 'learner_pace')", name: SOURCE_CHECK
      end
      unless check_constraint_exists?(:learning_plans, name: PACE_CHECK)
        add_check_constraint :learning_plans, "pace_weeks IS NULL OR pace_weeks > 0", name: PACE_CHECK
      end
    end
  end

  def down
    with_lock_timeout do
      remove_check_constraint :learning_plans, name: PACE_CHECK if check_constraint_exists?(:learning_plans, name: PACE_CHECK)
      remove_check_constraint :learning_plans, name: SOURCE_CHECK if check_constraint_exists?(:learning_plans, name: SOURCE_CHECK)
      %i[pace_changes_count pace_weeks source].each do |column|
        remove_column :learning_plans, column if column_exists?(:learning_plans, column)
      end
    end
    with_lock_timeout { remove_column :enrollments, :starts_on if column_exists?(:enrollments, :starts_on) }
    with_lock_timeout { remove_column :cohorts, :learner_pace_weeks if column_exists?(:cohorts, :learner_pace_weeks) }
  end

  private

  # One transaction, so SET LOCAL and the DDL run on the same pooled session.
  def with_lock_timeout(&block)
    transaction do
      execute "SET LOCAL lock_timeout = '#{LOCK_TIMEOUT}'"
      block.call
    end
  end
end
