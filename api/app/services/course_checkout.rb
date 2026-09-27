class CourseCheckout
  class Unavailable < StandardError; end

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
        record.stripe_price_id = cohort.stripe_price_id
        record.price_cents = cohort.public_price_cents
      end
    end
    purchase.with_lock do
      raise Unavailable, "This course is already purchased" if purchase.status == "paid"
      raise Unavailable, "This purchase needs staff review" if %w[refunded disputed].include?(purchase.status)
      raise Unavailable, "Course pricing changed; contact support" if purchase.stripe_price_id != cohort.stripe_price_id
      if purchase.status == "pending" && purchase.checkout_url.present? && purchase.checkout_expires_at&.future?
        return purchase.checkout_url
      end
      # An expired session can be renewed only after Stripe has confirmed it
      # expired. A stale paid webhook must never be replaced by a second sale.
      if purchase.stripe_session_id.present? && purchase.status != "failed"
        old_session = client.v1.checkout.sessions.retrieve(purchase.stripe_session_id)
        raise Unavailable, "Your payment is being confirmed" if old_session.payment_status == "paid"
        raise Unavailable, "Your checkout is still open; try again shortly" unless old_session.status == "expired"
      end

      stripe_price = client.v1.prices.retrieve(cohort.stripe_price_id)
      unless stripe_price.active && stripe_price.currency == "usd" && stripe_price.unit_amount == purchase.price_cents && stripe_price.type == "one_time"
        raise Unavailable, "Course price does not match the configured checkout price"
      end

      identifier = "csglearn#{SecureRandom.alphanumeric(8).downcase}"
      session = client.v1.checkout.sessions.create({
        mode: "payment",
        line_items: [ { price: cohort.stripe_price_id, quantity: 1 } ],
        customer_email: user.email,
        client_reference_id: purchase.id.to_s,
        metadata: { purchase_id: purchase.id.to_s },
        payment_intent_data: { metadata: { course_purchase_id: purchase.id.to_s } },
        success_url: "#{ENV.fetch('FRONTEND_URL').chomp('/')}/courses?checkout=return",
        cancel_url: "#{ENV.fetch('FRONTEND_URL').chomp('/')}/courses?checkout=canceled",
        integration_identifier: identifier
      }, { idempotency_key: "csg-course-#{purchase.id}-#{purchase.stripe_session_id || 'initial'}" })
      purchase.update!(status: "pending", stripe_session_id: session.id, checkout_url: session.url, checkout_expires_at: Time.at(session.expires_at))
      session.url
    end
  end
end
