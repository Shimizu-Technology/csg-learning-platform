require "test_helper"
require "ostruct"

class SelfPacedCourseAccessTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Python Fundamentals", status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Foundations", position: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Variables", position: 0, release_day: 0)
    @instructor = user("instructor", :instructor)
    @student = user("student", :student)
    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Python at your pace", start_date: Date.current,
      status: :active, cohort_type: :workshop, course_delivery: "self_paced",
      public_checkout_enabled: true, stripe_price_id: "price_test_python", public_price_cents: 14_900,
      support_instructor: @instructor
    )
  end

  test "checkout stays disabled and a public offering does not expose a price until sale is enabled" do
    get "/api/v1/course_offerings"
    assert_response :success
    offering = JSON.parse(response.body).fetch("offerings").sole
    assert_equal false, offering.fetch("checkout_available")

    as_user(@student) do
      post "/api/v1/course_checkouts", params: { cohort_id: @cohort.id }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal 0, CoursePurchase.count
  end

  test "paid webhook fulfillment is idempotent and opens every lesson without meetings" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, price_cents: 14_900, stripe_session_id: "cs_test_python")
    session = OpenStruct.new(
      id: "cs_test_python", client_reference_id: purchase.id.to_s, payment_status: "paid",
      customer_details: OpenStruct.new(email: @student.email), currency: "usd",
      amount_subtotal: 14_900, payment_intent: "pi_test_python"
    )
    @cohort.update!(public_price_cents: 19_900)
    CoursePurchaseFulfillment.fulfill!(session)
    CoursePurchaseFulfillment.fulfill!(session)
    enrollment = Enrollment.find_by!(user: @student, cohort: @cohort)
    assert_equal 1, Enrollment.where(user: @student, cohort: @cohort).count
    assert_equal "paid", purchase.reload.status
    assert_nil enrollment.support_expires_at
    assert_in_delta 12.months.from_now.to_i, enrollment.access_expires_at.to_i, 5
    assert enrollment.module_assignments.find_by!(module_id: @module.id).accessible?(@cohort)

    as_user(@student) do
      get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: auth_headers
    end
    assert_response :success
    enrollment.reload
    assert_in_delta 6.weeks.from_now.to_i, enrollment.support_expires_at.to_i, 5

    as_user(@student) do
      get "/api/v1/private_meetings", headers: auth_headers
    end
    assert_response :success
    assert_empty JSON.parse(response.body).fetch("cohorts")
  end

  test "signed payment failure is processed while new checkout is disabled" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, price_cents: 14_900, stripe_session_id: "cs_test_python")
    secret = "whsec_test_course"
    previous = ENV["STRIPE_WEBHOOK_SECRET"]
    ENV["STRIPE_WEBHOOK_SECRET"] = secret
    payload = { id: "evt_test_failed", object: "event", type: "checkout.session.async_payment_failed", data: { object: { id: "cs_test_python", object: "checkout.session" } } }.to_json
    timestamp = Time.current
    signature = Stripe::Webhook::Signature.compute_signature(timestamp, payload, secret)
    header = Stripe::Webhook::Signature.generate_header(timestamp, signature)
    post "/api/v1/course_checkout_webhooks", params: payload, headers: { "Stripe-Signature" => header, "CONTENT_TYPE" => "application/json" }
    assert_response :success
    assert_equal "failed", purchase.reload.status
    assert_nil purchase.checkout_url
  ensure
    ENV["STRIPE_WEBHOOK_SECRET"] = previous
  end

  test "signed paid webhook grants access even after sales are turned off" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, price_cents: 14_900, stripe_session_id: "cs_test_python")
    secret = "whsec_test_course"
    previous = ENV["STRIPE_WEBHOOK_SECRET"]
    ENV["STRIPE_WEBHOOK_SECRET"] = secret
    payload = {
      id: "evt_test_paid", object: "event", type: "checkout.session.completed",
      data: { object: { object: "checkout.session", id: "cs_test_python", client_reference_id: purchase.id.to_s,
        payment_status: "paid", currency: "usd", amount_subtotal: 14_900, payment_intent: "pi_test_python",
        customer_details: { email: "different-payer@example.com" } } }
    }.to_json
    timestamp = Time.current
    signature = Stripe::Webhook::Signature.compute_signature(timestamp, payload, secret)
    header = Stripe::Webhook::Signature.generate_header(timestamp, signature)
    post "/api/v1/course_checkout_webhooks", params: payload, headers: { "Stripe-Signature" => header, "CONTENT_TYPE" => "application/json" }
    assert_response :success
    assert_equal "paid", purchase.reload.status
    assert Enrollment.find_by(user: @student, cohort: @cohort)&.active?
  ensure
    ENV["STRIPE_WEBHOOK_SECRET"] = previous
  end

  test "failed asynchronous payment can open a fresh checkout session" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, price_cents: 14_900, stripe_session_id: "cs_old")
    CoursePurchaseFulfillment.payment_failed!(OpenStruct.new(id: "cs_old"))
    assert_equal "failed", purchase.reload.status
    prices = Object.new
    prices.define_singleton_method(:retrieve) { |_id| OpenStruct.new(active: true, currency: "usd", unit_amount: 14_900, type: "one_time") }
    sessions = Object.new
    identifiers = []
    sessions.define_singleton_method(:create) do |params, _opts|
      identifiers << params.fetch(:integration_identifier)
      OpenStruct.new(id: "cs_new", url: "https://checkout.stripe.test/new", expires_at: 1.day.from_now.to_i)
    end
    fake_client = OpenStruct.new(v1: OpenStruct.new(prices: prices, checkout: OpenStruct.new(sessions: sessions)))
    original_client = CourseCheckout.method(:client)
    original_enabled = CourseCheckout.method(:enabled?)
    previous_frontend = ENV["FRONTEND_URL"]
    ENV["FRONTEND_URL"] = "https://learn.example.test"
    CourseCheckout.define_singleton_method(:client) { fake_client }
    CourseCheckout.define_singleton_method(:enabled?) { true }
    assert_equal "https://checkout.stripe.test/new", CourseCheckout.start!(user: @student, cohort: @cohort)
    assert_equal "cs_new", purchase.reload.stripe_session_id
    assert_equal "pending", purchase.status
    assert_match(/\Acsglearn[a-z]{8}\z/, purchase.integration_identifier)
    purchase.update!(status: "failed", checkout_url: nil, checkout_expires_at: nil)
    CourseCheckout.start!(user: @student, cohort: @cohort)
    assert_equal [ purchase.integration_identifier, purchase.integration_identifier ], identifiers
  ensure
    CourseCheckout.define_singleton_method(:client, original_client) if original_client
    CourseCheckout.define_singleton_method(:enabled?, original_enabled) if original_enabled
    ENV["FRONTEND_URL"] = previous_frontend
  end

  test "refund arriving before payment completion prevents later enrollment" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, price_cents: 14_900, stripe_session_id: "cs_test_python")
    payment_intent = OpenStruct.new(metadata: { "course_purchase_id" => purchase.id.to_s }, amount: 14_900)
    intents = Object.new
    intents.define_singleton_method(:retrieve) { |_id| payment_intent }
    fake_client = OpenStruct.new(v1: OpenStruct.new(payment_intents: intents))
    original = CourseCheckout.method(:client)
    CourseCheckout.define_singleton_method(:client) { fake_client }
    begin
      CoursePurchaseFulfillment.revoke!(payment_intent_id: "pi_test_python", status: "refunded")
    ensure
      CourseCheckout.define_singleton_method(:client, original)
    end
    assert_equal "refunded", purchase.reload.status
    session = OpenStruct.new(
      id: "cs_test_python", client_reference_id: purchase.id.to_s, payment_status: "paid",
      customer_details: OpenStruct.new(email: @student.email), currency: "usd",
      amount_subtotal: 14_900, payment_intent: "pi_test_python"
    )
    CoursePurchaseFulfillment.fulfill!(session)
    assert_nil Enrollment.find_by(user: @student, cohort: @cohort)
  end

  test "a forged or wrong-price payment cannot grant access" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, price_cents: 14_900, stripe_session_id: "cs_test_python")
    session = OpenStruct.new(
      id: "cs_test_python", client_reference_id: purchase.id.to_s, payment_status: "paid",
      customer_details: OpenStruct.new(email: @student.email), currency: "usd",
      amount_subtotal: 100, payment_intent: "pi_test_python"
    )
    assert_raises(RuntimeError) { CoursePurchaseFulfillment.fulfill!(session) }
    assert_nil Enrollment.find_by(user: @student, cohort: @cohort)
    assert_equal "pending", purchase.reload.status
  end

  test "content and instructor support have separate deadlines" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)
    enrollment.record_first_course_open!
    assert enrollment.instructor_support_active?
    enrollment.update!(support_expires_at: 1.minute.ago)
    refute enrollment.instructor_support_active?
    assert enrollment.active?
    enrollment.update!(access_expires_at: 1.minute.ago)
    refute enrollment.active?
    as_user(@student) { get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers }
    assert_response :forbidden
  end

  test "late first open cannot extend instructor support beyond lesson access" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 2.days.from_now)
    enrollment.record_first_course_open!
    assert_in_delta enrollment.access_expires_at.to_i, enrollment.reload.support_expires_at.to_i, 1
  end

  test "a disputed paid purchase revokes course access" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id,
      price_cents: 14_900, stripe_session_id: "cs_test_python", stripe_payment_intent_id: "pi_test_python", status: "paid")
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    payment_intent = OpenStruct.new(metadata: { "course_purchase_id" => purchase.id.to_s }, amount: 14_900)
    intents = Object.new
    intents.define_singleton_method(:retrieve) { |_id| payment_intent }
    fake_client = OpenStruct.new(v1: OpenStruct.new(payment_intents: intents))
    original = CourseCheckout.method(:client)
    CourseCheckout.define_singleton_method(:client) { fake_client }
    begin
      CoursePurchaseFulfillment.revoke!(payment_intent_id: "pi_test_python", status: "disputed")
    ensure
      CourseCheckout.define_singleton_method(:client, original)
    end
    assert_equal "disputed", purchase.reload.status
    assert_equal "dropped", enrollment.reload.status
  end

  test "signed dispute webhook uses the dispute payment intent without fetching its charge" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id,
      price_cents: 14_900, stripe_session_id: "cs_dispute", stripe_payment_intent_id: "pi_dispute", status: "paid")
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    payment_intent = OpenStruct.new(metadata: { "course_purchase_id" => purchase.id.to_s }, amount: 14_900)
    intents = Object.new
    intents.define_singleton_method(:retrieve) { |_id| payment_intent }
    original_client = CourseCheckout.method(:client)
    previous_secret = ENV["STRIPE_WEBHOOK_SECRET"]
    CourseCheckout.define_singleton_method(:client) { OpenStruct.new(v1: OpenStruct.new(payment_intents: intents)) }
    ENV["STRIPE_WEBHOOK_SECRET"] = "whsec_test_dispute"
    payload = { id: "evt_dispute", object: "event", type: "charge.dispute.created",
      data: { object: { object: "dispute", payment_intent: "pi_dispute", charge: "ch_dispute" } } }.to_json
    timestamp = Time.current
    signature = Stripe::Webhook::Signature.compute_signature(timestamp, payload, ENV.fetch("STRIPE_WEBHOOK_SECRET"))

    post "/api/v1/course_checkout_webhooks", params: payload,
      headers: { "Stripe-Signature" => Stripe::Webhook::Signature.generate_header(timestamp, signature), "CONTENT_TYPE" => "application/json" }

    assert_response :success
    assert_equal "disputed", purchase.reload.status
    assert_equal "dropped", enrollment.reload.status
  ensure
    CourseCheckout.define_singleton_method(:client, original_client) if original_client
    ENV["STRIPE_WEBHOOK_SECRET"] = previous_secret
  end

  test "a new paid checkout renews expired lesson access and restarts support on first open" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id,
      price_cents: 14_900, stripe_session_id: "cs_renewed")
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 1.day.ago,
      first_opened_at: 2.months.ago, support_expires_at: 1.month.ago)
    session = OpenStruct.new(id: "cs_renewed", client_reference_id: purchase.id.to_s, payment_status: "paid",
      currency: "usd", amount_subtotal: 14_900, payment_intent: "pi_renewed")

    CoursePurchaseFulfillment.fulfill!(session)

    assert enrollment.reload.active?
    assert_in_delta 12.months.from_now.to_i, enrollment.access_expires_at.to_i, 5
    assert_nil enrollment.first_opened_at
    assert_nil enrollment.support_expires_at
  end

  test "an individual lesson assignment opens a self-paced lesson without a module assignment" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    enrollment.lesson_assignments.create!(lesson: @lesson, unlocked: true)

    as_user(@student) { get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers }

    assert_response :success
    assert_equal @cohort.id, JSON.parse(response.body).dig("lesson", "cohort_id")
  end

  test "self-paced weekly plan returns a library view without a dated unlock" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)

    as_user(@student) { get "/api/v1/weekly_plan", params: { cohort_id: @cohort.id }, headers: auth_headers }

    assert_response :success
    plan = JSON.parse(response.body).fetch("weekly_plan")
    assert_equal "library", plan.fetch("mode")
    assert_equal @cohort.id, plan.dig("cohort", "id")
    assert_empty plan.fetch("events")
  end

  test "course questions reach only the assigned instructor during the support window" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)
    enrollment.record_first_course_open!
    @student.update!(community_terms_version: CommunityPolicy::VERSION, community_terms_accepted_at: Time.current)
    as_user(@student) do
      post "/api/v1/direct_conversations", params: { cohort_id: @cohort.id, user_ids: [ @instructor.id ] }, headers: auth_headers, as: :json
    end
    assert_response :created
    conversation_id = JSON.parse(response.body).dig("direct_conversation", "id")
    as_user(@student) do
      post "/api/v1/direct_conversations/#{conversation_id}/messages", params: { body: "How do I use a variable?" }, headers: auth_headers, as: :json
    end
    assert_response :created

    enrollment.update!(support_expires_at: 1.minute.ago)
    as_user(@student) do
      post "/api/v1/direct_conversations/#{conversation_id}/messages", params: { body: "A second question" }, headers: auth_headers, as: :json
    end
    assert_response :forbidden
    assert_equal 1, Message.where(direct_conversation_id: conversation_id).count

    as_user(@student) do
      get "/api/v1/channels/#{@cohort.channels.first.id}", headers: auth_headers
    end
    assert_response :forbidden
  end

  test "self-paced students cannot book even when a meeting configuration exists" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    config = PrivateMeetingConfig.create!(cohort: @cohort, instructor: @instructor)
    starts_at = 2.days.from_now
    slot = config.private_meeting_slots.create!(instructor: @instructor, starts_at: starts_at, ends_at: starts_at + 1.hour)
    as_user(@student) { post "/api/v1/private_meetings", params: { slot_id: slot.id }, headers: auth_headers, as: :json }
    assert_response :unprocessable_entity
    assert_equal 0, enrollment.private_meeting_bookings.count
  end

  test "dashboard selects among a learner's courses and rejects another course" do
    other_cohort = Cohort.create!(curriculum: @curriculum, name: "Guided Python", status: :active, start_date: Date.current, course_delivery: "guided")
    Enrollment.create!(user: @student, cohort: other_cohort)
    self_paced = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    self_paced.module_assignments.create!(curriculum_module: @module, unlocked: true)
    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :success
    assert_equal @cohort.id, JSON.parse(response.body).dig("dashboard", "cohort", "id")
    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: 999_999 }, headers: auth_headers }
    assert_response :forbidden
    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: @cohort.id }, headers: auth_headers
    end
    assert_response :success
    assert_equal @cohort.id, JSON.parse(response.body).dig("lesson", "cohort_id")
    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: 999_999 }, headers: auth_headers
    end
    assert_response :forbidden

    block = @lesson.content_blocks.create!(block_type: :text, position: 0, body: "Try a variable")
    as_user(@student) do
      patch "/api/v1/progress", params: { content_block_id: block.id, status: "completed", cohort_id: 999_999 },
        headers: auth_headers, as: :json
    end
    assert_response :forbidden
    assert_nil Progress.find_by(user: @student, content_block: block)
  end

  test "weekly plan and resources follow the selected enrolled course" do
    other_cohort = Cohort.create!(curriculum: @curriculum, name: "Guided Python", status: :active,
      start_date: Date.current, course_delivery: "guided",
      settings: { "class_resources" => [ { "title" => "Guided setup", "url" => "https://example.test/guided" } ] })
    @cohort.update!(settings: { "class_resources" => [ { "title" => "Self-paced setup", "url" => "https://example.test/self-paced" } ] })
    Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    guided_enrollment = Enrollment.create!(user: @student, cohort: other_cohort)
    guided_enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)

    as_user(@student) { get "/api/v1/weekly_plan", params: { cohort_id: other_cohort.id }, headers: auth_headers }
    assert_response :success
    assert_equal other_cohort.id, JSON.parse(response.body).dig("weekly_plan", "cohort", "id")
    as_user(@student) { get "/api/v1/resources", params: { cohort_id: other_cohort.id }, headers: auth_headers }
    assert_response :success
    assert_equal [ "Guided setup" ], JSON.parse(response.body).fetch("resources").pluck("title")
    as_user(@student) { get "/api/v1/resources", params: { cohort_id: 999_999 }, headers: auth_headers }
    assert_response :forbidden
  end

  test "existing program enrollment without an expiry remains active" do
    program = Cohort.create!(curriculum: @curriculum, name: "Existing program", status: :active, start_date: Date.current)
    enrollment = Enrollment.create!(user: @student, cohort: program)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)

    assert enrollment.active?
    as_user(@student) { get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: program.id }, headers: auth_headers }
    assert_response :success
    assert_equal program.id, JSON.parse(response.body).dig("lesson", "cohort_id")
  end

  private

  def user(name, role)
    User.create!(clerk_id: "clerk_self_paced_#{name}", email: "self_paced_#{name}@example.com", first_name: name.capitalize, role: role)
  end

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
