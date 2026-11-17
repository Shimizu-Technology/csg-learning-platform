# W8 PR 8.2 student Today and My work QA. Run from api/ with the owned harness
# DATABASE_URL, after course-outline-fixtures.rb setup.
#
#   bundle exec ruby ../scripts/qa/student-today-fixtures.rb setup
#     On the canonical 127-lesson program: gives persona 3 (Alex) a graded
#     exercise, an answered help request with its unread notification, an open
#     question, an unread instructor message and next week's live class; gives
#     persona 4 (behind, 5 of 127) seven redos; adds a behind learner with an
#     agreed catch-up plan ("QA Blair Plan"); and gives persona 6 (self-paced,
#     halfway) two submissions waiting for review. Writes ids to
#     .qa-local/student-today.json.
#   Switch the redesign with course-outline-fixtures.rb switch on|off.
#
# Synthetic people only; never reads a production database.
require_relative "boot"

path = Rails.root.join("..", ".qa-local", "student-today.json")
#   bundle exec ruby ../scripts/qa/student-today-fixtures.rb unread
#     Marks persona 3's help answer and instructor message unread again, after
#     the journey reads them (View response; Ask about this feedback opens the DM).
if ARGV.first == "unread"
  ids = JSON.parse(path.read)
  request = HelpRequest.find(ids.fetch("answered_help_request"))
  Notification.where(user_id: 3, notifiable: request).update_all(read_at: nil)
  DirectConversationMember.where(direct_conversation_id: ids.fetch("conversation"), user_id: 3).update_all(last_read_at: nil, last_read_message_id: nil)
  puts "Help answer #{request.id} and conversation #{ids.fetch('conversation')} unread again"
  exit
end
abort "usage: student-today-fixtures.rb setup | unread" unless ARGV.first == "setup"

