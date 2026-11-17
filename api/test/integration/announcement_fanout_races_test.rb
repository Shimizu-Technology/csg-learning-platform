require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/row_lock_race_helpers"
require_relative "../support/job_adapter_helpers"

class AnnouncementFanoutRacesTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include RowLockRaceHelpers
  include ActiveJob::TestHelper
  include JobAdapterHelpers

  setup do
    @threads = []
    @extra_announcements = []
    slug = SecureRandom.hex(6)
    @author = User.create!(clerk_id: slug, email: "#{slug}@example.com", role: :admin)
    now = Time.current
    ids = User.insert_all!((1..249).map do |i|
      { clerk_id: "#{slug}-#{i}", email: "#{slug}-#{i}@example.com", role: 1, created_at: now, updated_at: now }
    end, returning: %w[id]).rows.flatten
    @users = User.where(id: [ @author.id, *ids ]).to_a
    @announcement = Announcement.create!(title: "Race", body: "Words", author: @author, audience: :staff, status: :published, fanout_recipient_ids: User.not_archived.where(role: [ 1, 2 ]).order(:id).pluck(:id), fanout_requested_at: 10.minutes.ago)
  end

  teardown do
    finish_test_threads(@threads)
    ids = [ @announcement.id, *@extra_announcements.map(&:id) ]
    Notification.where(notifiable_type: "Announcement", notifiable_id: ids).delete_all
    Announcement.where(id: ids).delete_all
    delete_test_users(@users)
  end

  test "one failed recovery backs off without cancelling later fanout or push callbacks" do
    now = Time.current
    healthy = Announcement.create!(title: "Healthy", body: "Words", author: @author, audience: :staff, status: :published,
      fanout_requested_at: 10.minutes.ago, fanout_recipient_ids: [ @author.id ])
    push = Announcement.create!(title: "Push", body: "Words", author: @author, audience: :staff, status: :published, push_requested_at: 10.minutes.ago)
    @extra_announcements.concat([ healthy, push ])
    logger = ActiveSupport::Logger.new(log = StringIO.new)
    original = AnnouncementFanoutJob.method(:perform_now)
    broken_id = @announcement.id
    AnnouncementFanoutJob.define_singleton_method(:perform_now) do |id|
      raise "poisoned fanout" if id == broken_id
      original.call(id)
    end
    with_job_adapter(PushNotificationJob, queue_adapter) do
      assert_enqueued_with(job: PushNotificationJob, args: [ "Announcement", push.id, [] ]) do
        Announcement.transaction do
          ScheduledAnnouncementPublisher.new(logger: logger).call(now: now)
          assert_empty healthy.notifications
        end
      end
    end
    assert_equal 1, healthy.notifications.count
    assert_not_nil healthy.reload.fanout_settled_at
    assert_includes log.string, "fanout_failed=RuntimeError: poisoned fanout"
    assert_not ScheduledAnnouncementPublisher.fanout_due(now).exists?(@announcement.id)
    assert ScheduledAnnouncementPublisher.fanout_due(now + 1.hour + 1.second).exists?(@announcement.id)
  ensure
    AnnouncementFanoutJob.define_singleton_method(:perform_now, original) if original
  end

  test "a permanently failing fanout cannot prevent its push expiring" do
    @announcement.update_columns(push_requested_at: 2.days.ago)
    original = AnnouncementFanoutJob.method(:perform_now)
    AnnouncementFanoutJob.define_singleton_method(:perform_now) { |*| raise "always fails" }
    metrics = ScheduledAnnouncementPublisher.new(logger: ActiveSupport::Logger.new(StringIO.new)).call(now: Time.current)
    assert_equal 1, metrics[:push_expired]
    assert_not_nil @announcement.reload.push_settled_at
    assert_nil @announcement.fanout_settled_at
    assert_not_empty @announcement.fanout_recipient_ids
  ensure
    AnnouncementFanoutJob.define_singleton_method(:perform_now, original) if original
  end

  test "a publication rollback is invisible on another connection and drops fanout" do
    @announcement.update_columns(status: 0, published_at: nil, fanout_requested_at: nil)
    Announcement.transaction do
      @announcement.update!(status: :published)
      NotificationDeliveryService.announcement_published(@announcement)
      assert_not on_second_connection { Announcement.visible_now.exists?(@announcement.id) }
      assert_not on_second_connection { Notification.exists?(notifiable: @announcement) }
      raise ActiveRecord::Rollback
    end
    assert @announcement.reload.draft?
    assert_nil @announcement.fanout_requested_at
    assert_empty @announcement.notifications
  end

  test "large publication enqueues only after commit with no request fanout" do
    @announcement.update_columns(fanout_requested_at: nil)
    with_job_adapter(AnnouncementFanoutJob, queue_adapter) do
      assert_enqueued_with(job: AnnouncementFanoutJob, args: [ @announcement.id ]) do
        Announcement.transaction do
          NotificationDeliveryService.announcement_published(@announcement)
          assert_empty @announcement.notifications
          assert_no_enqueued_jobs only: AnnouncementFanoutJob
        end
      end
    end
    assert_empty @announcement.notifications
  end

  test "concurrent recovery ticks and jobs cannot duplicate recipients" do
    @announcement.with_lock do
      2.times do
        in_thread { ScheduledAnnouncementPublisher.new.call(now: Time.current) }
      end
      @threads.each { |thread| wait_until_blocked_or_done(thread) }
    end
    @threads.each(&:value)
    assert_equal 250, @announcement.notifications.count
    assert_equal 250, @announcement.notifications.distinct.count(:user_id)
    assert_not_nil @announcement.reload.fanout_settled_at
  end

  test "deletion waits before dependent cleanup while a batch is uncommitted" do
    entered = Queue.new
    release = Queue.new
    original = NotificationDeliveryService.instance_method(:announcement_batch)
    first = true
    NotificationDeliveryService.define_method(:announcement_batch) do |announcement, ids|
      original.bind_call(self, announcement, ids)
      if first
        first = false
        entered << true
        release.pop
      end
    end
    worker = in_thread { AnnouncementFanoutJob.perform_now(@announcement.id) }
    Timeout.timeout(30) { entered.pop }
    deleter = in_thread { Announcement.find(@announcement.id).destroy! }
    wait_until_blocked_or_done(deleter)
    assert deleter.alive?, "deletion must wait for the batch before reading its dependents"
    release << true
    worker.value
    deleter.value
    assert_not Announcement.exists?(@announcement.id)
    assert_not Notification.exists?(notifiable_type: "Announcement", notifiable_id: @announcement.id)
  ensure
    release << true if release
    finish_test_threads(@threads)
    NotificationDeliveryService.define_method(:announcement_batch, original) if original
  end

  test "a lost enqueue after publish commit is recovered by a real tick callback" do
    assert_empty @announcement.notifications
    ScheduledAnnouncementPublisher.new.call(now: Time.current)
    assert_equal 250, @announcement.notifications.count
    assert_not_nil @announcement.reload.fanout_settled_at
  end
end
