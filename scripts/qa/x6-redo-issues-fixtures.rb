require_relative 'boot'

# Synthetic fixtures for X-6.8 (Reliable Redo GitHub issues) browser QA.
# Creates:
# 1. Opted-in cohort with github_app + github_issue_delivery_v2 On, verified binding,
#    and three submissions:
#      - failed_submission: graded R with failed delivery (ready to test Retry -> delivered)
#      - pending_submission: graded R with pending delivery
#      - ungraded_submission: ungraded (ready to test grading R -> pending with zero HTTP)
# 2. Off cohort (Cohort 3 shape: github_issue_delivery_v2 inherited Off) with a graded R submission
#    having zero GithubIssueDelivery rows.

admin = User.find(1)
instructor = User.find(2)
student = User.find(3)

student.update!(github_username: 'app-learner')
student.record_verified_github_identity!(id: '24680', login: 'app-learner')

SchoolSetting.current.update!(
  features: SchoolSetting.current.features.merge(
    'github_app' => true,
    'github_issue_delivery_v2' => true
  )
)

curriculum = Curriculum.create!(name: 'X6 Prework QA Curriculum')
mod = curriculum.modules.create!(name: 'Prework', position: 0, day_offset: 0, schedule_days: 'weekdays')
lesson = mod.lessons.create!(title: 'Loops and Arrays', position: 0, release_day: 0, requires_submission: true)

failed_block = lesson.content_blocks.create!(
  block_type: :exercise, position: 0, title: 'Exercise 101', filename: '101.rb',
  body: 'Return the sum of positive numbers.', submission_type: :prework_github_sync
)
pending_block = lesson.content_blocks.create!(
  block_type: :exercise, position: 1, title: 'Exercise 102', filename: '102.rb',
  body: 'Reverse a string without reverse.', submission_type: :prework_github_sync
)
ungraded_block = lesson.content_blocks.create!(
  block_type: :exercise, position: 2, title: 'Exercise 103', filename: '103.rb',
  body: 'Filter even numbers from an array.', submission_type: :prework_github_sync
)

opted_in_cohort = Cohort.create!(
  name: 'X6 Opted-In Cohort',
  curriculum: curriculum,
  start_date: Date.current - 7.days,
  status: :active,
  repository_name: 'prework-exercises',
  settings: {
    'features' => {
      'github_app' => true,
      'github_issue_delivery_v2' => true
    }
  }
)
opted_in_cohort.cohort_instructor_assignments.create!(user: instructor)
opted_in_enrollment = Enrollment.create!(user: student, cohort: opted_in_cohort, status: :active)
opted_in_enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)

installation = opted_in_cohort.github_app_installations.create!(
  app_id: 12345,
  installation_id: 123,
  account_id: 24680,
  account_login: 'app-learner',
  account_type: 'User',
  repository_selection: 'selected',
  permissions: { 'contents' => 'read', 'checks' => 'read', 'metadata' => 'read', 'issues' => 'write' },
  connected_at: Time.current,
  checked_at: Time.current
)

binding = opted_in_enrollment.github_repository_bindings.create!(
  github_app_installation: installation,
  full_name: 'app-learner/prework-exercises',
  repository_id: 98765,
  github_user_id: '24680',
  github_username: 'app-learner',
  verification_state: 'verified',
  verified_at: Time.current,
  checked_at: Time.current
)

failed_by_run = {}
%w[chromium-1280:light chromium-1280:dark chromium-390:light chromium-390:dark].each_with_index do |run_key, idx|
  block = idx.zero? ? failed_block : lesson.content_blocks.create!(
    block_type: :exercise, position: 10 + idx, title: "Exercise 101-#{idx + 1}", filename: "101_#{idx + 1}.rb",
    body: 'Return the sum of positive numbers.', submission_type: :prework_github_sync
  )
  sub = Submission.create!(
    user: student,
    enrollment: opted_in_enrollment,
    content_block: block,
    submission_type: :prework_github_sync,
    text: "def sum_pos(nums)\n  nums.sum\nend",
    grade: 'R',
    feedback: 'Filter out negative numbers before summing.',
    graded_by_id: instructor.id,
    graded_at: 10.minutes.ago,
    num_submissions: 1
  )
  GithubIssueDelivery.create!(
    submission: sub,
    enrollment: opted_in_enrollment,
    content_block: block,
    github_repository_binding: binding,
    repository_id: 98765,
    repository_full_name: 'app-learner/prework-exercises',
    action: 'open_or_comment',
    grade: 'R',
    feedback_body: sub.feedback,
    dedupe_token: SecureRandom.hex(16),
    status: 'failed',
    attempts: 1,
    last_error: 'GitHub installation cannot access this repository; check selected repositories and reconnect'
  )
  failed_by_run[run_key] = sub.id
end
failed_submission_id = failed_by_run.fetch('chromium-1280:light')

pending_submission = Submission.create!(
  user: student,
  enrollment: opted_in_enrollment,
  content_block: pending_block,
  submission_type: :prework_github_sync,
  text: "def rev(s)\n  s\nend",
  grade: 'R',
  feedback: 'Build the reversed string in a loop.',
  graded_by_id: instructor.id,
  graded_at: 5.minutes.ago,
  num_submissions: 1
)
GithubIssueDelivery.create!(
  submission: pending_submission,
  enrollment: opted_in_enrollment,
  content_block: pending_block,
  github_repository_binding: binding,
  repository_id: 98765,
  repository_full_name: 'app-learner/prework-exercises',
  action: 'open_or_comment',
  grade: 'R',
  feedback_body: pending_submission.feedback,
  dedupe_token: SecureRandom.hex(16),
  status: 'pending',
  attempts: 0
)

ungraded_submission = Submission.create!(
  user: student,
  enrollment: opted_in_enrollment,
  content_block: ungraded_block,
  submission_type: :prework_github_sync,
  text: "def evens(nums)\n  nums.select { |n| n % 2 == 1 }\nend",
  num_submissions: 1
)

# Off cohort (Cohort 3 shape: inherits Off even though school switch is On)
off_cohort = Cohort.create!(
  name: 'Cohort 3 Off QA',
  curriculum: curriculum,
  start_date: Date.current - 14.days,
  status: :active,
  repository_name: 'cohort-3-prework',
  settings: {
    'features' => {
      'student_experience_v2' => false
    }
  }
)
off_cohort.cohort_instructor_assignments.create!(user: instructor)
off_enrollment = Enrollment.create!(user: student, cohort: off_cohort, status: :active)
off_enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)

off_submission = Submission.create!(
  user: student,
  enrollment: off_enrollment,
  content_block: failed_block,
  submission_type: :prework_github_sync,
  text: "def sum_pos(nums)\n  nums.sum\nend",
  grade: 'R',
  feedback: 'Cohort 3 legacy feedback.',
  graded_by_id: instructor.id,
  graded_at: 10.minutes.ago,
  num_submissions: 1
)

puts JSON.pretty_generate(
  admin_id: admin.id,
  instructor_id: instructor.id,
  opted_in_cohort_id: opted_in_cohort.id,
  off_cohort_id: off_cohort.id,
  failed_submission_id: failed_submission_id,
  failed_by_run: failed_by_run,
  pending_submission_id: pending_submission.id,
  ungraded_submission_id: ungraded_submission.id,
  off_submission_id: off_submission.id
)
