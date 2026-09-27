class CoursePurchaseFulfillment
  def self.revoke!(payment_intent_id:, status:)
    return if payment_intent_id.blank?

    payment_intent = CourseCheckout.client.v1.payment_intents.retrieve(payment_intent_id)
    purchase_id = Integer(payment_intent.metadata&.[]("course_purchase_id"), exception: false)
    purchase = purchase_id ? CoursePurchase.find_by(id: purchase_id) : CoursePurchase.find_by(stripe_payment_intent_id: payment_intent_id)
    return unless purchase
    return unless purchase.price_cents == payment_intent.amount

    purchase.with_lock do
      return if %w[refunded disputed].include?(purchase.status)

      was_paid = purchase.status == "paid"
      purchase.stripe_payment_intent_id ||= payment_intent_id
      purchase.update!(status: status)
      if was_paid
        purchase.user.enrollments.where(cohort: purchase.cohort).update_all(status: Enrollment.statuses.fetch("dropped"), updated_at: Time.current)
      end
    end
  end

  def self.fulfill!(session)
    return unless session.payment_status == "paid"

    purchase_id = Integer(session.client_reference_id, exception: false)
    return unless purchase_id

    purchase = CoursePurchase.find_by(id: purchase_id, stripe_session_id: session.id)
    return unless purchase

    purchase.with_lock do
      return if %w[paid refunded disputed].include?(purchase.status)
      cohort = purchase.cohort
      raise "Checkout purchase is not a self-paced course" unless cohort.self_paced?
      # The payer may use a different receipt email. Entitlement follows the verified Clerk account that
      # created this signed Checkout Session, not the payer's receipt address.
      raise "Checkout total changed" unless session.currency == "usd" && session.amount_subtotal == purchase.price_cents

      enrollment = Enrollment.find_or_initialize_by(user: purchase.user, cohort: cohort)
      enrollment.status = :active
      enrollment.access_expires_at ||= Time.current + cohort.self_paced_access_months.months
      enrollment.save!
      cohort.curriculum.modules.find_each do |curriculum_module|
        enrollment.module_assignments.find_or_create_by!(curriculum_module: curriculum_module) do |assignment|
          assignment.unlocked = true
        end
      end
      purchase.update!(status: "paid", stripe_payment_intent_id: session.payment_intent)
    end
  end

  def self.payment_failed!(session)
    purchase = CoursePurchase.find_by(stripe_session_id: session.id)
    purchase&.with_lock do
      purchase.update!(status: "failed", checkout_url: nil, checkout_expires_at: nil) if purchase.status == "pending"
    end
  end
end
