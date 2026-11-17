# Owned local QA database only; synthetic people and inert media keys.
require_relative "boot"
load File.expand_path("student-workspace-fixtures.rb", __dir__)
program = Cohort.find(1)
first = program.curriculum.modules.order(:position).first
last = program.curriculum.modules.order(:position).last
program.curriculum.modules.each do |mod|
  lesson = mod.lessons.order(:position).first
  clip = lesson.content_blocks.find_by(block_type: :video) || lesson.content_blocks.create!(block_type: :video, title: "QA counted clip", position: 20)
  clip.update_columns(s3_video_key: "qa/inert-#{clip.id}.mp4", s3_video_duration_seconds: 100)
end
[ 3, 4 ].each do |id|
  enrollment = Enrollment.find_by!(user_id: id, cohort: program)
  enrollment.module_assignments.where(module_id: last.id).destroy_all
  clip = first.lessons.order(:position).first.content_blocks.find_by!(block_type: :video)
  Progress.find_or_create_by!(enrollment: enrollment, user_id: id, content_block: clip).update!(status: id == 3 ? :completed : :in_progress)
  if id == 4
    plan = enrollment.learning_plan || enrollment.build_learning_plan
    plan.update!(active: true, title: "QA personal media plan", milestones: [ { title: "Next", due_on: "2026-12-01", lesson_ids: [ clip.lesson_id ] } ])
  end
end
self_enrollment = User.find(6).enrollments.find_by!(cohort_id: 2)
lesson = self_enrollment.cohort.curriculum.modules.order(:position).first.lessons.order(:position).first
self_enrollment.module_assignments.destroy_all
self_enrollment.lesson_assignments.find_or_create_by!(lesson: lesson).update!(unlocked: true)
clip = lesson.content_blocks.find_by!(block_type: :video)
clip.update_columns(s3_video_key: "qa/inert-#{clip.id}.mp4", s3_video_duration_seconds: 100)
Progress.find_or_create_by!(enrollment: self_enrollment, user_id: 6, content_block: clip).update!(status: :completed)
[ program, self_enrollment.cohort ].each do |cohort|
  [ :draft, :published ].each do |status|
    recording = cohort.recordings.create!(title: "QA #{status} media fix", status: status, source_kind: "external", source_url: "https://example.invalid/clip")
    cohort.enrollments.each { |enrollment| WatchProgress.create!(user: enrollment.user, recording: recording, total_watched_seconds: 90, duration_seconds: 100) }
  end
end
student = User.find(3)
behind = User.find(4)
[ User.find(1), User.find(2) ].each do |staff|
  [ student, behind ].each do |learner|
    dm = DirectConversation.find_or_create_for!(workspace: program.workspace, users: [ staff, learner ])
    12.times { |index| dm.messages.create!(author: learner, body: "QA private history #{learner.id}:#{index}") }
  end
end
channel = program.workspace.channels.find_by!(name: "qa-class")
12.times { |index| channel.messages.create!(author: student, body: "QA blocked class body #{index}") }
channel.messages.create!(author: behind, body: "QA permitted class activity")
UserBlock.find_or_create_by!(blocker: User.find(1), blocked_user: student)
UserBlock.find_or_create_by!(blocker: student, blocked_user: User.find(2))
# These contexts are separate so active requests respect the partial unique index.
[ student, behind ].each do |learner|
  lesson = first.lessons.create!(title: "QA support fixture #{learner.id}", position: 80 + learner.id)
  HelpRequest.create!(student: learner, cohort: program, context_type: :lesson, context_id: lesson.id,
    context_label: lesson.title, context_path: "/lessons/#{lesson.id}", category: :concept, message: "QA open request #{learner.id}")
end
puts "Student workspace fix fixtures ready: blocked student 3; personal plan 4; lesson-only 6."
