require "test_helper"
require_relative "../support/query_counter"

# W9.3 learner reminders. Times are Guam local; the course starts Tuesday
# 2026-12-01 with a 3-week personal pace, so its weekly milestones fall on
# Dec 7, 14 and 21, and the final project is due Dec 21 at 23:59:59.
class LearnerNudgesTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper
  include QueryCounter

  GUAM = ActiveSupport::TimeZone["Pacific/Guam"]

  setup do
    travel_to GUAM.local(2026, 12, 1, 9)
    @email_interval = LearnerNudges.email_interval
    LearnerNudges.email_interval = 0
    @env = ENV.to_h.slice("RESEND_API_KEY", "RESEND_FROM_EMAIL")
    ENV["RESEND_API_KEY"] = "re_test"
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@example.test>"
    @send = Resend::Emails.method(:send)
    @emails = []
    emails = @emails
    Resend::Emails.define_singleton_method(:send) { |params, options: {}| emails << params; { id: "nudge-test" } }
    SchoolSetting.current.update!(features: { "learner_nudges" => true })
    @curriculum = Curriculum.create!(name: "Python Fundamentals")
    @mod = @curriculum.modules.create!(name: "Course", position: 0, day_offset: 0)
    @lessons = [ "Variables", "Lists", "Loops", "Functions" ].each_with_index.map { |title, index| lesson(title, index) }
    @final = lesson("Final project", 4, type: :project)
    @teacher = person("teacher", :instructor)
    @cohort = paced_cohort("Python pilot")
    @enrollment = enroll(@cohort, "learner")
  end

  teardown do
    Resend::Emails.define_singleton_method(:send, @send)
    LearnerNudges.email_interval = @email_interval
    %w[RESEND_API_KEY RESEND_FROM_EMAIL].each { |key| ENV[key] = @env[key] }
    travel_back
  end

  test "the final project reminder goes out once at 48h and once at 24h, and reruns send nothing" do
    at(2026, 12, 20, 8) { 2.times { tick! } }
    nudge = LearnerNudge.sole
    assert_equal [ "due_soon", "48h" ], [ nudge.kind, nudge.threshold ]
    assert_equal "Final project due tomorrow", nudge.title
    assert_includes nudge.body, "11:59 PM Guam time"
    assert_equal GUAM.local(2026, 12, 21).end_of_day.to_i, nudge.event_at.to_i
    assert_equal "sent", nudge.email_status
    assert_equal [ "Final project due tomorrow - #{SchoolBrand.current.name}" ], @emails.map { |mail| mail[:subject] }
    notice = Notification.sole
    assert_equal [ @enrollment.user_id, "system", nudge ], [ notice.user_id, notice.notification_type, notice.notifiable ]
    assert_equal "/lessons/#{@final.id}?cohort_id=#{@cohort.id}", notice.path

    at(2026, 12, 21, 8) { 2.times { tick! } }
    assert_equal %w[48h 24h], LearnerNudge.where(kind: "due_soon").order(:id).pluck(:threshold)
    assert_equal "Final project due today", LearnerNudge.last.title
    assert_equal 2, @emails.size
    at(2026, 12, 21, 9) { tick! }
    at(2026, 12, 22, 9) { tick! }
    assert_equal 2, LearnerNudge.where(kind: "due_soon").count
  end

  test "a weekly milestone gets one reminder on its due day, naming the open lessons" do
    at(2026, 12, 6, 8) { tick! }
    assert_equal 0, LearnerNudge.count # 40h before the end of Dec 7: only the 24h threshold is used
    at(2026, 12, 7, 8) { tick! }
    nudge = LearnerNudge.sole
    assert_equal [ "due_soon", "24h" ], [ nudge.kind, nudge.threshold ]
    assert_equal "Week 1: due today", nudge.title
    week_one = @enrollment.learning_plan.reload.milestones.first.fetch("lesson_ids").map { |id| Lesson.find(id).title }
    assert_includes nudge.body, "#{week_one.size} lessons left: #{week_one.first}"
    assert_equal "due_soon/#{@enrollment.id}/milestone/2026-12-07/24h", nudge.key
  end

  test "a finished milestone and a handed-in final project get no reminder" do
    week_one = @enrollment.learning_plan.milestones.first.fetch("lesson_ids")
    Lesson.where(id: week_one).each { |item| complete(item) }
    complete(@final)
    at(2026, 12, 7, 8) { tick! }
    at(2026, 12, 21, 8) { tick! }
    assert_equal [], LearnerNudge.where(kind: "due_soon").pluck(:key).grep(%r{/final/|2026-12-07})
  end

  test "an extension cancels the old date's reminder and the new date gets its own" do
    target = GUAM.local(2026, 12, 28).end_of_day
    extension = @enrollment.learner_extensions.new(scope: "final", submissions_close_at: target, reason: "Family emergency")
    extension.record_change!(actor: @teacher)
    at(2026, 12, 20, 8) { tick! }
    at(2026, 12, 21, 8) { tick! }
    assert_empty LearnerNudge.where(kind: "due_soon").select { |nudge| nudge.key.include?("/final/") }
    at(2026, 12, 27, 8) { tick! }
    final = LearnerNudge.where(kind: "due_soon").select { |nudge| nudge.key.include?("/final/") }
    assert_equal [ "48h" ], final.map(&:threshold)
    assert_equal target.to_i, final.first.event_at.to_i
  end

  test "an extension granted after the 48h reminder moves the 24h one to the new date" do
    at(2026, 12, 20, 8) { tick! }
    assert_equal [ "48h" ], LearnerNudge.pluck(:threshold)
    target = GUAM.local(2026, 12, 25).end_of_day
    @enrollment.reload.learner_extensions.new(scope: "final", submissions_close_at: target, reason: "Sick").record_change!(actor: @teacher)
    at(2026, 12, 21, 8) { tick! }
    assert_empty LearnerNudge.where(threshold: "24h").select { |nudge| nudge.key.include?("/final/") }
    at(2026, 12, 25, 8) { tick! }
    assert_equal [ target.to_i ], LearnerNudge.where(threshold: "24h").select { |nudge| nudge.key.include?("/final/") }.map { |nudge| nudge.event_at.to_i }
  end

  test "quiet hours hold everything until the first tick at or after 08:00 Guam" do
    [ [ 20, 21, 0 ], [ 21, 3, 0 ], [ 21, 7, 59 ] ].each do |day, hour, minute|
      at(2026, 12, day, hour, minute) { assert tick![:quiet_hours] }
    end
    assert_equal 0, LearnerNudge.count
    at(2026, 12, 21, 8) { tick! }
    assert_equal [ "24h" ], LearnerNudge.where(kind: "due_soon").pluck(:threshold).uniq
    assert_equal 1, LearnerNudge.count # the deferred reminder is sent once, at its tightest threshold
  end

  test "learners who turn reminders off get only the essential access notice" do
    @enrollment.user.update!(learner_nudges_enabled: false)
    @enrollment.update!(access_expires_at: GUAM.local(2026, 12, 30, 12))
    at(2026, 12, 20, 8) { tick! }
    nudge = LearnerNudge.sole
    assert_equal [ "access_ending", "14d", true ], [ nudge.kind, nudge.threshold, nudge.essential ]
    assert_includes @emails.sole[:html], "sent even when reminders are turned off"
    at(2026, 12, 27, 13) { tick! }
    assert_equal %w[14d 3d], LearnerNudge.order(:id).pluck(:threshold)
  end

  test "access and support endings each notify at both thresholds" do
    @enrollment.update!(support_expires_at: GUAM.local(2026, 12, 10, 12), access_expires_at: GUAM.local(2027, 1, 20, 12))
    active!(GUAM.local(2026, 12, 3, 12))
    at(2026, 12, 3, 13) { tick! }
    assert_equal [ "support_ending/7d" ], keys
    at(2026, 12, 9, 13) { tick! }
    assert_equal [ "support_ending/7d", "support_ending/1d" ], keys
    assert_equal "Your help period ends tomorrow", LearnerNudge.last.title
    assert_includes LearnerNudge.last.body, "Your lessons stay open through Jan 20, 2027."
  end

  test "support ending with access the same day is left to the access notice" do
    ends = GUAM.local(2026, 12, 10, 12)
    @enrollment.update!(support_expires_at: ends, access_expires_at: ends + 2.hours)
    at(2026, 12, 9, 13) { tick! }
    assert_equal [ "access_ending/3d" ], keys
  end

  test "inactivity reminds after 7 and 14 days while work is open, and new activity starts over" do
    active!(GUAM.local(2026, 12, 2, 10))
    at(2026, 12, 9, 9) { tick! }
    assert_equal [], keys.grep(/inactive/)
    at(2026, 12, 9, 11) { tick! }
    assert_equal [ "inactive/7d" ], keys.grep(/inactive/)
    nudge = LearnerNudge.find_by!(kind: "inactive")
    assert_equal "Pick up where you left off", nudge.title
    assert_includes nudge.body, "7 days since your last activity in Python pilot"
    at(2026, 12, 16, 11) { tick! }
    assert_equal [ "inactive/7d", "inactive/14d" ], keys.grep(/inactive/)
    active!(GUAM.local(2026, 12, 17, 10))
    at(2026, 12, 24, 11) { tick! }
    assert_equal 3, LearnerNudge.where(kind: "inactive").count
  end

  test "a learner who never started gets a start message, not a last-activity one" do
    at(2026, 12, 8, 9) { tick! }
    nudge = LearnerNudge.find_by!(kind: "inactive")
    assert_equal [ "7d", "Your course is ready when you are" ], [ nudge.threshold, nudge.title ]
    assert_includes nudge.body, "You haven't started Python pilot yet. Next up:"
  end

  test "no inactivity reminder without open work or before the learner's start" do
    (@lessons + [ @final ]).each { |item| complete(item, at: GUAM.local(2026, 12, 1, 10)) }
    at(2026, 12, 12, 9) { tick! }
    assert_equal 0, LearnerNudge.where(kind: "inactive").count

    later = enroll(@cohort, "late")
    later.update!(starts_on: Date.new(2027, 1, 4))
    at(2026, 12, 30, 9) { tick! }
    assert_equal 0, LearnerNudge.where(enrollment: later).count
  end

  test "one optional reminder a day: the most urgent goes, the rest wait" do
    @enrollment.update!(support_expires_at: GUAM.local(2026, 12, 21, 12))
    at(2026, 12, 20, 8) { tick! }
    assert_equal [ "due_soon/48h" ], keys
    at(2026, 12, 20, 15) { tick! }
    assert_equal 1, LearnerNudge.count
    at(2026, 12, 21, 8) { tick! }
    assert_equal [ "due_soon/48h", "due_soon/24h" ], keys # the 24h final outranks support ending
  end

  test "two opted-in enrollments share the learner's Guam daily cap, but access ending can still send" do
    second = enroll(paced_cohort("Second program"), "second", user: @enrollment.user)
    at(2026, 12, 20, 8) do
      assert_equal 1, LearnerNudges.preview(Time.current)[:would_claim]
      tick!
    end
    assert_equal [ @enrollment.id, Date.new(2026, 12, 20) ], LearnerNudge.sole.values_at(:enrollment_id, :school_date)

    second.update!(access_expires_at: GUAM.local(2026, 12, 28, 12))
    at(2026, 12, 20, 15) { tick! }
    assert_equal [ @enrollment.id, second.id ], LearnerNudge.order(:id).pluck(:enrollment_id)
    assert_equal [ "due_soon/48h", "access_ending/14d" ], keys
    at(2026, 12, 21, 8) { tick! }
    assert_equal 1, LearnerNudge.where(school_date: Date.new(2026, 12, 21), essential: false).count
  end

  test "paused, dropped, completed, expired, archived and invited learners, and closed cohorts, get nothing" do
    { "paused" => { status: :paused }, "dropped" => { status: :dropped }, "completed" => { status: :completed },
      "expired" => { access_expires_at: GUAM.local(2026, 12, 19) } }.each do |name, attributes|
      enroll(@cohort, name).update_columns(attributes.transform_values { |value| value.is_a?(Symbol) ? Enrollment.statuses.fetch(value.to_s) : value })
    end
    enroll(@cohort, "archived").user.update_columns(archived_at: 1.day.ago)
    enroll(@cohort, "invited").user.update_columns(clerk_id: "pending_invite")
    closed = paced_cohort("Finished cohort")
    enroll(closed, "closed")
    closed.update_columns(status: Cohort.statuses.fetch("completed"))
    at(2026, 12, 20, 8) { tick! }
    assert_equal [ @enrollment.id ], LearnerNudge.distinct.pluck(:enrollment_id)
  end

  test "the school switch and each cohort's own opt-in are both required" do
    inherit = paced_cohort("Inherits", features: {})
    off = paced_cohort("Off", features: { "learner_nudges" => false })
    enroll(inherit, "inherit")
    enroll(off, "off")
    at(2026, 12, 20, 8) { tick! }
    assert_equal [ @enrollment.id ], LearnerNudge.distinct.pluck(:enrollment_id)
    assert_not LearnerNudges.enabled_for?(inherit)

    LearnerNudge.delete_all
    Notification.delete_all
    SchoolSetting.current.update!(features: { "learner_nudges" => false })
    at(2026, 12, 21, 8) { tick! }
    assert_equal 0, LearnerNudge.count
    assert_not LearnerNudges.enabled_for?(@cohort)
  end

  test "one learner's failure is logged and skipped, the others are still reminded, and the task reports it" do
    other = enroll(@cohort, "other")
    broken = @enrollment.id
    original = LearnerNudges.instance_method(:candidates_for)
    LearnerNudges.define_method(:candidates_for) do |enrollment, *rest|
      raise "corrupt plan" if enrollment.id == broken

      original.bind_call(self, enrollment, *rest)
    end
    at(2026, 12, 20, 8) do
      metrics = {}
      assert_raises(LearnerNudges::EvaluationFailed) { LearnerNudges.new.call(now: Time.current, metrics: metrics) }
      assert_equal 1, metrics[:failed]
    end
    assert_equal [ other.id ], LearnerNudge.distinct.pluck(:enrollment_id)
  ensure
    LearnerNudges.define_method(:candidates_for, original)
  end

  test "a concurrent tick! that loses the key sends nothing" do
    at(2026, 12, 20, 8) do
      service = LearnerNudges.new
      chosen = service.send(:choose, Enrollment.where(id: @enrollment.id).includes(:user, :cohort).to_a, Time.current, FeatureSwitches.school, { failed: 0 })
      tick!
      assert_equal [], service.send(:claim, chosen, { claimed: 0 })
    end
    assert_equal 1, Notification.count
  end

  test "an optional deadline projection raising still delivers essential access ending" do
    @enrollment.update!(access_expires_at: GUAM.local(2026, 12, 30, 12))
    @enrollment.update!(support_expires_at: GUAM.local(2026, 12, 23, 12))
    service = LearnerNudges.new
    service.define_singleton_method(:due_soon) { |*| raise "broken deadline" }
    at(2026, 12, 20, 8) do
      metrics = {}
      assert_raises(LearnerNudges::EvaluationFailed) { service.call(now: Time.current, metrics: metrics) }
      assert_equal 1, metrics[:failed]
    end
    assert_equal [ "access_ending/14d" ], keys
    assert_equal "sent", LearnerNudge.sole.email_status
    assert_equal LearnerNudge.sole, Notification.sole.notifiable
  end

  test "push is claimed per provider once and settled; the outbox re-requests a lost push and drops a stale one" do
    calls = []
    web = WebPushNotificationService.method(:system_notice)
    expo = ExpoPushNotificationService.method(:system_notice)
    WebPushNotificationService.define_singleton_method(:system_notice) { |record, notifications| calls << [ :web, record.id, notifications.map(&:id) ] }
    ExpoPushNotificationService.define_singleton_method(:system_notice) { |record, notifications| calls << [ :expo, record.id, notifications.map(&:id) ] }
    at(2026, 12, 20, 8) { tick! }
    nudge = LearnerNudge.sole
    assert_equal [ [ :web, nudge.id, [ Notification.sole.id ] ], [ :expo, nudge.id, [ Notification.sole.id ] ] ], calls
    assert nudge.reload.push_settled_at
    PushNotificationJob.perform_now("LearnerNudge", nudge.id, [ Notification.sole.id ])
    assert_equal 2, calls.size

    # A crash after the claim committed: unsettled, nothing attempted yet.
    nudge.update_columns(push_settled_at: nil, web_push_attempted_notification_ids: [], expo_push_attempted_notification_ids: [], push_requested_at: GUAM.local(2026, 12, 20, 8))
    at(2026, 12, 20, 8, 3) { tick! }
    assert_equal 2, calls.size # within the grace period
    at(2026, 12, 20, 9) { assert_equal 1, tick![:push_requeued] }
    assert_equal 4, calls.size
    assert nudge.reload.push_settled_at

    nudge.update_columns(push_settled_at: nil, web_push_attempted_notification_ids: [ Notification.sole.id ], expo_push_attempted_notification_ids: [], push_requested_at: GUAM.local(2026, 12, 20, 8))
    at(2026, 12, 21, 9) { assert_equal 1, tick![:push_expired] }
    assert_equal 4, calls.count { |call| call[1] == nudge.id }
    assert_equal "partial", nudge.reload.push_status
  ensure
    WebPushNotificationService.define_singleton_method(:system_notice, web)
    ExpoPushNotificationService.define_singleton_method(:system_notice, expo)
  end

  test "recovery cancels a pending optional push when the cohort turns off" do
    assert_canceled_push { @cohort.update!(settings: { "features" => { "learner_nudges" => false } }) }
  end

  test "recovery cancels a pending optional push when the learner opts out" do
    assert_canceled_push { @enrollment.user.update!(learner_nudges_enabled: false) }
  end

  test "overnight recovery cancels a pending push for an extended final deadline" do
    # The original 48h threshold would still qualify at 08:00 without the extension.
    @enrollment.learner_extensions.new(scope: "lesson", lesson: @final, submissions_close_at: GUAM.local(2026, 12, 22, 12),
      reason: "First extension").record_change!(actor: @teacher)
    assert_canceled_push do
      @enrollment.learner_extensions.new(scope: "final", submissions_close_at: GUAM.local(2026, 12, 28).end_of_day,
        reason: "Family emergency").record_change!(actor: @teacher)
    end
    assert_equal [ "due_soon/#{@enrollment.id}/final/2026-12-22T02:00:00Z/48h" ], LearnerNudge.pluck(:key).grep(%r{/final/})
  end

  test "overnight recovery cancels a pending inactivity push after the learner resumes work" do
    assert_canceled_push(day: 11) { complete(@lessons.first, at: GUAM.local(2026, 12, 11, 23)) }
  end

  test "opt-out alone does not cancel essential pushes, but school or enrollment eligibility still applies" do
    @enrollment.update!(access_expires_at: GUAM.local(2026, 12, 30, 12))
    @enrollment.user.update!(learner_nudges_enabled: false)
    at(2026, 12, 20, 20) { tick! }
    nudge = LearnerNudge.sole
    calls = record_pushes do
      reopen_push(nudge)
      at(2026, 12, 21, 8) { tick! }
      assert_equal "attempted", nudge.reload.push_status

      reopen_push(nudge)
      @enrollment.update!(status: :paused)
      at(2026, 12, 21, 8) { tick! }
      assert_equal "not_sent", nudge.reload.push_status

      reopen_push(nudge)
      @enrollment.update!(status: :active)
      SchoolSetting.current.update!(features: { "learner_nudges" => false })
      at(2026, 12, 21, 8) { tick! }
      assert_equal "not_sent", nudge.reload.push_status
    end
    assert_equal [ [ :web, nudge.id ], [ :expo, nudge.id ] ], calls
    assert_equal nudge, Notification.sole.notifiable
  end

  test "an email the provider refuses is recorded as failed and is not retried" do
    Resend::Emails.define_singleton_method(:send) { |*| raise Resend::Error, "rejected" }
    at(2026, 12, 20, 8) { assert_equal 1, tick![:email_failed] }
    at(2026, 12, 20, 9) { tick! }
    assert_equal [ "failed" ], LearnerNudge.pluck(:email_status)
    assert_equal 1, Notification.count
  end

  test "budgeted batches never wrap into the first page and quiet ticks preserve the sweep" do
    ids = [ @enrollment.id ] + 4.times.map { |index| enroll(@cohort, "batch#{index}").id }
    batches = []
    task = ScheduledTick::Task.new(name: "learner_nudges", daily_hour: nil, call: ->(now, _last, metrics) do
      elapsed = 0
      service = LearnerNudges.new(batch_size: 2, time_budget: 1)
      service.define_singleton_method(:monotonic) { elapsed }
      choose = service.method(:choose)
      service.define_singleton_method(:choose) do |batch, *args|
        batches << batch.map(&:id)
        elapsed = 1
        choose.call(batch, *args)
      end
      service.call(now: now, metrics: metrics)
    end)
    at(2026, 12, 20, 20) { assert_not ScheduledTick.new(tasks: [ task ]).call }
    assert_equal [ ids[1], ids.last ], nudge_checkpoint.values_at("resume_after", "sweep_boundary")
    at(2026, 12, 20, 21) { assert ScheduledTick.new(tasks: [ task ]).call }
    at(2026, 12, 21, 7, 59) { assert ScheduledTick.new(tasks: [ task ]).call }
    assert_equal [ true, ids[1], ids.last ], nudge_checkpoint.values_at("quiet_hours", "resume_after", "sweep_boundary")
    at(2026, 12, 21, 8) { assert_not ScheduledTick.new(tasks: [ task ]).call }
    assert_equal [ ids[3], ids.last ], nudge_checkpoint.values_at("resume_after", "sweep_boundary")
    at(2026, 12, 21, 9) { assert ScheduledTick.new(tasks: [ task ]).call }
    assert_equal [ ids.first(2), ids[2, 2], ids.last(1) ], batches
    assert_empty nudge_checkpoint.slice("resume_after", "sweep_boundary")
  end

  test "time spent on recovery can exhaust the budget before the first enrollment batch" do
    service = LearnerNudges.new(time_budget: 1)
    elapsed = 0
    service.define_singleton_method(:monotonic) { elapsed }
    service.define_singleton_method(:recover_deliveries) { |*| elapsed = 1 }
    at(2026, 12, 20, 8) do
      metrics = {}
      assert_raises(LearnerNudges::BacklogRemaining) { service.call(now: Time.current, metrics: metrics) }
      assert_equal [ 0, @enrollment.id ], metrics.values_at(:resume_after, :sweep_boundary)
      assert_empty LearnerNudge.all
    end
  end

  test "crossing 21:00 between providers defers later delivery and stops the next batch" do
    second = enroll(@cohort, "second")
    local = GUAM.local(2026, 12, 20, 20, 59)
    service = LearnerNudges.new(batch_size: 1, clock: -> { local })
    calls = record_pushes(on_web: ->(_) { local += 1.minute }) do
      service.call(now: local)
      assert_equal [ @enrollment.id ], LearnerNudge.pluck(:enrollment_id)
      assert_equal "pending", LearnerNudge.sole.push_status
      assert_empty LearnerNudge.sole.expo_push_attempted_notification_ids
      assert_equal 1, @emails.size
    end
    assert_equal [ [ :web, LearnerNudge.sole.id ] ], calls
    assert_empty second.learner_nudges
  end

  test "unstarted email and pushes at 21:00 stay pending and eligible ones recover at 08:00" do
    @enrollment.update!(access_expires_at: GUAM.local(2026, 12, 21, 18))
    local = GUAM.local(2026, 12, 20, 20, 59)
    service = LearnerNudges.new(clock: -> { local })
    service.define_singleton_method(:pace_email) { local += 1.minute }
    push_titles = []
    calls = record_pushes(on_web: ->(notices) { push_titles.concat(notices.map(&:title)) }) do
      service.call(now: local)
      nudge = LearnerNudge.sole
      assert_equal [ "pending", "pending" ], [ nudge.email_status, nudge.push_status ]
      assert_empty @emails
      at(2026, 12, 21, 8) { tick! }
      assert_equal [ "sent", "attempted" ], [ nudge.reload.email_status, nudge.push_status ]
      assert_match(/ends tomorrow\z/, Notification.find_by!(notifiable: nudge).title)
    end
    nudge = LearnerNudge.find_by!(kind: "access_ending")
    assert_equal [ :web, :expo ], calls.select { |_, id| id == nudge.id }.map(&:first)
    assert_equal 1, @emails.count { |email| email[:subject].include?("Your access") }
    assert_includes push_titles, "Your access to Python pilot ends today"
    assert @emails.any? { |email| email[:subject].include?("Python pilot ends today") }
  end

  test "guided terms ending at midnight name the last usable day" do
    @enrollment.update!(support_expires_at: GUAM.local(2026, 12, 3), access_expires_at: GUAM.local(2026, 12, 17))
    active!(GUAM.local(2026, 12, 1, 10))
    at(2026, 12, 2, 8) { tick! }
    nudge = LearnerNudge.find_by!(kind: "support_ending")
    assert_equal [ "1d", "Your help period ends today" ], [ nudge.threshold, nudge.title ]
    assert_includes nudge.body, "Your lessons stay open through Dec 16, 2026."
  end

  test "a completed cohort's learners still get the essential access notice, and only that" do
    @enrollment.update!(access_expires_at: GUAM.local(2026, 12, 30, 12), support_expires_at: GUAM.local(2026, 12, 22, 12))
    @cohort.update_columns(status: Cohort.statuses.fetch("completed"))
    at(2026, 12, 20, 8) { tick! }
    assert_equal [ "access_ending/14d" ], keys
    @cohort.update_columns(status: Cohort.statuses.fetch("archived"))
    at(2026, 12, 27, 13) { tick! }
    assert_equal [ "access_ending/14d" ], keys
  end

  test "dry-tick! preview counts what would go out without writing" do
    at(2026, 12, 20, 8) do
      assert_no_difference([ "LearnerNudge.count", "Notification.count" ]) do
        assert_equal 1, LearnerNudges.preview(Time.current)[:would_claim]
      end
      assert LearnerNudges.preview(GUAM.local(2026, 12, 20, 22))[:quiet_hours]
    end
    SchoolSetting.current.update!(features: {})
    assert_equal({ would_claim: 0, enabled: false }, LearnerNudges.preview(Time.current))
  end

  test "evaluation and claiming queries stay flat as learners grow" do
    counts = [ 1, 5 ].map do |size|
      LearnerNudge.delete_all
      Notification.delete_all
      Enrollment.where.not(id: @enrollment.id).where(cohort: @cohort).destroy_all
      (size - 1).times { |index| enroll(@cohort, "flat#{size}_#{index}") }
      at(2026, 12, 20, 8) do
        first = without_delivery { count_queries { tick! } }
        rerun = count_queries { tick! }
        assert_equal size, LearnerNudge.count
        [ first, rerun ]
      end
    end
    assert_equal counts.first, counts.last
  end

  test "Off cohorts add no tick queries whether or not the school switch is on" do
    SchoolSetting.current.update!(features: {})
    off = count_queries { at(2026, 12, 20, 8) { tick! } }
    5.times { |index| enroll(paced_cohort("Off #{index}", features: {}), "off#{index}") }
    assert_equal off, count_queries { at(2026, 12, 20, 8) { tick! } }

    SchoolSetting.current.update!(features: { "learner_nudges" => true })
    @cohort.update!(settings: { "features" => { "learner_nudges" => false } })
    base = count_queries { at(2026, 12, 20, 8) { tick! } }
    enroll(paced_cohort("Also off", features: {}), "also_off")
    assert_equal base, count_queries { at(2026, 12, 20, 8) { tick! } }
    assert_equal 0, LearnerNudge.count
  end

  private

  def nudge_checkpoint = ScheduledTaskRun.find_by!(name: "learner_nudges").last_result

  def assert_canceled_push(day: 20)
    at(2026, 12, day, 20) { tick! }
    nudge = LearnerNudge.sole
    notice = Notification.sole
    reopen_push(nudge)
    yield
    calls = record_pushes do
      at(2026, 12, day, 23) { assert tick![:quiet_hours] }
      assert_equal "pending", nudge.reload.push_status
      at(2026, 12, day + 1, 8) { tick! }
    end
    assert_empty calls.select { |_, id| id == nudge.id }
    assert_equal "not_sent", nudge.reload.push_status
    assert_equal nudge, notice.reload.notifiable
  end

  def reopen_push(nudge)
    nudge.update_columns(push_settled_at: nil, web_push_attempted_notification_ids: [], expo_push_attempted_notification_ids: [])
  end

  def record_pushes(on_web: ->(_notices) { })
    calls = []
    web = WebPushNotificationService.method(:system_notice)
    expo = ExpoPushNotificationService.method(:system_notice)
    WebPushNotificationService.define_singleton_method(:system_notice) { |record, notices| calls << [ :web, record.id ]; on_web.call(notices) }
    ExpoPushNotificationService.define_singleton_method(:system_notice) { |record, _| calls << [ :expo, record.id ] }
    yield
    calls
  ensure
    WebPushNotificationService.define_singleton_method(:system_notice, web)
    ExpoPushNotificationService.define_singleton_method(:system_notice, expo)
  end

  def tick!
    metrics = {}
    LearnerNudges.new.call(now: Time.current, metrics: metrics)
    metrics
  end

  def at(year, month, day, hour, minute = 0, &block)
    travel_to(GUAM.local(year, month, day, hour, minute), &block)
  end

  def keys = LearnerNudge.order(:id).map { |nudge| "#{nudge.kind}/#{nudge.threshold}" }

  # Delivery is one email, one status write and one push job per reminder
  # sent; the rest of the run (evaluation and the claim) is measured.
  def without_delivery
    original = LearnerNudges.instance_method(:deliver)
    LearnerNudges.define_method(:deliver) { |*| nil }
    yield
  ensure
    LearnerNudges.define_method(:deliver, original)
  end

  def lesson(title, position, type: :exercise)
    record = @mod.lessons.create!(title: title, position: position, release_day: 0, lesson_type: type)
    record.content_blocks.create!(block_type: :exercise, position: 0, title: "#{title} exercise", submission_type: "text_submission")
    record
  end

  def paced_cohort(name, features: { "learner_nudges" => true })
    cohort = Cohort.create!(curriculum: @curriculum, name: name, start_date: Date.new(2026, 12, 1), status: :active,
      course_delivery: "guided", learner_pace_weeks: [ 3 ], settings: { "features" => features })
    cohort.cohort_instructor_assignments.create!(user: @teacher)
    cohort
  end

  def enroll(cohort, name, user: person(name, :student))
    enrollment = Enrollment.create!(cohort: cohort, user: user, status: :active)
    enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    LearnerPace.new(enrollment).choose!(weeks: 3, actor: @teacher)
    enrollment
  end

  def person(name, role)
    @people = (@people || 0) + 1
    User.create!(clerk_id: "nudges_#{name}_#{@people}", email: "nudges_#{name}_#{@people}@example.com", first_name: name.capitalize, role: role)
  end

  def active!(time)
    ActivityEvent.create!(actor: @enrollment.user, subject_user: @enrollment.user, cohort: @cohort, event_type: "checkpoint_completed", created_at: time)
  end

  def complete(lesson, at: Time.current)
    lesson.content_blocks.each do |block|
      Submission.create!(user: @enrollment.user, enrollment: @enrollment, content_block: block, text: "Done", created_at: at)
    end
  end
end
