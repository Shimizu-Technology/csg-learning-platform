require_relative 'boot'

# Synthetic fixtures for X-6.7 (Grade suggestions in the grading workbench & queue) QA.
# Creates:
# 1. Opted-in cohort (github_app + github_grade_suggestions On) with verified binding,
#    active ExerciseCheckPolicy v1, and per-run (viewport x theme) ungraded submissions:
#      - suggest_b_accept: all required checks passed -> tests Select B (no auto-save) + Save & next
#      - suggest_b_override: all required checks passed -> tests overriding with A + override note
#      - review_for_redo: required check failed -> tests Redo feedback validation + Save R
#      - stale_reeval: stale policy suggestion -> tests amber stale warning, no Select B, Re-evaluate preserving draft
#      - checks_passed_grade_r: already graded R with suggest_b + overridden -> tests side-by-side display
# 2. Off cohort (Cohort 3 shape: github_grade_suggestions inherited Off) with an ungraded submission
#    confirming zero suggestion card, zero queue badge, and zero suggestion filter chips.

admin = User.find(1)
instructor = User.find(2)
student = User.find(3)

student.update!(github_username: 'sug-learner')
student.record_verified_github_identity!(id: '35791', login: 'sug-learner')

SchoolSetting.current.update!(
  features: SchoolSetting.current.features.merge(
    'github_app' => true,
    'github_grade_suggestions' => true
  )
)

curriculum = Curriculum.create!(name: 'X6.7 Prework Suggestions QA')
mod = curriculum.modules.create!(name: 'Prework Ruby', position: 0, day_offset: 0, schedule_days: 'weekdays')
lesson = mod.lessons.create!(title: 'Conditionals and Loops', position: 0, release_day: 0, requires_submission: true)

opted_in_cohort = Cohort.create!(
  name: 'X6.7 Opted-In Prework',
  curriculum: curriculum,
  start_date: Date.current - 7.days,
  status: :active,
  repository_name: 'prework-exercises',
  settings: {
    'features' => {
      'github_app' => true,
      'github_grade_suggestions' => true
    }
  }
)
opted_in_cohort.cohort_instructor_assignments.create!(user: instructor)
opted_in_enrollment = Enrollment.create!(user: student, cohort: opted_in_cohort, status: :active)
opted_in_enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)

installation = opted_in_cohort.github_app_installations.create!(
  app_id: 12345,
  installation_id: 67890,
  account_id: 35791,
  account_login: 'sug-learner',
  account_type: 'User',
  repository_selection: 'selected',
  permissions: { 'contents' => 'read', 'checks' => 'read', 'metadata' => 'read', 'issues' => 'write' },
  connection_state: 'connected',
  connected_at: Time.current,
  checked_at: Time.current
)

binding = opted_in_enrollment.github_repository_bindings.create!(
  github_app_installation: installation,
  curriculum_module: mod,
  full_name: 'sug-learner/prework-exercises',
  repository_id: 44444,
  github_user_id: '35791',
  github_username: 'sug-learner',
  verification_state: 'verified',
  verified_at: Time.current,
  checked_at: Time.current
)

def make_verified_sub(enrollment:, block:, binding:, code:, sha:, created_at:, grade: nil, feedback: nil, grader: nil)
  Submission.create!(
    user: enrollment.user,
    enrollment: enrollment,
    content_block: block,
    submission_type: :prework_github_sync,
    text: code,
    commit_sha: sha,
    branch: 'main',
    grade: grade,
    feedback: feedback,
    graded_by_id: grader&.id,
    graded_at: grade ? created_at + 10.minutes : nil,
    num_submissions: 1,
    created_at: created_at,
    updated_at: created_at,
    github_revision: {
      'version' => 1,
      'binding_id' => binding.id,
      'repository_id' => binding.repository_id,
      'repository_full_name' => binding.full_name,
      'paths' => [ block.filename ],
      'content_digest' => Digest::SHA256.hexdigest(code),
      'source_bytes' => code.bytesize,
      'captured_at' => created_at.iso8601(6)
    }
  )
