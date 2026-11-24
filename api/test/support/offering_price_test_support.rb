module OfferingPriceTestSupport
  def stamp_verified_offering_price(cohort)
    cohort.update!(settings: cohort.settings.to_h.merge("offering_price_verified" => {
      "stripe_price_id" => cohort.stripe_price_id, "price_cents" => cohort.public_price_cents, "verified_at" => Time.current.iso8601
    }))
  end

  def with_stripe_price(retrieve, configured: true)
    original = CourseCheckout.method(:client)
    previous_key = ENV["STRIPE_RESTRICTED_KEY"]
    ENV["STRIPE_RESTRICTED_KEY"] = configured ? "rk_test_synthetic" : nil
    prices = Object.new
    prices.define_singleton_method(:retrieve) { |id| retrieve.call(id) }
    CourseCheckout.define_singleton_method(:client) { Struct.new(:v1).new(Struct.new(:prices).new(prices)) }
    yield
  ensure
    CourseCheckout.define_singleton_method(:client, original)
    ENV["STRIPE_RESTRICTED_KEY"] = previous_key
  end
end