program = Cohort.find_by!(name: "QA canonical program")
self_paced = Cohort.find_by!(name: "QA canonical self_paced")
instructor = User.find(2)
lessons = program.curriculum.modules.find_by!(name: "Prework").lessons.order(:release_day, :position).to_a
work = lessons.select { |lesson| lesson.completion_blocks.any?(&:gradable_work_block?) }
block = ->(lesson) { lesson.completion_blocks.find(&:gradable_work_block?) }
ids = {}
ActiveRecord::Base.transaction do
  alex = program.enrollments.find_by!(user_id: 3)
  graded_lesson = work[2]
  Submission.find_or_create_by!(enrollment: alex, user_id: 3, content_block: block.call(graded_lesson)) do |row|
    row.assign_attributes(submission_type: :text_submission, text: "Synthetic answer", grade: "A", feedback: "Clean and readable. Good use of `const`.", graded_by_id: instructor.id, graded_at: 2.days.ago)
  end

  # An answered help request (unread notification) and one still waiting for a reply.
  answered_lesson = lessons[12]
  answered = HelpRequest.find_or_create_by!(student_id: 3, cohort: program, context_type: :lesson, context_id: answered_lesson.id) do |row|
    row.assign_attributes(context_label: answered_lesson.title, context_path: "/lessons/#{answered_lesson.id}", category: :concept, message: "My loop never stops. What am I missing?")
  end
  if answered.replies.empty?
    reply = answered.reply!(instructor, body: "Check the condition **before** the loop runs: it never becomes false.")
    NotificationDeliveryService.help_request_changed(answered.reload, push: false, reply: reply)
  end
  waiting_lesson = lessons[14]
  question = HelpRequest.find_or_create_by!(student_id: 3, cohort: program, context_type: :lesson, context_id: waiting_lesson.id) do |row|
    row.assign_attributes(context_label: waiting_lesson.title, context_path: "/lessons/#{waiting_lesson.id}", category: :instructions, message: "Is this exercise asking for a function or a script?")
  end

  # An unread message from the instructor.
  conversation = DirectConversation.find_or_create_for!(workspace: program.workspace, users: [ instructor, User.find(3) ])
  unless conversation.messages.exists?(author_id: instructor.id, body: "Nice work on the conditionals exercise. One small thing about naming…")
    Message.create!(direct_conversation: conversation, author: instructor, body: "Nice work on the conditionals exercise. One small thing about naming…")
  end

  # Next week's live class, past this week (L-1.4).
  program.office_hours.find_or_create_by!(title: "Week 18: Loops in practice") do |row|
    starts = 9.days.from_now.change(hour: 9)
    row.assign_attributes(description: "Bring a loop you are stuck on.", starts_at: starts, ends_at: starts + 1.hour, meeting_url: "https://example.invalid/zoom/qa-live-class",
      timezone: "Pacific/Guam", recurrence: :once, event_kind: :live_class, created_by: instructor)
  end

  # The behind learner: seven redos on early work, so Needs you shows five and "Show all".
  behind = program.enrollments.find_by!(user_id: 4)
  work.first(7).each_with_index do |lesson, index|
    Submission.find_or_create_by!(enrollment: behind, user_id: 4, content_block: block.call(lesson)) do |row|
      row.assign_attributes(submission_type: :text_submission, text: "Synthetic answer #{index}", grade: "R", feedback: "Redo #{index + 1}: return the value instead of printing it.", graded_by_id: instructor.id, graded_at: (index + 1).days.ago)
    end
  end

  # A behind learner with an agreed catch-up plan.
  blair = User.find_or_create_by!(email: "blair-plan@example.invalid") do |user|
    user.assign_attributes(clerk_id: "qa_blair_plan", first_name: "Blair", last_name: "Plan", role: :student, community_terms_accepted_at: Time.current,
      community_terms_version: CommunityPolicy::VERSION, last_sign_in_at: 2.days.ago, last_seen_at: Time.current)
  end
  ClerkIdentity.find_or_create_by!(user: blair, issuer: "https://test.clerk.invalid", clerk_user_id: blair.clerk_id)
  plan_enrollment = program.enrollments.find_or_create_by!(user: blair) { |row| row.status = :active }
  plan_enrollment.module_assignments.find_or_create_by!(curriculum_module: lessons.first.curriculum_module) { |row| row.unlocked = true }
  lessons.first(20).flat_map(&:completion_blocks).each do |item|
    Progress.find_or_create_by!(enrollment: plan_enrollment, user: blair, content_block: item) { |row| row.assign_attributes(status: :completed, completed_at: 5.days.ago) }
  end
  remaining = lessons.drop(20).select(&:required?).first(14)
  today = LearningCalendar.today
  plan = LearningPlan.find_or_initialize_by(enrollment: plan_enrollment)
  plan.assign_attributes(title: "Catch up by early December", description: "Required lessons first; optional ones can wait.", active: true, target_date: today + 16,
    milestones: [ { "title" => "This week", "due_on" => (today + 2).iso8601, "lesson_ids" => remaining.first(5).map(&:id) },
      { "title" => "Next week", "due_on" => (today + 9).iso8601, "lesson_ids" => remaining.drop(5).first(5).map(&:id) },
      { "title" => "Week after", "due_on" => (today + 16).iso8601, "lesson_ids" => remaining.drop(10).map(&:id) } ])
  if plan.changed? || plan.new_record?
    plan.save!
    plan.revisions.create!(author: instructor, snapshot: plan.snapshot)
  end

  # Self-paced, halfway: two submissions waiting for review.
  dana = self_paced.enrollments.find_by!(user_id: 6)
  work.drop(30).first(2).each do |lesson|
    Submission.find_or_create_by!(enrollment: dana, user_id: 6, content_block: block.call(lesson)) { |row| row.assign_attributes(submission_type: :text_submission, text: "Synthetic answer") }
  end

  ids = { program: program.id, self_paced: self_paced.id, alumni: Cohort.find_by!(name: "QA canonical alumni").id, qa_program: Cohort.find_by!(name: "QA Program").id,
    blair: blair.id, answered_help_request: answered.id, answered_lesson: answered_lesson.id, open_question: question.id, conversation: conversation.id }
end
path.write(JSON.pretty_generate(ids))
puts "Student Today fixtures: #{path}"
