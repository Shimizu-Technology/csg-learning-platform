require_relative 'boot'

# Synthetic fixtures for UX-1 (grading safety and speed) browser QA.
# One cohort, taught by the QA instructor, that delivers Redo feedback to GitHub
# (github_app + github_issue_delivery_v2 On, verified binding), with a waiting
# attempt per exercise so each browser run can grade one and move to the next.
# Run once after scripts/qa/run start, from api/:
#   DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/ux-grading-safety-fixtures.rb

instructor = User.find(2)
student = User.find(3)
student.update!(github_username: 'app-learner')
student.record_verified_github_identity!(id: '24680', login: 'app-learner')

SchoolSetting.current.update!(
  features: SchoolSetting.current.features.merge('github_app' => true, 'github_issue_delivery_v2' => true)
)

curriculum = Curriculum.create!(name: 'UX1 Prework QA Curriculum')
mod = curriculum.modules.create!(name: 'Prework', position: 0, day_offset: 0, schedule_days: 'weekdays')
lesson = mod.lessons.create!(title: 'Loops and Arrays', position: 0, release_day: 0, requires_submission: true)

cohort = Cohort.create!(
  name: 'UX1 GitHub Cohort',
  curriculum: curriculum,
  start_date: Date.current - 7.days,
  status: :active,
  repository_name: 'prework-exercises',
  settings: { 'features' => { 'github_app' => true, 'github_issue_delivery_v2' => true } }
)
cohort.cohort_instructor_assignments.create!(user: instructor)
enrollment = Enrollment.create!(user: student, cohort: cohort, status: :active)
enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)

installation = cohort.github_app_installations.create!(
  app_id: 12345, installation_id: 123, account_id: 24680, account_login: 'app-learner', account_type: 'User',
  repository_selection: 'selected', permissions: { 'contents' => 'read', 'checks' => 'read', 'metadata' => 'read', 'issues' => 'write' },
  connected_at: Time.current, checked_at: Time.current
)
enrollment.github_repository_bindings.create!(
  github_app_installation: installation, full_name: 'app-learner/prework-exercises', repository_id: 98765,
  github_user_id: '24680', github_username: 'app-learner', verification_state: 'verified',
  verified_at: Time.current, checked_at: Time.current
)

submissions = (1..10).map do |index|
  block = lesson.content_blocks.create!(
    block_type: :exercise, position: index, title: "Exercise #{200 + index}", filename: "#{200 + index}.rb",
    body: 'Filter even numbers from an array.', submission_type: :prework_github_sync
  )
  Submission.create!(
    user: student, enrollment: enrollment, content_block: block, submission_type: :prework_github_sync,
    repo_url: 'https://github.com/app-learner/prework-exercises', commit_sha: format('%040x', 0xabc000 + index),
    text: "def evens(nums)\n  nums.select { |n| n % 2 == 1 }\nend", num_submissions: 1,
    created_at: (30 - index).hours.ago
  )
end

payload = { cohort_id: cohort.id, module_id: mod.id, submission_ids: submissions.map(&:id) }
File.write(File.expand_path('../../.qa-local/ux-grading-safety.json', __dir__), JSON.pretty_generate(payload))
puts JSON.pretty_generate(payload)
