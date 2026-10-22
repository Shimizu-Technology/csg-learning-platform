require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require "ostruct"
require "timeout"

class CohortContentDefaultsConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup

  test "renewal waiting for bulk cohort access does not hold the enrollment lock" do
    curriculum = Curriculum.create!(name: "Concurrent defaults")
    mod = curriculum.modules.create!(name: "Selected", position: 0)
    cohort = Cohort.create!(name: "Concurrent course", curriculum: curriculum, start_date: Date.current, course_delivery: "self_paced")
    student = User.create!(clerk_id: "concurrent_defaults", email: "concurrent-defaults@example.com")
    enrollment = cohort.enrollments.create!(user: student, status: :dropped)
    purchase = CoursePurchase.create!(user: student, cohort: cohort, stripe_price_id: "price_defaults", price_cents: 100, stripe_session_id: "cs_defaults")
    session = OpenStruct.new(id: "cs_defaults", client_reference_id: purchase.id.to_s, payment_status: "paid", currency: "usd", amount_subtotal: 100, payment_intent: "pi_defaults")
    fulfillment = CoursePurchaseFulfillment
    enrollment.module_assignments.load
    started = Queue.new
    worker = nil

    cohort.with_lock do
      worker = Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          started << connection.select_value("SELECT pg_backend_pid()")
          fulfillment.fulfill!(session)
        end
      end
      backend_pid = Timeout.timeout(10) { started.pop }
      Timeout.timeout(10) do
        loop do
          waiting = ActiveRecord::Base.uncached { ActiveRecord::Base.connection.select_value("SELECT cardinality(pg_blocking_pids(#{Integer(backend_pid)})) > 0") }
          break if waiting
          raise worker.value unless worker.alive?

          sleep 0.01
        end
      end
      # This is the bulk access lock order: cohort, then enrollment. A renewal
      # must wait on the cohort without holding this enrollment row first.
      ActiveRecord::Base.connection.execute("SET LOCAL lock_timeout = '2s'")
      enrollment.with_lock { enrollment.update!(status: :paused) }
    end
    Timeout.timeout(10) { worker.join }
    worker.value
    assert_equal "paid", purchase.reload.status
    assert enrollment.reload.active?
    assert_equal [ mod.id ], enrollment.module_assignments.pluck(:module_id)
  ensure
    finish_test_threads(worker)
    purchase&.destroy!
    enrollment&.reload&.destroy!
    cohort&.destroy!
    curriculum&.destroy!
    delete_test_users(student)
  end

  test "unlock only request cannot restore a module removed while it waits for the cohort lock" do
    curriculum = Curriculum.create!(name: "Concurrent removal")
    mod = curriculum.modules.create!(name: "Removable", position: 0)
    cohort = Cohort.create!(name: "Concurrent removal course", curriculum: curriculum, start_date: Date.current)
    student = User.create!(clerk_id: "concurrent_removal", email: "concurrent-removal@example.com")
    admin = User.create!(clerk_id: "concurrent_removal_admin", email: "concurrent-removal-admin@example.com", role: :admin)
    enrollment = cohort.enrollments.create!(user: student)
    enrollment.module_assignments.create!(curriculum_module: mod)
    cohort.cohort_module_schedules.create!(curriculum_module: mod, start_date: mod.next_start_date_on_or_after(LearningCalendar.today))
    auth = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => admin.clerk_id, "email" => admin.email } }
    headers = { "Authorization" => "Bearer test_token" }
    started = Queue.new
    worker = nil
    removal = ActionDispatch::Integration::Session.new(Rails.application)

    cohort.with_lock do
      worker = Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          started << connection.select_value("SELECT pg_backend_pid()")
          unlock = ActionDispatch::Integration::Session.new(Rails.application)
          unlock.patch "/api/v1/cohorts/#{cohort.id}/module_access", params: { module_id: mod.id, unlocked: true }, headers: headers, as: :json
          [ unlock.response.status, JSON.parse(unlock.response.body) ]
        end
      end
      backend_pid = Timeout.timeout(10) { started.pop }
      Timeout.timeout(10) do
        loop do
          waiting = ActiveRecord::Base.uncached { ActiveRecord::Base.connection.select_value("SELECT cardinality(pg_blocking_pids(#{Integer(backend_pid)})) > 0") }
          break if waiting
          raise "Unlock request finished before waiting: #{worker.value.inspect}" unless worker.alive?

          sleep 0.01
        end
      end
      removal.patch "/api/v1/cohorts/#{cohort.id}/module_access", params: { module_id: mod.id, assigned: false }, headers: headers, as: :json
      assert_equal 200, removal.response.status
    end
    Timeout.timeout(10) { worker.join }
    status, payload = worker.value
    assert_equal 422, status
    assert_equal [ "Module must be assigned before it can be updated" ], payload.fetch("errors")
    refute cohort.reload.content_defaults.dig(mod.id.to_s, "assigned")
    refute enrollment.module_assignments.exists?(module_id: mod.id)
    refute cohort.cohort_module_schedules.exists?(module_id: mod.id)
  ensure
    finish_test_threads(worker)
    ClerkAuth.define_singleton_method(:verify, auth) if auth
    enrollment&.reload&.destroy!
    cohort&.destroy!
    curriculum&.destroy!
    delete_test_users(student, admin)
  end
end
