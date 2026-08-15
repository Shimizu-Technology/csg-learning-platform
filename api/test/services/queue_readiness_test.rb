require "test_helper"

class QueueReadinessTest < ActiveSupport::TestCase
  test "does not query Solid Queue when the adapter is not enabled" do
    assert_equal "not_required", QueueReadiness.status
  end

  test "requires a current worker and a current ready backlog" do
    with_solid_queue_adapter do
      assert_equal "failed", QueueReadiness.status

      worker = SolidQueue::Process.create!(
        kind: "Worker",
        last_heartbeat_at: Time.current,
        pid: 12_345,
        name: "worker-readiness-test",
        hostname: "test"
      )

      assert_equal "ok", QueueReadiness.status

      job = SolidQueue::Job.create!(
        queue_name: "default",
        class_name: "PushNotificationJob",
        arguments: {},
        active_job_id: SecureRandom.uuid,
        scheduled_at: 10.minutes.ago,
        created_at: 10.minutes.ago,
        updated_at: 10.minutes.ago
      )
      job.ready_execution.update_column(:created_at, 10.minutes.ago)

      assert_equal "failed", QueueReadiness.status
    ensure
      worker&.destroy!
      job&.destroy!
    end
  end

  private

  def with_solid_queue_adapter
    original_name = ActiveJob::Base.method(:queue_adapter_name)
    ActiveJob::Base.define_singleton_method(:queue_adapter_name) { "solid_queue" }
    yield
  ensure
    ActiveJob::Base.define_singleton_method(:queue_adapter_name, original_name)
  end
end
