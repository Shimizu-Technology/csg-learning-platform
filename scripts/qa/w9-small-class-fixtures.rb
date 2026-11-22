# Run in the disposable scripts/qa/run database only. The Playwright spec
# resets the synthetic pilot's terms before every viewport and theme.
require_relative "boot"

pilot = Cohort.find_by(name: "QA Small Class")
program = Cohort.find_by!(name: "QA Program")
teacher = User.find(2)
now = Time.current

unless pilot
  ActiveRecord::Base.transaction do
    curriculum = Curriculum.create!(name: "QA Small Class Curriculum", status: :active)
    mod = curriculum.modules.create!(name: "Python fundamentals", position: 0, day_offset: 0, schedule_days: "daily")
    pilot = Cohort.create!(name: "QA Small Class", curriculum: curriculum, course_delivery: "guided", status: :active,
      start_date: LearningCalendar.today - 14, settings: { "features" => { "student_experience_v2" => true } })
    pilot.instructors << teacher
    learner = User.create!(id: 915, clerk_id: "qa_small_class", email: "qa-small-class@example.invalid", first_name: "QA", last_name: "Learner",
      role: :student, community_terms_accepted_at: now, community_terms_version: CommunityPolicy::VERSION)
    enrollment = Enrollment.create!(user: learner, cohort: pilot, status: :active, start_here_dismissed_at: now)
    enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
    [ "Functions practice", "Variables practice" ].each_with_index do |title, index|
      lesson = mod.lessons.create!(title: title, position: index, release_day: 0, lesson_type: :exercise, required: true)
      block = lesson.content_blocks.create!(title: title, position: 0, block_type: :exercise, submission_type: :text_submission)
      Submission.create!(enrollment: enrollment, user: learner, content_block: block, text: "Synthetic practice", created_at: index.zero? ? now - 10.days : now)
    end
    pilot.office_hours.create!(title: "QA Python office hours", starts_at: now + 1.day, ends_at: now + 1.day + 45.minutes,
      meeting_url: "https://example.invalid/python", recurrence: :weekly, event_kind: :office_hours, created_by: teacher)
  end
end

pilot.update!(guided_access_months: nil, guided_support_weeks: nil, guided_access_ends_on: nil, guided_support_ends_on: nil,
  review_sla_business_days: nil, review_response_time: nil)
program.update!(settings: program.settings.merge("features" => { "student_experience_v2" => false }))
enrollment = pilot.enrollments.find_by!(user_id: 915)
abort "QA pilot enrollment terms changed" unless enrollment.access_expires_at.nil? && enrollment.support_expires_at.nil?
open_submission, late_submission = enrollment.submissions.order(created_at: :desc).to_a
calendar = SchoolSetting.current.review_sla_holidays
expected = ReviewSla.new(holidays: calendar).call(submitted_at: open_submission.created_at, business_days: 2, now: now)
abort "QA submission dates are stale; start a fresh harness" unless !expected[:overdue] &&
  ReviewSla.new(holidays: calendar).call(submitted_at: late_submission.created_at, business_days: 2, now: now)[:overdue]

puts JSON.generate(pilot: pilot.id, curriculum: pilot.curriculum_id, learner: enrollment.user_id, program: program.id,
  program_submission: User.find(3).submissions.find_by!(grade: nil).id, late_submission: late_submission.id,
  start_date: pilot.start_date.iso8601, expected_on: expected[:expected_on])
