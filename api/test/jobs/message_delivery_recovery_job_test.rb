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
    root = Message.create!(channel: channel, author: author, body: "Root")
    thread_reply = Message.create!(channel: channel, author: author, parent_message: root, body: "Thread reply")
    now = Time.current

    complete.update_columns(notifications_delivered_at: now, broadcasts_delivered_at: now)
    active.update_columns(notifications_delivery_started_at: now, notifications_delivery_claim: SecureRandom.uuid, broadcasts_delivered_at: now)
    abandoned.update_columns(notifications_delivery_started_at: 6.minutes.ago, notifications_delivery_claim: SecureRandom.uuid, broadcasts_delivered_at: now)
    root.update_columns(notifications_delivered_at: now, broadcasts_delivered_at: now)
    thread_reply.update_columns(notifications_delivered_at: now, broadcasts_delivered_at: now)

    delivered_ids = []
    original_delivery = MessageDeliveryService.method(:created)
    MessageDeliveryService.define_singleton_method(:created) { |message| delivered_ids << message.id }

    MessageDeliveryRecoveryJob.perform_now

    assert_equal [ abandoned.id, unclaimed.id, thread_reply.id ].sort, delivered_ids.sort
  ensure
    MessageDeliveryService.define_singleton_method(:created, original_delivery) if defined?(original_delivery) && original_delivery
  end
end
