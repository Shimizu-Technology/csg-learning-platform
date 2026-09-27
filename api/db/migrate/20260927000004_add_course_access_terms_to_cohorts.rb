class AddCourseAccessTermsToCohorts < ActiveRecord::Migration[8.1]
  def change
    add_column :cohorts, :self_paced_access_months, :integer, default: 12, null: false
    add_column :cohorts, :self_paced_support_weeks, :integer, default: 6, null: false
    add_check_constraint :cohorts, "self_paced_access_months > 0 AND self_paced_support_weeks > 0", name: "cohort_self_paced_terms_positive"
  end
end
