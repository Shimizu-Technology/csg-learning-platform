class CourseCheckout
  class Unavailable < StandardError; end
  class SetupFailure < Unavailable; end

  def self.enabled?
    !!(ActiveModel::Type::Boolean.new.cast(ENV["COURSE_CHECKOUT_ENABLED"]) &&
      ActiveModel::Type::Boolean.new.cast(ENV["OPEN_COURSE_SIGNUPS"]) &&
      ENV["STRIPE_RESTRICTED_KEY"].present? && webhook_ready? && ENV["FRONTEND_URL"].present?)
  end

  def self.webhook_ready?
    ENV["STRIPE_WEBHOOK_SECRET"].present?
  end

  def self.client
    Stripe::StripeClient.new(ENV.fetch("STRIPE_RESTRICTED_KEY"), stripe_version: "2026-08-26.dahlia")
  end

  def self.start!(user:, cohort:)
    raise Unavailable, "Course checkout is not available" unless enabled? && cohort.purchase_ready?
    raise Unavailable, "This course is already in your library" if user.enrollments.active.exists?(cohort: cohort)

    purchase = user.with_lock do
      CoursePurchase.find_or_create_by!(user: user, cohort: cohort) do |record|
        record.status = "failed" # No session has been requested; safe to retry setup.
        record.stripe_price_id = cohort.stripe_price_id
        record.price_cents = cohort.public_price_cents
      end
    end

    # Commit the full immutable request BEFORE the external side effect. A
    # timeout, crash, or failed local save must resume this same attempt.
    setup_error = nil
    attempt = purchase.with_lock do
      raise Unavailable, "This course is already purchased" if purchase.status == "paid"
      raise Unavailable, "This purchase needs staff review" if %w[refunded disputed].include?(purchase.status)
      if purchase.status == "pending" && purchase.stripe_session_id.present?
        session = client.v1.checkout.sessions.retrieve(purchase.stripe_session_id)
        raise Unavailable, "Your payment is being confirmed" if session.payment_status == "paid"
        if session.status == "open" && session.url.present?
          return session.url
        end
        raise Unavailable, "Checkout needs a status check; contact support" unless session.status == "expired"
      end
      if purchase.status == "pending" && purchase.stripe_session_id.blank?
        unless purchase.checkout_resumable?
          raise Unavailable, "Checkout needs a status check; contact support before trying another payment"
        end
        purchase.checkout_attempt
      else
        begin
          prepare_attempt!(purchase, user, cohort)
        rescue SetupFailure => error
          # Reconciliation above proved any prior session expired; no new
          # session was requested. Commit the definitive failure before raising.
          purchase.update!(status: "failed", stripe_session_id: nil, checkout_url: nil, checkout_expires_at: nil, checkout_attempt: nil)
          setup_error = error
          nil
        end
      end
    end

    raise setup_error if setup_error

    purchase.with_lock do
      # Another caller/webhook may have resolved this attempt while we waited.
      raise Unavailable, "This purchase needs a status check" unless purchase.status == "pending" && purchase.checkout_attempt == attempt
      return purchase.checkout_url if purchase.stripe_session_id.present? && purchase.checkout_url.present?
      raise Unavailable, "Checkout needs a status check; contact support" unless purchase.checkout_resumable?

      # Every creation error remains uncertain. Replay only the saved request
      # and key; never replace it merely because Stripe's response was lost.
      session = client.v1.checkout.sessions.create(attempt.fetch("params").deep_symbolize_keys,
        { idempotency_key: attempt.fetch("key") })
      purchase.update!(stripe_session_id: session.id, checkout_url: session.url, checkout_expires_at: Time.at(session.expires_at))
      session.url
    end
  end

  def self.prepare_attempt!(purchase, user, cohort)
    if purchase.stripe_session_id.present? && purchase.status != "failed"
      old_session = client.v1.checkout.sessions.retrieve(purchase.stripe_session_id)
      raise Unavailable, "Your payment is being confirmed" if old_session.payment_status == "paid"
      raise Unavailable, "Your checkout is still open; try again shortly" unless old_session.status == "expired"
    end

    stripe_price = begin
      client.v1.prices.retrieve(cohort.stripe_price_id)
    rescue Stripe::StripeError
      raise SetupFailure, "We couldn't start checkout — try again"
    end
    unless stripe_price.active && stripe_price.currency == "usd" && stripe_price.unit_amount == cohort.public_price_cents && stripe_price.type == "one_time"
      raise SetupFailure, "We couldn't start checkout — try again"
    end

    identifier = purchase.integration_identifier.presence || "csglearn#{Array.new(8) { ("a".ord + SecureRandom.random_number(26)).chr }.join}"
    params = {
      mode: "payment",
      line_items: [ { price: cohort.stripe_price_id, quantity: 1 } ],
      customer_email: user.email,
      client_reference_id: purchase.id.to_s,
      metadata: { purchase_id: purchase.id.to_s },
      payment_intent_data: { metadata: { course_purchase_id: purchase.id.to_s } },
      success_url: "#{ENV.fetch('FRONTEND_URL').chomp('/')}/courses?checkout=return&purchase_id=#{purchase.id}&offering_id=#{cohort.id}",
      cancel_url: "#{ENV.fetch('FRONTEND_URL').chomp('/')}/courses?checkout=canceled&offering_id=#{cohort.id}",
      integration_identifier: identifier
    }
    purchase.update!(status: "pending", stripe_session_id: nil, checkout_url: nil, checkout_expires_at: nil,
      stripe_price_id: cohort.stripe_price_id, price_cents: cohort.public_price_cents,
      access_months: cohort.self_paced_access_months, support_weeks: cohort.self_paced_support_weeks,
      integration_identifier: identifier,
      checkout_attempt: { key: "csg-course-#{purchase.id}-#{SecureRandom.uuid}", requested_at: Time.current.iso8601, params: params })
    purchase.checkout_attempt
  end
  private_class_method :prepare_attempt!
end
