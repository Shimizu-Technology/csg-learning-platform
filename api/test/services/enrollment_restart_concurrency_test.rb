require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require "timeout"

class EnrollmentRestartConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup

  test "concurrent restart requests with the same version produce one restart and one conflict" do
    curriculum = Curriculum.create!(name: "Concurrent restart")
    cohort = Cohort.create!(name: "Restart class", curriculum: curriculum, start_date: Date.current)
    student = User.create!(clerk_id: "concurrent_restart", email: "concurrent-restart@example.com")
    admin = User.create!(clerk_id: "concurrent_restart_admin", email: "concurrent-restart-admin@example.com", role: :admin)
    enrollment = cohort.enrollments.create!(user: student)
    auth = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => admin.clerk_id, "email" => admin.email } }
    # Load the lazy route set on the test thread before issuing concurrent requests.
    Rails.application.reload_routes!
    started = Queue.new
    threads = []
    student.with_lock do
      threads = 2.times.map do
        Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do |connection|
            started << connection.select_value("SELECT pg_backend_pid()")
            request = ActionDispatch::Integration::Session.new(Rails.application)
            request.post "/api/v1/enrollments/#{enrollment.id}/restart", params: { confirmation: student.email, restart_version: nil }, headers: { "Authorization" => "Bearer test_token" }, as: :json
            [ request.response.status, JSON.parse(request.response.body) ]
          end
        end
      end
      backends = 2.times.map { Timeout.timeout(60) { started.pop } }
      Timeout.timeout(60) do
        loop do
          break if backends.all? { |pid| ActiveRecord::Base.uncached { ActiveRecord::Base.connection.select_value("SELECT cardinality(pg_blocking_pids(#{Integer(pid)})) > 0") } }
          raise "Request completed without waiting: #{threads.reject(&:alive?).map(&:value).inspect}" if threads.any? { |thread| !thread.alive? }

          sleep 0.01
        end
      end
    end
    results = threads.map { |thread| Timeout.timeout(60) { thread.value } }
    assert_equal [ 201, 409 ], results.map(&:first).sort
    assert_equal "This learner was just restarted — refresh to see the latest state", results.find { |status, _| status == 409 }.last.fetch("error")
    assert_equal 1, EnrollmentRestart.where(enrollment: enrollment).count
    assert_equal 1, enrollment.recovery_plans.status_active.count
    assert_equal 1, enrollment.interventions.active.trigger_type_restart.count
  ensure
    finish_test_threads(threads)
    ClerkAuth.define_singleton_method(:verify, auth) if auth
    EnrollmentRestart.where(cohort: cohort).destroy_all if cohort
    enrollment&.reload&.destroy!
    cohort&.destroy!
    curriculum&.destroy!
    delete_test_users(student, admin)
  end
end
