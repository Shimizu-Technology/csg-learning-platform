require_relative 'boot'

ActiveRecord::Base.transaction do
  program = Cohort.find_by!(name: 'QA Program')
  # Align cohort start_date to today so QA Week 1 Day 1 lessons unlock today and Day 2 tomorrow.
  today = LearningCalendar.today
  program.update!(start_date: today)

  active_enrollment = program.enrollments.active.first!
  first_lesson = program.curriculum.modules.ordered.first.lessons.ordered.first!

  # Record a sent delivery from yesterday and a scheduler run so both Sent and Pending states appear.
  yesterday = today - 1
  ScheduledNotificationAttempt.find_or_create_by!(key: DailyUnlockNotifications.digest_key(active_enrollment.id, yesterday)) do |row|
    row.created_at = 1.day.ago
  end
  ScheduledNotificationAttempt.find_or_create_by!(key: DailyUnlockNotifications.claim_key(active_enrollment.id, first_lesson.id)) do |row|
    row.created_at = 1.day.ago
  end

  task_run = ScheduledTaskRun.find_or_initialize_by(name: 'daily_unlocks')
  task_run.update!(
    last_attempted_at: 1.day.ago,
    last_succeeded_at: 1.day.ago,
    last_school_date: yesterday,
    last_result: { 'status' => 'run', 'claimed' => 1, 'sent' => 1, 'failed' => 0 }
  )
end

puts 'Release communications QA fixtures seeded.'
