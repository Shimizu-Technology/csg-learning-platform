class AllowDisputedCoursePurchases < ActiveRecord::Migration[8.1]
  def up
    remove_check_constraint :course_purchases, name: "course_purchase_status_valid"
    add_check_constraint :course_purchases, "status IN ('pending', 'paid', 'expired', 'refunded', 'disputed')", name: "course_purchase_status_valid"
  end

  def down
    remove_check_constraint :course_purchases, name: "course_purchase_status_valid"
    add_check_constraint :course_purchases, "status IN ('pending', 'paid', 'expired', 'refunded')", name: "course_purchase_status_valid"
  end
end
