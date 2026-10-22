class SnapshotSelfPacedPurchaseTerms < ActiveRecord::Migration[8.1]
  def up
    add_column :course_purchases, :access_months, :integer
    add_column :course_purchases, :support_weeks, :integer
    add_column :enrollments, :self_paced_support_weeks, :integer
    # Nullable snapshots support overlapping old/new app processes. Catch up
    # individual records on use instead of locking purchase/enrollment tables
    # for a transactional backfill.
    add_check_constraint :course_purchases, "access_months > 0 AND support_weeks > 0", name: "course_purchase_terms_positive", validate: false
    add_check_constraint :enrollments, "self_paced_support_weeks > 0", name: "enrollment_support_weeks_positive", validate: false
  end

  def down
    remove_check_constraint :enrollments, name: "enrollment_support_weeks_positive"
    remove_check_constraint :course_purchases, name: "course_purchase_terms_positive"
    remove_column :enrollments, :self_paced_support_weeks
    remove_column :course_purchases, :support_weeks
    remove_column :course_purchases, :access_months
  end
end
