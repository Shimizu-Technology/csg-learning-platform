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

    Cohort.active.includes(curriculum: { modules: :lessons }).find_each do |cohort|
      today_lessons = find_lessons_unlocking_today(cohort)
      next if today_lessons.empty?

      puts "  Cohort #{cohort.name}: #{today_lessons.size} lesson(s) unlocking today"

      cohort.enrollments.active.includes(:user, :module_assignments).find_each do |enrollment|
        user = enrollment.user
        accessible_lessons = today_lessons.select do |lesson|
          ma = enrollment.module_assignments.find { |a| a.module_id == lesson.module_id }
          ma && lesson.available?(cohort, ma)
        end

        if accessible_lessons.empty?
          skip_count += 1
          next
        end

        success = NotificationEmailService.send_daily_unlock(
          user: user, cohort: cohort, lessons: accessible_lessons
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

  def find_lessons_unlocking_today(cohort)
    today = Date.current
    cohort.curriculum.modules.flat_map do |mod|
      mod.lessons.select do |lesson|
        lesson.unlock_date(cohort) == today
      end
    end
  end
end