end

runs = {}
ext_id = 7000
base_time = 2.hours.ago

%w[chromium-1280:light chromium-1280:dark chromium-390:light chromium-390:dark].each_with_index do |run_key, idx|
  sha_ok = format('%040x', 0x1000 + idx)
  sha_fail = format('%040x', 0x2000 + idx)
  sha_stale = format('%040x', 0x3000 + idx)

  accept_block = lesson.content_blocks.create!(
    block_type: :exercise, position: idx * 10 + 1, title: "Ex #{idx + 1}A Accept B", filename: "ex_#{idx}_a.rb",
    body: 'Return the double of a number.', submission_type: :prework_github_sync
  )
  ExerciseCheckPolicy.create_version!(
    content_block: accept_block, required_checks: [ "prework/ex_#{idx}_a.rb" ], allowed_app_slugs: [ 'github-actions' ], allowed_branch: 'main', created_by: admin
  )
  accept_sub = make_verified_sub(
    enrollment: opted_in_enrollment, block: accept_block, binding: binding,
    code: "def double(n)\n  n * 2\nend", sha: sha_ok, created_at: base_time + (idx * 20).minutes
  )
  accept_sub.github_check_runs.create!(
    external_id: (ext_id += 1), name: "prework/ex_#{idx}_a.rb", app_slug: 'github-actions',
    head_sha: sha_ok, status: 'completed', conclusion: 'success', fetched_at: Time.current
  )
  GithubGradeSuggestionEvaluator.evaluate_submission!(accept_sub)

  override_block = lesson.content_blocks.create!(
    block_type: :exercise, position: idx * 10 + 2, title: "Ex #{idx + 1}B Override A", filename: "ex_#{idx}_b.rb",
    body: 'Return the square of a number.', submission_type: :prework_github_sync
  )
  ExerciseCheckPolicy.create_version!(
    content_block: override_block, required_checks: [ "prework/ex_#{idx}_b.rb" ], allowed_app_slugs: [ 'github-actions' ], allowed_branch: 'main', created_by: admin
  )
  override_sub = make_verified_sub(
    enrollment: opted_in_enrollment, block: override_block, binding: binding,
    code: "def square(n)\n  n * n\nend", sha: sha_ok, created_at: base_time + (idx * 20 + 1).minutes
  )
  override_sub.github_check_runs.create!(
    external_id: (ext_id += 1), name: "prework/ex_#{idx}_b.rb", app_slug: 'github-actions',
    head_sha: sha_ok, status: 'completed', conclusion: 'success', fetched_at: Time.current
  )
  GithubGradeSuggestionEvaluator.evaluate_submission!(override_sub)

  redo_block = lesson.content_blocks.create!(
    block_type: :exercise, position: idx * 10 + 3, title: "Ex #{idx + 1}C Review Redo", filename: "ex_#{idx}_c.rb",
    body: 'Filter positive numbers.', submission_type: :prework_github_sync
  )
  ExerciseCheckPolicy.create_version!(
    content_block: redo_block, required_checks: [ "prework/ex_#{idx}_c.rb" ], allowed_app_slugs: [ 'github-actions' ], allowed_branch: 'main', created_by: admin
  )
  redo_sub = make_verified_sub(
    enrollment: opted_in_enrollment, block: redo_block, binding: binding,
    code: "def positives(nums)\n  nums\nend", sha: sha_fail, created_at: base_time + (idx * 20 + 2).minutes
  )
  redo_sub.github_check_runs.create!(
    external_id: (ext_id += 1), name: "prework/ex_#{idx}_c.rb", app_slug: 'github-actions',
    head_sha: sha_fail, status: 'completed', conclusion: 'failure', fetched_at: Time.current
  )
  GithubGradeSuggestionEvaluator.evaluate_submission!(redo_sub)

  stale_block = lesson.content_blocks.create!(
    block_type: :exercise, position: idx * 10 + 4, title: "Ex #{idx + 1}D Stale Reeval", filename: "ex_#{idx}_d.rb",
    body: 'Count vowels in a string.', submission_type: :prework_github_sync
  )
  ExerciseCheckPolicy.create_version!(
    content_block: stale_block, required_checks: [ "prework/ex_#{idx}_d.rb" ], allowed_app_slugs: [ 'github-actions' ], allowed_branch: 'main', created_by: admin
  )
  stale_sub = make_verified_sub(
    enrollment: opted_in_enrollment, block: stale_block, binding: binding,
    code: "def count_vowels(s)\n  s.scan(/[aeiou]/i).length\nend", sha: sha_stale, created_at: base_time + (idx * 20 + 3).minutes
  )
  stale_sub.github_check_runs.create!(
    external_id: (ext_id += 1), name: "prework/ex_#{idx}_d.rb", app_slug: 'github-actions',
    head_sha: sha_stale, status: 'completed', conclusion: 'success', fetched_at: Time.current
  )
  GithubGradeSuggestionEvaluator.evaluate_submission!(stale_sub)
  # Bump policy version to v2 so existing v1 suggestion is stale until re-evaluated!
  ExerciseCheckPolicy.create_version!(
    content_block: stale_block, required_checks: [ "prework/ex_#{idx}_d.rb" ], allowed_app_slugs: [ 'github-actions' ], allowed_branch: 'main', created_by: admin
  )

  runs[run_key] = {
    accept_id: accept_sub.id,
    override_id: override_sub.id,
    redo_id: redo_sub.id,
    stale_id: stale_sub.id
  }
