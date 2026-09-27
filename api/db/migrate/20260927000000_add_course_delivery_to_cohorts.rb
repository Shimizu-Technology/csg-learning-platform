class AddCourseDeliveryToCohorts < ActiveRecord::Migration[8.1]
  def change
    add_column :cohorts, :course_delivery, :string, default: "program", null: false
    add_column :cohorts, :public_checkout_enabled, :boolean, default: false, null: false
    add_column :cohorts, :stripe_price_id, :string
    add_check_constraint :cohorts, "course_delivery IN ('program', 'guided', 'self_paced')", name: "cohort_course_delivery_valid"
  end
end
