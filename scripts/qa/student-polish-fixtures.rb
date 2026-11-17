require_relative 'boot'
require 'json'
# Extend #296's isolated fixtures. No production data or provider writes.
ids = JSON.parse(File.read(Rails.root.join('..', '.qa-local', 'first-run.json')))
cohort = Cohort.find(ids.fetch('program'))
mod = cohort.curriculum.modules.order(:position).first
lesson = mod.lessons.create!(title: 'QA polish block types', position: 99, release_day: 0, required: false)
video = lesson.content_blocks.create!(block_type: :video, title: 'Watch synthetic video', position: 0, video_url: 'https://www.youtube.com/watch?v=polishVideo')
%w[text_submission repo_url_submission repo_and_live_url_submission manual_complete prework_github_sync].each_with_index do |kind, i|
  lesson.content_blocks.create!(block_type: :exercise, title: "Polish #{kind}", position: i + 1, submission_type: kind, filename: kind == 'text_submission' ? 'answer.md' : nil, body: 'Use invented work only.')
end
check = lesson.content_blocks.create!(block_type: :checkpoint, title: 'Polish recall', position: 6)
check.create_knowledge_check!(prompt: 'Choose the number five', options: %w[5 9], correct_option: 0, explanation: 'Five is the synthetic answer.')
cohort.update!(settings: (cohort.settings || {}).merge('class_resources' => [{ 'title' => 'Polish reference', 'url' => 'https://example.invalid/reference', 'category' => 'reference' }]))
ids['polish_video_block'] = video.id
ids['polish_lesson'] = lesson.id
ids['polish_module'] = mod.id
File.write(Rails.root.join('..', '.qa-local', 'student-polish.json'), JSON.pretty_generate(ids))
puts 'Student polish fixtures ready'