end

# Already graded "Checks passed · Grade R" submission
graded_r_block = lesson.content_blocks.create!(
  block_type: :exercise, position: 90, title: 'Ex 90 Checks Passed Grade R', filename: 'ex_90.rb',
  body: 'Implement fizzbuzz without hardcoding.', submission_type: :prework_github_sync
)
ExerciseCheckPolicy.create_version!(
  content_block: graded_r_block, required_checks: [ 'prework/ex_90.rb' ], allowed_app_slugs: [ 'github-actions' ], allowed_branch: 'main', created_by: admin
)
graded_r_sub = make_verified_sub(
  enrollment: opted_in_enrollment, block: graded_r_block, binding: binding,
  code: "def fizzbuzz(n)\n  'FizzBuzz'\nend", sha: '9' * 40, created_at: 3.hours.ago,
  grade: 'R', feedback: 'Implement the general loop rather than returning a fixed string.', grader: instructor
)
graded_r_sub.github_check_runs.create!(
  external_id: (ext_id += 1), name: 'prework/ex_90.rb', app_slug: 'github-actions',
  head_sha: '9' * 40, status: 'completed', conclusion: 'success', fetched_at: Time.current
)
graded_r_suggestion = GithubGradeSuggestionEvaluator.evaluate_submission!(graded_r_sub)
graded_r_suggestion.update!(
  decision: 'overridden',
  override_reason: 'Hardcoded output passed minimal tests',
  decided_by_id: instructor.id,
  decided_at: 2.hours.ago
)

# Off cohort (Cohort 3 shape)
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
off_sub = Submission.create!(
  user: student,
  enrollment: off_enrollment,
  content_block: graded_r_block,
  submission_type: :prework_github_sync,
  text: "def fizzbuzz(n)\n  n.to_s\nend",
  num_submissions: 1
)

puts JSON.pretty_generate(
  opted_in_cohort_id: opted_in_cohort.id,
  module_id: mod.id,
  off_cohort_id: off_cohort.id,
  off_submission_id: off_sub.id,
  graded_r_submission_id: graded_r_sub.id,
  runs: runs
)
