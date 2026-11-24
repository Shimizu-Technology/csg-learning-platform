require "test_helper"
require_relative "../support/offering_price_test_support"

class OfferingPriceVerificationTest < ActionDispatch::IntegrationTest
  include OfferingPriceTestSupport

  setup do
    @admin = User.create!(email: "price-admin@example.test", clerk_id: "price-admin", role: :admin)
    @instructor = User.create!(email: "price-instructor@example.test", clerk_id: "price-instructor", role: :instructor)
    @student = User.create!(email: "price-student@example.test", clerk_id: "price-student", role: :student)
    curriculum = Curriculum.create!(name: "Verified offering", status: :active)
    mod = curriculum.modules.create!(name: "Module", position: 0)
    lesson = mod.lessons.create!(title: "Lesson", position: 0)
    lesson.content_blocks.create!(block_type: :text, body: "Synthetic lesson", position: 0)
    @cohort = Cohort.create!(name: "Python course", curriculum: curriculum, start_date: Date.current, course_delivery: "self_paced",
      status: :active, public_title: "Python course", public_description: "Learn Python", public_image_url: "https://example.test/course.png",
      stripe_price_id: "price_verified_python", public_price_cents: 39_900)
    @cohort.instructors << @instructor
    @cohort.update!(support_instructor: @instructor)
    @path = "/api/v1/cohorts/#{@cohort.id}"
  end

  test "requires verification before enabling checkout and pauses new checkout when either saved price field changes" do
    enabled = CourseCheckout.method(:enabled?)
    CourseCheckout.define_singleton_method(:enabled?) { true }
    as_user(@admin) do
      enable_checkout
      assert_response :unprocessable_entity
      assert_includes response.parsed_body.fetch("errors"), "Needed: Price verified"

      verify_price
      assert_response :success
      stamp = response.parsed_body.fetch("offering_price_verified")
      assert_equal [ "price_verified_python", 39_900 ], stamp.values_at("stripe_price_id", "price_cents")
      assert Time.iso8601(stamp.fetch("verified_at"))

      enable_checkout
      assert_response :success
      assert_equal stamp, response.parsed_body.dig("cohort", "offering_price_verified")
      assert @cohort.reload.purchase_ready?

      [ { public_price_cents: 49_900 }, { stripe_price_id: "price_new_python" } ].each do |edit|
        post "#{@path}/setup_readiness", params: edit, headers: auth_headers, as: :json
        assert_response :success
        assert_equal false, response.parsed_body.dig("readiness", "price_verified")
        assert @cohort.reload.purchase_ready?, "Readiness preview must not save the edit"

        patch @path, params: edit, headers: auth_headers, as: :json
        assert_response :success
        assert_nil response.parsed_body.dig("cohort", "offering_price_verified")
        assert_equal false, response.parsed_body.dig("cohort", "offering_readiness", "price_verified")
        refute @cohort.reload.settings.key?("offering_price_verified")
        refute @cohort.purchase_ready?
        assert @cohort.public_checkout_enabled?

        as_user(@student) do
          assert_no_difference "CoursePurchase.count" do
            post "/api/v1/course_checkouts", params: { cohort_id: @cohort.id }, headers: auth_headers, as: :json
          end
          assert_response :unprocessable_entity
        end
        verify_price
        assert_response :success
        assert @cohort.reload.purchase_ready?
      end
    end
  ensure
    CourseCheckout.define_singleton_method(:enabled?, enabled)
  end

  test "a failed Stripe check returns the specific error and does not stamp settings" do
    verify = ->(_id) { Stripe::Price.construct_from(active: true, type: "one_time", currency: "usd", unit_amount: 49_900) }
    as_user(@admin) do
      with_stripe_price(verify) { post "#{@path}/verify_offering_price", headers: auth_headers }
    end
    assert_response :unprocessable_entity
    assert_equal "Stripe price is $499.00 USD, but display price is $399.00 USD.", response.parsed_body["error"]
    assert_nil @cohort.reload.offering_price_verification
  end

  test "a price edit while Stripe responds returns a conflict without verifying the edited price" do
    cohort = @cohort
    verify = ->(_id) do
      cohort.update!(public_price_cents: 49_900)
      Stripe::Price.construct_from(active: true, type: "one_time", currency: "usd", unit_amount: 39_900)
    end
    as_user(@admin) do
      with_stripe_price(verify) { post "#{@path}/verify_offering_price", headers: auth_headers }
    end
    assert_response :conflict
    assert_includes response.parsed_body["error"], "The saved price changed"
    assert_nil @cohort.reload.offering_price_verification
  end

  test "reports legacy cohort validation errors when saving a matching Stripe verification" do
    @cohort.update_columns(name: "")

    as_user(@admin) { verify_price }

    assert_response :unprocessable_entity
    assert_includes response.parsed_body["error"], "Could not save price verification"
    assert_includes response.parsed_body["error"], "Name can't be blank"
    assert_nil @cohort.reload.offering_price_verification
  end

  test "students and instructors cannot verify a price or inject the verification stamp" do
    with_stripe_price(->(_id) { flunk "Unauthorized price verification reached Stripe" }) do
      [ @instructor, @student ].each do |user|
        as_user(user) { post "#{@path}/verify_offering_price", headers: auth_headers }
        assert_response :forbidden
      end
    end
    as_user(@admin) do
      patch @path, params: { settings: { offering_price_verified: { stripe_price_id: @cohort.stripe_price_id, price_cents: @cohort.public_price_cents, verified_at: Time.current.iso8601 } } }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
    end
    assert_nil @cohort.reload.offering_price_verification
  end

  private

  def enable_checkout
    patch @path, params: { public_checkout_enabled: true }, headers: auth_headers, as: :json
  end

  def verify_price
    retrieve = ->(id) do
      assert_equal @cohort.stripe_price_id, id
      Stripe::Price.construct_from(active: true, type: "one_time", currency: "usd", unit_amount: @cohort.public_price_cents)
    end
    with_stripe_price(retrieve) { post "#{@path}/verify_offering_price", headers: auth_headers }
  end

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
