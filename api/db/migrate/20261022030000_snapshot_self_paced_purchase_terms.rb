class SnapshotSelfPacedPurchaseTerms < ActiveRecord::Migration[8.1]
  def up
    add_column :course_purchases, :access_months, :integer
    add_column :course_purchases, :support_weeks, :integer
    add_column :enrollments, :self_paced_support_weeks, :integer
    execute <<~SQL
      UPDATE course_purchases SET access_months = cohorts.self_paced_access_months,
        support_weeks = cohorts.self_paced_support_weeks FROM cohorts
        WHERE cohorts.id = course_purchases.cohort_id
    SQL
    execute <<~SQL
      UPDATE enrollments SET self_paced_support_weeks = cohorts.self_paced_support_weeks
        FROM cohorts WHERE cohorts.id = enrollments.cohort_id AND cohorts.course_delivery = 'self_paced'
    SQL
    add_check_constraint :course_purchases, "access_months > 0 AND support_weeks > 0", name: "course_purchase_terms_positive"
    add_check_constraint :enrollments, "self_paced_support_weeks > 0", name: "enrollment_support_weeks_positive"
  end

  def down
    remove_check_constraint :enrollments, name: "enrollment_support_weeks_positive"
    remove_check_constraint :course_purchases, name: "course_purchase_terms_positive"
    remove_column :enrollments, :self_paced_support_weeks
    remove_column :course_purchases, :support_weeks
    remove_column :course_purchases, :access_months
  end
end
