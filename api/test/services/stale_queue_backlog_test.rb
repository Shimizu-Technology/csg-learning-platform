require "test_helper"

class StaleQueueBacklogTest < ActiveSupport::TestCase
  test "reports only unfinished jobs created before the cutoff" do
    stale_job = create_job(created_at: 2.hours.ago)
    current_job = create_job(created_at: 5.minutes.ago)
    finished_job = create_job(created_at: 2.hours.ago, finished_at: 1.hour.ago)

    report = StaleQueueBacklog.new(cutoff: 1.hour.ago).report

    assert_equal 1, report[:total]
    assert_equal({ "PushNotificationJob" => 1 }, report[:classes])
    assert_equal 1, report.dig(:states, :ready)
    assert_equal 0, report[:unclassified]
  ensure
    [ stale_job, current_job, finished_job ].compact.each(&:destroy!)
  end

  test "purges stale ready jobs but preserves newer jobs" do
    stale_job = create_job(created_at: 2.hours.ago)
    current_job = create_job(created_at: 5.minutes.ago)

    deleted = StaleQueueBacklog.new(cutoff: 1.hour.ago).purge_ready!

    assert_equal 1, deleted
    assert_not SolidQueue::Job.exists?(stale_job.id)
    assert SolidQueue::Job.exists?(current_job.id)
  ensure
    [ stale_job, current_job ].compact.each { |job| job.destroy! if job.persisted? }
  end

  test "refuses to purge stale jobs that are not ready" do
    scheduled_job = create_job(created_at: 2.hours.ago, scheduled_at: 1.hour.from_now)

    error = assert_raises(StaleQueueBacklog::UnsafeStateError) do
      StaleQueueBacklog.new(cutoff: 1.hour.ago).purge_ready!
    end

    assert_match "outside the ready queue", error.message
    assert SolidQueue::Job.exists?(scheduled_job.id)
  ensure
    scheduled_job&.destroy!
  end

  private

  def create_job(created_at:, scheduled_at: created_at, finished_at: nil)
    SolidQueue::Job.create!(
      queue_name: "default",
      class_name: "PushNotificationJob",
      arguments: {},
      active_job_id: SecureRandom.uuid,
      scheduled_at: scheduled_at,
      created_at: created_at,
      updated_at: created_at,
      finished_at: finished_at
    )
  end
end
