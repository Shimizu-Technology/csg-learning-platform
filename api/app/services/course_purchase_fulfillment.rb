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
        purchase.user.with_lock do
          # Never drop an enrollment that has since been renewed by a newer paid purchase.
          newer_paid = CoursePurchase.where(user_id: purchase.user_id, cohort_id: purchase.cohort_id, status: "paid")
            .where("id > ?", purchase.id).exists?
          unless newer_paid
            purchase.user.enrollments.where(cohort: purchase.cohort).update_all(status: Enrollment.statuses.fetch("dropped"), updated_at: Time.current)
          end
        end
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
      return unless purchase.stripe_session_id == session.id
      return if %w[paid refunded disputed].include?(purchase.status)

      cohort = purchase.cohort
      over_capacity = false
      fixed_window_elapsed = false
      fulfilled_at = Time.current

      purchase.user.with_lock do
        cohort.with_lock do
          purchase.snapshot_terms
          raise "Checkout purchase is not eligible for in-app checkout" unless purchase.sold_eligible_for_checkout?
          # The payer may use a different receipt email. Entitlement follows the verified Clerk account that
          # created this signed Checkout Session, not the payer's receipt address.
          raise "Checkout total changed" unless session.currency == "usd" && session.amount_subtotal == purchase.price_cents

          # Never refuse or drop a paid learner if a late/expired session or
          # concurrent enrollment fills the cap: enroll anyway and alert admins.
          over_capacity = cohort.seat_limit.present? &&
            cohort.seats_taken(excluding_user_id: purchase.user_id) >= cohort.seat_limit

          sold = purchase.sold_terms
          enrollment = Enrollment.find_or_initialize_by(user: purchase.user, cohort: cohort)
          enrollment.status = :active
          if sold[:course_delivery] == "guided"
            # Guided terms (fixed dates or relative months/weeks) apply from the
            # snapshotted purchase terms. Preserve first_opened_at and graded
            # submissions on reactivation; anchor expired relative starts freshly.
            enrollment.apply_guided_purchase_terms(
              access_months: sold[:access_months],
              support_weeks: sold[:support_weeks],
              terms: sold,
              at: fulfilled_at
            )
            fixed_window_elapsed = enrollment.access_expires_at.present? && enrollment.access_expires_at <= fulfilled_at
          else
            # Self-paced support starts on the learner's next first open, so
            # reactivation resets first_opened_at and support_expires_at.
            enrollment.access_expires_at = fulfilled_at + sold[:access_months].months
            enrollment.self_paced_support_weeks = sold[:support_weeks]
            enrollment.first_opened_at = nil
            enrollment.support_expires_at = nil
          end
          enrollment.save!
          enrollment.assign_cohort_content_defaults!
        end
      end

      snapshot = (purchase.terms_snapshot || {}).dup
      snapshot["fulfilled_after_access_end"] = true if fixed_window_elapsed
      purchase.update!(
        status: "paid",
        stripe_payment_intent_id: session.payment_intent,
        over_capacity: over_capacity,
        terms_snapshot: snapshot
      )

      if over_capacity
        Rails.logger.warn(
          "[CoursePurchaseFulfillment] over_capacity purchase_id=#{purchase.id} cohort_id=#{cohort.id} " \
          "user_id=#{purchase.user_id} seat_limit=#{cohort.seat_limit}"
        )
      end
      if fixed_window_elapsed
        Rails.logger.warn(
          "[CoursePurchaseFulfillment] fulfilled_after_access_end purchase_id=#{purchase.id} cohort_id=#{cohort.id} " \
          "user_id=#{purchase.user_id}"
        )
      end

      if over_capacity || fixed_window_elapsed
        # Persist durable in-app admin notifications inside the fulfillment
        # transaction so a post-commit crash or delivery error cannot lose them.
        durable_notifications = NotificationDeliveryService.admin_alert(purchase, push: false)
        if durable_notifications.any?
          PushNotificationJob.perform_later("CoursePurchase", purchase.id, durable_notifications.map(&:id))
        end
      else
        # Deferred until this lock's transaction commits; a webhook replay returns above.
        AdminAlertJob.perform_later("CoursePurchase", purchase.id)
      end
    end
  end

  def self.payment_failed!(session)
    purchase = CoursePurchase.find_by(stripe_session_id: session.id)
    purchase&.with_lock do
      purchase.update!(status: "failed", checkout_url: nil, checkout_expires_at: nil) if purchase.status == "pending" && purchase.stripe_session_id == session.id
    end
  end
end
