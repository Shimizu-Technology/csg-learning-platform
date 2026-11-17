require "test_helper"

# L-5.2: staff record pages for a recording, an office-hour session, a
# private-meeting booking, a learning plan, a channel, a rubric and an
# activity event read GET /api/v1/records/:type/:id/detail. Admins open every
# record; instructors open records in cohorts they teach (a booking only when
# they host it). Students, other cohorts' instructors and unknown records get
# 404, never a hint that the record exists.
class RecordDetailTest < ActionDispatch::IntegrationTest
  VIDEO_URL = "https://www.youtube.com/watch?v=record-pages".freeze

  def setup
    travel_to Time.zone.local(2026, 11, 17, 9, 0)
    @curriculum = Curriculum.create!(name: "Detail curriculum", status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "JavaScript basics", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Make decisions", position: 0, release_day: 8)
    @second_lesson = Lesson.create!(curriculum_module: @module, title: "Loops", position: 1, release_day: 9)
    @video = @lesson.content_blocks.create!(block_type: :recording, title: "Class replay", position: 0, video_url: VIDEO_URL,
      metadata: { "video_segments" => [ { "label" => "If statements", "start_seconds" => 60, "end_seconds" => 600, "required" => true },
                                        { "label" => "Ternaries", "start_seconds" => 700, "end_seconds" => 900, "required" => false } ] })
    @rubric = Rubric.new(curriculum: @curriculum, title: "Ticket rubric", description: "How we grade ticket prices")
    @objective = LearningObjective.create!(curriculum: @curriculum, code: "JS.4", title: "Choose a branch", success_criteria: "I can pick one.", position: 0)
    @rubric.rubric_criteria.build(title: "Correct", description: "Right price", position: 0, learning_objective: @objective)
    @rubric.rubric_criteria.build(title: "Readable", description: "Clear names", position: 1)
    @rubric.save!
    @exercise = @second_lesson.content_blocks.create!(block_type: :exercise, title: "Ticket prices", position: 0, submission_type: :text_submission, rubric: @rubric)

    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort Teal", start_date: Date.new(2026, 11, 2), end_date: Date.new(2027, 2, 1), status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort Coral", start_date: Date.new(2026, 11, 2), status: :active)
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @co_teacher = person("coteacher", :instructor)
    @outsider = person("outsider", :instructor)
    @student = person("student", :student)
    @peer = person("peer", :student)
    @coral_student = person("coral", :student)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @cohort.cohort_instructor_assignments.create!(user: @co_teacher)
    @other_cohort.cohort_instructor_assignments.create!(user: @outsider)
    @enrollment = enroll(@student, @cohort)
    @peer_enrollment = enroll(@peer, @cohort)
    @coral_enrollment = enroll(@coral_student, @other_cohort)

    @recording = @cohort.recordings.create!(title: "Week 2 class", source_kind: "youtube", source_url: VIDEO_URL, status: :published,
      recorded_date: Time.zone.local(2026, 11, 10, 18), duration_seconds: 3600, uploaded_by: @instructor, position: 0)
    WatchProgress.create!(user: @student, recording: @recording, total_watched_seconds: 1800, duration_seconds: 3600, last_watched_at: 1.hour.ago)
    WatchProgress.create!(user: @coral_student, recording: @recording, total_watched_seconds: 3600, duration_seconds: 3600, completed: true, last_watched_at: 2.hours.ago)
  end

  # --- Recording -------------------------------------------------------------

  test "a recording shows its cohort, week, lessons with sections and who watched" do
    detail = fetch(@instructor, "recording", @recording.id)
    assert_response :success
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_equal [ "Week 2 class", "Cohort Teal", 2, true ], [ detail["title"], detail.dig("cohort", "name"), detail["week"], detail["can_edit"] ]
    lesson = detail["lessons"].sole
    assert_equal [ @lesson.id, @video.id, 2 ], [ lesson.dig("lesson", "id"), lesson.dig("block", "id"), lesson["week"] ]
    assert_equal [ [ "If statements", 60, 600, true ], [ "Ternaries", 700, 900, false ] ],
      lesson["sections"].map { |section| section.values_at("label", "start_seconds", "end_seconds", "required") }
    assert_equal 2, detail["students_count"]
    assert_equal [ [ @student.id, 50.0, false ] ], detail["watchers"].map { |row| [ row.dig("student", "id"), row["progress_percentage"], row["completed"] ] },
      "Only this cohort's learners are listed"
    refute_includes response.body, @coral_student.full_name
  end

  # Review round 1 (P2): watchers come one bounded page at a time; totals are counted separately.
  test "a recording's watchers are paged, with totals for the whole cohort" do
    60.times do |i|
      learner = User.create!(clerk_id: "detail_watch_#{i}", email: "detail-watch-#{i}@example.invalid", first_name: "Watcher", last_name: format("%02d", i), role: :student)
      enroll(learner, @cohort)
      WatchProgress.create!(user: learner, recording: @recording, total_watched_seconds: i.even? ? 3600 : 1800, duration_seconds: 3600, completed: i.even?, last_watched_at: (i + 2).hours.ago)
    end

    first = fetch(@instructor, "recording", @recording.id)
    assert_response :success
    assert_equal [ 25, 61, 30, 62, 1, 2 ],
      first.values_at("watchers", "watchers_count", "completed_count", "students_count", "watchers_page", "watchers_next_page").then { |w, *rest| [ w.size, *rest ] }
    assert_equal @student.id, first["watchers"].first.dig("student", "id"), "Most recently watched first"
    assert_operator response.body.bytesize, :<, 12_000, "Page 1 stays small however many learners watched"
    refute_includes response.body, @coral_student.full_name

    seen = first["watchers"].map { |row| row.dig("student", "id") }
    [ [ 2, 25, 3 ], [ 3, 11, nil ], [ 4, 0, nil ] ].each do |page, size, next_page|
      detail = fetch(@instructor, "recording", @recording.id, page: page)
      assert_equal [ size, next_page, 61 ], [ detail["watchers"].size, detail["watchers_next_page"], detail["watchers_count"] ], "page #{page}"
      seen += detail["watchers"].map { |row| row.dig("student", "id") }
    end
    assert_equal 61, seen.uniq.size, "Every watcher appears once across the pages"

    [ "abc", "0", "-3" ].each do |page|
      assert_equal 1, fetch(@instructor, "recording", @recording.id, page: page)["watchers_page"], "page=#{page} reads the first page"
    end
  end

  test "a lesson block on another curriculum never links to the recording" do
    other = Curriculum.create!(name: "Elsewhere")
    elsewhere = Lesson.create!(curriculum_module: CurriculumModule.create!(curriculum: other, name: "Other", position: 0, day_offset: 0), title: "Hidden lesson", position: 0, release_day: 0)
    elsewhere.content_blocks.create!(block_type: :video, title: "Same link", position: 0, video_url: VIDEO_URL)

    detail = fetch(@admin, "recording", @recording.id)
    assert_equal [ @lesson.id ], detail["lessons"].map { |row| row.dig("lesson", "id") }
  end

  # --- Office hours ----------------------------------------------------------

  test "an office-hour session shows its time, host, teaching team, invitees and Join link" do
    office_hour = OfficeHour.create!(cohort: @cohort, title: "Tuesday help", starts_at: Time.zone.local(2026, 11, 17, 18), ends_at: Time.zone.local(2026, 11, 17, 19),
      meeting_url: "https://example.invalid/office", recurrence: :weekly, created_by: @co_teacher)

    detail = fetch(@instructor, "office_hour", office_hour.id)
    assert_response :success
    assert_equal [ "Tuesday help", "https://example.invalid/office", "weekly", @co_teacher.id, 2 ],
      [ detail["title"], detail["meeting_url"], detail["recurrence"], detail.dig("scheduled_by", "id"), detail["invited_count"] ]
    assert_equal [ @co_teacher.id, @instructor.id ].sort, detail["teaching_team"].map { |user| user["id"] }.sort
    assert_equal 3, detail["upcoming"].size
    assert_operator detail["upcoming"].first["starts_at"], :<, detail["upcoming"].second["starts_at"]
  end

  # --- Private meetings ------------------------------------------------------

  test "a booking opens for its host and admins, not for another instructor in the same cohort" do
    booking = book(@enrollment, host: @instructor)
    PrivateMeetingScheduler.event!(booking, @instructor, "link_updated")

    detail = fetch(@instructor, "private_meeting", booking.id)
    assert_response :success
    assert_equal [ "confirmed", @student.id, @instructor.id, 1 ], [ detail["status"], detail.dig("student", "id"), detail.dig("host", "id"), detail["week_number"] ]
    assert_equal [ "link_updated" ], detail["history"].map { |row| row["action"] }
    assert_equal @instructor.id, detail["history"].first.dig("actor", "id")

    fetch(@admin, "private_meeting", booking.id)
    assert_response :success
    fetch(@co_teacher, "private_meeting", booking.id)
    assert_response :not_found, "Another host's booking stays private, as on Meetings"
  end

  # --- Learning plans --------------------------------------------------------

  test "a learning plan shows its milestones with the student's status and what each revision changed" do
    plan = LearningPlan.create!(enrollment: @enrollment, title: "Catch up", target_date: Date.new(2026, 12, 20),
      milestones: [ { "title" => "Basics", "due_on" => "2026-12-01", "lesson_ids" => [ @lesson.id, @second_lesson.id ] } ])
    plan.revisions.create!(author: @instructor, snapshot: plan.snapshot)
    plan.update!(next_check_in_on: Date.new(2026, 11, 24), description: "Two lessons a week")
    plan.revisions.create!(author: @admin, snapshot: plan.snapshot)
    Progress.create!(enrollment: @enrollment, user: @student, content_block: @video, status: :completed, completed_at: 1.hour.ago)

    detail = fetch(@instructor, "learning_plan", plan.id)
    assert_response :success
    assert_equal [ "Catch up", @student.id, "Cohort Teal", 2 ], [ detail["title"], detail.dig("student", "id"), detail.dig("cohort", "name"), detail["revisions_count"] ]
    milestone = detail["milestones"].sole
    assert_equal [ "Basics", "2026-12-01", 1 ], milestone.values_at("title", "due_on", "completed_count")
    assert_equal [ [ @lesson.id, true ], [ @second_lesson.id, false ] ], milestone["lessons"].map { |row| row.values_at("id", "completed") }
    assert_equal [ [ @admin.id, [ "description", "next follow-up" ] ], [ @instructor.id, [ "created" ] ] ],
      detail["revisions"].map { |row| [ row.dig("author", "id"), row["changes"] ] }
  end

  # --- Channels --------------------------------------------------------------

  test "a channel shows members as a count for instructors and a list for admins" do
    channel = @cohort.workspace.channels.first
    Message.create!(channel: channel, author: @student, body: "Hello class")

    detail = fetch(@instructor, "channel", channel.id)
    assert_response :success
    assert_equal [ channel.name, "cohort", "Cohort Teal" ], [ detail["name"], detail["visibility"], detail.dig("cohort", "name") ]
    assert_nil detail.dig("members", "list"), "Instructors get the number"
    assert_operator detail.dig("members", "count"), :>=, 4, "Two learners, two instructors and the admin"
    assert_equal [ 1, 1 ], [ detail.dig("activity", "messages_count"), detail.dig("activity", "last_7_days") ]

    admin_view = fetch(@admin, "channel", channel.id)
    assert_includes admin_view.dig("members", "list").map { |row| row["id"] }, @student.id
    refute_includes admin_view.dig("members", "list").map { |row| row["id"] }, @coral_student.id
  end

  test "a blocked sender reads Message hidden" do
    channel = @cohort.workspace.channels.first
    Message.create!(channel: channel, author: @student, body: "Secret plan")
    Message.create!(channel: channel, author: @peer, body: "Visible hello")
    UserBlock.create!(blocker: @instructor, blocked_user: @student)

    detail = fetch(@instructor, "channel", channel.id)
    rows = detail.dig("activity", "recent").to_h { |row| [ row.dig("author", "id"), row ] }
    assert_equal [ true, "Message hidden" ], rows[@student.id].values_at("hidden", "preview")
    assert_equal [ false, "Visible hello" ], rows[@peer.id].values_at("hidden", "preview")
    refute_includes response.body, "Secret plan"
  end

  # --- Rubrics ---------------------------------------------------------------

  test "a rubric shows criteria and the exercises using it, with other cohorts only as a number" do
    Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, submission_type: :text_submission, text: "A", grade: :A, graded_at: Time.current)
    Submission.create!(user: @coral_student, enrollment: @coral_enrollment, content_block: @exercise, submission_type: :text_submission, text: "B", grade: :B, graded_at: Time.current)

    detail = fetch(@instructor, "rubric", @rubric.id)
    assert_response :success
    assert_equal [ "Ticket rubric", "Detail curriculum" ], [ detail["title"], detail.dig("curriculum", "name") ]
    assert_equal [ [ "Correct", "JS.4" ], [ "Readable", nil ] ], detail["criteria"].map { |row| [ row["title"], row.dig("objective", "code") ] }
    use = detail["uses"].sole
    assert_equal [ @second_lesson.id, @exercise.id, 1 ], [ use.dig("lesson", "id"), use.dig("block", "id"), use["graded"] ], "Only Cohort Teal's grades count"
    assert_equal [ "Cohort Teal" ], detail["cohorts"].map { |row| row["name"] }
    assert_equal 1, detail["other_cohorts_count"]
    refute_includes response.body, "Cohort Coral"

    assert_equal 2, fetch(@admin, "rubric", @rubric.id)["uses"].sole["graded"]
  end

  # --- Activity events -------------------------------------------------------

  test "an activity event links its submission for staff who teach the cohort" do
    submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, submission_type: :text_submission, text: "A")
    event = ActivityEvent.record!(event_type: "submission_created", actor: @student, cohort: @cohort, record: submission)
    coral_event = ActivityEvent.record!(event_type: "submission_created", actor: @coral_student, cohort: @other_cohort)

    detail = fetch(@instructor, "activity_event", event.id)
    assert_response :success
    assert_equal [ "submission_created", "work", @student.id, "Cohort Teal", "Ticket prices" ],
      [ detail["event_type"], detail["category"], detail.dig("subject", "id"), detail.dig("cohort", "name"), detail["record_label"] ]
    assert_equal({ "kind" => "submission", "id" => submission.id, "cohort_id" => @cohort.id, "student_id" => @student.id, "lesson_id" => @second_lesson.id, "content_block_id" => @exercise.id }, detail["record"])

    fetch(@instructor, "activity_event", coral_event.id)
    assert_response :not_found
    assert_equal "Cohort Coral", fetch(@admin, "activity_event", coral_event.id).dig("cohort", "name")
  end

  # Review round 1 (P2): the subject's label passes the same check as its link.
  # No user flow builds these mismatches; they are made directly on the model.
  test "an event pointing at another cohort's record shows neither its link nor its label" do
    coral_recording = @other_cohort.recordings.create!(title: "Coral secret replay", source_kind: "youtube", source_url: "https://www.youtube.com/watch?v=coral",
      status: :published, position: 0)
    coral_submission = Submission.create!(user: @coral_student, enrollment: @coral_enrollment, content_block: @exercise, submission_type: :text_submission, text: "B")
    elsewhere = Curriculum.create!(name: "Elsewhere")
    elsewhere_block = Lesson.create!(curriculum_module: CurriculumModule.create!(curriculum: elsewhere, name: "Other", position: 0, day_offset: 0), title: "Hidden lesson", position: 0, release_day: 0)
      .content_blocks.create!(block_type: :exercise, title: "Elsewhere secret exercise", position: 0, submission_type: :text_submission)
    mismatches = {
      "Coral secret replay" => ActivityEvent.record!(event_type: "recording_started", actor: @student, cohort: @cohort, record: coral_recording),
      # Ticket prices is the coral learner's submission, recorded as this learner's event in Teal.
      "Ticket prices" => ActivityEvent.record!(event_type: "submission_created", actor: @student, cohort: @cohort, record: coral_submission),
      "Elsewhere secret exercise" => ActivityEvent.record!(event_type: "checkpoint_completed", actor: @student, cohort: @cohort, record: elsewhere_block)
    }

    mismatches.each do |title, event|
      [ @admin, @instructor ].each do |viewer|
        detail = fetch(viewer, "activity_event", event.id)
        assert_response :success
        assert_nil detail["record"], "#{title}: no link for #{viewer.role}"
        assert_nil detail["record_label"], "#{title}: no label for #{viewer.role}"
        refute_includes response.body, title, "#{title} never reaches the page for #{viewer.role}"
      end
    end
  end

  test "an event's label shows when its record passes the check" do
    recording_event = ActivityEvent.record!(event_type: "recording_started", actor: @student, cohort: @cohort, record: @recording)
    block_event = ActivityEvent.record!(event_type: "checkpoint_completed", actor: @student, cohort: @cohort, record: @video)

    assert_equal [ "Week 2 class", "recording" ], fetch(@instructor, "activity_event", recording_event.id).then { |d| [ d["record_label"], d.dig("record", "kind") ] }
    assert_equal [ "Class replay", "lesson" ], fetch(@instructor, "activity_event", block_event.id).then { |d| [ d["record_label"], d.dig("record", "kind") ] }
  end

  test "an instructor opens their own history in a cohort they don't teach, without that cohort's name" do
    event = ActivityEvent.record!(event_type: "lesson_editing_granted", actor: @admin, subject_user: @instructor, cohort: @other_cohort)

    detail = fetch(@instructor, "activity_event", event.id)
    assert_response :success
    assert_nil detail["cohort"]
    refute_includes response.body, "Cohort Coral"
  end

  # --- Access ----------------------------------------------------------------

  test "students, other cohorts' instructors and unknown records get 404" do
    booking = book(@enrollment, host: @instructor)
    plan = LearningPlan.create!(enrollment: @enrollment, title: "Plan")
    office_hour = OfficeHour.create!(cohort: @cohort, title: "Help", starts_at: 1.day.from_now, ends_at: 1.day.from_now + 1.hour, meeting_url: "https://example.invalid/o")
    event = ActivityEvent.record!(event_type: "submission_created", actor: @student, cohort: @cohort)
    records = { "recording" => @recording.id, "office_hour" => office_hour.id, "private_meeting" => booking.id, "learning_plan" => plan.id,
                "channel" => @cohort.workspace.channels.first.id, "rubric" => @rubric.id, "activity_event" => event.id }

    records.each do |type, id|
      fetch(@student, type, id)
      assert_response :not_found, "#{type} for a student"
      assert_equal({ "error" => "Not found" }, response.parsed_body)
      fetch(@admin, type, 999_999)
      assert_response :not_found, "unknown #{type}"
      next if type == "rubric" # Content is readable by every staff member.

      fetch(@outsider, type, id)
      assert_response :not_found, "#{type} for an instructor of another cohort"
      refute_includes response.body, "Cohort Teal"
    end

    fetch(@admin, "lesson", @lesson.id)
    assert_response :not_found, "The usage endpoint serves content types"
    fetch(@admin, "recording", "abc")
    assert_response :not_found
  end

  test "an archived instructor opens nothing" do
    @instructor.update!(archived_at: Time.current)
    assert_nil RecordDetail.for(viewer: @instructor.reload, type: "recording", id: @recording.id)
  end

  private

  def person(name, role)
    User.create!(clerk_id: "detail_#{name}", email: "detail-#{name}@example.invalid", first_name: "Detail", last_name: name.capitalize, role: role)
  end

  def enroll(user, cohort)
    Enrollment.create!(user: user, cohort: cohort, status: :active, joined_at: 1.day.ago).tap do |enrollment|
      ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @module, unlocked: true)
    end
  end

  def book(enrollment, host:)
    config = PrivateMeetingConfig.find_or_create_by!(cohort: enrollment.cohort) { |record| record.instructor = host; record.duration_minutes = 30; record.weeks = 10 }
    starts = Time.zone.local(2026, 11, 19, 10)
    slot = config.private_meeting_slots.create!(instructor: host, starts_at: starts, ends_at: starts + 30.minutes)
    PrivateMeetingBooking.create!(private_meeting_slot: slot, cohort: enrollment.cohort, enrollment: enrollment, student: enrollment.user, instructor: host,
      starts_at: starts, ends_at: starts + 30.minutes, week_number: 1)
  end

  def fetch(user, type, id, **params)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    get "/api/v1/records/#{type}/#{id}/detail", params: params, headers: { "Authorization" => "Bearer test_token" }
    response.parsed_body["detail"]
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
