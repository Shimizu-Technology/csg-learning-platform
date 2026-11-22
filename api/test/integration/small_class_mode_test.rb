require "test_helper"

class SmallClassModeTest < ActionDispatch::IntegrationTest
  ZONE = Time.find_zone!(LearningCalendar::TIMEZONE)
  NOW = ZONE.local(2026, 11, 26, 10)
  TERM_FIELDS = %w[guided_access_months guided_support_weeks review_sla_business_days].freeze

  setup do
    travel_to NOW
    @admin = person("admin", :admin)
    @teacher = person("teacher", :instructor)
    @learner = person("learner", :student)
    @curriculum = Curriculum.create!(name: "Small class curriculum")
    @mod = @curriculum.modules.create!(name: "Python", position: 0, day_offset: 0, schedule_days: "daily")
    @overdue_block = exercise("Functions", 0)
    @on_time_block = exercise("Variables", 1)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Small class", course_delivery: "guided", start_date: Date.new(2026, 11, 2),
      settings: { "features" => { "student_experience_v2" => true } })
    @cohort.instructors << @teacher
    @enrollment = enroll(@cohort)
    @overdue = hand_in(@enrollment, @overdue_block, ZONE.local(2026, 11, 19, 12))
    @on_time = hand_in(@enrollment, @on_time_block, ZONE.local(2026, 11, 24, 12))
  end

  test "admin can create guided terms, change them and clear a review target" do
    post "/api/v1/cohorts", params: {
      name: "New pilot", course_delivery: "guided", cohort_type: "custom", curriculum_id: @curriculum.id, start_date: "2026-11-02",
      guided_access_months: 12, guided_support_weeks: 8, review_sla_business_days: 2, review_response_time: "usually within 2 business days"
    }, headers: headers(@admin), as: :json
    assert_response :created
    cohort = response.parsed_body.fetch("cohort")
    assert_equal [ 12, 8, 2 ], cohort.values_at(*TERM_FIELDS)
    assert_equal "usually within 2 business days", Cohort.find(cohort["id"]).review_response_time

    patch_cohort(guided_access_months: 6, guided_support_weeks: 4, review_sla_business_days: 3)
    assert_response :success
    assert_equal [ 6, 4, 3 ], response.parsed_body.fetch("cohort").values_at(*TERM_FIELDS)
    assert_nil @enrollment.reload.access_expires_at
    assert_nil @enrollment.support_expires_at
    assert_equal Time.utc(2027, 5, 2, 14), enroll(@cohort.reload, user: person("new")).access_expires_at

    patch_cohort(review_sla_business_days: nil)
    assert_response :success
    assert_not response.parsed_body.fetch("cohort").key?("review_sla_business_days")
  end

  test "cohort rejects duration and review values outside their integer ranges" do
    { guided_access_months: 121, guided_support_weeks: 0, review_sla_business_days: 2.5 }.each do |field, bad_value|
      patch_cohort(field => bad_value)
      assert_response :unprocessable_entity
      assert_nil @cohort.reload.public_send(field)
    end
    patch_cohort(review_sla_business_days: 31)
    assert_response :unprocessable_entity
  end

  test "waiting feedback dates, optional check-in and staff alerts agree across real responses" do
    @cohort.update!(review_sla_business_days: 2)
    SchoolSetting.current.update!(review_sla_holidays: [ Date.new(2026, 11, 23) ])
    @cohort.office_hours.create!(title: "Weekly check-in", starts_at: NOW + 1.hour, ends_at: NOW + 2.hours,
      meeting_url: "https://example.invalid/check-in", event_kind: :office_hours)
    HelpRequest.create!(student: @learner, cohort: @cohort, context_type: :lesson, context_source: :primary,
      context_id: @on_time_block.lesson_id, context_label: "Variables", context_path: "/lessons/#{@on_time_block.lesson_id}", category: :concept, message: "Please help.")
    off = program_cohort
    oldest_off = hand_in(enroll(off), @overdue_block, NOW - 10.days)

    dashboard = fetch("/api/v1/dashboard", @learner, @cohort).fetch("dashboard")
    student_today = dashboard.fetch("student_today")
    work = fetch("/api/v1/my_work", @learner, @cohort).fetch("my_work")
    assert_equal work.fetch("waiting"), student_today.dig("waiting", "items")
    expected_by = ZONE.local(2026, 11, 26).end_of_day.iso8601(6)
    assert_equal [ "2026-11-26", expected_by ], work.fetch("waiting").find { |item| item["submission_id"] == @on_time.id }.values_at("expected_review_on", "expected_review_by")
    assert_equal true, student_today.dig("next_session", "optional_check_in")
    assert_equal true, dashboard.fetch("office_hours").sole.fetch("optional_check_in")

    today = fetch("/api/v1/dashboard", @teacher).dig("dashboard", "today", "items")
    assert_equal "help", today.first["kind"]
    reviews = today.select { |item| item["kind"] == "review" }
    assert_equal [ @overdue.id, oldest_off.id, @on_time.id ], reviews.map { |item| item["id"] }
    assert_equal [ true, ZONE.local(2026, 11, 24).end_of_day.iso8601(6) ], reviews.first.values_at("overdue", "expected_review_by")
    assert reviews.drop(1).none? { |item| item.key?("overdue") }

    queue = fetch("/api/v1/grading_queue", @teacher, @cohort, per_page: 1, sort: "newest")
    assert_equal 1, queue.dig("counts", "overdue"), "the count includes the overdue row on the next page"
    assert_equal({ "business_days" => 2, "expected_on" => "2026-11-26", "expected_by" => expected_by, "overdue" => false }, queue["submissions"].sole["review_sla"])
    assert_equal true, queue.dig("next", "review_sla", "overdue")
    assert_equal 0, fetch("/api/v1/grading_queue", @teacher, @cohort, lesson_id: @on_time_block.lesson_id).dig("counts", "overdue")

    @cohort.update!(review_sla_business_days: nil)
    assert_not fetch("/api/v1/grading_queue", @teacher, @cohort).fetch("counts").key?("overdue")
    assert fetch("/api/v1/my_work", @learner, @cohort).dig("my_work", "waiting").none? { |item| item.key?("expected_review_on") }
  end

  test "Cohort 3 Off keeps byte-identical scoped responses when the pilot turns on" do
    program = program_cohort
    enrollment = enroll(program)
    hand_in(enrollment, @overdue_block, NOW - 10.days)
    snapshots = -> do
      {
        learner: raw("/api/v1/dashboard", @learner, program),
        staff: raw("/api/v1/dashboard", @teacher, program),
        work: raw("/api/v1/my_work", @learner, program),
        grading: raw("/api/v1/grading_queue", @teacher, program),
        settings: raw("/api/v1/cohorts/#{program.id}", @admin)
      }
    end

    before = snapshots.call
    assert_not JSON.parse(before[:learner]).fetch("dashboard").key?("student_today")
    assert_empty JSON.parse(before[:settings]).fetch("cohort").keys & TERM_FIELDS
    assert_equal({ "ungraded" => 1, "redo" => 0, "all" => 1 }, JSON.parse(before[:grading]).fetch("counts"))
    assert_not JSON.parse(before[:grading]).fetch("submissions").sole.key?("review_sla")

    patch_cohort(guided_access_months: 12, guided_support_weeks: 8, review_sla_business_days: 2)
    assert_response :success
    SchoolSetting.current.update!(review_sla_holidays: [ Date.new(2026, 11, 23) ])

    assert_equal before, snapshots.call
    assert_equal [ nil, nil ], enrollment.reload.attributes.values_at("access_expires_at", "support_expires_at")
  end

  test "Today shows guided support ending at the stored Guam cutoff" do
    @cohort.update!(guided_support_weeks: 3)
    enrollment = enroll(@cohort.reload, user: person("support"))
    assert_not enrollment.instructor_support_active?
    today = fetch("/api/v1/dashboard", enrollment.user, @cohort).dig("dashboard", "student_today")
    assert_equal true, today.dig("support", "ended")
    assert_equal "none", today.dig("support", "mode")
    assert_equal false, today["read_only"]
  end

  private

  def person(name, role = :student)
    User.create!(clerk_id: "small_class_#{name}", email: "small-class-#{name}@example.invalid", first_name: name.capitalize, role: role)
  end

  def exercise(title, position)
    lesson = @mod.lessons.create!(title: title, position: position, release_day: 0, lesson_type: :exercise, required: true)
    lesson.content_blocks.create!(block_type: :exercise, title: title, position: 0, submission_type: :text_submission)
  end

  def enroll(cohort, user: @learner)
    Enrollment.create!(user: user, cohort: cohort, status: :active).tap do |enrollment|
      enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    end
  end

  def hand_in(enrollment, block, created_at)
    Submission.create!(user: enrollment.user, enrollment: enrollment, content_block: block, submission_type: :text_submission, text: "QA answer", created_at: created_at)
  end

  def program_cohort
    Cohort.create!(curriculum: @curriculum, name: "Cohort 3", course_delivery: "program", start_date: Date.new(2026, 10, 5),
      settings: { "features" => { "student_experience_v2" => false } }).tap { |cohort| cohort.instructors << @teacher }
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }

  def raw(path, user, cohort = nil, **params)
    get path, params: { cohort_id: cohort&.id }.compact.merge(params), headers: headers(user)
    assert_response :success
    response.body
  end

  def fetch(...) = JSON.parse(raw(...))

  def patch_cohort(**params)
    patch "/api/v1/cohorts/#{@cohort.id}", params: params, headers: headers(@admin), as: :json
  end
end
