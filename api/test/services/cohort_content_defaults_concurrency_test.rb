require "test_helper"
require "ostruct"
require "timeout"

class CohortContentDefaultsConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

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
    begin
      worker&.join(10)
    rescue StandardError
      # Preserve fixture cleanup when the worker is the deadlock victim.
    end
    purchase&.destroy!
    enrollment&.destroy!
    cohort&.destroy!
    curriculum&.destroy!
    student&.destroy!
  end
end
