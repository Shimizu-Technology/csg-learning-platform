# Local-only additions for W7 PR 7.5. Never reads production data.
require_relative "boot"
program = Cohort.find_by!(name: "QA Program")
self_paced = Cohort.find_by!(name: "QA Self paced")
student = User.find(3)
instructor = User.find(2)
admin = User.find(1)
Enrollment.find_or_create_by!(user: student, cohort: self_paced) do |enrollment|
  enrollment.status = :active
end
student.enrollments.find_by!(cohort: self_paced).assign_cohort_content_defaults!
[admin, instructor].each do |staff|
  conversation = DirectConversation.find_or_create_for!(workspace: program.workspace, users: [staff, student])
  conversation.messages.create!(author: student, body: "QA workspace message for #{staff.role}")
end
channel = program.workspace.channels.find_by!(name: "qa-class")
channel.messages.create!(author: student, body: "QA workspace channel activity")
config = program.private_meeting_config || program.create_private_meeting_config!(instructor: instructor, weeks: 8)
start = 2.days.from_now.change(hour: 15, min: 0)
slot = config.private_meeting_slots.create!(instructor: instructor, starts_at: start, ends_at: start + 1.hour)
PrivateMeetingBooking.create!(cohort: program, student: student, enrollment: student.enrollments.find_by!(cohort: program), instructor: instructor,
  private_meeting_slot: slot, starts_at: start, ends_at: start + 1.hour, week_number: config.week_for(start))
objective = program.curriculum.learning_objectives.create!(code: "QA.W7", title: "Explain a fictional counter", success_criteria: "I can describe the fictional result", position: 0)
lesson = program.curriculum.modules.order(:position).first.lessons.order(:release_day, :position).first
block = lesson.content_blocks.find_by!(block_type: :exercise, submission_type: :text_submission)
ObjectiveAlignment.create!(learning_objective: objective, lesson: lesson, content_block: block)
Submission.where(user: student, content_block: block).update_all(grade: "A", graded_at: Time.current)
puts "QA workspace fixtures: program=#{program.id}, self_paced=#{self_paced.id}, lesson=#{lesson.id}, module=#{lesson.module_id}, meeting=#{PrivateMeetingBooking.last.id}"
