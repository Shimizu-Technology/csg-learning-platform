class AddCoursePurchaseAmountAndFailedStatus < ActiveRecord::Migration[8.1]
  def up
    add_column :course_purchases, :price_cents, :integer
    remove_check_constraint :course_purchases, name: "course_purchase_status_valid"
    add_check_constraint :course_purchases, "status IN ('pending', 'paid', 'expired', 'failed', 'refunded', 'disputed')", name: "course_purchase_status_valid"
    add_check_constraint :course_purchases, "price_cents IS NULL OR price_cents > 0", name: "course_purchase_price_positive"
  end

  def down
    remove_check_constraint :course_purchases, name: "course_purchase_price_positive"
    remove_check_constraint :course_purchases, name: "course_purchase_status_valid"
    add_check_constraint :course_purchases, "status IN ('pending', 'paid', 'expired', 'refunded', 'disputed')", name: "course_purchase_status_valid"
    remove_column :course_purchases, :price_cents
  end
end
