# Each curriculum grades on one scale: A / B / C / Redo (every existing
# curriculum, so Actualize and current cohorts keep their grades) or
# Pass / Redo. Pass is stored as the new submission grade P (enum value 4),
# so the GitHub feedback outbox and check-based suggestions accept it too:
# a passing check run on a Pass / Redo curriculum suggests P (suggest_pass)
# where an A / B / C curriculum still suggests B (suggest_b).
#
# SET LOCAL for the transaction-mode pooler. Each step checks what exists, so
# a rerun after a partial apply (or a migration test) is safe. Rolling back
# refuses while any Pass grade, Pass delivery or Pass suggestion exists, since
# the narrower constraints and enum would strand them. It first fences writers
# on those three tables (SHARE ROW EXCLUSIVE, held to commit), so no Pass can
# commit between the check and the narrower constraints. Reads go on.
class AddGradingScaleToCurricula < ActiveRecord::Migration[8.1]
  SCALE_CONSTRAINT = "curricula_grading_scale_valid"
  DELIVERY_GRADE_CONSTRAINT = "github_issue_deliveries_grade_valid"
  OUTCOME_CONSTRAINT = "submission_grade_suggestions_outcome_valid"
  SUGGESTED_GRADE_CONSTRAINT = "submission_grade_suggestions_suggested_grade_valid"

  DELIVERY_GRADES_WITH_PASS = "grade IN ('A', 'B', 'C', 'R', 'P')"
  DELIVERY_GRADES_WITHOUT_PASS = "grade IN ('A', 'B', 'C', 'R')"
  OUTCOMES_WITH_PASS = "outcome IN ('suggest_b', 'suggest_pass', 'review_for_redo', 'no_suggestion', 'stale_evidence')"
  OUTCOMES_WITHOUT_PASS = "outcome IN ('suggest_b', 'review_for_redo', 'no_suggestion', 'stale_evidence')"
  SUGGESTED_GRADES_WITH_PASS = "(outcome = 'suggest_b' AND suggested_grade IS NOT NULL AND suggested_grade = 'B') OR " \
    "(outcome = 'suggest_pass' AND suggested_grade IS NOT NULL AND suggested_grade = 'P') OR " \
    "(outcome NOT IN ('suggest_b', 'suggest_pass') AND suggested_grade IS NULL)"
  SUGGESTED_GRADES_WITHOUT_PASS = "(outcome = 'suggest_b' AND suggested_grade IS NOT NULL AND suggested_grade = 'B') OR " \
    "(outcome <> 'suggest_b' AND suggested_grade IS NULL)"
  # Submission.grades["P"]
  PASS_GRADE_VALUE = 4
  FENCED_TABLES = %w[submissions submission_grade_suggestions github_issue_deliveries].freeze

  def up
    execute "SET LOCAL lock_timeout = '5s'"
    unless column_exists?(:curricula, :grading_scale)
      add_column :curricula, :grading_scale, :string, null: false, default: "letter_abc_redo"
    end
    unless check_constraint_exists?(:curricula, name: SCALE_CONSTRAINT)
      add_check_constraint :curricula, "grading_scale IN ('letter_abc_redo', 'pass_redo')", name: SCALE_CONSTRAINT
    end
    replace_constraint :github_issue_deliveries, DELIVERY_GRADE_CONSTRAINT, DELIVERY_GRADES_WITH_PASS
    replace_constraint :submission_grade_suggestions, OUTCOME_CONSTRAINT, OUTCOMES_WITH_PASS
    replace_constraint :submission_grade_suggestions, SUGGESTED_GRADE_CONSTRAINT, SUGGESTED_GRADES_WITH_PASS
  end

  def down
    # One transaction (the migration's own, or this one when run directly), so the fence holds
    # until the narrower constraints commit.
    connection.transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      execute "LOCK TABLE #{FENCED_TABLES.join(', ')} IN SHARE ROW EXCLUSIVE MODE"
      if pass_records_exist?
        raise ActiveRecord::IrreversibleMigration, "Pass grades, deliveries or suggestions exist; regrade them before rolling back"
      end

      replace_constraint :submission_grade_suggestions, SUGGESTED_GRADE_CONSTRAINT, SUGGESTED_GRADES_WITHOUT_PASS
      replace_constraint :submission_grade_suggestions, OUTCOME_CONSTRAINT, OUTCOMES_WITHOUT_PASS
      replace_constraint :github_issue_deliveries, DELIVERY_GRADE_CONSTRAINT, DELIVERY_GRADES_WITHOUT_PASS
      remove_check_constraint :curricula, name: SCALE_CONSTRAINT if check_constraint_exists?(:curricula, name: SCALE_CONSTRAINT)
      remove_column :curricula, :grading_scale if column_exists?(:curricula, :grading_scale)
    end
  end

  private

  def replace_constraint(table, name, expression)
    remove_check_constraint table, name: name if check_constraint_exists?(table, name: name)
    add_check_constraint table, expression, name: name
  end

  def pass_records_exist?
    select_value("SELECT 1 FROM submissions WHERE grade = #{PASS_GRADE_VALUE} LIMIT 1").present? ||
      select_value("SELECT 1 FROM github_issue_deliveries WHERE grade = 'P' LIMIT 1").present? ||
      select_value("SELECT 1 FROM submission_grade_suggestions WHERE outcome = 'suggest_pass' LIMIT 1").present?
  end
end
