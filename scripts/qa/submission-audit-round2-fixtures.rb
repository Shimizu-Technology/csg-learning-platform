require_relative 'boot'
require 'json'
cohort = Cohort.find_by!(name: 'QA Program')
cohort.update!(settings: cohort.settings.deep_merge('features' => { 'student_experience_v2' => false }))
mod = cohort.curriculum.modules.first
enrollment = Enrollment.find_by!(cohort: cohort, user_id: 3)
rows = 4.times.map do |i|
  lesson = mod.lessons.create!(title: "Companion impact #{i}", release_day: 0, position: 100 + i)
  text = lesson.content_blocks.create!(title: "Deploy companion #{i}", block_type: :text, position: 0, body: 'Deploy your site and upload your link.')
  progress = Progress.create!(user_id: 3, enrollment: enrollment, content_block: text, status: :completed)
  abort 'Fixture not complete' unless LearnerProgress.new(enrollment.reload).lesson_progress(lesson).completed
  { lesson_id: lesson.id, block_id: text.id, module_id: mod.id, cohort_id: cohort.id, progress: progress.as_json }
end
File.write(File.expand_path('../../.qa-local/submission-audit-round2.json', __dir__), JSON.pretty_generate(rows))
puts "#{rows.size} completed instruction-only lessons seeded"
