# Synthetic fixtures and controls for staff-home-scheduled-updates.spec.ts (W6.4 + L-5.1). From api/, with the
# exact owned harness database:
#   DATABASE_URL=postgresql://localhost/<csg_qa_ database> RAILS_ENV=test bundle exec ruby ../scripts/qa/staff-home-scheduled-updates-fixtures.rb setup
# setup  - posts "QA read count update" (pinned) to QA Program through the real fan-out and marks persona 3's copy read,
#          and writes the ids the spec needs to .qa-local/staff-home-scheduled.json.
# due ID - moves scheduled update ID's send time to a minute ago, as if its hour had come (the tick would
#          refuse a past time set through the API, so this is the one backend shortcut).
# tick   - runs the real ScheduledTick with only the scheduled_updates task, twice in the same hour, then resets
#          the hourly checkpoint and runs it a third time. It starts from a fresh hourly slot (no checkpoint), as
#          the first tick of a new hour would; an earlier forced tick in the same hour would otherwise skip it.
#          Prints each summary, the update's state and how many notifications and push jobs it produced. Push is requested on the test adapter; nothing is sent.
require_relative 'boot'
require 'json'

STATE = File.expand_path('../../.qa-local/staff-home-scheduled.json', __dir__)
program = Cohort.find_by!(name: 'QA Program')
command, argument = ARGV

case command
when 'setup'
  update = Announcement.find_by(title: 'QA read count update') || ActiveRecord::Base.transaction do
    posted = Announcement.create!(cohort: program, author: User.find(1), audience: :cohort, status: :published, title: 'QA read count update',
                                  body: "Read this **before Friday**.\n\n- Bring a laptop\n- Bring a charger\n\n```ruby\nputs 'ready'\n```")
    NotificationDeliveryService.announcement_published(posted)
    posted
  end
  # Pinned, so it stays on the first page of Manage while QA runs post more updates to the cohort.
  update.update_columns(pinned: true)
  Notification.where(notifiable: update, user_id: 3).update_all(read_at: Time.current)
  submission = Submission.joins(:enrollment).where(user_id: 3, enrollments: { cohort_id: program.id }).where.not(grade: nil).order(:id).first!
  File.write(STATE, JSON.pretty_generate(program_cohort_id: program.id, read_update_id: update.id, submission_id: submission.id,
                                         rubric_id: submission.content_block.rubric_id, lesson_id: submission.content_block.lesson_id,
                                         module_id: submission.content_block.lesson.module_id))
  puts File.read(STATE)
when 'due'
  update = Announcement.scheduled.find(Integer(argument, 10))
  update.update_columns(scheduled_for: 1.minute.ago)
  puts({ id: update.id, scheduled_for: update.reload.scheduled_for }.to_json)
when 'tick'
  task = ScheduledTick::TASKS.find { |entry| entry.name == 'scheduled_updates' }
  log = StringIO.new
  logger = ActiveSupport::Logger.new(log)
  push_jobs = -> { ActiveJob::Base.queue_adapter.enqueued_jobs.count { |job| job['job_class'] == 'PushNotificationJob' } }
  ScheduledTaskRun.where(name: 'scheduled_updates').delete_all
  runs = 2.times.map { ScheduledTick.new(now: Time.current, tasks: [ task ], logger: logger, dry_run: false).call }
  # A rerun that isn't held back by the hourly checkpoint still finds nothing to post.
  ScheduledTaskRun.where(name: 'scheduled_updates').delete_all
  runs << ScheduledTick.new(now: Time.current, tasks: [ task ], logger: logger, dry_run: false).call
  update = argument && Announcement.find(Integer(argument, 10))
  puts({ runs: runs, summaries: log.string.lines.map { |line| JSON.parse(line[/\{.*\}/]) },
         update: update && { id: update.id, status: update.status, published_at: update.published_at, notifications: Notification.where(notifiable: update).count },
         push_jobs: push_jobs.call }.to_json)
else
  abort 'usage: staff-home-scheduled-updates-fixtures.rb setup | due ID | tick [ID]'
end
