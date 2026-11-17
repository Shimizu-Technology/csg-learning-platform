require_relative 'boot'
mod = CurriculumModule.find_by!(name: 'QA Week 1', curriculum: Curriculum.find_by!(name: 'QA Program Lab'))
# Move synthetic lessons onto MWF once; widening thereafter must be display-only.
mod.lessons.each { |lesson| lesson.update!(release_day: lesson.release_day * 2) } if mod.lessons.maximum(:release_day) == 2
mod.update!(schedule_days: 'mwf')
before = mod.lessons.pluck(:id, :release_day)
mod.update!(schedule_days: 'weekdays')
abort 'Release days moved' unless before == mod.lessons.pluck(:id, :release_day)
4.times do |i|
  lesson = mod.lessons.first
  block = lesson.content_blocks.find_or_create_by!(title: "Audit fixture #{i}") do |b|
    b.position = 10 + i
    b.block_type = :exercise
    b.body = 'Build a fictional counter and submit a screenshot.'
    b.submission_type = :manual_complete
  end
  Progress.find_or_create_by!(user_id: 3, enrollment: Enrollment.find_by!(user_id: 3, cohort: Cohort.find_by!(name: 'QA Program')), content_block: block) { |p| p.status = :completed }
end
puts({ module_id: mod.id, curriculum_id: mod.curriculum_id, lesson_id: mod.lessons.first.id, cohort_id: Cohort.find_by!(name: 'QA Program').id }.to_json)

cohort = Cohort.find_by!(name: 'QA Program')
cohort.update!(settings: cohort.settings.deep_merge('features' => { 'student_experience_v2' => false }))
4.times do |i|
  mod.lessons.first.content_blocks.find_or_create_by!(title: "Instruction audit #{i}") do |b|
    b.position = 14 + i
    b.block_type = :text
    b.body = 'Upload your file after reading these instructions.'
    b.submission_type = :manual_complete
  end
end
