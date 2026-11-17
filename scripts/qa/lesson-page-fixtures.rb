require_relative 'boot'
require 'json'
path = Pathname.new(__dir__).join('../../.qa-local/lesson-page.json')
if ARGV.first == 'reset'
  data = JSON.parse(path.read)
  enrollment = Enrollment.find_by!(cohort_id: data.fetch('cohort'), user_id: 3)
  HelpRequest.where(cohort_id: enrollment.cohort_id, student_id: 3).destroy_all
  Progress.where(enrollment: enrollment).delete_all
  Submission.where(enrollment: enrollment).delete_all
  Progress.create!(enrollment: enrollment, user_id: 3, content_block: Lesson.find(data.fetch('video')).content_blocks.sole, status: :completed, completed_at: Time.current)
  Submission.create!(enrollment: enrollment, user_id: 3, content_block: Lesson.find(data.fetch('redo')).content_blocks.sole, text: 'print("earlier answer")', grade: 'R', feedback: 'Explain the boundary case, then try again.', graded_by_id: 2, graded_at: Time.current)
  puts 'Reset lesson journey'
  exit
end
ActiveRecord::Base.transaction do
curriculum = Curriculum.create!(name: 'QA Lesson Journey')
first = curriculum.modules.create!(name: 'Python foundations', position: 0, day_offset: 0, schedule_days: 'daily')
last = curriculum.modules.create!(name: 'Putting it together', position: 1, day_offset: 7, schedule_days: 'daily')
make = lambda do |mod, title, day, type, attrs|
  lesson = mod.lessons.create!(title: title, position: 0, release_day: day, lesson_type: type == :text ? :reading : type == :video ? :video : :exercise)
  lesson.content_blocks.create!({ block_type: type, title: title, position: 0 }.merge(attrs))
  lesson
end
reading = make.call(first, 'Read Python without wrapping', 0, :text, { body: "## Start here\nRead this fictional example.\n\n```python\n#{'very_long_python_identifier_' * 8} = 'kept on one line'\n```" })
video = make.call(first, 'Watch the counter', 1, :video, { video_url: 'https://example.invalid/qa-counter.mp4', body: 'Synthetic video placeholder. Playback is outside this harness.' })
exercise = make.call(first, 'Count fictional seedlings', 2, :exercise, { filename: 'counter.py', submission_type: :text_submission, body: 'Write Python that prints the fictional seedling count.' })
redo_lesson = make.call(first, 'Review the boundary case', 3, :exercise, { filename: 'boundary.py', submission_type: :text_submission, body: 'Handle the empty collection too.' })
manual = make.call(first, 'Try it in your terminal', 4, :exercise, { submission_type: :manual_complete, body: 'Run the fictional example. Nothing to hand in.' })
final = make.call(last, 'Reflect on your course', 0, :text, { body: 'You have reached the last lesson. Reflect on what you learned.' })
cohort = Cohort.create!(name: 'QA Lesson Program On', curriculum: curriculum, start_date: Date.current - 30, status: :active, settings: { 'features' => { 'student_experience_v2' => true, 'private_meetings' => false } })
cohort.instructors << User.find(2)
enrollment = Enrollment.create!(user_id: 3, cohort: cohort, status: :active)
[ first, last ].each { |mod| enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true) }
off = Cohort.create!(name: 'QA Running Program Off (Lance shape)', curriculum: curriculum, start_date: Date.current - 30, status: :active, settings: { 'features' => { 'student_experience_v2' => false } })
off.instructors << User.find(2)
off_enrollment = Enrollment.create!(user_id: 4, cohort: off, status: :active)
[ first, last ].each { |mod| off_enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true) }
self_paced = Cohort.create!(name: 'QA Lesson self-paced', curriculum: curriculum, course_delivery: 'self_paced', start_date: Date.current + 30, status: :active, settings: { 'features' => { 'student_experience_v2' => true } })
self_paced.instructors << User.find(2)
self_paced.update!(support_instructor_id: 2)
self_enrollment = Enrollment.create!(user_id: 7, cohort: self_paced, status: :active)
[ first, last ].each { |mod| self_enrollment.module_assignments.create!(curriculum_module: mod) }
conversation = DirectConversation.find_or_create_for!(workspace: cohort.workspace, users: [User.find(2), User.find(3)])
Message.create!(direct_conversation: conversation, author: User.find(2), body: 'Welcome, Alex. Ask me about your lesson here.')
ids = { cohort: cohort.id, off_cohort: off.id, self_paced_cohort: self_paced.id, reading: reading.id, video: video.id, exercise: exercise.id, redo: redo_lesson.id, manual: manual.id, final: final.id, conversation: conversation.id }
path.write(JSON.pretty_generate(ids))
puts ids.to_json

end
