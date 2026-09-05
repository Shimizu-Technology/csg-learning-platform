require "test_helper"

class MessageDeliveryRecoveryJobTest < ActiveJob::TestCase
  test "retries only incomplete deliveries without an active lease" do
    curriculum = Curriculum.create!(name: "Recovery job curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Recovery job cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "recovery_job_author", email: "recovery-job@example.com", role: :admin)
    channel = cohort.channels.find_by!(name: "Class Chat")
    complete = Message.create!(channel: channel, author: author, body: "Complete")
    active = Message.create!(channel: channel, author: author, body: "Active")
    abandoned = Message.create!(channel: channel, author: author, body: "Abandoned")
    unclaimed = Message.create!(channel: channel, author: author, body: "Unclaimed")
    deleted = Message.create!(channel: channel, author: author, body: "Deleted", deleted_at: Time.current)
    legacy = Message.create!(channel: channel, author: author, body: "Delivered before tracking")
    root = Message.create!(channel: channel, author: author, body: "Root")
    thread_reply = Message.create!(channel: channel, author: author, parent_message: root, body: "Thread reply")
    now = Time.current

    Message.where(id: [ complete.id, active.id, abandoned.id, unclaimed.id, deleted.id, root.id, thread_reply.id ])
      .update_all(delivery_tracking_requested: true)
    complete.update_columns(notifications_delivered_at: now, broadcasts_delivered_at: now)
    active.update_columns(notifications_delivery_started_at: now, notifications_delivery_claim: SecureRandom.uuid, broadcasts_delivered_at: now)
    abandoned.update_columns(notifications_delivery_started_at: 6.minutes.ago, notifications_delivery_claim: SecureRandom.uuid, broadcasts_delivered_at: now)
    root.update_columns(notifications_delivered_at: now, broadcasts_delivered_at: now)
    thread_reply.update_columns(notifications_delivered_at: now, broadcasts_delivered_at: now)
    abandoned_attempted_before = abandoned.delivery_recovery_attempted_at

    delivered_ids = []
    original_delivery = MessageDeliveryService.method(:created)
    original_notification_delivery = NotificationDeliveryService.method(:message_created)
    NotificationDeliveryService.define_singleton_method(:message_created) do |message, push: false|
      raise "delivery unavailable" if message.id == abandoned.id

      original_notification_delivery.call(message, push: push)
    end
    MessageDeliveryService.define_singleton_method(:created) do |message|
      original_delivery.call(message)
      delivered_ids << message.id
    end

    MessageDeliveryRecoveryJob.perform_now

    assert_equal [ unclaimed.id, thread_reply.id ].sort, delivered_ids.sort
    assert_not_includes delivered_ids, legacy.id
    assert_not_includes delivered_ids, deleted.id
    assert_operator abandoned.reload.delivery_recovery_attempted_at, :>, abandoned_attempted_before
    assert_nil abandoned.notifications_delivery_claim
    assert_nil abandoned.notifications_delivery_started_at
  ensure
    MessageDeliveryService.define_singleton_method(:created, original_delivery) if defined?(original_delivery) && original_delivery
    NotificationDeliveryService.define_singleton_method(:message_created, original_notification_delivery) if defined?(original_notification_delivery) && original_notification_delivery
  end
end
