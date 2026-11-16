# Additive, synthetic-only fixtures for PR #281 fix round 1: a queue longer than one page
# (60 waiting attempts) in a cohort that has made its own copy of a shared curriculum.
# Run after scripts/qa/run start, from api/:
#   DATABASE_URL=postgres://localhost/<csg_qa_ database> bundle exec ruby ../scripts/qa/grading-fix1-fixtures.rb
#
# "QA Paging Cohort" and "QA Paging Partner" share "QA Paging Curriculum"; 30 invented
# learners in the first submit two exercises each, then the first cohort makes its copy
# (CurriculumCopyForCohort), which moves their work onto the copy's ids. The instructor
# (QA user 2) teaches both. Prints the cohort, the copy's module and lesson ids, and the
# old ones as JSON for grading-fix1.spec.ts.
require_relative 'boot'
require 'json'
abort 'Paging fixtures already installed' if Cohort.exists?(name: 'QA Paging Cohort')

admin = User.find(1)
instructor = User.find(2)
curriculum = Curriculum.create!(name: 'QA Paging Curriculum', status: :active)
mod = curriculum.modules.create!(name: 'QA Paging Module', position: 0, day_offset: 0, schedule_days: 'daily')
blocks = [ 'Paging practice one', 'Paging practice two' ].each_with_index.map do |title, index|
  lesson = mod.lessons.create!(title: title, position: index, release_day: index, required: true)
  lesson.content_blocks.create!(block_type: :exercise, position: 0, title: title, body: "Synthetic exercise: #{title}.", submission_type: :text_submission)
end
cohort = Cohort.create!(curriculum: curriculum, name: 'QA Paging Cohort', start_date: Date.current - 14, status: :active)
partner = Cohort.create!(curriculum: curriculum, name: 'QA Paging Partner', start_date: Date.current - 14, status: :active)
[ cohort, partner ].each { |course| CohortInstructorAssignment.create!(cohort: course, user: instructor) }

30.times do |index|
  user = User.create!(clerk_id: "qa_paging_#{index}", email: "paging-#{index}@example.invalid", first_name: format('Pager%02d', index + 1),
                      last_name: 'Synthetic', role: :student, community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  enrollment = Enrollment.create!(user: user, cohort: cohort, status: :active)
  ModuleAssignment.create!(enrollment: enrollment, curriculum_module: mod, unlocked: true)
  blocks.each_with_index do |block, offset|
    at = (200 - (index * 2) - offset).hours.ago
    Submission.create!(user: user, enrollment: enrollment, content_block: block, submission_type: :text_submission,
                       text: "Synthetic answer #{index + 1}.#{offset + 1}: **bold** and `code`.", created_at: at, updated_at: at)
  end
end

old_lesson_ids = blocks.map(&:lesson_id)
CurriculumCopyForCohort.new(cohort: cohort, user: admin, source_curriculum_id: curriculum.id).copy!
copy = cohort.reload.curriculum
copy_module = copy.modules.find_by!(name: 'QA Paging Module')
first = Submission.joins(:enrollment).where(enrollments: { cohort_id: cohort.id }).order(:created_at, :id).first
puts JSON.generate(cohort_id: cohort.id, copy_module_id: copy_module.id, old_module_id: mod.id,
                   copy_lesson_ids: copy_module.lessons.order(:position).pluck(:id), old_lesson_ids: old_lesson_ids,
                   waiting: Submission.joins(:enrollment).where(enrollments: { cohort_id: cohort.id }, grade: nil).count, first_id: first.id)
