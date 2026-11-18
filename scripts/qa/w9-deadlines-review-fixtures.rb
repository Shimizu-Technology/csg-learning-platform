require_relative "boot"
admin = User.find(1)
curriculum = Curriculum.find_or_create_by!(name: "QA Deadline Review")
mod = curriculum.modules.find_or_create_by!(name: "Python") { |row| row.assign_attributes(position: 0, day_offset: 0) }
lessons = (0..7).map do |index|
  lesson = mod.lessons.find_or_create_by!(title: "Review lesson #{index + 1}") { |row| row.assign_attributes(position: index, release_day: index == 7 ? 7 : 0) }
  lesson.content_blocks.find_or_create_by!(title: "Written answer") { |row| row.assign_attributes(block_type: :exercise, position: 0, filename: "answer.md", metadata: { "language" => "markdown" }, submission_type: :text_submission, body: "Write a short answer.") }
  lesson
end
project = mod.lessons.find_or_create_by!(title: "Review final project") { |row| row.assign_attributes(position: 8, release_day: 14, lesson_type: :project) }
project.content_blocks.find_or_create_by!(title: "Final draft") { |row| row.assign_attributes(block_type: :exercise, position: 0, filename: "draft.md", metadata: { "language" => "markdown" }, submission_type: :text_submission, body: "Submit your draft.") }
program = Cohort.find_or_create_by!(name: "QA Deadline Program") { |row| row.assign_attributes(curriculum: curriculum, start_date: Date.current - 60, end_date: Date.current + 180, status: :active, settings: { "features" => { "student_experience_v2" => true } }) }
paced = Cohort.find_or_create_by!(name: "QA Deadline Pace") { |row| row.assign_attributes(curriculum: curriculum, start_date: Date.current - 14, end_date: Date.current + 180, status: :active, course_delivery: "guided", learner_pace_weeks: [ 3, 6, 12 ], settings: { "features" => { "student_experience_v2" => true } }) }
paced.update!(start_date: LearningCalendar.today - 14)
[ program, paced ].each do |cohort|
  cohort.cohort_instructor_assignments.find_or_create_by!(user: User.find(2))
  cohort.cohort_module_submission_windows.destroy_all
end
learners = [ [ 951, program, "Extended" ], [ 952, program, "Off" ], [ 953, paced, "Paced" ] ].map do |id, cohort, name|
  user = User.find_or_create_by!(id: id) { |row| row.assign_attributes(clerk_id: "qa_deadline_#{id}", email: "deadline#{id}@example.invalid", first_name: "QA", last_name: name, role: :student, community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION) }
  enrollment = Enrollment.find_or_create_by!(user: user, cohort: cohort) { |row| row.status = :active }
  enrollment.learner_extensions.destroy_all
  Submission.where(enrollment: enrollment).destroy_all
  Progress.where(enrollment: enrollment).destroy_all
  enrollment.learning_plan&.destroy!
  enrollment.update!(first_opened_at: 2.weeks.ago, starts_on: cohort.personal_pace? ? cohort.start_date : nil)
  enrollment.assign_cohort_content_defaults!
  enrollment.module_assignments.update_all(unlocked: true)
  enrollment.reload
end
extended, off, pace = learners
window = program.cohort_module_submission_windows.create!(curriculum_module: mod, week_number: 1, submissions_close_at: 3.days.ago)
extended.learner_extensions.new(scope: "lesson", lesson: lessons.first, reason: "Earlier grant before cohort postponement", submissions_close_at: 1.day.ago).record_change!(actor: admin)
window.update!(submissions_close_at: 1.day.from_now)
paced.cohort_module_submission_windows.create!(curriculum_module: mod, week_number: 1, submissions_close_at: 3.days.ago)
LearnerPace.new(pace).choose!(weeks: 3, actor: admin)
[ [ extended, lessons.last ], [ pace, lessons.first ] ].each do |enrollment, lesson|
  enrollment.learner_extensions.new(scope: "lesson", lesson: lesson, reason: "Legacy hard cutoff", submissions_close_at: 1.day.ago, granted_by: admin, granted_at: 2.days.ago).save!(validate: false)
end
if ENV["QA_DELETED_EXTENSION"] == "1"
  extended.learner_extensions.destroy_all
  deleted = mod.lessons.create!(title: "Lesson removed in deadline QA", position: 9, release_day: 0)
  extended.reload.learner_extensions.new(scope: "lesson", lesson: deleted, reason: "Grant for deleted lesson", submissions_close_at: 3.days.from_now).record_change!(actor: admin)
  deleted.destroy!
end
ids = { program: program.id, paced: paced.id, extended: { user: 951, enrollment: extended.id }, off: { user: 952, enrollment: off.id }, pace: { user: 953, enrollment: pace.id }, lesson: lessons.first.id, open_lesson: lessons.last.id, project: project.id }
Rails.root.join("..", ".qa-local", "w9-deadlines-review.json").write(JSON.pretty_generate(ids))
