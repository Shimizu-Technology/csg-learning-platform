require "test_helper"
require "ostruct"
require_relative "../support/offering_price_test_support"

class GuidedCheckoutSeatCapTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper
  include OfferingPriceTestSupport

  ZONE = Time.find_zone!(LearningCalendar::TIMEZONE)
  NOW = ZONE.local(2026, 11, 22, 10)

  setup do
    travel_to NOW
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @learner_a = person("learner_a", :student)
    @learner_b = person("learner_b", :student)
    @learner_c = person("learner_c", :student)

    @curriculum = Curriculum.create!(name: "Python Guided Pilot", status: :active)
    @mod = @curriculum.modules.create!(name: "Week 1", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = @mod.lessons.create!(title: "Variables", position: 0, release_day: 0, lesson_type: :exercise, required: true)
    @block = @lesson.content_blocks.create!(block_type: :exercise, title: "Variables practice", position: 0, submission_type: :text_submission)

    @guided = Cohort.create!(
      curriculum: @curriculum,
      name: "Python Pilot (Guided)",
      start_date: Date.new(2026, 11, 22),
      status: :active,
      cohort_type: :workshop,
      course_delivery: "guided",
      public_title: "Python Fundamentals",
      public_description: "Small-class Python with weekly check-ins.",
      public_image_url: "https://example.test/python.png",
      public_price_cents: 14_900,
      stripe_price_id: "price_guided_python",
      guided_access_months: 12,
      guided_support_weeks: 8,
      seat_limit: 2,
      unlisted: true,
      public_checkout_enabled: true
    )
    @guided.cohort_instructor_assignments.create!(user: @instructor)
    @guided.update!(support_instructor: @instructor)
    stamp_verified_offering_price(@guided)

    @program = Cohort.create!(
      curriculum: @curriculum,
      name: "Cohort 3",
      start_date: Date.new(2026, 10, 5),
      status: :active,
      cohort_type: :bootcamp,
      course_delivery: "program",
      public_title: "Live Bootcamp",
      public_price_cents: 14_900,
      stripe_price_id: "price_program_blocked"
    )
    @program.cohort_instructor_assignments.create!(user: @instructor)
    @program.update!(support_instructor: @instructor)
  end

  teardown { travel_back }

  test "guided cohort is purchase-ready while program and alumni cohorts stay strictly excluded" do
    assert @guided.purchase_ready?
    assert_not @program.purchase_ready?

    @program.public_checkout_enabled = true
    assert_not @program.valid?
    assert_includes @program.errors[:public_checkout_enabled], "requires a guided or self-paced course"

    @program.reload
    @program.seat_limit = 10
    assert_not @program.valid?
    assert_includes @program.errors[:seat_limit], "is only for guided or self-paced courses"

    @program.reload
    @program.unlisted = true
    assert_not @program.valid?
    assert_includes @program.errors[:unlisted], "is only for guided or self-paced courses"

    alumni = Cohort.create!(curriculum: @curriculum, name: "Alumni Library", cohort_type: :alumni, course_delivery: "guided", start_date: Date.new(2026, 1, 5), status: :active)
    alumni.public_checkout_enabled = true
    assert_not alumni.valid?
    assert_not alumni.purchase_ready?

    with_checkout_client(cohort: @program) do
      as_user(@learner_a) { post "/api/v1/course_checkouts", params: { cohort_id: @program.id }, headers: auth_headers, as: :json }
      assert_response :unprocessable_entity
    end

    # Even if a forged purchase existed for a program cohort, fulfillment refuses it.
    program_purchase = CoursePurchase.create!(user: @learner_a, cohort: @program, stripe_price_id: "price_program_blocked", price_cents: 14_900, stripe_session_id: "cs_program")
    session = paid_session("cs_program", program_purchase)
    assert_raises(RuntimeError) { CoursePurchaseFulfillment.fulfill!(session) }
    assert_nil Enrollment.find_by(user: @learner_a, cohort: @program)
  end

  test "unlisted guided cohort hides from public catalog list, sends X-Robots-Tag noindex, and works via direct slug URL without leaking PII" do
    Enrollment.create!(user: @learner_a, cohort: @guided, status: :active)

    get "/api/v1/course_offerings"
    assert_response :success
    assert_empty response.parsed_body.fetch("offerings")

    as_user(@learner_b) { get "/api/v1/dashboard", headers: auth_headers }
    assert_response :success
    assert_equal false, response.parsed_body.dig("dashboard", "catalog_enabled")

    get "/api/v1/course_offerings/#{@guided.public_slug}"
    assert_response :success
    assert_equal "noindex, nofollow", response.headers["X-Robots-Tag"]
    offering = response.parsed_body.fetch("offering")
    assert_equal "guided", offering.fetch("course_delivery")
    assert_equal true, offering.fetch("unlisted")
    assert_equal 2, offering.fetch("seat_limit")
    assert_equal 1, offering.fetch("seats_taken")
    assert_equal 1, offering.fetch("seats_remaining")
    assert_equal false, offering.fetch("sold_out")
    assert_equal 12, offering.fetch("access_months")
    assert_equal 8, offering.fetch("instructor_message_weeks")
    assert_nil offering.fetch("guided_access_ends_on")
    assert_nil offering.fetch("guided_support_ends_on")
    assert_equal "2026-11-22", offering.fetch("start_date")
    refute_includes response.body, @learner_a.email
    refute_includes response.body, @learner_a.full_name

    # Program cohort is never accessible via slug even with a public_title.
    get "/api/v1/course_offerings/#{@program.public_slug}"
    assert_response :not_found

    # Turning unlisted off lists the guided cohort in the public catalog and drops X-Robots-Tag.
    @guided.update!(unlisted: false)
    get "/api/v1/course_offerings"
    assert_response :success
    assert_equal [ @guided.id ], response.parsed_body.fetch("offerings").pluck("id")

    get "/api/v1/course_offerings/#{@guided.public_slug}"
    assert_response :success
    assert_nil response.headers["X-Robots-Tag"]

    # Listed public courses also preserve /courses/:slug on Stripe success and cancel URLs.
    with_checkout_client(cohort: @guided, session_id: "cs_listed_slug") do |_sessions, requests|
      as_user(@learner_b) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
      assert_response :success
      params = requests.sole.first
      assert_includes params.fetch(:success_url), "/courses/#{@guided.public_slug}?checkout=return"
      assert_includes params.fetch(:cancel_url), "/courses/#{@guided.public_slug}?checkout=canceled"
    end
  end

  test "guided checkout fulfills relative terms and fixed dates accurately, supports real repurchase via POST, and protects renewal from older refunds" do
    # 1) Relative terms on an already-started cohort anchor to today so full purchased window applies.
    with_checkout_client(cohort: @guided, session_id: "cs_initial") do |_sessions, requests|
      as_user(@learner_a) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
      assert_response :success
      # Unlisted guided cohort redirects back to its direct slug page.
      params = requests.sole.first
      assert_includes params.fetch(:success_url), "/courses/#{@guided.public_slug}?checkout=return"
      assert_includes params.fetch(:cancel_url), "/courses/#{@guided.public_slug}?checkout=canceled"
    end

    first_purchase = CoursePurchase.find_by!(user: @learner_a, cohort: @guided)
    assert_equal [ 12, 8 ], [ first_purchase.access_months, first_purchase.support_weeks ]
    assert_equal "guided", first_purchase.terms_snapshot.fetch("course_delivery")
    session = paid_session(first_purchase.stripe_session_id, first_purchase, intent: "pi_initial")

    perform_enqueued_jobs(only: AdminAlertJob) do
      CoursePurchaseFulfillment.fulfill!(session)
      # Duplicate webhook replay is idempotent.
      CoursePurchaseFulfillment.fulfill!(session)
    end

    as_user(@learner_a) { get "/api/v1/course_checkouts/#{first_purchase.id}/status", headers: auth_headers }
    assert_response :success
    status_body = response.parsed_body
    assert_equal "fulfilled", status_body.fetch("status")
    assert_equal @guided.public_slug, status_body.dig("cohort", "slug")
    assert_equal true, status_body.dig("cohort", "unlisted")

    enrollment = Enrollment.find_by!(user: @learner_a, cohort: @guided)
    assert enrollment.active?
    assert_equal 1, Notification.course_purchase.where(notifiable: first_purchase, user: @admin).count
    assert_equal ZONE.local(2027, 11, 23), enrollment.access_expires_at
    assert_equal ZONE.local(2027, 1, 18), enrollment.support_expires_at
    assert_nil enrollment.first_opened_at
    assert_equal [ @mod.id ], enrollment.module_assignments.pluck(:module_id)

    # 2) Repurchase through real POST /api/v1/course_checkouts after drop/expiry:
    #    - creates a NEW CoursePurchase row preserving the old paid receipt & Stripe IDs
    #    - recalculates relative terms freshly (including updating a stale past starts_on)
    #    - preserves both prior graded submissions and first_opened_at.
    @guided.update!(learner_pace_weeks: [ 4, 6 ])
    opened = ZONE.local(2026, 11, 22, 11)
    enrollment.update!(
      status: :dropped,
      starts_on: Date.new(2025, 1, 1),
      first_opened_at: opened,
      access_expires_at: 1.day.ago,
      support_expires_at: 2.days.ago
    )
    submission = Submission.create!(user: @learner_a, enrollment: enrollment, content_block: @block, submission_type: :text_submission, text: "My graded work", grade: "A", graded_by_id: @instructor.id, graded_at: NOW)

    travel 5.days do
      with_checkout_client(cohort: @guided, session_id: "cs_repurchase") do
        as_user(@learner_a) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
        assert_response :success
      end

      purchases = CoursePurchase.where(user: @learner_a, cohort: @guided).order(:id).to_a
      assert_equal 2, purchases.size
      assert_equal first_purchase.id, purchases.first.id
      assert_equal "paid", purchases.first.status
      assert_equal "cs_initial", purchases.first.stripe_session_id
      assert_equal "pi_initial", purchases.first.stripe_payment_intent_id

      second_purchase = purchases.last
      assert_equal "pending", second_purchase.status
      assert_equal "cs_repurchase", second_purchase.stripe_session_id

      CoursePurchaseFulfillment.fulfill!(paid_session("cs_repurchase", second_purchase, intent: "pi_repurchase"))
      enrollment.reload
      assert enrollment.active?
      assert_equal Date.new(2026, 11, 27), enrollment.starts_on
      assert_equal opened, enrollment.first_opened_at
      assert_equal ZONE.local(2027, 11, 28), enrollment.access_expires_at
      assert_equal ZONE.local(2027, 1, 23), enrollment.support_expires_at
      assert_equal "A", submission.reload.grade

      # Delayed refund webhook for the OLD purchase must NOT drop the renewed enrollment!
      with_payment_intent_client(purchase: first_purchase) do
        CoursePurchaseFulfillment.revoke!(payment_intent_id: "pi_initial", status: "refunded")
      end
      assert_equal "refunded", first_purchase.reload.status
      assert_equal "paid", second_purchase.reload.status
      assert enrollment.reload.active?, "Refunding an older purchase must never drop a renewed active enrollment"
    end

    # 3) Fixed guided cohort dates take precedence over relative durations.
    fixed_cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Fixed Guided",
      start_date: Date.new(2026, 12, 1),
      status: :active,
      cohort_type: :workshop,
      course_delivery: "guided",
      public_title: "Fixed Python",
      public_price_cents: 14_900,
      stripe_price_id: "price_fixed_python",
      guided_access_ends_on: Date.new(2027, 6, 30),
      guided_support_ends_on: Date.new(2027, 4, 30),
      guided_access_months: 12,
      guided_support_weeks: 8,
      public_checkout_enabled: true
    )
    fixed_cohort.cohort_instructor_assignments.create!(user: @instructor)
    fixed_cohort.update!(support_instructor: @instructor)
    stamp_verified_offering_price(fixed_cohort)

    fixed_purchase = CoursePurchase.create!(user: @learner_b, cohort: fixed_cohort, stripe_price_id: "price_fixed_python", price_cents: 14_900, stripe_session_id: "cs_fixed")
    assert_nil fixed_purchase.access_months
    assert_nil fixed_purchase.support_weeks
    CoursePurchaseFulfillment.fulfill!(paid_session("cs_fixed", fixed_purchase, intent: "pi_fixed"))
    fixed_enrollment = Enrollment.find_by!(user: @learner_b, cohort: fixed_cohort)
    assert_equal ZONE.local(2027, 7, 1), fixed_enrollment.access_expires_at
    assert_equal ZONE.local(2027, 5, 1), fixed_enrollment.support_expires_at
  end

  test "concurrent admin price edit between Stripe verification and lock rejects checkout with 409 before creating a Stripe session" do
    seen_price_ids = []
    guided_id = @guided.id
    with_checkout_client(cohort: @guided, session_id: "cs_should_not_exist") do |_sessions, requests, prices|
      prices.define_singleton_method(:retrieve) do |price_id|
        seen_price_ids << price_id
        # Simulate an admin editing price while Stripe price verification is in flight.
        Cohort.where(id: guided_id).update_all(stripe_price_id: "price_guided_new", public_price_cents: 19_900)
        OpenStruct.new(active: true, currency: "usd", unit_amount: 14_900, type: "one_time")
      end

      as_user(@learner_a) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
      assert_response :conflict
      assert_equal "price_changed", response.parsed_body.fetch("code")
      assert_empty requests
    end

    assert_equal [ "price_guided_python" ], seen_price_ids

    purchase = CoursePurchase.find_by!(user: @learner_a, cohort: @guided)
    assert_equal "failed", purchase.status
    assert_nil purchase.stripe_session_id
    assert_equal 0, @guided.reload.seats_taken
  end

  test "switching cohort to program or alumni is blocked while open checkout sessions exist, while turning off sales lets issued sessions settle" do
    with_checkout_client(cohort: @guided, session_id: "cs_open_session", expires_at: 1.hour.from_now) do
      as_user(@learner_a) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
      assert_response :success
    end
    purchase = CoursePurchase.find_by!(user: @learner_a, cohort: @guided)

    # Admin cannot switch delivery to program or cohort_type to alumni while open checkout exists.
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@guided.id}",
        params: { course_delivery: "program", public_checkout_enabled: false, seat_limit: nil, unlisted: false },
        headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      assert_match(/open checkout sessions/i, response.parsed_body.fetch("errors").join(" "))

      patch "/api/v1/cohorts/#{@guided.id}",
        params: { cohort_type: "alumni", public_checkout_enabled: false, seat_limit: nil, unlisted: false },
        headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      assert_match(/open checkout sessions/i, response.parsed_body.fetch("errors").join(" "))

      # Turning public_checkout_enabled off IS allowed, and the already-issued session still settles cleanly!
      patch "/api/v1/cohorts/#{@guided.id}", params: { public_checkout_enabled: false }, headers: auth_headers, as: :json
      assert_response :success
    end

    assert_not @guided.reload.public_checkout_enabled?
    CoursePurchaseFulfillment.fulfill!(paid_session("cs_open_session", purchase, intent: "pi_after_sales_off"))
    assert_equal "paid", purchase.reload.status
    assert Enrollment.find_by!(user: @learner_a, cohort: @guided).active?
  end

  test "past fixed guided access refuses new checkout, mid-checkout term edits do not corrupt in-flight purchases, and delayed settlement alerts admins" do
    past_fixed = Cohort.create!(
      curriculum: @curriculum,
      name: "Past Fixed Guided",
      start_date: Date.new(2026, 10, 1),
      status: :active,
      cohort_type: :workshop,
      course_delivery: "guided",
      public_title: "Past Python",
      public_price_cents: 14_900,
      stripe_price_id: "price_past_fixed",
      guided_access_ends_on: Date.new(2026, 11, 21),
      public_checkout_enabled: true
    )
    past_fixed.cohort_instructor_assignments.create!(user: @instructor)
    past_fixed.update!(support_instructor: @instructor)
    stamp_verified_offering_price(past_fixed)

    assert_not past_fixed.purchase_ready?
    with_checkout_client(cohort: past_fixed) do |_sessions, requests|
      as_user(@learner_a) { post "/api/v1/course_checkouts", params: { cohort_id: past_fixed.id }, headers: auth_headers, as: :json }
      assert_response :unprocessable_entity
      assert_empty requests
    end

    # Mid-checkout term edits must not alter the snapshotted terms of an in-flight purchase.
    with_checkout_client(cohort: @guided, session_id: "cs_mid_edit") do
      as_user(@learner_a) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
      assert_response :success
    end
    purchase = CoursePurchase.find_by!(user: @learner_a, cohort: @guided)
    @guided.update!(guided_access_months: 1, guided_support_weeks: 1)

    CoursePurchaseFulfillment.fulfill!(paid_session("cs_mid_edit", purchase, intent: "pi_mid_edit"))
    enrollment = Enrollment.find_by!(user: @learner_a, cohort: @guided)
    assert_equal ZONE.local(2027, 11, 23), enrollment.access_expires_at
    assert_equal ZONE.local(2027, 1, 18), enrollment.support_expires_at

    # Pre-upgrade self-paced purchase with empty terms_snapshot preserves its own saved access_months/support_weeks
    # even if staff later shorten the cohort's current defaults before settlement.
    self_paced = Cohort.create!(
      curriculum: @curriculum,
      name: "Legacy Self-Paced",
      start_date: Date.new(2026, 11, 1),
      status: :active,
      cohort_type: :workshop,
      course_delivery: "self_paced",
      public_title: "Legacy Python",
      public_price_cents: 14_900,
      stripe_price_id: "price_legacy_sp",
      self_paced_access_months: 12,
      self_paced_support_weeks: 8,
      public_checkout_enabled: true
    )
    self_paced.cohort_instructor_assignments.create!(user: @instructor)
    self_paced.update!(support_instructor: @instructor)
    stamp_verified_offering_price(self_paced)
    legacy_purchase = CoursePurchase.create!(
      user: @learner_c,
      cohort: self_paced,
      stripe_price_id: "price_legacy_sp",
      price_cents: 14_900,
      stripe_session_id: "cs_legacy_sp",
      access_months: 12,
      support_weeks: 8
    )
    legacy_purchase.update_columns(terms_snapshot: {})
    self_paced.update!(self_paced_access_months: 1, self_paced_support_weeks: 1)

    CoursePurchaseFulfillment.fulfill!(paid_session("cs_legacy_sp", legacy_purchase, intent: "pi_legacy_sp"))
    legacy_enrollment = Enrollment.find_by!(user: @learner_c, cohort: self_paced)
    assert_in_delta (NOW + 12.months).to_i, legacy_enrollment.access_expires_at.to_i, 5
    assert_equal 8, legacy_enrollment.self_paced_support_weeks
    assert_equal 12, legacy_purchase.reload.terms_snapshot.fetch("access_months")
    assert_equal 8, legacy_purchase.terms_snapshot.fetch("support_weeks")

    # Guided checkout started with open-ended (nil) cutoffs keeps nil cutoffs on first-time enrollment creation
    # even if staff add fixed cutoffs to the cohort before the webhook settles.
    open_ended = Cohort.create!(
      curriculum: @curriculum,
      name: "Open-Ended Guided",
      start_date: Date.new(2026, 11, 1),
      status: :active,
      cohort_type: :workshop,
      course_delivery: "guided",
      public_title: "Open Guided Python",
      public_price_cents: 14_900,
      stripe_price_id: "price_open_guided",
      public_checkout_enabled: true
    )
    open_ended.cohort_instructor_assignments.create!(user: @instructor)
    open_ended.update!(support_instructor: @instructor)
    stamp_verified_offering_price(open_ended)

    with_checkout_client(cohort: open_ended, session_id: "cs_open_ended") do
      as_user(@learner_c) { post "/api/v1/course_checkouts", params: { cohort_id: open_ended.id }, headers: auth_headers, as: :json }
      assert_response :success
    end
    open_purchase = CoursePurchase.find_by!(user: @learner_c, cohort: open_ended)
    open_ended.update!(guided_access_ends_on: Date.new(2027, 1, 31), guided_support_ends_on: Date.new(2026, 12, 31))

    CoursePurchaseFulfillment.fulfill!(paid_session("cs_open_ended", open_purchase, intent: "pi_open_ended"))
    open_enrollment = Enrollment.find_by!(user: @learner_c, cohort: open_ended)
    assert open_enrollment.active?
    assert_nil open_enrollment.access_expires_at
    assert_nil open_enrollment.support_expires_at

    # Fixed access window that elapses between checkout start and delayed webhook settlement
    # still marks paid and persists a durable in-app admin recovery alert.
    closing_fixed = Cohort.create!(
      curriculum: @curriculum,
      name: "Closing Fixed Guided",
      start_date: Date.new(2026, 11, 1),
      status: :active,
      cohort_type: :workshop,
      course_delivery: "guided",
      public_title: "Closing Python",
      public_price_cents: 14_900,
      stripe_price_id: "price_closing_fixed",
      guided_access_ends_on: Date.new(2026, 11, 22),
      public_checkout_enabled: true
    )
    closing_fixed.cohort_instructor_assignments.create!(user: @instructor)
    closing_fixed.update!(support_instructor: @instructor)
    stamp_verified_offering_price(closing_fixed)

    with_checkout_client(cohort: closing_fixed, session_id: "cs_closing_fixed") do
      as_user(@learner_b) { post "/api/v1/course_checkouts", params: { cohort_id: closing_fixed.id }, headers: auth_headers, as: :json }
      assert_response :success
    end
    closing_purchase = CoursePurchase.find_by!(user: @learner_b, cohort: closing_fixed)

    travel 2.days do
      CoursePurchaseFulfillment.fulfill!(paid_session("cs_closing_fixed", closing_purchase, intent: "pi_closing_fixed"))
      assert_equal "paid", closing_purchase.reload.status
      assert closing_purchase.fulfilled_after_access_end?
      assert Enrollment.exists?(user: @learner_b, cohort: closing_fixed)

      notice = Notification.course_purchase.find_by!(notifiable: closing_purchase, user: @admin)
      assert_includes notice.title, "Access window ended"
      assert_includes notice.body, "Fixed access window ended before settlement"
    end
  end

  test "seat cap counts active enrollments and unexpired pending sessions, refuses 409 when full, and releases seats on expiry or full refund" do
    # Learner A is enrolled (1 of 2 seats taken).
    Enrollment.create!(user: @learner_a, cohort: @guided, status: :active)
    # Same learner also having a pending purchase does not double-count.
    CoursePurchase.create!(user: @learner_a, cohort: @guided, stripe_price_id: @guided.stripe_price_id, price_cents: 14_900, status: "pending", checkout_expires_at: 1.hour.from_now)
    assert_equal 1, @guided.seats_taken
    assert_equal 1, @guided.seats_remaining
    assert_not @guided.sold_out?

    # Learner B starts checkout -> reserves seat 2 of 2.
    with_checkout_client(cohort: @guided, session_id: "cs_seat_b", expires_at: 30.minutes.from_now) do
      as_user(@learner_b) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
      assert_response :success
    end
    assert_equal 2, @guided.seats_taken
    assert_equal 0, @guided.seats_remaining
    assert @guided.sold_out?

    # Learner C is refused with 409 cohort_full and does not hold a seat.
    with_checkout_client(cohort: @guided, session_id: "cs_seat_c") do |_sessions, requests|
      as_user(@learner_c) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
      assert_response :conflict
      assert_equal "cohort_full", response.parsed_body.fetch("code")
      assert_equal "This cohort is full", response.parsed_body.fetch("error")
      assert_empty requests
    end
    assert_equal "failed", CoursePurchase.find_by!(user: @learner_c, cohort: @guided).status

    # Learner B continuing their OWN open session is allowed (not blocked by their own seat hold).
    purchase_b = CoursePurchase.find_by!(user: @learner_b, cohort: @guided)
    with_checkout_client(cohort: @guided) do |sessions, requests|
      sessions.define_singleton_method(:retrieve) { |_id| OpenStruct.new(status: "open", payment_status: "unpaid", url: purchase_b.checkout_url) }
      as_user(@learner_b) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
      assert_response :success
      assert_equal purchase_b.checkout_url, response.parsed_body.fetch("url")
      assert_empty requests
    end

    # When Learner B's pending session expires, the seat opens immediately for Learner C.
    travel 31.minutes do
      assert_equal 1, @guided.seats_taken
      assert_not @guided.sold_out?
      with_checkout_client(cohort: @guided, session_id: "cs_seat_c_after_expiry", expires_at: 1.hour.from_now) do
        as_user(@learner_c) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
        assert_response :success
      end
      assert_equal 2, @guided.seats_taken
      assert @guided.sold_out?

      # Learner C completes payment; then a full refund drops Learner C and frees the seat.
      purchase_c = CoursePurchase.find_by!(user: @learner_c, cohort: @guided)
      CoursePurchaseFulfillment.fulfill!(paid_session("cs_seat_c_after_expiry", purchase_c, intent: "pi_refund_c"))
      assert_equal 2, @guided.seats_taken

      with_payment_intent_client(purchase: purchase_c) do
        CoursePurchaseFulfillment.revoke!(payment_intent_id: "pi_refund_c", status: "refunded")
      end

      assert_equal "dropped", Enrollment.find_by!(user: @learner_c, cohort: @guided).status
      assert_equal 1, @guided.seats_taken
      assert_equal 1, @guided.seats_remaining
      assert_not @guided.sold_out?
    end
  end

  test "over-capacity paid webhook enrolls the learner, persists durable admin notifications inside the transaction even if push raises" do
    @guided.update!(seat_limit: 1)
    # Learner A started a session earlier which expired locally.
    late_purchase = CoursePurchase.create!(
      user: @learner_a,
      cohort: @guided,
      stripe_price_id: @guided.stripe_price_id,
      price_cents: 14_900,
      status: "expired",
      stripe_session_id: "cs_late_paid"
    )
    # Learner B took the 1 available seat.
    Enrollment.create!(user: @learner_b, cohort: @guided, status: :active)
    assert @guided.sold_out?

    # Even if PushNotificationJob / downstream delivery raises, the durable in-app
    # Notification row is ALREADY persisted atomically inside the fulfillment transaction!
    original_push = WebPushNotificationService.method(:admin_alert)
    WebPushNotificationService.define_singleton_method(:admin_alert) { |_record, _notifications| raise "push gateway down" }
    begin
      CoursePurchaseFulfillment.fulfill!(paid_session("cs_late_paid", late_purchase, intent: "pi_late_paid"))
    ensure
      WebPushNotificationService.define_singleton_method(:admin_alert, original_push)
    end

    assert_equal "paid", late_purchase.reload.status
    assert late_purchase.over_capacity?
    enrollment_a = Enrollment.find_by!(user: @learner_a, cohort: @guided)
    assert enrollment_a.active?
    assert_equal 2, @guided.seats_taken
    assert_equal 0, @guided.seats_remaining
    assert @guided.sold_out?

    # Durable notification exists IMMEDIATELY on commit without running AdminAlertJob!
    notice = Notification.course_purchase.find_by!(notifiable: late_purchase, user: @admin)
    assert_includes notice.title, "Over capacity"
    assert_includes notice.title, @learner_a.full_name
    assert_includes notice.body, "Over capacity (2/1 seats)"
    assert_equal 1, Notification.course_purchase.where(notifiable: late_purchase, user: @admin).count

    # Offering detail record exposes guided offering seat capacity and over_capacity flag.
    as_user(@admin) { get "/api/v1/records/offering/#{@guided.id}/detail", headers: auth_headers }
    assert_response :success
    detail = response.parsed_body.fetch("detail")
    assert_equal [ 1, 2, 0, true, true ], detail.values_at("seat_limit", "seats_taken", "seats_remaining", "sold_out", "unlisted")
    assert_equal true, detail.fetch("purchases").first.fetch("over_capacity")
  end

  test "admin cohort API validates and serializes seat_limit and unlisted fields cleanly" do
    as_user(@admin) { get "/api/v1/cohorts/#{@guided.id}", headers: auth_headers }
    assert_response :success
    cohort = response.parsed_body.fetch("cohort")
    assert_equal [ 2, 0, 2, false, true ], cohort.values_at("seat_limit", "seats_taken", "seats_remaining", "sold_out", "unlisted")

    as_user(@admin) { patch "/api/v1/cohorts/#{@guided.id}", params: { seat_limit: 0 }, headers: auth_headers, as: :json }
    assert_response :unprocessable_entity

    as_user(@admin) { patch "/api/v1/cohorts/#{@guided.id}", params: { seat_limit: nil, unlisted: false }, headers: auth_headers, as: :json }
    assert_response :success
    updated = response.parsed_body.fetch("cohort")
    assert_nil updated.fetch("seat_limit")
    assert_nil updated.fetch("seats_remaining")
    assert_equal 0, updated.fetch("seats_taken")
    assert_equal false, updated.fetch("sold_out")
    assert_equal false, updated.fetch("unlisted")
  end

  test "blocks checkout creation until community standards are accepted" do
    @learner_a.update!(community_terms_accepted_at: nil, community_terms_version: nil)
    as_user(@learner_a) { post "/api/v1/course_checkouts", params: { cohort_id: @guided.id }, headers: auth_headers, as: :json }
    assert_response :forbidden
    assert_equal "community_terms_required", response.parsed_body["code"]
    assert_equal false, response.parsed_body.dig("community_policy", "accepted")
    assert_equal 0, CoursePurchase.where(user: @learner_a, cohort: @guided).count
  end

  private

  def person(name, role)
    User.create!(
      clerk_id: "guided_cap_#{name}",
      email: "guided-cap-#{name}@example.invalid",
      first_name: name.capitalize,
      last_name: "Tester",
      role: role,
      community_terms_accepted_at: Time.current,
      community_terms_version: CommunityPolicy::VERSION
    )
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

  def paid_session(session_id, purchase, intent: "pi_#{session_id}")
    OpenStruct.new(
      id: session_id,
      client_reference_id: purchase.id.to_s,
      payment_status: "paid",
      currency: "usd",
      amount_subtotal: purchase.price_cents,
      payment_intent: intent
    )
  end

  def with_payment_intent_client(purchase:)
    payment_intent = OpenStruct.new(metadata: { "course_purchase_id" => purchase.id.to_s }, amount: purchase.price_cents)
    intents = Object.new
    intents.define_singleton_method(:retrieve) { |_id| payment_intent }
    original_client = CourseCheckout.method(:client)
    CourseCheckout.define_singleton_method(:client) { OpenStruct.new(v1: OpenStruct.new(payment_intents: intents)) }
    yield
  ensure
    CourseCheckout.define_singleton_method(:client, original_client) if original_client
  end

  def with_checkout_client(cohort:, session_id: "cs_new", expires_at: 1.day.from_now)
    requests = []
    prices = Object.new
    prices.define_singleton_method(:retrieve) { |_id| OpenStruct.new(active: true, currency: "usd", unit_amount: cohort.public_price_cents, type: "one_time") }
    sessions = Object.new
    sessions.define_singleton_method(:retrieve) { |_id| OpenStruct.new(status: "expired", payment_status: "unpaid") }
    sessions.define_singleton_method(:create) do |params, opts|
      requests << [ params, opts ]
      OpenStruct.new(id: session_id, url: "https://checkout.stripe.test/#{session_id}", expires_at: expires_at.to_i)
    end
    original_client = CourseCheckout.method(:client)
    original_enabled = CourseCheckout.method(:enabled?)
    previous_frontend = ENV["FRONTEND_URL"]
    ENV["FRONTEND_URL"] = "https://learn.example.test"
    CourseCheckout.define_singleton_method(:client) { OpenStruct.new(v1: OpenStruct.new(prices: prices, checkout: OpenStruct.new(sessions: sessions))) }
    CourseCheckout.define_singleton_method(:enabled?) { true }
    yield sessions, requests, prices
  ensure
    CourseCheckout.define_singleton_method(:client, original_client) if original_client
    CourseCheckout.define_singleton_method(:enabled?, original_enabled) if original_enabled
    ENV["FRONTEND_URL"] = previous_frontend
  end
end
