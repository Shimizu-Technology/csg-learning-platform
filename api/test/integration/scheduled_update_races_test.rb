require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/row_lock_race_helpers"

# W6.4 (U-3.6): the tick posting a scheduled update while something else
# touches the same row on another connection. The tick's advisory lock keeps
# two ticks apart (ScheduledTickOverlapTest); these show the row lock and the
# "still scheduled and due" check make each post happen once regardless.
class ScheduledUpdateRacesTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include RowLockRaceHelpers

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

  private

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
