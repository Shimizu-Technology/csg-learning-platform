# Additive, synthetic-only fixtures for the L-5.2 staff record pages: a recording with a lesson that plays
# it, an office-hour session, a private-meeting booking, a learning plan with revisions, a channel with a
# blocked sender, a rubric in use and activity events. Run once after scripts/qa/run start, from api/:
#   DATABASE_URL=postgresql://localhost/<csg_qa_ database> RAILS_ENV=test bundle exec ruby ../scripts/qa/record-pages-fixtures.rb
# - QA Program (taught by the QA instructor, 2) gets one of each record.
# - "QA Other Program" shares QA Program Lab and is taught only by "QA Other instructor". The QA instructor
#   must never open its records or see its name; the admin sees everything.
# - The QA instructor blocks the behind student (4), so that learner's channel message reads "Message hidden".
# Writes the ids to .qa-local/record-pages.json for record-pages.spec.ts.
require_relative 'boot'
abort 'Record-page fixtures already installed' if Cohort.exists?(name: 'QA Other Program')

admin = User.find(1)
instructor = User.find(2)
program_student = User.find(3)
behind = User.find(4)
program = Cohort.find_by!(name: 'QA Program')
curriculum = program.curriculum

def person(slug, last_name, role)
  user = User.create!(clerk_id: "qa_#{slug}", email: "#{slug}@example.invalid", first_name: 'QA', last_name: last_name, role: role,
                      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  ClerkIdentity.create!(user: user, issuer: 'https://test.clerk.invalid', clerk_user_id: user.clerk_id)
  user
end

def book(cohort, enrollment, host, starts)
  config = PrivateMeetingConfig.find_or_create_by!(cohort: cohort) { |record| record.instructor = host; record.duration_minutes = 30; record.weeks = 12 }
  slot = config.private_meeting_slots.create!(instructor: host, starts_at: starts, ends_at: starts + 30.minutes)
  PrivateMeetingBooking.create!(private_meeting_slot: slot, cohort: cohort, enrollment: enrollment, student: enrollment.user, instructor: host,
                                starts_at: starts, ends_at: starts + 30.minutes, week_number: config.week_for(starts) || 1)
end

ActiveRecord::Base.transaction do
  # Recording: a lesson in QA Week 2 plays the seeded recording, in two sections.
  recording = program.recordings.find_by!(title: 'QA counter walkthrough')
  recording.update!(duration_seconds: 2400, recorded_date: program.start_date + 8, uploaded_by: instructor)
  lesson = Lesson.joins(:curriculum_module).where(modules: { curriculum_id: curriculum.id, position: 1 }).order(:release_day, :position, :id).first
  lesson.content_blocks.create!(block_type: :recording, title: 'Class replay', position: 9, video_url: recording.source_url,
                                metadata: { 'video_segments' => [ { 'label' => 'Set up the synthetic counter', 'start_seconds' => 90, 'end_seconds' => 720, 'required' => true },
                                                                  { 'label' => 'Optional: count by twos', 'start_seconds' => 800, 'end_seconds' => 1100, 'required' => false } ] })
  WatchProgress.create!(user: program_student, recording: recording, total_watched_seconds: 1200, duration_seconds: 2400, last_watched_at: 2.hours.ago)
  WatchProgress.create!(user: behind, recording: recording, total_watched_seconds: 2400, duration_seconds: 2400, completed: true, last_watched_at: 3.days.ago)
  # 28 more watchers (watched longer ago), so the list runs past one page of 25 and "Show more" loads the rest.
  28.times do |i|
    watcher = person("record_watcher_#{i}", format('Watcher %02d', i), :student)
    Enrollment.create!(user: watcher, cohort: program, status: :active).assign_cohort_content_defaults!
    WatchProgress.create!(user: watcher, recording: recording, total_watched_seconds: 600, duration_seconds: 2400, last_watched_at: (5 + i).days.ago)
  end

  # Office hours: the seeded weekly session.
  office_hour = program.office_hours.find_by!(title: 'QA weekly support')

  # Booking: persona 3 with the QA instructor, link changed once.
  enrollment = program.enrollments.find_by!(user: program_student)
  booking = book(program, enrollment, instructor, (Time.current + 2.days).change(hour: 10))
  PrivateMeetingScheduler.event!(booking, program_student, 'booked')
  booking.update!(zoom_url: 'https://example.invalid/zoom-qa')
  PrivateMeetingScheduler.event!(booking, instructor, 'link_updated')

  # Learning plan: persona 3's seeded plan, saved twice.
  plan = enrollment.learning_plan
  plan.revisions.create!(author: instructor, snapshot: plan.snapshot)
  plan.update!(description: 'Two synthetic labs a week.', next_check_in_on: Date.current + 7)
  plan.revisions.create!(author: admin, snapshot: plan.snapshot)

  # Channel: two learner messages; the instructor blocks the behind student.
  channel = program.channels.find_by!(name: 'qa-class')
  Message.create!(channel: channel, author: program_student, body: 'Synthetic question about the counter.')
  Message.create!(channel: channel, author: behind, body: 'Synthetic message from a blocked sender.')
  UserBlock.create!(blocker: instructor, blocked_user: behind)
  copy_message = Message.create!(channel: channel, author: instructor, body: 'Synthetic permalink target: copy this link.')

  # Activity: persona 3's submission in QA Program.
  submission = Submission.where(user: program_student, enrollment: enrollment).order(:id).first
  event = ActivityEvent.record!(event_type: 'submission_created', actor: program_student, cohort: program, record: submission)

  # The other cohort: same curriculum, another instructor, one of each record.
  other_instructor = person('record_other_instructor', 'Other instructor', :instructor)
  other = Cohort.create!(name: 'QA Other Program', curriculum: curriculum, start_date: Date.current - 14, status: :active)
  other.cohort_instructor_assignments.create!(user: other_instructor)
  other_learner = person('record_other_learner', 'Other learner', :student)
  other_enrollment = Enrollment.create!(user: other_learner, cohort: other, status: :active)
  other_enrollment.assign_cohort_content_defaults!
  block = ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: curriculum.id }, rubric_id: curriculum.rubrics.select(:id)).order(:id).first
  other_submission = Submission.create!(user: other_learner, enrollment: other_enrollment, content_block: block, submission_type: block.submission_type,
                                        text: 'Other cohort synthetic answer', grade: :B, graded_at: Time.current, graded_by_id: other_instructor.id)
  other_recording = other.recordings.create!(title: 'QA other walkthrough', source_kind: 'external', source_url: 'https://example.invalid/other-recording', status: :published, position: 0)
  other_office_hour = other.office_hours.create!(title: 'QA other support', starts_at: 1.day.from_now, ends_at: 1.day.from_now + 1.hour,
                                                 meeting_url: 'https://example.invalid/other-meeting', created_by: other_instructor)
  other_booking = book(other, other_enrollment, other_instructor, (Time.current + 3.days).change(hour: 11))
  other_plan = other_enrollment.create_learning_plan!(title: 'QA other plan', active: true)
  other_channel = other.workspace.channels.order(:id).first
  Message.create!(channel: other_channel, author: other_learner, body: 'Other cohort synthetic hello')
  other_event = ActivityEvent.record!(event_type: 'submission_created', actor: other_learner, cohort: other, record: other_submission)

  require 'json'
  ids = {
    program_cohort_id: program.id, other_cohort_id: other.id, curriculum_id: curriculum.id,
    recording_id: recording.id, recording_lesson_id: lesson.id, office_hour_id: office_hour.id, booking_id: booking.id, booking_week: booking.week_number,
    learning_plan_id: plan.id, program_student_id: program_student.id, channel_id: channel.id, copy_message_id: copy_message.id,
    rubric_id: block.rubric_id, activity_event_id: event.id, submission_id: submission.id,
    other: { recording_id: other_recording.id, office_hour_id: other_office_hour.id, booking_id: other_booking.id, learning_plan_id: other_plan.id,
             channel_id: other_channel.id, activity_event_id: other_event.id }
  }
  File.write(File.expand_path('../../.qa-local/record-pages.json', __dir__), JSON.pretty_generate(ids))
  puts ids.to_json
end
