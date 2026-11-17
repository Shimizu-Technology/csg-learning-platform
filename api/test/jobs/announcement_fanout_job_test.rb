require "test_helper"

class AnnouncementFanoutJobTest < ActiveJob::TestCase
  setup do
    @author = User.create!(clerk_id: "fanout_admin", email: "fanout-admin@example.com", role: :admin)
    now = Time.current
    User.insert_all!((1..249).map do |i|
      { clerk_id: "fanout_staff_#{i}", email: "fanout-staff-#{i}@example.com", role: 1, created_at: now, updated_at: now }
    end)
    @announcement = Announcement.create!(title: "Posted", body: "Words", audience: :staff, status: :published, author: @author, push_requested_at: now)
  end

  test "publication records an intent and does not write a large audience in the request" do
    adapter = AnnouncementFanoutJob.queue_adapter
    queued = adapter.enqueued_jobs.size
    Announcement.transaction do
      NotificationDeliveryService.announcement_published(@announcement, push: true)
      assert_empty @announcement.notifications
      assert_not_nil @announcement.reload.fanout_requested_at
      assert_equal queued, adapter.enqueued_jobs.size
    end
    # The application transaction committed; fixture transactions are ignored.
    assert_equal queued + 1, adapter.enqueued_jobs.size
    assert_nil @announcement.reload.fanout_settled_at
  end

  test "a crash after commit before enqueue is recovered by the tick and duplicate ticks are harmless" do
    @announcement.update_columns(fanout_recipient_ids: User.not_archived.where(role: [ 1, 2 ]).order(:id).pluck(:id), fanout_requested_at: 10.minutes.ago)
    2.times { ScheduledAnnouncementPublisher.new.call(now: Time.current) }
    # Test fixture transactions defer tick callbacks; simulate the committed callback.
    2.times { AnnouncementFanoutJob.perform_now(@announcement.id) }
    assert_equal 250, @announcement.notifications.count
    assert_not_nil @announcement.reload.fanout_settled_at
    assert_enqueued_with(job: PushNotificationJob)
  end

  test "a retry after a committed batch resumes without duplicates or resetting read state" do
    @announcement.update_columns(fanout_recipient_ids: User.not_archived.where(role: [ 1, 2 ]).order(:id).pluck(:id), fanout_requested_at: Time.current)
    original = NotificationDeliveryService.instance_method(:announcement_batch)
    calls = 0
    NotificationDeliveryService.define_method(:announcement_batch) do |announcement, ids|
      calls += 1
      original.bind_call(self, announcement, ids)
      raise "crash after second batch inserts" if calls == 2
    end
    assert_raises(RuntimeError) { AnnouncementFanoutJob.perform_now(@announcement.id) }
    assert_equal 100, @announcement.notifications.count
    notification = @announcement.notifications.first
    notification.mark_read!
    NotificationDeliveryService.define_method(:announcement_batch, original)
    2.times { AnnouncementFanoutJob.perform_now(@announcement.id) }
    assert_equal 250, @announcement.notifications.count
    assert_not_nil notification.reload.read_at
  ensure
    NotificationDeliveryService.define_method(:announcement_batch, original) if original
  end

  test "archiving between batches stops further inserts and push" do
    @announcement.update_columns(fanout_recipient_ids: User.not_archived.where(role: [ 1, 2 ]).order(:id).pluck(:id), fanout_requested_at: Time.current)
    original = NotificationDeliveryService.instance_method(:announcement_batch)
    NotificationDeliveryService.define_method(:announcement_batch) do |announcement, ids|
      original.bind_call(self, announcement, ids)
      announcement.update_columns(status: Announcement.statuses[:archived])
    end
    assert_no_enqueued_jobs only: PushNotificationJob do
      AnnouncementFanoutJob.perform_now(@announcement.id)
    end
    assert_equal 100, @announcement.notifications.count
    assert_not_nil @announcement.reload.fanout_settled_at
  ensure
    NotificationDeliveryService.define_method(:announcement_batch, original) if original
  end

  test "a deleted publication is harmless and drafts cannot fan out or push" do
    @announcement.update_columns(fanout_recipient_ids: User.not_archived.where(role: [ 1, 2 ]).order(:id).pluck(:id), fanout_requested_at: Time.current, status: 0)
    assert_no_enqueued_jobs only: PushNotificationJob do
      AnnouncementFanoutJob.perform_now(@announcement.id)
    end
    assert_empty @announcement.notifications
    @announcement.destroy!
    assert_nothing_raised { AnnouncementFanoutJob.perform_now(@announcement.id) }
  end

  test "deletion after a committed batch leaves no orphan notifications on retry" do
    @announcement.update_columns(fanout_recipient_ids: @announcement.recipients.order(:id).pluck(:id), fanout_requested_at: Time.current)
    original = NotificationDeliveryService.instance_method(:announcement_batch)
    calls = 0
    NotificationDeliveryService.define_method(:announcement_batch) do |announcement, ids|
      calls += 1
      raise "crash" if calls == 2
      original.bind_call(self, announcement, ids)
    end
    assert_raises(RuntimeError) { AnnouncementFanoutJob.perform_now(@announcement.id) }
    assert_equal 100, @announcement.notifications.count
    @announcement.reload.destroy!
    NotificationDeliveryService.define_method(:announcement_batch, original)
    assert_nothing_raised { AnnouncementFanoutJob.perform_now(@announcement.id) }
    assert_not Notification.exists?(notifiable_type: "Announcement", notifiable_id: @announcement.id)
  ensure
    NotificationDeliveryService.define_method(:announcement_batch, original) if original
  end

  test "new recipients do not enter the publication snapshot" do
    @announcement.update_columns(fanout_recipient_ids: @announcement.recipients.order(:id).pluck(:id), fanout_requested_at: Time.current)
    newcomer = User.create!(clerk_id: "late_staff", email: "late-staff@example.com", role: :instructor)
    AnnouncementFanoutJob.perform_now(@announcement.id)
    assert_equal 250, @announcement.notifications.count
    assert_not @announcement.notifications.exists?(user: newcomer)
  end

  test "old recovered fanout completes in app but expires push" do
    @announcement.update_columns(fanout_recipient_ids: @announcement.recipients.order(:id).pluck(:id), fanout_requested_at: 2.days.ago, push_requested_at: 2.days.ago)
    assert_no_enqueued_jobs only: PushNotificationJob do
      AnnouncementFanoutJob.perform_now(@announcement.id)
    end
    assert_equal 250, @announcement.notifications.count
    assert_not_nil @announcement.reload.fanout_settled_at
    assert_not_nil @announcement.push_settled_at
  end

  test "push cannot settle before fanout completes" do
    @announcement.update_columns(fanout_recipient_ids: User.not_archived.where(role: [ 1, 2 ]).order(:id).pluck(:id), fanout_requested_at: Time.current)
    PushNotificationJob.perform_now("Announcement", @announcement.id, [])
    assert_nil @announcement.reload.push_settled_at
  end
end
