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
      public_checkout_enabled: true, stripe_price_id: "price_test_python", public_price_cents: 14_900
    )
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @cohort.update!(support_instructor: @instructor)
    @lesson.content_blocks.create!(block_type: :text, position: 0, body: "Learn variables")
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

  test "checkout for a missing course returns not found" do
    as_user(@student) do
      post "/api/v1/course_checkouts", params: { cohort_id: 999_999 }, headers: auth_headers, as: :json
    end

    assert_response :not_found
    assert_equal "Course not found", JSON.parse(response.body).fetch("error")
  end

  test "viewing a completed self-paced course does not start instructor support" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :completed, access_expires_at: 12.months.from_now)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)

    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: auth_headers }

    assert_response :success
    assert_nil enrollment.reload.first_opened_at
    assert_nil enrollment.support_expires_at
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

  test "signed expiry clears a pending checkout but cannot downgrade a paid purchase" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, stripe_session_id: "cs_expiry")
    previous = ENV["STRIPE_WEBHOOK_SECRET"]
    ENV["STRIPE_WEBHOOK_SECRET"] = "whsec_test_expiry"
    payload = { id: "evt_expiry", object: "event", type: "checkout.session.expired", data: { object: { id: "cs_expiry", object: "checkout.session" } } }.to_json
    timestamp = Time.current
    signature = Stripe::Webhook::Signature.compute_signature(timestamp, payload, ENV["STRIPE_WEBHOOK_SECRET"])
    header = Stripe::Webhook::Signature.generate_header(timestamp, signature)
    post "/api/v1/course_checkout_webhooks", params: payload, headers: { "Stripe-Signature" => header, "CONTENT_TYPE" => "application/json" }
    assert_response :success
    assert_equal "expired", purchase.reload.status
    purchase.update!(status: "paid")
    post "/api/v1/course_checkout_webhooks", params: payload, headers: { "Stripe-Signature" => header, "CONTENT_TYPE" => "application/json" }
    assert_equal "paid", purchase.reload.status
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

  test "paid enrollment follows cohort module selection rather than adding the whole curriculum" do
    excluded = @curriculum.modules.create!(name: "Excluded", position: 1)
    @cohort.update!(content_defaults: { @module.id.to_s => { assigned: true, unlocked: false } })
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id,
      price_cents: 14_900, stripe_session_id: "cs_selected")
    session = OpenStruct.new(id: "cs_selected", client_reference_id: purchase.id.to_s, payment_status: "paid",
      currency: "usd", amount_subtotal: 14_900, payment_intent: "pi_selected")
    CoursePurchaseFulfillment.fulfill!(session)
    enrollment = Enrollment.find_by!(user: @student, cohort: @cohort)
    assert_equal [ @module.id ], enrollment.module_assignments.pluck(:module_id)
    refute enrollment.module_assignments.exists?(module_id: excluded.id)
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

  test "self-paced weekly plan returns a course overview without a dated unlock" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 12.months.from_now)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)

    as_user(@student) { get "/api/v1/weekly_plan", params: { cohort_id: @cohort.id }, headers: auth_headers }

    assert_response :success
    plan = JSON.parse(response.body).fetch("weekly_plan")
    assert_equal "self_paced", plan.fetch("mode")
    assert_equal @cohort.id, plan.dig("cohort", "id")
    assert_equal @curriculum.name, plan.fetch("course_name")
    assert_equal({ "lesson_id" => @lesson.id, "title" => @lesson.title, "module_id" => @module.id }, plan.fetch("next_lesson"))
    assert_equal "course_question", plan.dig("capabilities", "support_mode")
    assert_empty plan.fetch("redos")
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

  test "purchase status requires a student owner and maps local states without Stripe" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, stripe_session_id: "cs_owned")
    get "/api/v1/course_checkouts/#{purchase.id}/status"
    assert_response :unauthorized
    as_user(@instructor) { get "/api/v1/course_checkouts/#{purchase.id}/status", headers: auth_headers }
    assert_response :forbidden
    stranger = user("stranger", :student)
    as_user(stranger) { get "/api/v1/course_checkouts/cs_owned/status", headers: auth_headers }
    assert_response :not_found
    as_user(stranger) { get "/api/v1/course_checkouts", headers: auth_headers }
    assert_empty JSON.parse(response.body).fetch("purchases")

    { "pending" => "pending", "paid" => "failed", "expired" => "failed", "failed" => "failed", "refunded" => "refunded", "disputed" => "failed" }.each do |stored, expected|
      purchase.update!(status: stored)
      as_user(@student) { get "/api/v1/course_checkouts/#{purchase.id}/status", headers: auth_headers }
      assert_response :success
      assert_equal expected, JSON.parse(response.body).fetch("status")
      assert_equal %w[pending expired].include?(stored), JSON.parse(response.body).fetch("can_continue")
      assert_nil JSON.parse(response.body).fetch("enrollment_id")
    end
    enrollment = Enrollment.create!(user: @student, cohort: @cohort)
    purchase.update!(status: "paid")
    as_user(@student) { get "/api/v1/course_checkouts/cs_owned/status", headers: auth_headers }
    assert_equal "no-store", response.headers["Cache-Control"]
    assert_equal "fulfilled", JSON.parse(response.body).fetch("status")
    assert_equal enrollment.id, JSON.parse(response.body).fetch("enrollment_id")
    enrollment.update!(status: :dropped)
    as_user(@student) { get "/api/v1/course_checkouts/#{purchase.id}/status", headers: auth_headers }
    assert_equal "failed", JSON.parse(response.body).fetch("status")
  end

  test "unenrolled dashboard exposes only owned pending purchases and catalog visibility" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id)
    as_user(@student) { get "/api/v1/dashboard", headers: auth_headers }
    dashboard = JSON.parse(response.body).fetch("dashboard")
    assert_equal false, dashboard.fetch("enrolled")
    assert_equal true, dashboard.fetch("catalog_enabled")
    assert_equal [ purchase.id ], dashboard.fetch("pending_purchases").pluck("id")
    purchase.update!(status: "failed")
    as_user(@student) { get "/api/v1/dashboard", headers: auth_headers }
    assert_empty JSON.parse(response.body).dig("dashboard", "pending_purchases")
  end

  test "offering setup validates terms price and assigned active support instructor" do
    admin = user("admin", :admin)
    stranger = user("unassigned", :instructor)
    invalid = [ { public_price_cents: 0 }, { public_price_cents: -1 }, { stripe_price_id: "prod_wrong" },
      { self_paced_access_months: 0 }, { self_paced_support_weeks: 1.5 }, { support_instructor_id: stranger.id },
      { support_instructor_id: @student.id }, { support_instructor_id: admin.id } ]
    invalid.each do |params|
      as_user(admin) { patch "/api/v1/cohorts/#{@cohort.id}", params: params, headers: auth_headers, as: :json }
      assert_response :unprocessable_entity
    end
    as_user(@instructor) { patch "/api/v1/cohorts/#{@cohort.id}", params: { public_price_cents: 999 }, headers: auth_headers, as: :json }
    assert_response :forbidden
    @instructor.update!(archived_at: Time.current)
    @cohort.update_columns(support_instructor_id: nil)
    as_user(admin) { patch "/api/v1/cohorts/#{@cohort.id}", params: { support_instructor_id: @instructor.id }, headers: auth_headers, as: :json }
    assert_response :unprocessable_entity
  end

  test "readiness requires active curriculum content and valid support and does not enable sales" do
    assert @cohort.purchase_ready?
    @lesson.archive!
    assert_not @cohort.purchase_ready?
    assert_not @cohort.offering_readiness.fetch(:published_content)
    @lesson.restore!
    @cohort.cohort_instructor_assignments.destroy_all
    assert_not @cohort.purchase_ready?
    fresh = Cohort.create!(curriculum: @curriculum, name: "Draft offering", start_date: Date.current, course_delivery: "self_paced")
    assert_not fresh.public_checkout_enabled?
  end

  test "changing offering defaults preserves purchased terms before payment and first open" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, price_cents: 14_900, stripe_session_id: "cs_terms")
    @cohort.update!(self_paced_access_months: 2, self_paced_support_weeks: 1)
    CoursePurchaseFulfillment.fulfill!(OpenStruct.new(id: "cs_terms", client_reference_id: purchase.id.to_s, payment_status: "paid", currency: "usd", amount_subtotal: 14_900, payment_intent: "pi_terms"))
    enrollment = @student.enrollments.sole
    assert_in_delta 12.months.from_now.to_i, enrollment.access_expires_at.to_i, 5
    enrollment.record_first_course_open!
    assert_in_delta 6.weeks.from_now.to_i, enrollment.support_expires_at.to_i, 5
    dates = enrollment.attributes.slice("access_expires_at", "support_expires_at")
    @cohort.update!(self_paced_access_months: 3, self_paced_support_weeks: 2)
    assert_equal dates, enrollment.reload.attributes.slice("access_expires_at", "support_expires_at")
  end

  test "legacy null snapshots catch up during fulfillment and remain stable" do
    purchase = purchase_record
    purchase.update_columns(access_months: nil, support_weeks: nil)
    @cohort.update!(self_paced_access_months: 4, self_paced_support_weeks: 3)
    session = OpenStruct.new(id: purchase.stripe_session_id, client_reference_id: purchase.id.to_s, payment_status: "paid", currency: "usd", amount_subtotal: 14_900, payment_intent: "pi_test")
    CoursePurchaseFulfillment.fulfill!(session)
    assert_equal [ 4, 3 ], purchase.reload.attributes.values_at("access_months", "support_weeks")
    enrollment = @student.enrollments.sole
    assert_in_delta 4.months.from_now.to_i, enrollment.access_expires_at.to_i, 5
    @cohort.update!(self_paced_access_months: 1, self_paced_support_weeks: 1)
    CoursePurchaseFulfillment.fulfill!(session)
    assert_equal 3, enrollment.reload.self_paced_support_weeks
    assert_equal 4, purchase.reload.access_months
  end

  test "legacy null terms permit refund dispute failure and expiry updates with catch-up" do
    purchase = purchase_record
    %w[refunded disputed failed expired].each do |status|
      purchase.update_columns(access_months: nil, support_weeks: nil)
      purchase.update!(status: status)
      assert_equal status, purchase.reload.status
      assert_equal [ 12, 6 ], purchase.attributes.values_at("access_months", "support_weeks")
    end
  end

  test "legacy enrollment support catches up without changing absolute dates" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 4.months.from_now)
    enrollment.update_columns(self_paced_support_weeks: nil)
    @cohort.update!(self_paced_support_weeks: 2)
    enrollment.record_first_course_open!
    assert_equal 2, enrollment.reload.self_paced_support_weeks
    dates = enrollment.attributes.slice("access_expires_at", "first_opened_at", "support_expires_at")
    @cohort.update!(self_paced_support_weeks: 1)
    enrollment.record_first_course_open!
    assert_equal dates, enrollment.reload.attributes.slice(*dates.keys)
    assert_equal 2, enrollment.self_paced_support_weeks
  end

  test "failed and confirmed expired attempts renew current price and terms" do
    purchase = purchase_record
    %w[failed expired].each do |status|
      purchase.update!(status: status, stripe_session_id: "cs_old", checkout_url: nil, checkout_expires_at: nil)
      @cohort.update!(stripe_price_id: "price_new_#{status}", public_price_cents: 19_900, self_paced_access_months: 3, self_paced_support_weeks: 2)
      with_checkout_client do |_sessions, requests|
        CourseCheckout.start!(user: @student, cohort: @cohort)
        assert_equal [ 3, 2, 19_900, "price_new_#{status}" ], purchase.reload.attributes.values_at("access_months", "support_weeks", "price_cents", "stripe_price_id")
        assert_equal "price_new_#{status}", requests.sole.first.dig(:line_items, 0, :price)
      end
    end
  end

  test "open attempt preserves URL and agreed terms after offering edits" do
    purchase = purchase_record
    purchase.update!(checkout_url: "https://checkout.stripe.test/open", checkout_expires_at: 1.hour.from_now)
    @cohort.update!(stripe_price_id: "price_new", self_paced_access_months: 3, self_paced_support_weeks: 2)
    with_checkout_client do |sessions, requests|
      sessions.define_singleton_method(:retrieve) { |_id| OpenStruct.new(status: "open", payment_status: "unpaid", url: purchase.checkout_url) }
      assert_equal purchase.checkout_url, CourseCheckout.start!(user: @student, cohort: @cohort)
      assert_empty requests
      assert_equal [ 12, 6 ], purchase.reload.attributes.values_at("access_months", "support_weeks")
    end
  end

  test "signed in canceled checkout continues the same open session without a new attempt" do
    purchase = purchase_record
    purchase.update!(checkout_url: "https://checkout.stripe.test/open", checkout_expires_at: 1.hour.from_now,
      checkout_attempt: { key: "original-attempt" })
    before = purchase.attributes
    with_checkout_client do |sessions, requests|
      sessions.define_singleton_method(:retrieve) do |id|
        raise "wrong session" unless id == "cs_test"
        OpenStruct.new(status: "open", payment_status: "unpaid", url: purchase.checkout_url)
      end
      assert local_status(purchase).fetch("can_continue")
      as_user(@student) { post "/api/v1/course_checkouts", params: { cohort_id: @cohort.id }, headers: auth_headers, as: :json }
      assert_response :success
      assert_equal purchase.checkout_url, JSON.parse(response.body).fetch("url")
      assert_empty requests
      assert_equal before, purchase.reload.attributes
    end
  end

  test "continue checkout renews an expired session even when the cached URL has not expired" do
    purchase = purchase_record
    purchase.update!(checkout_url: "https://checkout.stripe.test/stale", checkout_expires_at: 1.hour.from_now,
      checkout_attempt: { key: "original-attempt" })
    with_checkout_client do |_sessions, requests|
      as_user(@student) { post "/api/v1/course_checkouts", params: { cohort_id: @cohort.id }, headers: auth_headers, as: :json }
      assert_response :success
      assert_equal "https://checkout.stripe.test/new", JSON.parse(response.body).fetch("url")
      assert_equal "cs_new", purchase.reload.stripe_session_id
      assert_not_equal "original-attempt", purchase.checkout_attempt.fetch("key")
      assert_equal 1, requests.size
      assert_equal 1, @student.course_purchases.count
    end
  end

  test "expired purchases remain discoverable for server checked renewal" do
    purchase = purchase_record
    purchase.update!(status: "expired", checkout_url: nil, checkout_expires_at: nil)
    as_user(@student) { get "/api/v1/course_checkouts", headers: auth_headers }
    assert_response :success
    assert_equal [ purchase.id ], JSON.parse(response.body).fetch("purchases").pluck("id")
    assert local_status(purchase).fetch("can_continue")
  end

  test "continue never replaces a completed or paid session while webhook confirmation is pending" do
    purchase = purchase_record
    purchase.update!(checkout_url: "https://checkout.stripe.test/old", checkout_expires_at: 1.hour.from_now)
    with_checkout_client do |sessions, requests|
      [ [ "complete", "unpaid" ], [ "complete", "paid" ] ].each do |status, payment_status|
        sessions.define_singleton_method(:retrieve) { |_id| OpenStruct.new(status: status, payment_status: payment_status) }
        as_user(@student) { post "/api/v1/course_checkouts", params: { cohort_id: @cohort.id }, headers: auth_headers, as: :json }
        assert_response :unprocessable_entity
        assert_equal "cs_test", purchase.reload.stripe_session_id
      end
      assert_empty requests
    end
  end

  test "definitive price setup failure is retryable and never pending payment" do
    with_checkout_client(price_amount: 1) do |_sessions, requests|
      assert_raises(CourseCheckout::Unavailable) { CourseCheckout.start!(user: @student, cohort: @cohort) }
      purchase = @student.course_purchases.sole
      assert_empty requests
      assert_equal "setup_failed", local_status(purchase).fetch("status")
      as_user(@student) { get "/api/v1/course_checkouts", headers: auth_headers }
      assert_empty JSON.parse(response.body).fetch("purchases")
    end
    with_checkout_client do
      assert_equal "https://checkout.stripe.test/new", CourseCheckout.start!(user: @student, cohort: @cohort)
      assert_equal "cs_new", @student.course_purchases.sole.stripe_session_id
    end
  end

  test "renewal price setup failure clears only the confirmed expired session" do
    purchase = purchase_record
    with_checkout_client(price_amount: 1) do
      assert_raises(CourseCheckout::Unavailable) { CourseCheckout.start!(user: @student, cohort: @cohort) }
      assert_equal "setup_failed", local_status(purchase).fetch("status")
      assert_nil purchase.reload.stripe_session_id
    end
  end

  test "legacy session-less pending purchase requires reconciliation without creating a session" do
    purchase = purchase_record
    purchase.update!(stripe_session_id: nil)
    with_checkout_client do |_sessions, requests|
      assert_raises(CourseCheckout::Unavailable) { CourseCheckout.start!(user: @student, cohort: @cohort) }
      assert_equal "starting", local_status(purchase).fetch("status")
      assert_equal false, local_status(purchase).fetch("can_resume")
      assert_empty requests
      assert_equal "pending", purchase.reload.status
    end
  end

  test "uncertain creation persists attempt and resumes the identical request" do
    with_checkout_client do |sessions, requests|
      calls = 0
      sessions.define_singleton_method(:create) do |params, opts|
        requests << [ params, opts ]
        calls += 1
        raise Stripe::APIConnectionError, "timeout after send" if calls == 1
        OpenStruct.new(id: "cs_resumed", url: "https://checkout.stripe.test/resumed", expires_at: 1.hour.from_now.to_i)
      end
      assert_raises(Stripe::APIConnectionError) { CourseCheckout.start!(user: @student, cohort: @cohort) }
      purchase = @student.course_purchases.sole
      result = local_status(purchase)
      assert_equal "starting", result.fetch("status")
      assert_equal true, result.fetch("can_resume")
      assert purchase.reload.checkout_attempt.present?
      @cohort.update!(stripe_price_id: "price_changed", public_price_cents: 29_900, self_paced_access_months: 1)
      @student.update!(email: "changed@example.test")
      assert_equal "https://checkout.stripe.test/resumed", CourseCheckout.start!(user: @student, cohort: @cohort)
      assert_equal requests.first, requests.last
      assert_equal 12, purchase.reload.access_months
    end
  end

  test "uncertain request outside idempotency window requires reconciliation" do
    with_checkout_client do |sessions, requests|
      sessions.define_singleton_method(:create) { |_params, _opts| raise Stripe::APIConnectionError, "timeout" }
      assert_raises(Stripe::APIConnectionError) { CourseCheckout.start!(user: @student, cohort: @cohort) }
      travel 25.hours do
        assert_raises(CourseCheckout::Unavailable) { CourseCheckout.start!(user: @student, cohort: @cohort) }
        assert_equal false, local_status(@student.course_purchases.sole).fetch("can_resume")
      end
      assert_empty requests
    end
  end

  test "readiness requires content in an assigned module" do
    @cohort.update!(content_defaults: {})
    assert_not @cohort.offering_readiness.fetch(:published_content)
    empty = @curriculum.modules.create!(name: "Empty selected", position: 1)
    @cohort.update!(content_defaults: { empty.id.to_s => { assigned: true }, @module.id.to_s => { assigned: false } })
    assert_not @cohort.offering_readiness.fetch(:published_content)
    @cohort.update!(content_defaults: { @module.id.to_s => { assigned: true } })
    assert @cohort.offering_readiness.fetch(:published_content)
    @lesson.archive!
    assert_not @cohort.offering_readiness.fetch(:published_content)
  end

  test "admin creates hidden self-paced cohort then configures offering readiness" do
    admin = user("creator", :admin)
    params = { name: "New self-paced", curriculum_id: @curriculum.id, start_date: Date.current, course_delivery: "self_paced", status: "active" }
    as_user(@instructor) { post "/api/v1/cohorts", params: params, headers: auth_headers, as: :json }
    assert_response :forbidden
    as_user(admin) { post "/api/v1/cohorts", params: params, headers: auth_headers, as: :json }
    assert_response :created
    fresh = Cohort.find(JSON.parse(response.body).dig("cohort", "id"))
    assert_not fresh.public_checkout_enabled?
    assert_not fresh.purchase_ready?
    fresh.cohort_instructor_assignments.create!(user: @instructor)
    as_user(admin) { patch "/api/v1/cohorts/#{fresh.id}", params: { stripe_price_id: "price_configured", public_price_cents: 14_900, support_instructor_id: @instructor.id, self_paced_access_months: 4, self_paced_support_weeks: 2 }, headers: auth_headers, as: :json }
    assert_response :success
    assert JSON.parse(response.body).dig("cohort", "offering_readiness").values.all?
    assert_not fresh.reload.public_checkout_enabled?
  end

  test "expiry rechecks session under lock before clearing replacement" do
    purchase = purchase_record
    original = CoursePurchase.method(:find_by)
    purchase.define_singleton_method(:with_lock) do |&block|
      CoursePurchase.where(id: id).update_all(stripe_session_id: "cs_replacement")
      super(&block)
    end
    CoursePurchase.define_singleton_method(:find_by) { |*args| args == [ { stripe_session_id: "cs_test" } ] ? purchase : original.call(*args) }
    previous = ENV["STRIPE_WEBHOOK_SECRET"]
    ENV["STRIPE_WEBHOOK_SECRET"] = "whsec_race"
    payload = { id: "evt_race", object: "event", type: "checkout.session.expired", data: { object: { id: "cs_test", object: "checkout.session" } } }.to_json
    timestamp = Time.current
    signature = Stripe::Webhook::Signature.compute_signature(timestamp, payload, ENV.fetch("STRIPE_WEBHOOK_SECRET"))
    post "/api/v1/course_checkout_webhooks", params: payload, headers: { "Stripe-Signature" => Stripe::Webhook::Signature.generate_header(timestamp, signature), "CONTENT_TYPE" => "application/json" }
    assert_response :success
    assert_equal "pending", purchase.reload.status
    assert_equal "cs_replacement", purchase.stripe_session_id
  ensure
    CoursePurchase.define_singleton_method(:find_by, original) if original
    ENV["STRIPE_WEBHOOK_SECRET"] = previous
  end

  private

  def purchase_record
    CoursePurchase.create!(user: @student, cohort: @cohort, stripe_price_id: @cohort.stripe_price_id, price_cents: 14_900, stripe_session_id: "cs_test")
  end

  def local_status(purchase)
    as_user(@student) { get "/api/v1/course_checkouts/#{purchase.id}/status", headers: auth_headers }
    assert_response :success
    JSON.parse(response.body)
  end

  def with_checkout_client(price_amount: nil)
    requests = []
    cohort = @cohort
    prices = Object.new
    prices.define_singleton_method(:retrieve) { |_id| OpenStruct.new(active: true, currency: "usd", unit_amount: price_amount || cohort.public_price_cents, type: "one_time") }
    sessions = Object.new
    sessions.define_singleton_method(:retrieve) { |_id| OpenStruct.new(status: "expired", payment_status: "unpaid") }
    sessions.define_singleton_method(:create) do |params, opts|
      requests << [ params, opts ]
      OpenStruct.new(id: "cs_new", url: "https://checkout.stripe.test/new", expires_at: 1.day.from_now.to_i)
    end
    original_client = CourseCheckout.method(:client)
    original_enabled = CourseCheckout.method(:enabled?)
    previous = ENV["FRONTEND_URL"]
    ENV["FRONTEND_URL"] = "https://learn.example.test"
    CourseCheckout.define_singleton_method(:client) { OpenStruct.new(v1: OpenStruct.new(prices: prices, checkout: OpenStruct.new(sessions: sessions))) }
    CourseCheckout.define_singleton_method(:enabled?) { true }
    yield sessions, requests
  ensure
    CourseCheckout.define_singleton_method(:client, original_client) if original_client
    CourseCheckout.define_singleton_method(:enabled?, original_enabled) if original_enabled
    ENV["FRONTEND_URL"] = previous
  end
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
