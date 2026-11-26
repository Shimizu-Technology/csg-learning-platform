require_relative 'boot'

# Synthetic fixtures for unified-grading-and-help.spec.ts: a Pass / Redo curriculum and cohort
# taught by the QA instructor (2), with one rubric-graded attempt from the program student (3)
# waiting per browser run, a lesson where that student asks for help, and a lesson the admin (1)
# edits in the lesson editor. Run once after scripts/qa/run start, from api/:
#   DATABASE_URL=postgresql://localhost/<qa db> RAILS_ENV=test bundle exec ruby ../scripts/qa/unified-grading-and-help-fixtures.rb

instructor = User.find(2)
student = User.find(3)
runs = 4 # light and dark, at 1280 and 390

curriculum = Curriculum.create!(name: 'Pass Redo QA Curriculum', grading_scale: 'pass_redo')
rubric = curriculum.rubrics.create!(title: 'Practice rubric', rubric_criteria_attributes: [
  { title: 'Works as asked', description: 'The fictional program does what the task asks', position: 0 },
  { title: 'Reads clearly', description: 'Names and steps are easy to follow', position: 1 }
])
mod = curriculum.modules.create!(name: 'Practice week', position: 0, day_offset: 0, schedule_days: 'weekdays')
lesson = mod.lessons.create!(title: 'Pass QA practice', position: 0, release_day: 0, requires_submission: true, published: true)
blocks = Array.new(runs) do |index|
  lesson.content_blocks.create!(block_type: :exercise, position: index, title: "Practice #{index + 1}",
    body: 'Write a fictional greeting.', submission_type: :text_submission, rubric: rubric)
end
editor_lesson = mod.lessons.create!(title: 'Pass QA project', position: 1, release_day: 0, published: true)
editor_block = editor_lesson.content_blocks.create!(block_type: :exercise, position: 0, title: 'Ship a project',
  body: 'Share your fictional project.', submission_type: :repo_url_submission)

cohort = Cohort.create!(
  name: 'Pass Redo QA Cohort',
  curriculum: curriculum,
  start_date: Date.current - 7.days,
  status: :active,
  settings: { 'features' => { 'student_experience_v2' => true, 'help_requests' => true } }
)
cohort.cohort_instructor_assignments.create!(user: instructor)
enrollment = Enrollment.create!(user: student, cohort: cohort, status: :active)
enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)

submissions = blocks.map do |block|
  Submission.create!(user: student, enrollment: enrollment, content_block: block, submission_type: :text_submission,
    text: "puts 'Hafa adai from #{block.title}'")
end

fixtures = {
  curriculum_id: curriculum.id,
  cohort_id: cohort.id,
  module_id: mod.id,
  lesson_id: lesson.id,
  editor_lesson_id: editor_lesson.id,
  editor_block_id: editor_block.id,
  submission_ids: submissions.map(&:id)
}
path = File.expand_path('../../.qa-local/unified-grading-and-help.json', __dir__)
File.write(path, JSON.pretty_generate(fixtures))
puts fixtures.to_json
