# Run in the disposable scripts/qa/run database only. Resets the synthetic
# guided checkout cohorts before each viewport and theme in Playwright QA.
require_relative "boot"
require_relative "../../api/test/support/offering_price_test_support"
extend OfferingPriceTestSupport

teacher = User.find(2)
program = Cohort.find_by!(name: "QA Program")
now = Time.current

curriculum = Curriculum.find_by(name: "QA Guided Checkout Curriculum")
unless curriculum
  ActiveRecord::Base.transaction do
    curriculum = Curriculum.create!(name: "QA Guided Checkout Curriculum", status: :active)
    mod = curriculum.modules.create!(name: "Python basics", position: 0, day_offset: 0, schedule_days: "weekdays")
    lesson = mod.lessons.create!(title: "Variables and types", position: 0, release_day: 0, lesson_type: :exercise, required: true)
    lesson.content_blocks.create!(title: "Variables", position: 0, block_type: :exercise, submission_type: :text_submission, body: "Practice variables")
  end
end

open_cohort = Cohort.find_by(name: "QA Guided Capped Open")
unless open_cohort
  open_cohort = Cohort.create!(
    name: "QA Guided Capped Open",
    curriculum: curriculum,
    course_delivery: "guided",
    cohort_type: :workshop,
    status: :active,
    start_date: LearningCalendar.today,
    public_title: "Python Fundamentals Pilot",
    public_description: "A focused small-class Python cohort with optional weekly check-ins.",
    public_image_url: "https://example.invalid/python.png",
    public_price_cents: 14_900,
    stripe_price_id: "price_qa_guided_open",
    guided_access_months: 12,
    guided_support_weeks: 8,
    seat_limit: 15,
    unlisted: true,
    public_checkout_enabled: true
  )
  open_cohort.instructors << teacher
  open_cohort.update!(support_instructor: teacher)

  # Fill 11 seats so 4 of 15 seats remain.
  11.times do |i|
    seat_user = User.find_or_create_by!(clerk_id: "qa_guided_seat_#{i}") do |u|
      u.email = "qa-guided-seat-#{i}@example.invalid"
      u.first_name = "Seat"
      u.last_name = "Learner#{i}"
      u.role = :student
    end
    Enrollment.find_or_create_by!(user: seat_user, cohort: open_cohort) { |e| e.status = :active }
  end
end

open_cohort.update!(
  public_checkout_enabled: true,
  unlisted: true,
  seat_limit: 15,
  guided_access_months: 12,
  guided_support_weeks: 8
)
stamp_verified_offering_price(open_cohort)

full_cohort = Cohort.find_by(name: "QA Guided Capped Full")
unless full_cohort
  full_cohort = Cohort.create!(
    name: "QA Guided Capped Full",
    curriculum: curriculum,
    course_delivery: "guided",
    cohort_type: :workshop,
    status: :active,
    start_date: LearningCalendar.today,
    public_title: "Python Full Cohort",
    public_description: "A full small-class Python cohort.",
    public_image_url: "https://example.invalid/python-full.png",
    public_price_cents: 14_900,
    stripe_price_id: "price_qa_guided_full",
    guided_access_months: 12,
    guided_support_weeks: 8,
    seat_limit: 1,
    unlisted: false,
    public_checkout_enabled: true
  )
  full_cohort.instructors << teacher
  full_cohort.update!(support_instructor: teacher)
  holder = User.find_or_create_by!(clerk_id: "qa_guided_full_holder") do |u|
    u.email = "qa-guided-full-holder@example.invalid"
    u.first_name = "Full"
    u.last_name = "Holder"
    u.role = :student
  end
  Enrollment.find_or_create_by!(user: holder, cohort: full_cohort) { |e| e.status = :active }
end

full_cohort.update!(public_checkout_enabled: true, unlisted: false, seat_limit: 1)
stamp_verified_offering_price(full_cohort)

puts JSON.generate(
  open_id: open_cohort.id,
  open_slug: open_cohort.public_slug,
  full_id: full_cohort.id,
  full_slug: full_cohort.public_slug,
  program_id: program.id,
  new_student_id: 7,
  now: now.iso8601
)
