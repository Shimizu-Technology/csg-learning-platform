require "test_helper"
require_relative "../support/query_counter"

class InterventionFollowUpJobTest < ActiveJob::TestCase
  include QueryCounter

  setup do
    @curriculum = Curriculum.create!(name: "Follow-up curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Follow-up cohort", start_date: Date.current, status: :active)
    @owner = User.create!(clerk_id: "follow_up_owner", email: "follow-up-owner@example.com", role: :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @owner)
    @originals = [ WebPushNotificationService, ExpoPushNotificationService ].to_h { |service| [ service, service.method(:intervention_follow_ups) ] }
    @calls = []
    calls = @calls
    @originals.each_key do |service|
      service.define_singleton_method(:intervention_follow_ups) { |notifications| calls << [ service, notifications ] }
    end
    @intervention = build_follow_up("first")
  end

  teardown do
    @originals.each { |service, original| service.define_singleton_method(:intervention_follow_ups, original) }
  end

  test "notifies an owner once for the current due date and excludes invalid owners" do
    InterventionFollowUpJob.perform_now
    notification = Notification.find_by!(notifiable: @intervention, user: @owner)
    assert_equal "intervention", notification.notification_type
    assert_equal "Follow-up due for #{@intervention.enrollment.user.full_name}", notification.title
    assert @intervention.reload.follow_up_notified_at
    assert_equal 2, @calls.size
    InterventionFollowUpJob.perform_now
    assert_equal 2, @calls.size
    @intervention.update!(next_follow_up_at: 2.hours.ago)
    @owner.update!(clerk_id: "pending_follow_up_owner")
    InterventionFollowUpJob.perform_now
    assert_nil @intervention.reload.follow_up_notified_at
    assert_equal 2, @calls.size
    @owner.update!(clerk_id: "follow_up_owner")
    @cohort.cohort_instructor_assignments.destroy_all
    InterventionFollowUpJob.perform_now
    assert_nil @intervention.reload.follow_up_notified_at
    @cohort.cohort_instructor_assignments.create!(user: @owner)
    InterventionFollowUpJob.perform_now
    assert @intervention.reload.follow_up_notified_at
    assert_equal 4, @calls.size
  end

  test "provider failure attempts the other provider but never repeats uncertain pushes" do
    attempts = 0
    WebPushNotificationService.define_singleton_method(:intervention_follow_ups) do |*|
      attempts += 1
      raise "accepted before connection lost"
    end
    assert_raises(RuntimeError) { InterventionFollowUpJob.perform_now }
    assert_equal 1, @calls.size, "Expo still runs after web push fails"
    InterventionFollowUpJob.perform_now
    assert_equal 1, attempts
    assert_equal 1, @calls.size
    assert @intervention.reload.follow_up_notified_at
  end

  test "follow-up planning, claims and provider preparation use flat SQL queries" do
    @originals.each { |service, original| service.define_singleton_method(:intervention_follow_ups, original) }
    configured = WebPushNotificationService.method(:configured?)
    WebPushNotificationService.define_singleton_method(:configured?) { true }
    # Real provider preparation, no subscriptions or tokens, hence no HTTP.
    InterventionFollowUpJob.perform_now
    @intervention.update_columns(follow_up_notified_at: nil)
    small = capture_queries { InterventionFollowUpJob.perform_now }
    9.times do |index|
      owner = User.create!(clerk_id: "follow_up_growth_owner#{index}", email: "follow-up-growth-owner#{index}@example.test", role: :instructor)
      @cohort.cohort_instructor_assignments.create!(user: owner)
      build_follow_up("growth#{index}", owner: owner)
    end
    Intervention.update_all(follow_up_notified_at: nil)
    large = capture_queries { InterventionFollowUpJob.perform_now }
    assert_equal 10, Notification.where(notifiable_type: "Intervention").count
    assert_equal small.size, large.size, "1 follow-up: #{small.size}; 10: #{large.size}\n#{large.join("\n")}"
  ensure
    WebPushNotificationService.define_singleton_method(:configured?, configured) if configured
  end

  private

  def build_follow_up(name, owner: @owner)
    user = User.create!(clerk_id: "follow_up_#{name}", email: "follow-up-#{name}@example.test", role: :student)
    enrollment = Enrollment.create!(user: user, cohort: @cohort)
    Intervention.create!(enrollment: enrollment, trigger_type: :inactivity, severity: :normal, status: :contacted,
      evidence_snapshot: {}, owner: owner, created_by: owner, next_follow_up_at: 1.hour.ago)
  end
end
