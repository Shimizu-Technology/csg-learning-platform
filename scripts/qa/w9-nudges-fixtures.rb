# W9.3 learner reminders: synthetic fixtures for the local QA harness.
# From api/, after `scripts/qa/run start`:
#   DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/w9-nudges-fixtures.rb
# Resets only its own cohorts, learners and reminders. Every course starts on
# today's Guam date with a 3-week pace, so the final project is due on day 20.
require_relative "boot"

GUAM = ActiveSupport::TimeZone["Pacific/Guam"]
admin = User.find(1)
instructor = User.find(2)
start = GUAM.today

SchoolSetting.current.update!(features: SchoolSetting.current.features.merge("learner_nudges" => true))
# The harness time-travels the tick forward; start each run from a clean checkpoint.
ScheduledTaskRun.where(name: "learner_nudges").delete_all
curriculum = Curriculum.find_or_create_by!(name: "QA Reminders course") { |row| row.status = :active }
mod = curriculum.modules.find_or_create_by!(name: "Python basics") { |row| row.assign_attributes(position: 0, day_offset: 0) }
titles = [ "Variables", "Lists", "Loops", "Functions" ]
lessons = titles.each_with_index.map do |title, index|
  lesson = mod.lessons.find_or_create_by!(title: "Reminder lesson: #{title}") { |row| row.assign_attributes(position: index, release_day: 0) }
  lesson.content_blocks.find_or_create_by!(title: "Written answer") { |row| row.assign_attributes(block_type: :exercise, position: 0, filename: "answer.md", metadata: { "language" => "markdown" }, submission_type: :text_submission, body: "Write a short answer.") }
  lesson
end
project = mod.lessons.find_or_create_by!(title: "Reminder final project") { |row| row.assign_attributes(position: 9, release_day: 0, lesson_type: :project) }
project.content_blocks.find_or_create_by!(title: "Final draft") { |row| row.assign_attributes(block_type: :exercise, position: 0, filename: "draft.md", metadata: { "language" => "markdown" }, submission_type: :text_submission, body: "Submit your draft.") }

paced = Cohort.find_or_initialize_by(name: "QA Reminders Pace")
paced.assign_attributes(curriculum: curriculum, start_date: start, end_date: start + 180, status: :active, course_delivery: "guided",
  learner_pace_weeks: [ 3 ], settings: { "features" => { "student_experience_v2" => true, "learner_nudges" => true } })
paced.save!
# Cohort 3's shape: a program cohort with the new student experience off, not opted in.
off = Cohort.find_or_initialize_by(name: "QA Reminders Off program")
off.assign_attributes(curriculum: curriculum, start_date: start - 30, end_date: start + 180, status: :active, course_delivery: "program",
  settings: { "features" => { "student_experience_v2" => false } })
off.save!
[ paced, off ].each { |cohort| cohort.cohort_instructor_assignments.find_or_create_by!(user: instructor) }

people = { 971 => [ paced, "Due" ], 972 => [ paced, "Extended" ], 973 => [ paced, "Opted out" ], 974 => [ off, "Off" ], 975 => [ paced, "Quiet" ] }
enrollments = people.to_h do |id, (cohort, name)|
  user = User.find_or_create_by!(id: id) do |row|
    row.assign_attributes(clerk_id: "qa_nudge_#{id}", email: "nudge#{id}@example.invalid", first_name: "QA", last_name: name, role: :student,
      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  end
  ClerkIdentity.find_or_create_by!(user: user, issuer: "https://test.clerk.invalid") { |row| row.clerk_user_id = user.clerk_id }
  user.update!(learner_nudges_enabled: id != 973)
  enrollment = Enrollment.find_or_create_by!(user: user, cohort: cohort) { |row| row.status = :active }
  LearnerNudge.where(enrollment: enrollment).destroy_all
  enrollment.learner_extensions.destroy_all
  Submission.where(enrollment: enrollment).destroy_all
  Progress.where(enrollment: enrollment).destroy_all
  ActivityEvent.where(subject_user: user).delete_all
  enrollment.learning_plan&.destroy!
  enrollment.update!(status: :active, first_opened_at: nil, starts_on: cohort.personal_pace? ? start : nil, access_expires_at: nil, support_expires_at: nil)
  enrollment.assign_cohort_content_defaults!
  enrollment.module_assignments.update_all(unlocked: true)
  enrollment.reload
  LearnerPace.new(enrollment).choose!(weeks: 3, actor: admin) if cohort.personal_pace?
  [ id, enrollment.reload ]
end
# Access ends on day 22 at noon for the opted-out learner and the Off learner.
[ 973, 974 ].each { |id| enrollments[id].update!(access_expires_at: GUAM.local(start.year, start.month, start.day, 12) + 22.days) }

final_due = enrollments[971].learning_plan.target_date
ids = { start: start.iso8601, final_due: final_due.iso8601, paced: paced.id, off: off.id, project: project.id,
  learners: enrollments.transform_values { |enrollment| { user: enrollment.user_id, enrollment: enrollment.id } } }
Rails.root.join("..", ".qa-local", "w9-nudges.json").write(JSON.pretty_generate(ids))
puts JSON.pretty_generate(ids)
