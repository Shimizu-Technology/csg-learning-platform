namespace :notifications do
  desc "Send daily unlock email notifications to students with new content available today"
  task send_daily_unlocks: :environment do
    puts "[#{Time.current}] Starting daily unlock notifications..."

    unless NotificationEmailService.configured?
      puts "Email service not configured. Skipping."
      next
    end

    sent_count = 0
    skip_count = 0
    error_count = 0
    today = Date.current

    Cohort.active.includes(curriculum: { modules: :lessons }).find_each do |cohort|
      cohort.enrollments.active.includes(:user, :module_assignments).find_each do |enrollment|
        user = enrollment.user
        unlocking_today = lessons_unlocking_today_for(cohort, enrollment, today)

        if unlocking_today.empty?
          skip_count += 1
          next
        end

        success = NotificationEmailService.send_daily_unlock(
          user: user, cohort: cohort, lessons: unlocking_today
        )

        if success
          sent_count += 1
        else
          error_count += 1
        end
      end
    end

    puts "[#{Time.current}] Done: #{sent_count} sent, #{skip_count} skipped, #{error_count} errors"
  end

  private

  # Finds lessons whose unlock_date is today for this specific enrollment,
  # respecting per-student module_assignment unlock_date_override.
  def lessons_unlocking_today_for(cohort, enrollment, today)
    enrollment.module_assignments.flat_map do |ma|
      next [] unless ma.accessible?

      ma.curriculum_module.lessons.select do |lesson|
        lesson.unlock_date(cohort, ma) == today
      end
    end
  end
end
