# Additive, synthetic-only L-0.9 fixtures. Run after scripts/qa/run start.
require_relative 'boot'
abort 'Search fixtures already installed' if Curriculum.exists?(name: 'Forbidden curriculum')
cohort = Cohort.find(1)
cohort.update!(settings: cohort.settings.merge('class_resources' => [
  { 'title' => 'Synthetic resource', 'url' => 'https://example.invalid/resource', 'description' => 'Synthetic resource description' }
]))
other_curriculum = Curriculum.create!(name: 'Forbidden curriculum')
Cohort.create!(name: 'Forbidden cohort', curriculum: other_curriculum, start_date: Date.current)
other_module = other_curriculum.modules.create!(name: 'Forbidden module', position: 0)
other_module.lessons.create!(title: 'Forbidden lesson', position: 0, release_day: 0)
lesson = Lesson.find(1)
lesson.update!(title: 'QA finished lesson')
enrollment = Enrollment.find_by!(user_id: 3, cohort_id: 1)
lesson.content_blocks.each do |block|
  Progress.find_or_create_by!(user_id: 3, enrollment_id: enrollment.id, content_block_id: block.id).update!(status: :completed)
end
