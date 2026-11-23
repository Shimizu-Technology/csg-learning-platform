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
Rails.root.join("..", ".qa-local", "school-deadlines.json").write(
  { base: deadline.iso8601, first: (second_sunday - 1).iso8601, second: second_sunday.iso8601 }.to_json
)
