# Additive, synthetic-only fixtures for "Make a copy for this cohort" (W5 PR 5.3 part 2b).
# Run after scripts/qa/run start:  ruby scripts/qa/copy-fixtures.rb setup | verify
# setup: a second cohort shares QA Program Lab, the QA instructor gets lesson editing on
#        QA Program, and each learner's progress (LearnerProgress) is saved by lesson title.
# verify: after the copy, every learner's statuses, counts and next step match what was saved.
require_relative 'boot'
require 'json'
SNAPSHOT = File.expand_path('../../.qa-local/copy-before.json', __dir__)

def views
  Enrollment.joins(:cohort).where(cohorts: { name: [ 'QA Program', 'QA Program 2' ] }).order(:id).to_h do |enrollment|
    progress = LearnerProgress.new(Enrollment.find(enrollment.id), now: Time.zone.parse(Date.current.iso8601 + 'T12:00:00'))
    rows = progress.lessons.map { |lesson| entry = progress.lesson_progress(lesson); [ lesson.title, entry.status, entry.completed_blocks, entry.total_blocks, entry.available ] }
    work = Submission.where(enrollment_id: enrollment.id).order(:id).pluck(:id, :grade, :text)
    # Each exercise's effective submission type and GitHub repository (per-module settings).
    github = enrollment.cohort.settings.fetch('module_github_config', {})
    exercises = progress.lessons.flat_map do |lesson|
      lesson.content_blocks.select(&:exercise_like?).map do |block|
        [ lesson.title, block.title, block.submission_type_for(enrollment), github.dig(lesson.module_id.to_s, 'repository_name').presence || enrollment.cohort.repository_name ]
      end
    end
    [ "#{enrollment.cohort.name} / #{enrollment.user.email}", { lessons: rows, overall: progress.overall, next: progress.next_lesson&.title, work: work, exercises: exercises } ]
  end
end

case ARGV.first
when 'setup'
  abort 'Copy fixtures already installed' if Cohort.exists?(name: 'QA Program 2')
  program = Cohort.find_by!(name: 'QA Program')
  admin = User.find_by!(email: 'admin@example.invalid')
  instructor = User.find_by!(email: 'instructor@example.invalid')
  other = Cohort.create!(name: 'QA Program 2', curriculum: program.curriculum, start_date: Date.current - 21, status: :active)
  learner = User.create!(clerk_id: 'qa_other_program', email: 'other-program@example.invalid', first_name: 'QA', last_name: 'Other program', role: :student,
                         community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  ClerkIdentity.create!(user: learner, issuer: 'https://test.clerk.invalid', clerk_user_id: learner.clerk_id)
  enrollment = Enrollment.create!(user: learner, cohort: other, status: :active)
  enrollment.assign_cohort_content_defaults!
  block = ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: program.curriculum_id }, block_type: :exercise, submission_type: :text_submission).order(:id).first
  Submission.create!(user: learner, enrollment: enrollment, content_block: block, submission_type: :text_submission, text: 'Other cohort synthetic answer')
  CohortInstructorAssignment.find_by!(cohort: program, user: instructor).set_lesson_editing!(true, by: admin)
  # Per-module GitHub settings must follow the copied modules.
  github_module = program.curriculum.modules.order(:position).first
  program.update_columns(settings: program.settings.merge('module_github_config' => { github_module.id.to_s => { 'requires_github' => true, 'repository_name' => 'qa-module-repo' } }))
  File.write(SNAPSHOT, JSON.pretty_generate(views))
  puts({ other_learner_id: learner.id, lesson_id: block.lesson_id, snapshot: SNAPSHOT }.to_json)
when 'verify'
  before = JSON.parse(File.read(SNAPSHOT))
  after = JSON.parse(JSON.generate(views))
  copy = CurriculumCopy.sole
  program = Cohort.find_by!(name: 'QA Program')
  github_modules = program.settings.fetch('module_github_config', {}).keys.map(&:to_i)
  puts({ copy_curriculum: copy.copy_curriculum.name, counts: copy.counts, other_cohort_curriculum: Cohort.find_by!(name: 'QA Program 2').curriculum.name,
         github_settings_on_copy: CurriculumModule.where(id: github_modules, curriculum_id: program.curriculum_id).count == github_modules.size,
         learners: after.keys, identical: before == after }.to_json)
  abort 'Per-module GitHub settings were left on the shared modules' unless CurriculumModule.where(id: github_modules, curriculum_id: program.curriculum_id).count == github_modules.size
  abort 'Learner progress changed' unless before == after
else
  abort 'usage: copy-fixtures.rb setup|verify'
end
