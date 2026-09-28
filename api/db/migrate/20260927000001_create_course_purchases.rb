class CreateCoursePurchases < ActiveRecord::Migration[8.1]
  def change
    add_column :enrollments, :access_expires_at, :datetime
    add_column :enrollments, :support_expires_at, :datetime
    add_index :enrollments, :access_expires_at
    create_table :course_purchases do |t|
      t.references :user, null: false, foreign_key: true
      t.references :cohort, null: false, foreign_key: true
      t.string :stripe_session_id
      t.text :checkout_url
      t.datetime :checkout_expires_at
      t.string :stripe_payment_intent_id
      t.string :stripe_price_id, null: false
      t.string :status, null: false, default: "pending"
      t.timestamps
    end
    add_index :course_purchases, :stripe_session_id, unique: true
    add_index :course_purchases, :stripe_payment_intent_id, unique: true
    add_index :course_purchases, [ :user_id, :cohort_id ], unique: true
    add_check_constraint :course_purchases, "status IN ('pending', 'paid', 'expired', 'refunded')", name: "course_purchase_status_valid"
  end
end
