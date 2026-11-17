# Run from api/ against a disposable test database only:
# RAILS_ENV=test DATABASE_URL=postgresql:///csg_scheduled_jobs_smoke bin/rails runner ../scripts/qa/scheduled-jobs-smoke.rb
require "rake"
require "active_support/testing/time_helpers"
include ActiveSupport::Testing::TimeHelpers
abort "Disposable scheduled-jobs test database required" unless Rails.env.test? && ActiveRecord::Base.connection_db_config.database.start_with?("csg_scheduled_jobs")
abort "Smoke database must have no users" if User.exists?

Rails.logger = ActiveSupport::Logger.new($stdout)
ActiveJob::Base.logger = Rails.logger
ActiveJob::Base.queue_adapter = :inline
ENV["RESEND_API_KEY"] = "re_test_simulated"
ENV["RESEND_FROM_EMAIL"] = "CSG <scheduled-smoke@example.test>"
travel_to Time.utc(2030, 1, 16, 20, 50) # Jan 17 06:50 Guam, before the daily sends

curriculum = Curriculum.create!(name: "Scheduled smoke")
mod = curriculum.modules.create!(name: "Scheduled week", position: 0, day_offset: 0, schedule_days: "daily")
cohort = Cohort.create!(curriculum: curriculum, name: "Scheduled smoke", status: :active, start_date: LearningCalendar.today)
mod.lessons.create!(title: "Smoke lesson", position: 0, release_day: 0)
student = User.create!(clerk_id: "scheduled_smoke_student", email: "scheduled-smoke-student@example.test", role: :student)
owner = User.create!(clerk_id: "scheduled_smoke_owner", email: "scheduled-smoke-owner@example.test", role: :admin)
enrollment = Enrollment.create!(user: student, cohort: cohort)
enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
intervention = Intervention.create!(enrollment: enrollment, owner: owner, created_by: owner, next_follow_up_at: 1.hour.ago,
  trigger_type: :manual, status: :open, evidence_snapshot: {})
token = student.mobile_push_tokens.create!(token: "ExpoPushToken[scheduled-smoke]", platform: "ios", last_seen_at: Time.current)
ExpoPushReceipt.create!(receipt_id: "scheduled-smoke-receipt", mobile_push_token: token, available_at: 1.minute.ago)

email_count = 0
push_count = 0
receipt_count = 0
Resend::Emails.define_singleton_method(:send) do |*, **|
  committed = ScheduledTaskLockRecord.connection.select_value("SELECT COUNT(*) FROM scheduled_notification_attempts").to_i
  raise "Email claim was not committed before send" unless committed == 2

  email_count += 1
  { id: "simulated-scheduled-smoke" }
end
[ WebPushNotificationService, ExpoPushNotificationService ].each do |provider|
  provider.define_singleton_method(:intervention_follow_ups) do |notifications|
    mark = ScheduledTaskLockRecord.connection.select_value("SELECT follow_up_notified_at FROM interventions WHERE id = #{intervention.id}")
    raise "Push mark was not committed before send" if mark.nil?

    push_count += notifications.size
  end
end
receipt_service = Object.new
receipt_service.define_singleton_method(:check) { |requests| receipt_count += requests.size; [] }
ExpoPushReceiptService.define_singleton_method(:new) { receipt_service }
Rails.application.load_tasks

invoke_tick = -> { Rake::Task["scheduled:tick"].reenable; Rake::Task["scheduled:tick"].invoke }
ENV["SCHEDULED_TICK_DRY_RUN"] = "TrUe"
school_count = SchoolSetting.count
invoke_tick.call
raise "Dry run mutated or delivered" unless ScheduledTaskRun.count.zero? && ScheduledNotificationAttempt.count.zero? && SchoolSetting.count == school_count && email_count.zero? && push_count.zero? && receipt_count.zero?
ENV.delete("SCHEDULED_TICK_DRY_RUN")
invoke_tick.call
raise "Pre-7am real trigger should only handle receipts" unless [ email_count, push_count, receipt_count ] == [ 0, 0, 1 ]
travel_to Time.utc(2030, 1, 16, 21) # 07:00 Guam
invoke_tick.call
raise "7am should send only the digest" unless [ email_count, push_count, receipt_count ] == [ 1, 0, 1 ]
travel_to Time.utc(2030, 1, 16, 22) # 08:00 Guam
invoke_tick.call
raise "Expected one unlock, both push providers, one resolved receipt" unless [ email_count, push_count, receipt_count ] == [ 1, 2, 1 ] && ExpoPushReceipt.count.zero? && Notification.where(notifiable: intervention).count == 1
invoke_tick.call
raise "Repeat delivered again" unless [ email_count, push_count, receipt_count ] == [ 1, 2, 1 ]
puts "SMOKE passed: dry preview has no writes/sends; 06:50 receipts only; 07:00 digest; 08:00 follow-up; repeat skipped; email=1 push_providers=2 receipts=1"
travel_back
