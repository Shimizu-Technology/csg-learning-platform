require "test_helper"
require "stringio"
require_relative "../support/after_commit_helpers"
require_relative "../support/query_counter"

# W6.4 (U-3.6): scheduling an update. A scheduled update is a draft with a
# send time; the hourly scheduled:tick posts it once, at the first run at or
# after that time. Until then nobody but its author and admins sees it.
class ScheduledUpdatesTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include QueryCounter
  include ActiveJob::TestHelper

  setup do
    curriculum = Curriculum.create!(name: "Scheduled curriculum")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Scheduled cohort", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: curriculum, name: "Other cohort", start_date: Date.current, status: :active)
    @admin = person("admin", :admin)
    @author = person("author", :instructor)
    @colleague = person("colleague", :instructor)
    @outsider = person("outsider", :instructor)
    [ @author, @colleague ].each { |instructor| @cohort.cohort_instructor_assignments.create!(user: instructor) }
    @other_cohort.cohort_instructor_assignments.create!(user: @outsider)
    @student = person("student", :student)
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @log = StringIO.new
  end

  test "the author schedules, reschedules, cancels and schedules again; nothing is sent and only the author and admins see it" do
    first = 2.days.from_now.change(usec: 0)
    as_user(@author) do
      assert_no_enqueued_jobs do
        post "/api/v1/announcements", params: schedule_params(first, title: "Lab moves schedneedle", send_push: true), headers: headers, as: :json
      end
      assert_response :created
    end
    body = response.parsed_body["announcement"]
    update = Announcement.find(body["id"])
    assert_equal [ "draft", first.utc.iso8601(3), true, "Pacific/Guam" ], body.values_at("status", "scheduled_for", "scheduled_send_push", "schedule_time_zone")
    assert_equal [ @author.id, true ], [ update.scheduled_by_id, update.scheduled_send_push ]
    assert_nil update.published_at

    later = 3.days.from_now.change(min: 0, sec: 0, usec: 0)
    as_user(@author) do
      patch "/api/v1/announcements/#{update.id}", params: { scheduled_for: later.iso8601, title: "Lab moves to Thursday schedneedle" }, headers: headers, as: :json
      assert_response :success
      assert_equal later.utc.iso8601(3), response.parsed_body.dig("announcement", "scheduled_for")
      assert_equal true, response.parsed_body.dig("announcement", "scheduled_send_push"), "rescheduling keeps the push choice"

      patch "/api/v1/announcements/#{update.id}", params: { scheduled_for: nil }, headers: headers, as: :json
      assert_response :success
      assert_equal [ "draft", nil, false ], response.parsed_body["announcement"].values_at("status", "scheduled_for", "scheduled_send_push")
      get "/api/v1/announcements", params: { scope: "manage", status: "draft" }, headers: headers
      assert_includes ids, update.id, "a cancelled schedule is an ordinary draft"

      patch "/api/v1/announcements/#{update.id}", params: { scheduled_for: later.iso8601, send_push: false }, headers: headers, as: :json
      assert_response :success
      assert_equal [ later.utc.iso8601(3), false ], response.parsed_body["announcement"].values_at("scheduled_for", "scheduled_send_push")
    end
    assert_equal 0, Notification.where(notifiable: update).count

    [ @author, @admin ].each do |viewer|
      as_user(viewer) do
        get "/api/v1/announcements", params: { scope: "manage", status: "scheduled", sort: "scheduled_asc" }, headers: headers
        assert_equal [ update.id ], ids
        get "/api/v1/announcements", params: { scope: "manage", status: "draft" }, headers: headers
        assert_not_includes ids, update.id, "Drafts lists unscheduled drafts only"
        get "/api/v1/announcements/#{update.id}", headers: headers
        assert_response :success
      end
    end

    as_user(@colleague) do
      get "/api/v1/announcements", params: { scope: "manage", status: "scheduled" }, headers: headers
      assert_empty ids
      get "/api/v1/announcements/#{update.id}", headers: headers
      assert_response :not_found
      patch "/api/v1/announcements/#{update.id}", params: { scheduled_for: nil }, headers: headers, as: :json
      assert_response :not_found
    end
    assert_hidden_from_student(update, "schedneedle")
  end

  test "a send time needs a UTC offset, must be ahead and within a year, and only a draft can have one" do
    as_user(@author) do
      [ "2030-01-01T09:00", "tomorrow", "2030-13-45T09:00:00+10:00" ].each do |value|
        post "/api/v1/announcements", params: schedule_params(value), headers: headers, as: :json
        assert_response :unprocessable_entity
        assert_equal [ "Send time must be an ISO 8601 time with a UTC offset" ], response.parsed_body["errors"]
      end
      post "/api/v1/announcements", params: schedule_params(1.minute.ago), headers: headers, as: :json
      assert_equal [ "Choose a send time in the future" ], response.parsed_body["errors"]
      post "/api/v1/announcements", params: schedule_params(13.months.from_now), headers: headers, as: :json
      assert_equal [ "Choose a send time within a year" ], response.parsed_body["errors"]
      post "/api/v1/announcements", params: schedule_params(1.day.from_now, body: ""), headers: headers, as: :json
      assert_includes response.parsed_body["errors"], "Body can't be blank"
      post "/api/v1/announcements", params: schedule_params(1.day.from_now, status: "published"), headers: headers, as: :json
      assert_equal [ "Post an update now or schedule it as a draft, not both" ], response.parsed_body["errors"]
      assert_equal 0, Announcement.where(author: @author).count
    end

    # Only null or "" cancels a schedule; any other non-time value is refused, not taken as a cancel.
    update = scheduled(at: 1.day.from_now)
    as_user(@author) do
      [ false, [], 0, { at: "tomorrow" }, "   " ].each do |value|
        patch "/api/v1/announcements/#{update.id}", params: { scheduled_for: value }, headers: headers, as: :json
        assert_response :unprocessable_entity, value.inspect
        assert_equal [ "Send time must be an ISO 8601 time with a UTC offset" ], response.parsed_body["errors"]
      end
      assert update.reload.scheduled?
      patch "/api/v1/announcements/#{update.id}", params: { scheduled_for: "" }, headers: headers, as: :json
      assert_response :success
      assert_nil update.reload.scheduled_for
    end

    posted = Announcement.create!(title: "Posted", body: "Words", author: @author, audience: :cohort, cohort: @cohort, status: :published)
    as_user(@author) do
      patch "/api/v1/announcements/#{posted.id}", params: { scheduled_for: 1.day.from_now.iso8601 }, headers: headers, as: :json
      assert_response :unprocessable_entity
      assert_equal [ "This update has already been posted, so its schedule can't change" ], response.parsed_body["errors"]
      patch "/api/v1/announcements/#{posted.id}", params: { scheduled_for: nil }, headers: headers, as: :json
      assert_response :unprocessable_entity
    end
    assert_raises(ActiveRecord::RecordInvalid, "An update that has been posted can't be scheduled") { posted.update!(scheduled_for: 1.day.from_now) }
  end

  test "scheduling to a cohort the poster doesn't teach is refused like posting there" do
    as_user(@author) do
      post "/api/v1/announcements", params: schedule_params(1.day.from_now, cohort_id: @other_cohort.id), headers: headers, as: :json
      assert_response :forbidden
      post "/api/v1/announcements", params: schedule_params(1.day.from_now, audience: "global", cohort_id: nil), headers: headers, as: :json
      assert_response :forbidden
    end
    assert_equal 0, Announcement.count
  end

  test "the tick posts a due update once, after the commit, and a rerun or later tick posts nothing again" do
    second = person("second", :student)
    Enrollment.create!(user: second, cohort: @cohort, status: :active)
    update = scheduled(at: Time.utc(2026, 11, 18, 23), push: true) # Nov 19 09:00 Guam

    travel_to Time.utc(2026, 11, 18, 22, 59) do
      assert tick(Time.current)
      assert update.reload.scheduled?, "08:59 is before its time"
    end

    travel_to Time.utc(2026, 11, 18, 23, 0, 20) do
      with_inline_jobs do
        record_external_calls(WebPushNotificationService, :announcement_published) do |web|
          record_external_calls(ExpoPushNotificationService, :announcement_published) do |expo|
            assert tick(Time.current)
            assert_sent_after_commit(web, "web push")
            assert_sent_after_commit(expo, "Expo push")
            assert_equal 1, web.size
            assert_equal 1, expo.size
          end
        end
      end
      update.reload
      assert update.published?
      assert_equal Time.current, update.published_at
      assert_equal [ @student.id, second.id ].sort, Notification.where(notifiable: update).pluck(:user_id).sort
      run = ScheduledTaskRun.find_by!(name: "scheduled_updates")
      assert_equal [ 1, 1, 0, 0 ], run.last_result.values_at("claimed", "sent", "failed", "refused")

      # The publisher itself is idempotent, apart from the tick's hourly checkpoint.
      assert_no_enqueued_jobs do
        assert_equal 0, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:sent]
        assert tick(Time.current)
      end
    end
    travel_to Time.utc(2026, 11, 19, 0, 0, 5) do
      assert_no_enqueued_jobs { assert tick(Time.current) }
    end
    assert_equal 2, Notification.where(notifiable: update).count

    travel_to Time.utc(2026, 11, 19, 1) do
      as_user(@student) do
        get "/api/v1/announcements/#{update.id}", headers: headers
        assert_response :success
        assert_equal [ "published", nil ], response.parsed_body["announcement"].values_at("status", "scheduled_for")
      end
    end
  end

  test "a time between hourly ticks goes out at the next tick, not before" do
    update = scheduled(at: Time.utc(2026, 11, 18, 23, 30))
    travel_to(Time.utc(2026, 11, 18, 23, 0, 10)) { assert tick(Time.current) }
    assert update.reload.scheduled?
    travel_to(Time.utc(2026, 11, 19, 0, 0, 10)) { assert tick(Time.current) }
    assert update.reload.published?
  end

  test "an update whose scheduler can no longer post there goes back to an unscheduled draft and tells its author once" do
    update = scheduled(at: Time.utc(2026, 11, 18, 23))
    @author.reload.cohort_instructor_assignments.destroy_all
    travel_to Time.utc(2026, 11, 18, 23, 1) do
      assert_no_enqueued_jobs { assert tick(Time.current) }
    end
    update.reload
    assert update.draft?
    assert_nil update.scheduled_for
    notice = Notification.find_by!(notifiable: update)
    assert_equal @author.id, notice.user_id
    assert_equal "system", notice.notification_type
    assert_equal "Not sent: the scheduler no longer teaches #{@cohort.name}.", update.schedule_failure
    assert_equal update.schedule_failure, notice.title
    assert_equal 1, ScheduledTaskRun.find_by!(name: "scheduled_updates").last_result["refused"]
    assert tick(Time.utc(2026, 11, 19, 1))
    assert_equal 1, Notification.where(notifiable: update).count
    as_user(@author) do
      get "/api/v1/announcements", params: { scope: "manage", status: "draft" }, headers: headers
      assert_response :success
      assert_includes ids, update.id
      assert_equal update.schedule_failure, response.parsed_body["announcements"].find { |row| row["id"] == update.id }["schedule_failure"]
    end
    as_user(@student) do
      get "/api/v1/announcements/#{update.id}", headers: headers
      assert_response :not_found
    end
  end

  test "a refused update can be scheduled again and refused again without duplicate notices" do
    update = scheduled(at: 1.hour.ago)
    @author.reload.cohort_instructor_assignments.destroy_all
    publisher = ScheduledAnnouncementPublisher.new
    assert_equal 1, publisher.call(now: Time.current)[:refused]
    # Validation alone must not delete the persisted notice or clear the reason.
    pending = Announcement.find(update.id)
    pending.scheduled_for = 1.hour.from_now
    pending.scheduled_by = @admin
    assert pending.valid?
    assert_equal 1, Notification.where(notifiable: update).count
    assert Announcement.find(update.id).schedule_failure.present?
    @cohort.cohort_instructor_assignments.create!(user: @author)
    as_user(@author) do
      patch "/api/v1/announcements/#{update.id}", params: { scheduled_for: 1.hour.from_now.iso8601 }, headers: headers, as: :json
      assert_response :success
    end
    assert_nil update.reload.schedule_failure
    assert_empty Notification.where(notifiable: update)
    @author.reload.cohort_instructor_assignments.destroy_all
    assert_equal 1, publisher.call(now: 2.hours.from_now)[:refused]
    assert_equal 1, Notification.where(notifiable: update).count
    @cohort.cohort_instructor_assignments.create!(user: @author)
    as_user(@author) do
      patch "/api/v1/announcements/#{update.id}", params: { status: "published" }, headers: headers, as: :json
      assert_response :success
    end
    assert_nil update.reload.schedule_failure
    assert_empty Notification.where(notifiable: update, notification_type: :system)
    assert_equal [ @student.id ], Notification.where(notifiable: update).pluck(:user_id)
  end

  test "an admin who schedules an instructor's draft to everyone is the one checked when it posts" do
    update = Announcement.create!(title: "School-wide", body: "Words", author: @author, audience: :global, status: :draft)
    as_user(@admin) do
      patch "/api/v1/announcements/#{update.id}", params: { scheduled_for: 1.hour.from_now.iso8601 }, headers: headers, as: :json
      assert_response :success
    end
    assert_equal @admin.id, update.reload.scheduled_by_id
    travel_to(2.hours.from_now) { assert tick(Time.current) }
    assert update.reload.published?
  end

  test "Post now on a scheduled draft posts it at once and the tick then has nothing to post" do
    update = scheduled(at: 1.day.from_now)
    as_user(@author) do
      patch "/api/v1/announcements/#{update.id}", params: { status: "published" }, headers: headers, as: :json
      assert_response :success
      assert_equal [ "published", nil ], response.parsed_body["announcement"].values_at("status", "scheduled_for")
    end
    assert_nil update.reload.scheduled_for
    travel_to(2.days.from_now) do
      assert_no_enqueued_jobs { assert_equal 0, ScheduledAnnouncementPublisher.new.call(now: Time.current)[:claimed] }
    end
    assert_equal 1, Notification.where(notifiable: update).count
  end

  test "a post that fails rolls back, stays scheduled, fails the task, and the next tick posts it" do
    update = scheduled(at: Time.utc(2026, 11, 18, 23))
    original = NotificationDeliveryService.method(:announcement_published)
    NotificationDeliveryService.define_singleton_method(:announcement_published) { |*| raise ActiveRecord::StatementInvalid, "connection lost" }
    travel_to(Time.utc(2026, 11, 18, 23, 1)) { assert_not tick(Time.current) }
    NotificationDeliveryService.define_singleton_method(:announcement_published, original)
    assert update.reload.scheduled?
    assert_equal "error", ScheduledTaskRun.find_by!(name: "scheduled_updates").last_result["status"]
    assert_includes @log.string, '"error":"ScheduledAnnouncementPublisher::PublishFailed"'

    travel_to(Time.utc(2026, 11, 19, 0, 0, 5)) { assert tick(Time.current) }
    assert update.reload.published?
    assert_equal 1, Notification.where(notifiable: update).count
  ensure
    NotificationDeliveryService.define_singleton_method(:announcement_published, original) if original
  end

  test "a dry run reports the due updates and posts nothing" do
    update = scheduled(at: Time.utc(2026, 11, 18, 23))
    travel_to Time.utc(2026, 11, 18, 23, 1) do
      assert ScheduledTick.new(now: Time.current, tasks: [ publish_task ], logger: logger, dry_run: true).call
    end
    assert update.reload.scheduled?
    assert_includes @log.string, '"would_publish":1'
  end

  test "posting from the tick sends the same statements for 1 or 10 recipients" do
    counts = [ 1, 10 ].map do |size|
      cohort = Cohort.create!(curriculum: @cohort.curriculum, name: "Fan-out #{size}", start_date: Date.current, status: :active)
      cohort.cohort_instructor_assignments.create!(user: @author)
      size.times { |index| Enrollment.create!(user: person("fan#{size}_#{index}", :student), cohort: cohort, status: :active) }
      update = scheduled(at: 1.hour.from_now, cohort: cohort)
      count = travel_to(2.hours.from_now) { count_queries { ScheduledAnnouncementPublisher.new.call(now: Time.current) } }
      assert_equal size, Notification.where(notifiable: update).count
      count
    end
    assert_equal counts.first, counts.last, "posting to 1 then 10 recipients sent #{counts.first} then #{counts.last} queries"
  end

  test "the Scheduled and Drafts lists send the same number of queries for one update or five" do
    # Grown with the instructor's own drafts and scheduled updates, which both
    # the instructor and the admin see, and measured with the rows in each
    # response checked (#299 review P3: an admin-authored fixture left the
    # instructor's list empty at both sizes).
    counts = [ 1, 5 ].map do |size|
      (size - Announcement.scheduled.count).times { |index| scheduled(at: (index + 1).days.from_now) }
      (size - Announcement.unscheduled_drafts.count).times do |index|
        Announcement.create!(title: "Draft #{size}.#{index}", body: "Words", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
      end
      [ @author, @admin ].product(%w[scheduled draft]).to_h do |viewer, status|
        params = { scope: "manage", status: status, sort: status == "scheduled" ? "scheduled_asc" : "updated_desc" }
        as_user(viewer) { get "/api/v1/announcements", params: params, headers: headers }
        count = count_queries { as_user(viewer) { get "/api/v1/announcements", params: params, headers: headers } }
        assert_response :success
        assert_equal size, ids.size, "#{viewer.first_name} #{status} list at size #{size}"
        [ [ viewer.first_name, status ], count ]
      end
    end
    assert_equal counts.first, counts.last
  end

  test "refused drafts remain visible to their author with flat list query counts" do
    @author.reload.cohort_instructor_assignments.destroy_all
    counts = [ 1, 5 ].map do |size|
      (size - Announcement.draft.where(author: @author).count).times { scheduled(at: 1.hour.ago) }
      ScheduledAnnouncementPublisher.new.call(now: Time.current)
      # Match the existing cardinality checks: warm request-global identity
      # associations before measuring each response size; QueryCounter clears SQL caches.
      as_user(@author) { get "/api/v1/announcements", params: { scope: "manage", status: "draft" }, headers: headers }
      count = count_queries do
        as_user(@author) { get "/api/v1/announcements", params: { scope: "manage", status: "draft" }, headers: headers }
      end
      assert_response :success
      assert_equal size, ids.size
      assert response.parsed_body["announcements"].all? { |row| row["schedule_failure"].present? && !row["can_edit"] }
      count
    end
    assert_equal counts.first, counts.last
  end

  test "everything due drains in one run, in batches, so nothing waits behind the hourly checkpoint" do
    # The review's repro: 101 due updates and one tick.
    101.times { scheduled(at: 1.hour.ago) }
    assert tick(Time.current)
    assert_equal 0, Announcement.scheduled.count
    assert_equal 101, Announcement.published.count
    assert_equal 101, ScheduledTaskRun.find_by!(name: "scheduled_updates").last_result["sent"]
  end

  test "a run that spends its time budget fails the task and the next run, even in the same hour, carries on" do
    5.times { scheduled(at: 1.hour.ago) }
    task = ScheduledTick::Task.new(name: "scheduled_updates", daily_hour: nil,
      call: ->(now, _last, metrics) { ScheduledAnnouncementPublisher.new(batch_size: 2, time_budget: 0).call(now: now, metrics: metrics) })
    run = ->(now) { ScheduledTick.new(now: now, tasks: [ task ], logger: logger, dry_run: false).call }
    at = Time.current
    assert_not run.call(at), "the budget ran out with work still due"
    assert_equal 3, Announcement.scheduled.count
    state = ScheduledTaskRun.find_by!(name: "scheduled_updates")
    assert_nil state.last_succeeded_at
    assert_equal "error", state.last_result["status"]
    assert_includes @log.string, "ScheduledAnnouncementPublisher::BacklogRemaining"
    assert_not run.call(at + 1.minute)
    assert run.call(at + 2.minutes), "the last batch drains it"
    assert_equal 0, Announcement.scheduled.count
    assert ScheduledTaskRun.find_by!(name: "scheduled_updates").last_succeeded_at
  end

  test "an update that fails to post isn't retried in a loop within the run" do
    good = scheduled(at: 1.hour.ago)
    bad = scheduled(at: 2.hours.ago)
    original = NotificationDeliveryService.method(:announcement_published)
    NotificationDeliveryService.define_singleton_method(:announcement_published) do |announcement, **kwargs|
      raise ActiveRecord::StatementInvalid, "connection lost" if announcement.id == bad.id

      original.call(announcement, **kwargs)
    end
    error = assert_raises(ScheduledAnnouncementPublisher::PublishFailed) { ScheduledAnnouncementPublisher.new(batch_size: 1).call(now: Time.current) }
    assert_match "1 scheduled update", error.message
    assert good.reload.published?
    assert bad.reload.scheduled?
  ensure
    NotificationDeliveryService.define_singleton_method(:announcement_published, original) if original
  end

  test "an update posted from a request whose push never ran is pushed by the tick once, after the grace period" do
    # A process killed between the commit and the after-commit push (the same gap as scheduled posts).
    as_user(@author) do
      assert_enqueued_with(job: PushNotificationJob) do
        post "/api/v1/announcements", params: schedule_params(nil, status: "published", scheduled_for: nil, send_push: true), headers: headers, as: :json
      end
    end
    update = Announcement.find(response.parsed_body.dig("announcement", "id"))
    assert update.push_requested_at
    clear_enqueued_jobs # the job that "never ran"
    travel_to(ScheduledAnnouncementPublisher::PUSH_GRACE.from_now + 1.second) do
      assert_enqueued_with(job: PushNotificationJob, args: [ "Announcement", update.id, Notification.where(notifiable: update).pluck(:id) ]) do
        assert tick(Time.current)
      end
    end
    assert_equal 1, ScheduledTaskRun.find_by!(name: "scheduled_updates").last_result["push_requeued"]
    perform_enqueued_jobs
    assert update.reload.push_settled_at
    travel_to(2.hours.from_now) { assert_no_enqueued_jobs { assert tick(Time.current) } }
  end

  test "posting without push leaves no intent, and a push unsettled for a day is settled without sending" do
    as_user(@author) do
      post "/api/v1/announcements", params: schedule_params(nil, status: "published", scheduled_for: nil, send_push: false), headers: headers, as: :json
    end
    assert_nil Announcement.find(response.parsed_body.dig("announcement", "id")).push_requested_at
    stale = Announcement.create!(title: "Old", body: "Words", author: @author, audience: :cohort, cohort: @cohort, status: :published, push_requested_at: 25.hours.ago)
    assert_no_enqueued_jobs { ScheduledAnnouncementPublisher.new.call(now: Time.current) }
    assert stale.reload.push_settled_at
  end

  test "staff who can't act on a scheduled update's or draft's cohort get the same 404 as a missing id for every action" do
    update = scheduled(at: 1.day.from_now)
    draft = Announcement.create!(title: "Plain draft", body: "Words", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    posted = Announcement.create!(title: "Posted", body: "Words", author: @admin, audience: :cohort, cohort: @cohort, status: :published)
    actions = [
      [ :get, {} ], [ :patch, { scheduled_for: nil } ], [ :patch, { scheduled_for: 2.days.from_now.iso8601 } ],
      [ :patch, { title: "Changed" } ], [ :patch, { status: "published" } ], [ :delete, {} ]
    ]
    expect_missing = lambda do |announcement, label|
      actions.each do |verb, params|
        options = verb == :get ? { headers: headers } : { params: params, headers: headers, as: :json }
        public_send(verb, "/api/v1/announcements/#{Announcement.maximum(:id) + 1000}", **options)
        missing = [ response.status, response.body ]
        public_send(verb, "/api/v1/announcements/#{announcement.id}", **options)
        assert_equal missing, [ response.status, response.body ], "#{label}: #{verb} #{params.keys.join(',')}"
      end
    end
    # A colleague on the cohort, an instructor of another cohort, and the
    # author once their assignment is gone (the review's repro).
    as_user(@colleague) { [ update, draft ].each { |item| expect_missing.call(item, "colleague, #{item.title}") } }
    as_user(@outsider) { [ update, draft ].each { |item| expect_missing.call(item, "outsider, #{item.title}") } }
    @author.reload.cohort_instructor_assignments.destroy_all
    as_user(@author) { [ update, draft ].each { |item| expect_missing.call(item, "removed author, #{item.title}") } }
    assert update.reload.scheduled?
    assert draft.reload.draft?

    # Posted updates keep main's answers: 403 for staff outside the cohort, and
    # for a colleague who can read it but not change it.
    as_user(@author) do
      get "/api/v1/announcements/#{posted.id}", headers: headers
      assert_response :forbidden
      patch "/api/v1/announcements/#{posted.id}", params: { title: "Changed" }, headers: headers, as: :json
      assert_response :forbidden
    end
    as_user(@colleague) do
      patch "/api/v1/announcements/#{posted.id}", params: { title: "Changed" }, headers: headers, as: :json
      assert_response :forbidden
    end
    assert_equal "Posted", posted.reload.title
  end

  test "a scheduled draft stays hidden from students with the new student experience on and off, counts included" do
    # Adapted from the review's adversarial test.
    update = scheduled(at: 1.day.from_now)
    [ false, true ].each do |enabled|
      @cohort.update!(settings: { "features" => { "student_experience_v2" => enabled } })
      update.update!(title: "review299unique")
      assert_hidden_from_student(update, "review299unique")
      as_user(@student) do
        get "/api/v1/announcements", params: { scope: "manage", status: "scheduled" }, headers: headers
        assert_equal 0, response.parsed_body["unread_count"]
        assert_equal 0, response.parsed_body.dig("meta", "total_count")
      end
    end
  end

  test "staff who manage a posted update see how many have read it; nobody else does" do
    readers = 3.times.map do |index|
      person("reader#{index}", :student).tap { |reader| Enrollment.create!(user: reader, cohort: @cohort, status: :active) }
    end
    update = Announcement.create!(title: "Read me", body: "Words", author: @author, audience: :cohort, cohort: @cohort, status: :published)
    NotificationDeliveryService.announcement_published(update)
    Notification.where(notifiable: update, user: readers.first(2)).update_all(read_at: Time.current)

    { @admin => { "notified" => 4, "read" => 2 }, @author => { "notified" => 4, "read" => 2 }, @colleague => { "notified" => 4, "read" => 2 } }.each do |viewer, expected|
      as_user(viewer) { get "/api/v1/announcements/#{update.id}", headers: headers }
      assert_equal expected, response.parsed_body.dig("announcement", "read_summary"), viewer.first_name
    end
    as_user(@student) { get "/api/v1/announcements/#{update.id}", headers: headers }
    assert_nil response.parsed_body.dig("announcement", "read_summary")
    as_user(@admin) { get "/api/v1/announcements/#{update.id}", headers: headers }
    assert_equal 3, response.parsed_body.dig("announcement", "read_summary", "read"), "the student who just opened it counts as read"
    as_user(@admin) { get "/api/v1/announcements", params: { scope: "manage" }, headers: headers }
    assert response.parsed_body["announcements"].all? { |item| item["read_summary"].nil? }, "lists carry no read counts"

    global = Announcement.create!(title: "School", body: "Words", author: @admin, audience: :global, status: :published)
    as_user(@author) { get "/api/v1/announcements/#{global.id}", headers: headers }
    assert_response :success
    assert_nil response.parsed_body.dig("announcement", "read_summary"), "an instructor doesn't manage school-wide updates"
    draft = Announcement.create!(title: "Draft", body: "", author: @author, audience: :cohort, cohort: @cohort, status: :draft)
    as_user(@author) { get "/api/v1/announcements/#{draft.id}", headers: headers }
    assert_nil response.parsed_body.dig("announcement", "read_summary")
  end

  test "the update page's read counts cost the same for 1 or 10 recipients" do
    counts = [ 1, 10 ].map do |size|
      cohort = Cohort.create!(curriculum: @cohort.curriculum, name: "Readers #{size}", start_date: Date.current, status: :active)
      size.times { |index| Enrollment.create!(user: person("r#{size}_#{index}", :student), cohort: cohort, status: :active) }
      update = Announcement.create!(title: "Read #{size}", body: "Words", author: @admin, audience: :cohort, cohort: cohort, status: :published)
      NotificationDeliveryService.announcement_published(update)
      Notification.where(notifiable: update).limit(size / 2).update_all(read_at: Time.current)
      as_user(@admin) { get "/api/v1/announcements/#{update.id}", headers: headers }
      assert_equal size, response.parsed_body.dig("announcement", "read_summary", "notified")
      count_queries { as_user(@admin) { get "/api/v1/announcements/#{update.id}", headers: headers } }
    end
    assert_equal counts.first, counts.last
  end

  private

  def assert_hidden_from_student(update, needle)
    as_user(@student) do
      get "/api/v1/announcements", params: { cohort_id: @cohort.id }, headers: headers
      assert_not_includes ids, update.id
      get "/api/v1/announcements/#{update.id}", headers: headers
      assert_response :not_found
      get "/api/v1/search", params: { q: needle }, headers: headers
      assert_nil response.parsed_body.fetch("groups", {}).find { |group| group["type"] == "announcement" }
      get "/api/v1/notifications", headers: headers
      assert_empty response.parsed_body["notifications"]
      get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers
      assert_response :success
      assert_not_includes response.parsed_body.dig("dashboard", "cohort", "announcements").map { |item| item["id"] }, update.id
      get "/api/v1/cohorts/#{@cohort.id}/home", headers: headers
      assert_response :success
      assert_not_includes response.body, needle
    end
  end

  def scheduled(at:, push: false, cohort: @cohort, author: @author)
    update = Announcement.create!(title: "Scheduled", body: "Words", author: author, audience: :cohort, cohort: cohort, status: :draft)
    update.update_columns(scheduled_for: at, scheduled_by_id: author.id, scheduled_send_push: push)
    update
  end

  def publish_task = ScheduledTick::TASKS.find { |task| task.name == "scheduled_updates" }

  def logger = ActiveSupport::Logger.new(@log)

  def tick(now)
    ScheduledTick.new(now: now, tasks: [ publish_task ], logger: logger, dry_run: false).call
  end

  def schedule_params(at, **overrides)
    { title: "Lab notes", body: "Bring laptops", audience: "cohort", cohort_id: @cohort.id, status: "draft",
      scheduled_for: at.respond_to?(:iso8601) ? at.iso8601 : at }.merge(overrides)
  end

  def ids = response.parsed_body["announcements"].map { |item| item["id"] }

  def person(name, role)
    User.create!(clerk_id: "scheduled_#{name}", email: "scheduled-#{name}@example.com", first_name: name.capitalize, last_name: "Synthetic", role: role)
  end

  def headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
