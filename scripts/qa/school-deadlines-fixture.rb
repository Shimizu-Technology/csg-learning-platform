# Reset synthetic deadline learners before each browser case.
require_relative "w9-deadlines-review-fixtures"

enrollment = User.find(953).enrollments.find_by!(cohort: Cohort.find_by!(name: "QA Deadline Pace"))
# Use the next January 15 that follows this learner's original pace target.
plan = enrollment.learning_plan
deadline = Date.new(plan.target_date.year, 1, 15)
deadline = deadline.next_year if deadline <= plan.target_date
plan.update!(target_date: deadline)
march = Date.new(deadline.year, 3, 1)
second_sunday = march + ((7 - march.wday) % 7) + 7
fall_day = Date.new(deadline.year, 11, 1)
fall_day += (7 - fall_day.wday) % 7
fold_saved_at = Time.utc(fall_day.year, fall_day.month, fall_day.day, 7, 30, 42)
fold_lock_at = Time.utc(fall_day.year, fall_day.month, fall_day.day, 6, 30, 10)
if LearningCalendar.time_zone == "America/Chicago"
  program = Cohort.find_by!(name: "QA Deadline Program")
  mod = program.curriculum.modules.find_by!(name: "Python")
  program.cohort_module_submission_windows.create!(curriculum_module: mod, week_number: 2, submissions_close_at: fold_saved_at)
end
Rails.root.join("..", ".qa-local", "school-deadlines.json").write(
  { base: deadline.iso8601, first: (second_sunday - 1).iso8601, second: second_sunday.iso8601, fold_lock_at: fold_lock_at.iso8601 }.to_json
)
