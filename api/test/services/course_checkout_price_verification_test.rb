require "test_helper"
require_relative "../support/offering_price_test_support"

class CourseCheckoutPriceVerificationTest < ActiveSupport::TestCase
  include OfferingPriceTestSupport

  Price = Struct.new(:active, :currency, :unit_amount, :type, keyword_init: true)

  setup do
    curriculum = Curriculum.create!(name: "Stripe price test")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Saved offering", start_date: Date.current,
      course_delivery: "self_paced", stripe_price_id: "price_saved", public_price_cents: 39_900, settings: { "other_setting" => true })
  end

  test "stamps an active one-time matching USD price and preserves other settings" do
    travel_to Time.utc(2026, 11, 24, 2) do
      with_stripe_price(->(id) { assert_equal "price_saved", id; price }) do
        stamp = CourseCheckout.verify_offering_price!(@cohort)
        assert_equal({ "stripe_price_id" => "price_saved", "price_cents" => 39_900, "verified_at" => "2026-11-24T02:00:00Z" }, stamp)
        assert_equal stamp, @cohort.reload.offering_price_verification
        assert_equal true, @cohort.settings["other_setting"]
      end
    end
  end

  {
    amount_mismatch: [ { unit_amount: 49_900 }, "$499.00 USD, but display price is $399.00 USD" ],
    inactive: [ { active: false }, "Stripe price is inactive" ],
    wrong_currency: [ { currency: "eur" }, "uses EUR" ],
    recurring: [ { type: "recurring" }, "Stripe price is recurring" ],
    custom_amount: [ { unit_amount: nil }, "does not have a fixed amount" ]
  }.each do |name, (overrides, message)|
    test "rejects #{name} without saving a stamp" do
      assert_verification_failure(->(_id) { price(**overrides) }, message)
    end
  end

  test "reports a missing Stripe price ID and provider failure without leaking Stripe errors" do
    assert_verification_failure(->(_id) { raise Stripe::InvalidRequestError.new("private detail", "id", code: "resource_missing") }, "could not find this Price ID")
    assert_verification_failure(->(_id) { raise Stripe::InvalidRequestError.new("private detail", "id") }, "rejected this Price ID")
    assert_verification_failure(->(_id) { raise Stripe::APIConnectionError, "private detail" }, "Could not reach Stripe")
    assert_verification_failure(->(_id) { raise Stripe::PermissionError, "private detail" }, "could not authorize")
  end

  test "refuses an unconfigured school and invalid saved terms before requesting Stripe" do
    never_request = ->(_id) { flunk "Stripe should not be called" }
    with_stripe_price(never_request, configured: false) do
      error = assert_raises(CourseCheckout::SetupFailure) { CourseCheckout.verify_offering_price!(@cohort) }
      assert_includes error.message, "Stripe is not configured"
    end
    @cohort.update!(stripe_price_id: nil)
    assert_verification_failure(never_request, "Save a display price and a valid Stripe Price ID")
  end

  test "refuses to stamp a price changed while Stripe was responding" do
    retrieve = ->(_id) do
      Cohort.find(@cohort.id).update!(public_price_cents: 49_900)
      price
    end
    with_stripe_price(retrieve) do
      assert_raises(CourseCheckout::PriceChanged) { CourseCheckout.verify_offering_price!(@cohort) }
    end
    assert_nil @cohort.reload.offering_price_verification
  end

  private

  def price(**overrides)
    Price.new(**{ active: true, currency: "usd", unit_amount: 39_900, type: "one_time" }.merge(overrides))
  end

  def assert_verification_failure(retrieve, message)
    with_stripe_price(retrieve) do
      error = assert_raises(CourseCheckout::SetupFailure) { CourseCheckout.verify_offering_price!(@cohort) }
      assert_includes error.message, message
      refute_includes error.message, "private detail"
    end
    assert_nil @cohort.reload.offering_price_verification
  end
end
