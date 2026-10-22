class AddCheckoutAttemptToCoursePurchases < ActiveRecord::Migration[8.1]
  def change
    # Immutable request + idempotency key, committed before contacting Stripe.
    add_column :course_purchases, :checkout_attempt, :jsonb
  end
end
