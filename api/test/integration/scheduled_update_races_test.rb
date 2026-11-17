require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/row_lock_race_helpers"
require_relative "../support/after_commit_helpers"

# W6.4 (U-3.6): the tick posting a scheduled update while something else
# touches the same row on another connection. The tick's advisory lock keeps
# two ticks apart (ScheduledTickOverlapTest); these show the row lock and the
# "still scheduled and due" check make each post happen once regardless.
class ScheduledUpdateRacesTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include RowLockRaceHelpers
  include AfterCommitHelpers
  include ActiveJob::TestHelper

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Scheduled races #{slug}")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Scheduled races #{slug}", start_date: Date.current, status: :active)
    @author = person("author", :instructor, slug)
    @cohort.cohort_instructor_assignments.create!(user: @author)
    @students = 2.times.map { |index| person("student#{index}", :student, slug) }
    @students.each { |student| Enrollment.create!(user: student, cohort: @cohort, status: :active) }
    @users = [ @author, *@students ]
    @threads = []
    @update = Announcement.create!(title: "Scheduled", body: "Words", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    @update.update_columns(scheduled_for: 1.minute.ago, scheduled_by_id: @author.id)
    @original_verify = ClerkAuth.method(:verify)
    payloads = @users.to_h { |user| [ user.clerk_id, { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name } ] }
    ClerkAuth.define_singleton_method(:verify) { |token| payloads.fetch(token) }
    @original_fan_out = NotificationDeliveryService.method(:announcement_published)
  end

  teardown do
    NotificationDeliveryService.define_singleton_method(:announcement_published, @original_fan_out) if @original_fan_out
    finish_test_threads(@threads)
    ClerkAuth.define_singleton_method(:verify, @original_verify) if @original_verify
    Notification.where(notifiable_type: "Announcement", notifiable_id: @update&.id).delete_all
    Announcement.where(id: @update&.id).delete_all
    Enrollment.where(user_id: @users.map(&:id)).delete_all
    CohortInstructorAssignment.where(user_id: @users.map(&:id)).delete_all
    Cohort.find_by(id: @cohort&.id)&.destroy!
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    delete_test_users(@users)
  end

  test "a second publisher waiting on the row while the first posts finds it posted and sends nothing" do
    second = nil
    holding_lock do
      second = in_thread { ScheduledAnnouncementPublisher.new.call(now: Time.current) }
      wait_until_blocked_or_done(second)
      assert second.alive?, "the second publisher waits for the first one's row lock"
    end
    assert_equal 0, second.value[:sent]
    assert_equal 0, second.value[:claimed]
    assert @update.reload.published?
    assert_equal @students.map(&:id).sort, Notification.where(notifiable: @update).pluck(:user_id).sort
  end

  test "cancelling while the tick posts gets a refusal, and the update is posted once" do
    canceller = nil
    holding_lock do
      canceller = in_thread { request(:patch, { scheduled_for: nil }) }
      wait_until_blocked_or_done(canceller)
      assert canceller.alive?, "the cancel waits for the tick's row lock"
    end
    status, body = canceller.value
    assert_equal 422, status
    assert_equal [ "This update has already been posted, so its schedule can't change" ], body["errors"]
    assert @update.reload.published?
    assert_equal 2, Notification.where(notifiable: @update).count
  end

  test "a cancel that commits first leaves the tick nothing to post" do
    tick = nil
    @update.with_lock do
      @update.update!(scheduled_for: nil, scheduled_by: nil)
      tick = in_thread { ScheduledAnnouncementPublisher.new.call(now: Time.current) }
      wait_until_blocked_or_done(tick)
    end
    assert_equal 0, tick.value[:sent]
    assert @update.reload.draft?
    assert_equal 0, Notification.where(notifiable: @update).count
  end

  test "an edit waiting on the tick's lock lands after the post, retitles the notifications and tells nobody again" do
    # From the review's adversarial tests.
    editor = nil
    holding_lock do
      editor = in_thread { request(:patch, { title: "Edited after tick" }) }
      wait_until_blocked_or_done(editor)
      assert editor.alive?
    end
    assert_equal 200, editor.value.first
    assert_equal "Edited after tick", @update.reload.title
    assert_equal 2, Notification.where(notifiable: @update).count
    assert_equal [ "Edited after tick" ], Notification.where(notifiable: @update).distinct.pluck(:title)
  end

  # The push outbox (#299 review P1). These tests and the crash harness are
  # adapted from the independent review's adversarial tests.

  test "a process that dies after the post commits, before the push, loses nothing: a later run pushes once" do
    @update.update_columns(scheduled_send_push: true)
    crash_child(:after_commit)
    @update.reload
    assert @update.published?
    assert_equal 2, Notification.where(notifiable: @update).count
    assert @update.push_requested_at, "the push intent committed with the post"
    assert_nil @update.push_settled_at

    pushes = with_recorded_pushes do
      # Within the grace period a rerun leaves it to a job that may still be running.
      assert_equal 0, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:push_requeued]
      travel_to(ScheduledAnnouncementPublisher::PUSH_GRACE.from_now + 1.second) do
        assert_equal 1, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:push_requeued]
        assert_equal 0, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:push_requeued]
      end
      travel_to(2.hours.from_now) { assert_equal 0, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:push_requeued] }
    end
    assert_equal({ web: [ recipients ], expo: [ recipients ] }, pushes)
    assert @update.reload.push_settled_at
  end

  test "a process that dies before the post commits rolls back, and a rerun posts and notifies once" do
    crash_child(:before_commit)
    assert @update.reload.scheduled?
    assert_equal 0, Notification.where(notifiable: @update).count
    assert_equal 1, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:sent]
    assert_equal 0, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:sent]
    assert_equal 2, Notification.where(notifiable: @update).count
  end

  test "two jobs pushing the same update at once push each recipient once per provider" do
    @update.update_columns(scheduled_send_push: true)
    assert_equal 1, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:sent]
    ids = Notification.where(notifiable: @update).pluck(:id)
    entered = Queue.new
    release = Queue.new
    calls = Queue.new
    originals = [ WebPushNotificationService, ExpoPushNotificationService ].to_h { |service| [ service, service.method(:announcement_published) ] }
    originals.each_key do |service|
      service.define_singleton_method(:announcement_published) do |_announcement, notifications|
        calls << [ service.name, notifications.pluck(:user_id).sort ]
        if service == WebPushNotificationService && Thread.current[:hold_push]
          entered << true
          release.pop
        end
      end
    end
    first = in_thread { Thread.current[:hold_push] = true; PushNotificationJob.perform_now("Announcement", @update.id, ids) }
    Timeout.timeout(30) { entered.pop }
    # The first job holds the web claims (and is mid-send); the second gets none of them.
    second = in_thread { PushNotificationJob.perform_now("Announcement", @update.id, ids) }
    finish_test_threads(second)
    release << true
    finish_test_threads(first)
    sent = []
    sent << calls.pop until calls.empty?
    assert_equal [ [ "ExpoPushNotificationService", recipients ], [ "WebPushNotificationService", recipients ] ], sent.sort
    assert @update.reload.push_settled_at
  ensure
    release&.<< true
    originals&.each { |service, original| service.define_singleton_method(:announcement_published, original) }
  end

  test "a retry after a partial send pushes only the recipients not yet claimed" do
    @update.update_columns(scheduled_send_push: true)
    ids = nil
    first = with_recorded_pushes(expo_not_started: :first) do
      assert_equal 1, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:sent]
      ids = Notification.where(notifiable: @update).order(:user_id).pluck(:id)
    end
    # Web reached both; Expo never started for the first recipient, so that one claim was released.
    assert_equal({ web: [ recipients ], expo: [ recipients ] }, first)
    @update.reload
    assert_equal ids.sort, @update.web_push_attempted_notification_ids.sort
    assert_equal [ ids.last ], @update.expo_push_attempted_notification_ids
    assert_nil @update.push_settled_at

    retry_pushes = with_recorded_pushes do
      travel_to(ScheduledAnnouncementPublisher::PUSH_GRACE.from_now + 1.second) do
        assert_equal 1, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:push_requeued]
      end
    end
    assert_equal({ web: [], expo: [ [ @students.first.id ] ] }, retry_pushes)
    assert @update.reload.push_settled_at
  end

  test "a claim released after another job settled the push is unsettled again, and the re-request sends only to it" do
    assert_released_claim_recovery
  end

  # Opt-in repetitions run full setup/teardown and independent database fixtures.
  Integer(ENV.fetch("SCHEDULED_PUSH_STRESS_RUNS", "0"), 10).times do |iteration|
    test "released claim stress #{iteration + 1}" do
      assert_released_claim_recovery
    end
  end

  test "a release after the push settled (no other job running) unsettles it, and only the released recipient is re-sent" do
    @update.update_columns(scheduled_send_push: true)
    with_recorded_pushes { ScheduledAnnouncementPublisher.new.call(now: Time.current) }
    assert @update.reload.push_settled_at
    released = Notification.where(notifiable: @update).order(:user_id).first
    PushNotificationJob.new.send(:release_push_claims, @update, :expo_push_attempted_notification_ids, [ released.id ])
    assert_nil @update.reload.push_settled_at
    pushes = with_recorded_pushes do
      travel_to(ScheduledAnnouncementPublisher::PUSH_GRACE.from_now + 1.second) { ScheduledAnnouncementPublisher.new.call(now: Time.current) }
    end
    assert_equal({ web: [], expo: [ [ released.user_id ] ] }, pushes)
    assert @update.reload.push_settled_at
  end

  private

  def assert_released_claim_recovery
    # Adapted from the independent re-check's race test: job A holds the web
    # claims mid-send, job B claims Expo and settles, then A's provider
    # reports it never started and A releases its web claims.
    # Freeze the publication clock and build the persisted intent directly.
    # The original fixture left an initial PushNotificationJob queued: running
    # it before the recovery tick legitimately makes :push_requeued zero.
    # This case owns only the two racing jobs and the tick's recovery job.
    freeze_time
    @update.update!(status: :published, push_requested_at: Time.current)
    assert_no_enqueued_jobs only: PushNotificationJob do
      NotificationDeliveryService.announcement_published(@update, push: false)
    end
    ids = Notification.where(notifiable: @update).order(:id).pluck(:id)
    entered = Queue.new
    release = Queue.new
    originals = [ WebPushNotificationService, ExpoPushNotificationService ].to_h { |service| [ service, service.method(:announcement_published) ] }
    WebPushNotificationService.define_singleton_method(:announcement_published) do |_record, notifications|
      entered << true
      release.pop
      raise PushDeliveryNotStarted.new(provider: "web_push", notification_ids: notifications.pluck(:id))
    end
    ExpoPushNotificationService.define_singleton_method(:announcement_published) { |*| }
    first = in_thread { PushNotificationJob.perform_now("Announcement", @update.id, ids) }
    Timeout.timeout(30) { entered.pop }
    second = in_thread { PushNotificationJob.perform_now("Announcement", @update.id, ids) }
    finish_test_threads(second)
    second.value
    assert @update.reload.push_settled_at, "B settled while A's web claims were held"
    release << true
    finish_test_threads(first)
    first.value
    @update.reload
    assert_empty @update.web_push_attempted_notification_ids
    assert_equal ids.sort, @update.expo_push_attempted_notification_ids.sort
    assert_nil @update.push_settled_at, "the released recipients are recoverable again"
    assert Announcement.push_pending.exists?(@update.id)
    originals.each { |service, original| service.define_singleton_method(:announcement_published, original) }

    # The tick re-requests it: web goes to both released recipients once, Expo to nobody again.
    pushes = with_recorded_pushes do
      travel_to(@update.reload.push_requested_at + ScheduledAnnouncementPublisher::PUSH_GRACE + 1.second)
      assert ScheduledAnnouncementPublisher.push_due(Time.current).exists?(@update.id)
      assert_equal 1, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:push_requeued]
      assert_equal 0, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:push_requeued]
    end
    assert_equal({ web: [ recipients ], expo: [] }, pushes)
    assert @update.reload.push_settled_at
  ensure
    release&.<< true
    finish_test_threads(@threads)
    originals&.each { |service, original| service.define_singleton_method(:announcement_published, original) }
    travel_back
  end

  def recipients = @students.map(&:id).sort

  # Forks a publisher that dies at `stage`, as a killed process would.
  # macOS libpq can crash a forked GSS session, so the child connects without it.
  def crash_child(stage)
    previous_gss = ENV["PGGSSENCMODE"]
    ENV["PGGSSENCMODE"] = "disable"
    ActiveRecord::Base.connection_handler.clear_all_connections!
    child = fork do
      ActiveJob::Base.queue_adapter = :inline
      if stage == :before_commit
        original = NotificationDeliveryService.method(:announcement_published)
        NotificationDeliveryService.define_singleton_method(:announcement_published) do |*args, **kwargs|
          original.call(*args, **kwargs)
          Process.exit!(73)
        end
      else
        ActiveJob::Base.queue_adapter.define_singleton_method(:enqueue) { |_job| Process.exit!(73) }
      end
      ScheduledAnnouncementPublisher.new.call(now: Time.current)
      Process.exit!(74)
    end
    _, status = Process.wait2(child)
    assert_equal 73, status.exitstatus, "the child died at #{stage}"
  ensure
    ENV["PGGSSENCMODE"] = previous_gss
  end

  # Runs the block with inline jobs and records each provider's sends (user
  # ids per call). `expo_not_started: :first` makes Expo report that it never
  # started the request for the lowest user id, as a provider deadline would.
  def with_recorded_pushes(expo_not_started: nil)
    pushes = { web: [], expo: [] }
    originals = { WebPushNotificationService => :web, ExpoPushNotificationService => :expo }.to_h do |service, key|
      original = service.method(:announcement_published)
      service.define_singleton_method(:announcement_published) do |_announcement, notifications|
        rows = notifications.order(:user_id).pluck(:id, :user_id)
        pushes[key] << rows.map(&:last)
        if key == :expo && expo_not_started == :first && rows.any?
          raise PushDeliveryNotStarted.new(provider: "expo", notification_ids: [ rows.first.first ])
        end
      end
      [ service, original ]
    end
    with_inline_jobs { yield }
    pushes
  ensure
    originals&.each { |service, original| service.define_singleton_method(:announcement_published, original) }
  end

  # Runs the tick's publisher on another connection and pauses it inside the
  # fan-out, holding the update's row lock, while the block runs.
  def holding_lock
    entered = Queue.new
    release = Queue.new
    original = @original_fan_out
    NotificationDeliveryService.define_singleton_method(:announcement_published) do |*args, **kwargs|
      entered << true
      release.pop
      original.call(*args, **kwargs)
    end
    first = in_thread { ScheduledAnnouncementPublisher.new.call(now: Time.current) }
    Timeout.timeout(30) { entered.pop }
    yield
    release << true
    assert_equal 1, first.value[:sent]
  ensure
    release << true
    NotificationDeliveryService.define_singleton_method(:announcement_published, original)
  end

  def request(verb, params)
    session = ActionDispatch::Integration::Session.new(Rails.application)
    session.public_send(verb, "/api/v1/announcements/#{@update.id}", params: params, headers: { "Authorization" => "Bearer #{@author.clerk_id}" }, as: :json)
    [ session.response.status, session.response.parsed_body ]
  end

  def person(name, role, slug)
    User.create!(clerk_id: "sched_races_#{name}_#{slug}", email: "sched-races-#{name}-#{slug}@example.invalid", first_name: name.capitalize, last_name: "Synthetic", role: role)
  end
end
