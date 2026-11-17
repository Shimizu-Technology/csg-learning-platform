# Additive, synthetic-only fixtures for "Where used" and the content record pages (W5 PR 5.4).
# Run after scripts/qa/run start, against the harness's own database:
#   cd api && DATABASE_URL=postgresql://localhost/<csg_qa_ database> RAILS_ENV=test bundle exec ruby ../scripts/qa/where-used-fixtures.rb
# - "QA Program 2" shares QA Program Lab with QA Program. The QA instructor (2) teaches only QA Program,
#   so QA Program 2's name, learner, work and question must never reach them.
# - "QA Program 3" moved to its own copy of QA Program Lab, made by the admin: copy history for the admin,
#   one unnamed copy for the instructor.
# - The QA instructor has lesson editing access for QA Program only (fix round 1), so the shared lesson's
#   editor is read only and must say the curriculum is shared without naming QA Program 2.
# - The QA instructor owns one active follow-up plan (already seeded) for the team member page.
require_relative 'boot'
abort 'Where-used fixtures already installed' if Cohort.exists?(name: 'QA Program 2')

admin = User.find(1)
program = Cohort.find_by!(name: 'QA Program')
curriculum = program.curriculum

def learner(slug, name)
  user = User.create!(clerk_id: "qa_#{slug}", email: "#{slug}@example.invalid", first_name: 'QA', last_name: name, role: :student,
                      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  ClerkIdentity.create!(user: user, issuer: 'https://test.clerk.invalid', clerk_user_id: user.clerk_id)
  user
end

second = Cohort.create!(name: 'QA Program 2', curriculum: curriculum, start_date: Date.current - 14, status: :active)
other = learner('where_used_other', 'Second cohort learner')
enrollment = Enrollment.create!(user: other, cohort: second, status: :active)
enrollment.assign_cohort_content_defaults!
block = ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: curriculum.id }, block_type: :exercise).order(:id).first
Submission.create!(user: other, enrollment: enrollment, content_block: block, submission_type: block.submission_type.presence || :text_submission,
                   text: 'Second cohort synthetic answer')
HelpRequest.create!(student: other, cohort: second, category: :concept, context_type: :lesson, context_source: :primary, context_id: block.lesson_id,
                    context_label: block.lesson.title, context_path: "/lessons/#{block.lesson_id}", message: 'Second cohort synthetic question')

CohortInstructorAssignment.find_by!(cohort: program, user_id: 2).set_lesson_editing!(true, by: admin)
# A question on another lesson in QA Program: the lesson's "open help" must not open it.
other_lesson = Lesson.joins(:curriculum_module).where(modules: { curriculum_id: curriculum.id }).where.not(id: block.lesson_id)
                     .where.not(id: HelpRequest.where(context_type: :lesson).select(:context_id)).order(:id).first
HelpRequest.create!(student: User.find(3), cohort: program, category: :concept, context_type: :lesson, context_source: :primary, context_id: other_lesson.id,
                    context_label: other_lesson.title, context_path: "/lessons/#{other_lesson.id}", message: 'Synthetic question on another lesson')

third = Cohort.create!(name: 'QA Program 3', curriculum: curriculum, start_date: Date.current - 7, status: :active)
copy = Curriculum.create!(name: "#{curriculum.name} (QA Program 3's copy)", status: :active)
copy.modules.create!(name: 'QA Week 1', position: 0, day_offset: 0, schedule_days: 'weekdays')
CurriculumCopy.create!(cohort: third, source_curriculum: curriculum, copy_curriculum: copy, created_by: admin, counts: { 'lessons' => 0 })
third.update_columns(curriculum_id: copy.id)

require 'json'
ids = { shared_curriculum_id: curriculum.id, module_id: block.lesson.module_id, lesson_id: block.lesson_id, second_cohort_id: second.id,
        copy_curriculum_id: copy.id, program_cohort_id: program.id, other_lesson_id: other_lesson.id }
File.write(File.expand_path('../../.qa-local/where-used.json', __dir__), JSON.pretty_generate(ids))
puts ids.to_json
