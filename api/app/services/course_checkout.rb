class CourseCheckout
  class Unavailable < StandardError; end
  class SetupFailure < Unavailable; end
  class CohortFull < Unavailable; end
  class PriceChanged < Unavailable; end

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

  def self.verify_offering_price!(cohort)
    captured_id = cohort.stripe_price_id
    captured_cents = cohort.public_price_cents
    raise SetupFailure, "Stripe is not configured for this school." if ENV["STRIPE_RESTRICTED_KEY"].blank?

    verified_price!(stripe_price_id: captured_id, price_cents: captured_cents)

    # A price edit during the Stripe request must never stamp the newer terms.
    cohort.with_lock do
      unless cohort.stripe_price_id == captured_id && cohort.public_price_cents == captured_cents
        raise PriceChanged, "The saved price changed while Stripe was checking it. Reload settings and try again."
      end

      stamp = { "stripe_price_id" => captured_id, "price_cents" => captured_cents, "verified_at" => Time.current.iso8601 }
      cohort.update!(settings: cohort.settings.to_h.merge("offering_price_verified" => stamp))
      stamp
    end
  rescue ActiveRecord::RecordInvalid => error
    raise SetupFailure, "Could not save price verification. Fix the cohort settings and try again. #{error.record.errors.full_messages.to_sentence}"
  end

  def self.verified_price!(stripe_price_id:, price_cents:)
    unless stripe_price_id.to_s.match?(/\Aprice_[a-zA-Z0-9_]+\z/) && price_cents.to_i.positive?
      raise SetupFailure, "Save a display price and a valid Stripe Price ID before verifying."
    end
    price = client.v1.prices.retrieve(stripe_price_id)
    raise SetupFailure, "This Stripe price is inactive. Use an active Price ID." unless price.active
    raise SetupFailure, "This Stripe price is recurring. Use a one-time price." unless price.type == "one_time"
    unless price.currency == "usd"
      raise SetupFailure, "This Stripe price uses #{price.currency.to_s.upcase}. Use a price in USD."
    end
    unless price.unit_amount == price_cents
      raise SetupFailure, "This Stripe price does not have a fixed amount." if price.unit_amount.nil?

      raise SetupFailure, "Stripe price is #{usd_price(price.unit_amount)}, but display price is #{usd_price(price_cents)}."
    end
    price
  rescue Stripe::InvalidRequestError => error
    raise SetupFailure, "Stripe could not find this Price ID. Check the ID and try again." if error.code == "resource_missing" || error.http_status == 404

    raise SetupFailure, "Stripe rejected this Price ID. Check the ID and try again."
  rescue Stripe::AuthenticationError, Stripe::PermissionError
    raise SetupFailure, "Stripe could not authorize the price check. Check the school's Stripe configuration."
  rescue Stripe::StripeError
    raise SetupFailure, "Could not reach Stripe to check this price. Try again."
  end
  private_class_method :verified_price!

  def self.usd_price(cents)
    dollars, remainder = cents.divmod(100)
    format("$%d.%02d USD", dollars, remainder)
  end
  private_class_method :usd_price

  def self.start!(user:, cohort:)
    raise Unavailable, "Course checkout is not available" unless enabled? && cohort.purchase_ready?(require_verified_price: false)
    raise Unavailable, "This course is already in your library" if user.enrollments.with_read_access.exists?(cohort: cohort)

    purchase = user.with_lock do
      raise Unavailable, "This course is already in your library" if user.enrollments.with_read_access.exists?(cohort: cohort)
      raise Unavailable, "This purchase needs staff review" if CoursePurchase.where(user: user, cohort: cohort, status: "disputed").exists?

      open_purchase = CoursePurchase.where(user: user, cohort: cohort, status: CoursePurchase::OPEN_ATTEMPT_STATUSES).order(id: :desc).first
      # Previously opened sessions and immutable requests can still resume on their agreed terms.
      if open_purchase
        open_purchase
      else
        raise Unavailable, "Course checkout is not available" unless cohort.offering_price_verification

        CoursePurchase.create!(
          user: user,
          cohort: cohort,
          status: "failed", # No session has been requested; safe to retry setup.
          stripe_price_id: cohort.stripe_price_id,
          price_cents: cohort.public_price_cents
        )
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
        rescue CohortFull, PriceChanged => error
          if purchase.status == "pending" && purchase.stripe_session_id.present?
            purchase.update!(status: "expired", checkout_url: nil, checkout_expires_at: nil)
          end
          setup_error = error
          nil
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

    raise CohortFull, "This cohort is full" if cohort.full_for_checkout?(user: user)
    raise Unavailable, "Course checkout is not available" unless cohort.offering_price_verification

    captured_price_id = cohort.stripe_price_id
    captured_price_cents = cohort.public_price_cents

    begin
      verified_price!(stripe_price_id: captured_price_id, price_cents: captured_price_cents)
    rescue SetupFailure
      raise SetupFailure, "We couldn't start checkout — try again"
    end

    identifier = purchase.integration_identifier.presence || "csglearn#{Array.new(8) { ("a".ord + SecureRandom.random_number(26)).chr }.join}"

    # Acquire cohort row lock to serialize concurrent seat reservations and
    # verify price/terms did not change while Stripe verified the price.
    cohort.with_lock do
      if cohort.stripe_price_id != captured_price_id || cohort.public_price_cents != captured_price_cents
        raise PriceChanged, "The course price changed while checkout was starting. Reload and try again."
      end
      raise Unavailable, "Course checkout is not available" unless cohort.purchase_ready?
      raise CohortFull, "This cohort is full" if cohort.full_for_checkout?(user: user)

      course_path = cohort.unlisted? && cohort.public_slug.present? ? "/courses/#{cohort.public_slug}" : "/courses"
      params = {
        mode: "payment",
        line_items: [ { price: captured_price_id, quantity: 1 } ],
        customer_email: user.email,
        client_reference_id: purchase.id.to_s,
        metadata: { purchase_id: purchase.id.to_s },
        payment_intent_data: { metadata: { course_purchase_id: purchase.id.to_s } },
        success_url: "#{ENV.fetch('FRONTEND_URL').chomp('/')}#{course_path}?checkout=return&purchase_id=#{purchase.id}&offering_id=#{cohort.id}",
        cancel_url: "#{ENV.fetch('FRONTEND_URL').chomp('/')}#{course_path}?checkout=canceled&offering_id=#{cohort.id}",
        integration_identifier: identifier
      }

      snapshot = CoursePurchase.terms_snapshot_for(cohort)
      purchase.update!(
        status: "pending", stripe_session_id: nil, checkout_url: nil, checkout_expires_at: nil,
        stripe_price_id: captured_price_id, price_cents: captured_price_cents,
        access_months: snapshot["access_months"], support_weeks: snapshot["support_weeks"],
        terms_snapshot: snapshot, over_capacity: false,
        integration_identifier: identifier,
        checkout_attempt: { key: "csg-course-#{purchase.id}-#{SecureRandom.uuid}", requested_at: Time.current.iso8601, params: params }
      )
    end
    purchase.checkout_attempt
  end
  private_class_method :prepare_attempt!
end
