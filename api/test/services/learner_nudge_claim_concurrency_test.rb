require "test_helper"
require_relative "../support/lock_wait_helpers"
require_relative "../support/non_transactional_test_cleanup"

class LearnerNudgeClaimConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include LockWaitHelpers
  include NonTransactionalTestCleanup

  test "concurrent claims for different enrollments cannot both use the Guam daily cap" do
    now = Time.find_zone!(LearningCalendar::TIMEZONE).local(2026, 12, 20, 8)
    student = User.create!(clerk_id: "concurrent_nudge_claim", email: "concurrent-nudge-claim@example.com")
    curriculum = Curriculum.create!(name: "Concurrent reminder claim")
    cohorts = %w[First Second].map { |name| Cohort.create!(name: name, curriculum: curriculum, start_date: now.to_date) }
    enrollments = cohorts.map { |cohort| cohort.enrollments.create!(user: student) }
    threads = []

    student.with_lock do
      holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
      threads = enrollments.map do |enrollment|
        Thread.new do
          Rails.application.executor.wrap do
            candidate = LearnerNudges::Candidate.new(enrollment: enrollment, kind: "due_soon", threshold: "24h",
              key: "due_soon/#{enrollment.id}/concurrency/24h", essential: false, event_at: now + 1.hour,
              title: "Work is due soon", body: "Finish your work", path: "/cohorts/#{enrollment.cohort_id}", priority: 1)
            LearnerNudges.new(clock: -> { now }).send(:claim, [ candidate ], { claimed: 0 }).size
          end
        end
      end
      wait_for_lock_waiters(holder_pid, workers: threads, timeout: 10)
    end

    assert_equal [ 0, 1 ], threads.map(&:value).sort
    reminders = LearnerNudge.where(enrollment: enrollments, school_date: now.to_date)
    assert_equal 1, reminders.count
    assert_equal reminders.sole, student.notifications.where(notifiable_type: "LearnerNudge").sole.notifiable
  ensure
    finish_test_threads(threads)
    enrollments&.each(&:destroy!)
    cohorts&.each(&:destroy!)
    curriculum&.destroy!
    delete_test_users(student)
  end
end
