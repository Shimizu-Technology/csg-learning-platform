require "test_helper"
require_relative "../support/query_counter"

class FirstRunStatesTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    @student = User.create!(clerk_id: "first_run_student", email: "first-run@example.invalid", role: :student)
    @curriculum = Curriculum.create!(name: "First run")
    @cohort = Cohort.create!(name: "First run", curriculum: @curriculum, start_date: LearningCalendar.today - 14, settings: { "features" => { "student_experience_v2" => true } })
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort)
  end

  test "switcher visibility matches published recordings, legacy and resources and the off payload stays unchanged" do
    get "/api/v1/cohorts/accessible", headers: headers
    assert_equal({ "recordings" => false, "resources" => false }, response.parsed_body["cohorts"].sole["available_features"])
    recording = @cohort.recordings.create!(title: "Draft", source_kind: "external", source_url: "https://example.invalid/replay", position: 0)
    assert_equal false, availability["recordings"]
    recording.update!(status: :published)
    assert_equal true, availability["recordings"]
    @cohort.update!(settings: @cohort.settings.merge("class_resources" => [ { "title" => "Guide", "url" => "https://example.invalid/guide" } ]))
    assert_equal true, availability["resources"]
    @cohort.update!(settings: @cohort.settings.merge("features" => { "student_experience_v2" => false }))
    get "/api/v1/cohorts/accessible", headers: headers
    assert_not response.parsed_body["cohorts"].sole.key?("available_features")
  end

  test "paused visibility hides material published after the read cutoff and disabled recordings" do
    @enrollment.update!(status: :paused)
    @enrollment.update_columns(paused_at: 3.days.ago)
    @cohort.recordings.create!(title: "New", source_kind: "external", source_url: "https://example.invalid/new", status: :published, position: 0)
    @cohort.update!(settings: @cohort.settings.merge("recordings" => [ { "title" => "Legacy new", "url" => "https://example.invalid/legacy", "date" => LearningCalendar.today.iso8601 } ], "class_resources" => [ { "title" => "New guide", "url" => "https://example.invalid/guide" } ]))
    assert_equal({ "recordings" => false, "resources" => false }, availability)
    @enrollment.update!(status: :active)
    assert_equal true, availability["recordings"]
    @cohort.update!(settings: @cohort.settings.merge("features" => { "student_experience_v2" => true, "recordings" => false }))
    assert_equal false, availability["recordings"]
  end

  test "switcher queries stay flat as readable cohorts and recordings grow" do
    request = -> { get "/api/v1/cohorts/accessible", headers: headers; assert_response :success }
    request.call
    small = count_queries(&request)
    4.times do |index|
      curriculum = Curriculum.create!(name: "Extra #{index}")
      cohort = Cohort.create!(name: "Extra #{index}", curriculum: curriculum, start_date: LearningCalendar.today, settings: { "features" => { "student_experience_v2" => true } })
      Enrollment.create!(user: @student, cohort: cohort)
      cohort.recordings.create!(title: "Extra replay #{index}", source_kind: "external", source_url: "https://example.invalid/#{index}", status: :published, position: 0)
    end
    grown = count_queries(&request)
    assert_equal 5, response.parsed_body["cohorts"].size, "fixture really grew"
    assert_equal 4, response.parsed_body["cohorts"].count { |cohort| cohort.dig("available_features", "recordings") }, "recording fixtures grew too"
    assert_equal small, grown
  end

  test "recordings link their dated course week and do not invent a lesson association" do
    mod = @curriculum.modules.create!(name: "Second week", position: 0, day_offset: 7, schedule_days: "daily")
    mod.lessons.create!(title: "Second week lesson", release_day: 0, position: 0)
    @enrollment.module_assignments.create!(curriculum_module: mod)
    @cohort.recordings.create!(title: "Replay", source_kind: "external", source_url: "https://example.invalid/replay", status: :published, position: 0, recorded_date: @cohort.start_date + 7)
    get "/api/v1/recordings", params: { cohort_id: @cohort.id }, headers: headers
    assert_response :success
    assert_equal "/materials?cohort_id=#{@cohort.id}&week=2", response.parsed_body["items"].sole["learning_path"]
  end

  test "receipts belong only to the signed-in purchaser and are fetched on demand" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, status: "paid", stripe_price_id: "price_synthetic", stripe_payment_intent_id: "pi_synthetic", price_cents: 14900)
    payments = Object.new
    payments.define_singleton_method(:retrieve) do |id, options|
      raise "wrong intent" unless id == "pi_synthetic" && options == { expand: [ "latest_charge" ] }
      Struct.new(:latest_charge).new(Struct.new(:receipt_url).new("https://pay.stripe.com/receipts/synthetic"))
    end
    client = Struct.new(:v1).new(Struct.new(:payment_intents).new(payments))
    original = CourseCheckout.method(:client)
    CourseCheckout.define_singleton_method(:client) { client }
    begin
      get "/api/v1/course_checkouts/#{purchase.id}/receipt", headers: headers
      assert_response :success
      assert_equal "https://pay.stripe.com/receipts/synthetic", response.parsed_body["url"]
    ensure
      CourseCheckout.define_singleton_method(:client, original)
    end
    get "/api/v1/profile", headers: headers
    assert_equal purchase.id, response.parsed_body["enrollments"].sole["purchase_id"]
    other = User.create!(clerk_id: "first_run_other", email: "first-run-other@example.invalid", role: :student)
    get "/api/v1/course_checkouts/#{purchase.id}/receipt", headers: { "Authorization" => "Bearer test_token_#{other.id}" }
    assert_response :not_found
  end

  test "recording weeks follow Learn schedule overrides and breaks, not elapsed calendar weeks" do
    @cohort.update!(start_date: LearningCalendar.today.beginning_of_week(:monday) - 42)
    mod = @curriculum.modules.create!(name: "Curriculum week 3", position: 0, day_offset: 14, schedule_days: "daily")
    lesson = mod.lessons.create!(title: "Moved lesson", release_day: 0, position: 0)
    lesson.content_blocks.create!(title: "Read", block_type: :text, position: 0)
    @enrollment.module_assignments.create!(curriculum_module: mod)
    moved_start = @cohort.start_date + 7
    @cohort.cohort_module_schedules.create!(curriculum_module: mod, start_date: moved_start)
    @cohort.recordings.create!(title: "Moved week replay", source_kind: "external", source_url: "https://example.invalid/moved", status: :published, position: 0, recorded_date: moved_start + 1)
    @cohort.recordings.create!(title: "Break replay", source_kind: "external", source_url: "https://example.invalid/break", status: :published, position: 1, recorded_date: moved_start + 14)
    get "/api/v1/course_outline", params: { cohort_id: @cohort.id }, headers: headers
    assert_response :success
    group = response.parsed_body.fetch("outline").fetch("modules").sole.fetch("groups").sole
    assert_equal 3, group["week"]
    assert_equal moved_start.iso8601, group["opens_on"]
    get "/api/v1/recordings", params: { cohort_id: @cohort.id }, headers: headers
    assert_response :success
    assert_equal [ "/materials?cohort_id=#{@cohort.id}&week=3" ] * 2, response.parsed_body.fetch("items").pluck("learning_path")
  end

  test "recording schedule query count stays flat while assigned cohorts and recordings grow" do
    add = ->(index) do
      curriculum = Curriculum.create!(name: "Scheduled #{index}")
      cohort = Cohort.create!(name: "Scheduled #{index}", curriculum: curriculum, start_date: LearningCalendar.today - 14, settings: { "features" => { "student_experience_v2" => true } })
      enrollment = Enrollment.create!(user: @student, cohort: cohort)
      mod = curriculum.modules.create!(name: "Week", day_offset: 7, position: 0)
      mod.lessons.create!(title: "Lesson", release_day: 0, position: 0)
      enrollment.module_assignments.create!(curriculum_module: mod)
      cohort.recordings.create!(title: "Replay #{index}", source_kind: "external", source_url: "https://example.invalid/#{index}", status: :published, position: 0, recorded_date: cohort.start_date + 7)
    end
    request = -> { get "/api/v1/recordings", headers: headers; assert_response :success }
    add.call(0); request.call
    small = count_queries(&request)
    4.times { |index| add.call(index + 1) }
    grown = count_queries(&request)
    assert_equal 5, response.parsed_body.fetch("items").size
    assert response.parsed_body.fetch("items").all? { |item| item["learning_path"].end_with?("week=2") }
    assert_equal small, grown
  end

  test "malformed provider receipt URLs return not found" do
    purchase = CoursePurchase.create!(user: @student, cohort: @cohort, status: "paid", stripe_price_id: "price_synthetic", stripe_payment_intent_id: "pi_synthetic", price_cents: 14900)
    payments = Object.new
    payments.define_singleton_method(:retrieve) { |*| Struct.new(:latest_charge).new(Struct.new(:receipt_url).new("https://pay.stripe.com/bad url")) }
    client = Struct.new(:v1).new(Struct.new(:payment_intents).new(payments))
    original = CourseCheckout.method(:client)
    CourseCheckout.define_singleton_method(:client) { client }
    begin
      get "/api/v1/course_checkouts/#{purchase.id}/receipt", headers: headers
      assert_response :not_found
      assert_equal "Receipt unavailable. Contact #{SchoolBrand.current.name} at #{SchoolBrand.current.support_email} for a copy.", response.parsed_body["error"]
      refute_includes response.parsed_body["error"], "Contact CSG"
    ensure
      CourseCheckout.define_singleton_method(:client, original)
    end
  end

  private

  def headers = { "Authorization" => "Bearer test_token_#{@student.id}" }

  def availability
    get "/api/v1/cohorts/accessible", headers: headers
    assert_response :success
    response.parsed_body["cohorts"].sole.fetch("available_features")
  end
end
