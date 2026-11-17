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
    Notification.where(notifiable_type: "Announcement", notifiable_id: @announcement.id).delete_all
    Announcement.where(id: @announcement.id).delete_all
    delete_test_users(@users)
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
