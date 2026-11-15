require_relative "../support/model_coverage"

class CoursePurchaseTest < ModelCoverageTestCase
  test "snapshots purchase terms and models uncertain checkout retry window" do
    purchase = CoursePurchase.create!(user: student, cohort: course, stripe_price_id: "price_synthetic", status: "pending")
    assert_equal course.self_paced_access_months, purchase.access_months
    assert_equal course.self_paced_support_weeks, purchase.support_weeks
    assert_equal "starting", purchase.checkout_state
    purchase.checkout_attempt = { "requested_at" => 22.hours.ago.iso8601 }
    assert purchase.checkout_resumable?
    purchase.checkout_attempt = { "requested_at" => 23.hours.ago.iso8601 }
    assert_not purchase.checkout_resumable?
    purchase.status = "failed"
    assert_equal "setup_failed", purchase.checkout_state
    purchase.status = "paid"
    assert_equal "paid", purchase.checkout_state
    assert_not purchase.checkout_resumable?
    purchase.save!
    assert_invalid purchase, :price_cents, 0
    assert_invalid purchase, :status, "unknown"
    assert_database_rejects purchase, { price_cents: 0 }
    assert_database_rejects purchase, { status: "unknown" }
    assert_database_rejects purchase, { access_months: 0 }
    assert_database_rejects purchase, { support_weeks: 0 }
  end

  test "unique purchase and Stripe references prevent duplicate entitlements" do
    purchase = CoursePurchase.create!(user: student, cohort: course, stripe_price_id: "price_synthetic", stripe_session_id: "cs_synthetic", stripe_payment_intent_id: "pi_synthetic")
    duplicate = purchase.dup
    assert_not duplicate.valid?
    other = CoursePurchase.create!(user: person, cohort: course, stripe_price_id: "price_synthetic")
    %i[user_id stripe_session_id stripe_payment_intent_id].each do |attribute|
      assert_database_rejects other, { attribute => purchase.public_send(attribute) }, ActiveRecord::RecordNotUnique
    end
    assert_not student.destroy
    assert User.exists?(student.id)
  end
end
