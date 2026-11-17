require "test_helper"
require_relative "../support/query_counter"

# L-5.2: each staff record page sends the same number of queries whether its
# lists hold one row or five. Every test grows the record's own lists (watch
# rows and lessons, teaching team, history, milestones and revisions, members
# and messages, criteria and exercises, cohorts) and asserts that the response
# really grew, so a growth step that silently stops adding rows fails here
# instead of passing with two equal counts.
class RecordDetailQueryCountsTest < ActionDispatch::IntegrationTest
  include QueryCounter

  VIDEO_URL = "https://www.youtube.com/watch?v=record-load".freeze

  setup do
    travel_to Time.zone.local(2026, 11, 17, 9, 0)
    @curriculum = Curriculum.create!(name: "Load curriculum")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Load cohort", start_date: Date.new(2026, 11, 2), end_date: Date.new(2027, 2, 1), status: :active)
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @student = person("learner", :student)
    @enrollment = enroll(@student, @cohort)
    @size = 0
  end

  test "recording page" do
    recording = @cohort.recordings.create!(title: "Class", source_kind: "youtube", source_url: VIDEO_URL, status: :published, position: 0, uploaded_by: @instructor)
    grow = lambda do |i|
      peer = person("watcher#{i}", :student)
      enroll(peer, @cohort)
      WatchProgress.create!(user: peer, recording: recording, total_watched_seconds: 60 * (i + 1), duration_seconds: 3600, last_watched_at: i.minutes.ago)
      lesson = Lesson.create!(curriculum_module: @module, title: "Replay #{i}", position: i, release_day: i)
      lesson.content_blocks.create!(block_type: :video, title: "Part #{i}", position: 0, video_url: VIDEO_URL,
        metadata: { "video_segments" => [ { "label" => "Step #{i}", "start_seconds" => 0, "end_seconds" => 60 } ] })
    end
    # Grows past one page of watchers: the page stays at 25 rows while the totals keep counting.
    per_page = RecordDetail::RecordingPage::WATCHERS_PER_PAGE
    sizes = [ 1, per_page + 5 ]
    assert_flat(@instructor, "recording", recording.id, grow, sizes: sizes) do |detail, size|
      assert_equal [ size, per_page ].min, detail["watchers"].size, "watchers are one bounded page"
      size > per_page ? assert_kind_of(Integer, detail["watchers_next_after"]) : assert_nil(detail["watchers_next_after"])
      assert_operator response.body.bytesize, :<, 15_000 + size * 120, "only the lessons list grows the payload"
      [ detail["watchers_count"], detail["lessons"].size ]
    end
  end

  test "recording page continued after a cursor" do
    recording = @cohort.recordings.create!(title: "Class", source_kind: "youtube", source_url: VIDEO_URL, status: :published, position: 0, uploaded_by: @instructor)
    first_row = nil
    grow = lambda do |i|
      peer = person("cursor#{i}", :student)
      enroll(peer, @cohort)
      row = WatchProgress.create!(user: peer, recording: recording, total_watched_seconds: 60, duration_seconds: 3600, last_watched_at: i.minutes.ago)
      first_row ||= row
    end
    per_page = RecordDetail::RecordingPage::WATCHERS_PER_PAGE
    # After the first watcher: 1 row at size 2, then a full page of 25 at size 30. (At size 1 the
    # page would be empty and Rails would skip the user preload, which isn't growth.)
    assert_flat(@instructor, "recording", recording.id, grow, sizes: [ 2, per_page + 5 ], params: -> { { watchers_after: first_row.id } }) do |detail, size|
      assert_equal [ size - 1, per_page ].min, detail["watchers"].size
      [ detail["watchers_count"] ]
    end
  end

  test "office-hour page" do
    office_hour = OfficeHour.create!(cohort: @cohort, title: "Help", starts_at: 1.hour.from_now, ends_at: 2.hours.from_now, meeting_url: "https://example.invalid/o",
      recurrence: :weekly, created_by: @instructor)
    grow = lambda do |i|
      @cohort.cohort_instructor_assignments.create!(user: person("team#{i}", :instructor))
      enroll(person("invitee#{i}", :student), @cohort)
    end
    assert_flat(@instructor, "office_hour", office_hour.id, grow) { |detail| [ detail["teaching_team"].size - 1, detail["invited_count"] - 1 ] }
  end

  test "private-meeting page" do
    config = PrivateMeetingConfig.create!(cohort: @cohort, instructor: @instructor, duration_minutes: 30, weeks: 10)
    starts = Time.zone.local(2026, 11, 19, 10)
    slot = config.private_meeting_slots.create!(instructor: @instructor, starts_at: starts, ends_at: starts + 30.minutes)
    booking = PrivateMeetingBooking.create!(private_meeting_slot: slot, cohort: @cohort, enrollment: @enrollment, student: @student, instructor: @instructor,
      starts_at: starts, ends_at: starts + 30.minutes, week_number: 1)
    actors = [ @student, @instructor, @admin ]
    grow = ->(i) { booking.private_meeting_booking_events.create!(actor: actors[i % 3], action: "link_updated", details: {}) }
    assert_flat(@instructor, "private_meeting", booking.id, grow) { |detail| [ detail["history"].size ] }
  end

  test "learning-plan page" do
    plan = LearningPlan.new(enrollment: @enrollment, title: "Plan")
    grow = lambda do |i|
      lesson = Lesson.create!(curriculum_module: @module, title: "Plan lesson #{i}", position: i, release_day: i)
      block = lesson.content_blocks.create!(block_type: :exercise, title: "Exercise #{i}", position: 0, submission_type: :text_submission)
      Progress.create!(enrollment: @enrollment, user: @student, content_block: block, status: :completed, completed_at: 1.hour.ago) if i.even?
      plan.milestones = plan.milestones + [ { "title" => "Step #{i}", "due_on" => (Date.new(2026, 12, 1) + i).iso8601, "lesson_ids" => [ lesson.id ] } ]
      plan.enrollment = Enrollment.find(@enrollment.id) # sees the new lesson as assigned
      plan.save!
      plan.revisions.create!(author: i.even? ? @instructor : @admin, snapshot: plan.snapshot)
    end
    assert_flat(@instructor, "learning_plan", -> { plan.id }, grow) { |detail| [ detail["milestones"].size, detail["revisions"].size ] }
  end

  test "channel page for an instructor" do
    channel = @cohort.workspace.channels.first
    grow = lambda do |i|
      peer = person("member#{i}", :student)
      enroll(peer, @cohort)
      Message.create!(channel: channel, author: peer, body: "Hello #{i}")
      UserBlock.create!(blocker: @instructor, blocked_user: peer) if i.odd?
    end
    assert_flat(@instructor, "channel", channel.id, grow) { |detail| [ detail.dig("activity", "recent").size, detail.dig("activity", "messages_count") ] }
  end

  test "channel page for an admin" do
    channel = @cohort.workspace.channels.first
    grow = lambda do |i|
      peer = person("listed#{i}", :student)
      enroll(peer, @cohort)
      Message.create!(channel: channel, author: peer, body: "Hello #{i}")
    end
    # The admin and instructor are members too; the list grows with each learner.
    assert_flat(@admin, "channel", channel.id, grow) { |detail| [ detail.dig("members", "list").size - 3, detail.dig("activity", "recent").size ] }
  end

  test "rubric page" do
    rubric = Rubric.new(curriculum: @curriculum, title: "Rubric")
    grow = lambda do |i|
      objective = LearningObjective.create!(curriculum: @curriculum, code: "LO.#{i}", title: "Objective #{i}", success_criteria: "Done", position: i)
      rubric.rubric_criteria.build(title: "Criterion #{i}", description: "Meets #{i}", position: i, learning_objective: objective)
      rubric.save!
      lesson = Lesson.create!(curriculum_module: @module, title: "Graded #{i}", position: i, release_day: i)
      block = lesson.content_blocks.create!(block_type: :exercise, title: "Graded #{i}", position: 0, submission_type: :text_submission, rubric: rubric)
      cohort = Cohort.create!(curriculum: @curriculum, name: "Taught #{i}", start_date: Date.new(2026, 11, 2), status: :active)
      cohort.cohort_instructor_assignments.create!(user: @instructor)
      Cohort.create!(curriculum: @curriculum, name: "Untaught #{i}", start_date: Date.new(2026, 11, 2), status: :active)
      Submission.create!(user: @student, enrollment: @enrollment, content_block: block, submission_type: :text_submission, text: "A", grade: :A, graded_at: Time.current)
    end
    assert_flat(@instructor, "rubric", -> { rubric.id }, grow) { |detail| [ detail["criteria"].size, detail["uses"].size, detail["cohorts"].size - 1, detail["other_cohorts_count"] ] }
  end

  test "activity-event page" do
    exercise = Lesson.create!(curriculum_module: @module, title: "Work", position: 0, release_day: 0)
      .content_blocks.create!(block_type: :exercise, title: "Work", position: 0, submission_type: :text_submission)
    submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: exercise, submission_type: :text_submission, text: "A")
    event = ActivityEvent.record!(event_type: "submission_created", actor: @student, cohort: @cohort, record: submission)
    grow = lambda do |i|
      Cohort.create!(curriculum: @curriculum, name: "More #{i}", start_date: Date.new(2026, 11, 2), status: :active).cohort_instructor_assignments.create!(user: @instructor)
      ActivityEvent.record!(event_type: "submission_updated", actor: @student, cohort: @cohort, record: submission)
    end
    # One event has no lists: the world around it grows (taught cohorts, events), and the link must stay.
    assert_flat(@instructor, "activity_event", event.id, grow) do |detail|
      assert_equal submission.id, detail.dig("record", "id")
      [ @instructor.cohort_instructor_assignments.count - 1, ActivityEvent.where(cohort_id: @cohort.id).count - 1 ]
    end
  end

  test "return-plan page" do
    plan = RecoveryPlan.create!(enrollment: @enrollment, source: :manual, status: :active, owner: @instructor, created_by: @instructor,
      target_pace: "Steady", required_scope: "Week 2", check_in_cadence: "weekly", next_check_in_at: 2.days.from_now)
    authors = [ @instructor, @admin ]
    grow = ->(i) { plan.check_ins.create!(author: authors[i % 2], body: "Check-in #{i}", next_check_in_at: (i + 1).days.from_now) }
    assert_flat(@instructor, "recovery_plan", plan.id, grow) { |detail| [ detail["check_ins"].size, detail["check_ins_count"] ] }
  end

  test "community-report page" do
    channel = @cohort.workspace.channels.first
    reported = person("reported", :student)
    enroll(reported, @cohort)
    report = ContentReport.create!(reporter: @student, reported_user: reported, reason: :spam,
      message: Message.create!(channel: channel, author: reported, body: "Reported"))
    UserBlock.create!(blocker: @student, blocked_user: reported)
    grow = lambda do |i|
      reporter = person("reporter#{i}", :student)
      ContentReport.create!(reporter: reporter, reported_user: reported, reason: :other)
      UserBlock.create!(blocker: reporter, blocked_user: reported)
    end
    assert_flat(@admin, "content_report", report.id, grow) do |detail|
      [ detail["other_reports"].size, detail["other_reports_count"], detail.dig("reported_user_safety", "blocked_by") - 1 ]
    end
  end

  test "offering page" do
    offering = Cohort.create!(curriculum: @curriculum, name: "Self-paced", start_date: Date.new(2026, 11, 2), status: :active, course_delivery: "self_paced")
    offering.cohort_instructor_assignments.create!(user: @instructor)
    offering.update!(support_instructor: @instructor)
    grow = lambda do |i|
      buyer = person("buyer#{i}", :student)
      CoursePurchase.create!(user: buyer, cohort: offering, stripe_price_id: "price_synthetic", price_cents: 100, status: i.even? ? "paid" : "pending")
      enroll(buyer, offering) if i.even?
    end
    # Grows past one page of purchases: the page stays at 25 rows while the totals keep counting.
    per_page = RecordDetail::OfferingPage::PURCHASES_PER_PAGE
    assert_flat(@admin, "offering", offering.id, grow, sizes: [ 1, per_page + 5 ]) do |detail, size|
      assert_equal [ size, per_page ].min, detail["purchases"].size, "purchases are one bounded page"
      assert_operator response.body.bytesize, :<, 12_000, "the payload doesn't grow with purchases"
      [ detail["purchases_count"] ]
    end
  end

  private

  # Measures the page with one row, grows to five and measures again. The block
  # returns the response's growing lists; each must equal the size measured.
  def assert_flat(user, type, id, grow, sizes: [ 1, 5 ], params: -> { {} })
    assert_equal 0, @size, "assert_flat grows the fixtures itself; call it once per test"
    counts = sizes.map do |size|
      while @size < size
        grow.call(@size)
        @size += 1
      end
      path = "/api/v1/records/#{type}/#{id.respond_to?(:call) ? id.call : id}/detail"
      request_as(user, path, params.call)
      assert_response :success
      grown = yield(response.parsed_body["detail"], size)
      assert_equal [ size ] * grown.size, grown, "#{type}: the response lists must hold #{size} rows each"
      count = count_queries { request_as(user, path, params.call) }
      assert_response :success
      count
    end
    puts "\n#{type}: #{counts.join(' -> ')}" if ENV["QUERY_COUNT_REPORT"]
    assert_equal counts.first, counts.last, "#{type} detail sent #{counts.join(' then ')} queries for #{sizes.join(' then ')} rows"
  end

  def person(name, role)
    User.create!(clerk_id: "detail_load_#{name}", email: "detail-load-#{name}@example.invalid", first_name: "Load", last_name: name.capitalize, role: role)
  end

  def enroll(user, cohort)
    Enrollment.create!(user: user, cohort: cohort, status: :active, joined_at: 1.day.ago).tap do |enrollment|
      ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @module, unlocked: true)
    end
  end

  def request_as(user, path, params = {})
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    get path, params: params, headers: { "Authorization" => "Bearer test_token" }
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
