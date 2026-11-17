require "test_helper"
require_relative "../support/query_counter"

# R-3: the hot endpoints send the same number of queries whether a list holds
# one record or five. Each test measures the endpoint with one of everything
# (students, lessons, cohorts, submissions, help requests, notifications,
# channels, conversations and sourced messages), grows the world to five, and
# measures again. Set QUERY_COUNT_REPORT=1 to print the counts.
class EndpointQueryCountsTest < ActionDispatch::IntegrationTest
  include QueryCounter

  FIXTURE_TIME = Time.utc(2026, 8, 10, 13, 59)

  setup do
    travel_to FIXTURE_TIME
    today = LearningCalendar.today
    @curriculum = Curriculum.create!(name: "Load curriculum")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Load cohort", start_date: today - 14, end_date: today + 80, status: :active)
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @student = person("learner", :student)
    @enrollment = enroll(@student, @cohort)
    @conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    @lessons = []
    @size = 0
  end

  test "users index with enrollments for an instructor" do
    assert_flat_queries(@instructor, :get, "/api/v1/users", role: "student", include_enrollments: true)
  end

  test "users index for messaging people search" do
    assert_flat_queries(@instructor, :get, "/api/v1/users", role: "student", include_enrollments: true, people_search: true)
  end

  test "users index with every user for an admin" do
    assert_flat_queries(@admin, :get, "/api/v1/users", include_archived: true, include_enrollments: true)
  end

  test "users index one page" do
    assert_flat_queries(@instructor, :get, "/api/v1/users", role: "student", include_enrollments: true, per_page: 3)
  end

  test "users show for an instructor" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/users/#{@student.id}" })
  end

  test "profile stays flat from one to six enrollments including distinct curriculum copies" do
    source = Curriculum.create!(name: "Original private lab")
    CurriculumCopy.create!(cohort: @cohort, source_curriculum: source, copy_curriculum: @curriculum, created_by: @admin)
    counts = [ 1, 6 ].map do |size|
      while @student.enrollments.count < size
        index = @student.enrollments.count
        curriculum = Curriculum.create!(name: "Private lab #{index} (copy)")
        cohort = Cohort.create!(curriculum: curriculum, name: "Copy cohort #{index}", start_date: LearningCalendar.today, status: :active)
        CurriculumCopy.create!(cohort: cohort, source_curriculum: @curriculum, copy_curriculum: curriculum, created_by: @admin)
        Enrollment.create!(user: @student, cohort: cohort)
      end
      request_as(@student, :get, "/api/v1/profile", {})
      count = count_queries { request_as(@student, :get, "/api/v1/profile", {}) }
      assert_response :success
      rows = response.parsed_body.fetch("enrollments")
      assert_equal size, rows.size
      rows.reject { |row| row.fetch("cohort_id") == @cohort.id }.each do |row|
        assert_equal "Private lab #{row.fetch('cohort_name').split.last} (#{row.fetch('cohort_name')})", row.fetch("curriculum_name")
      end
      count
    end
    puts "Profile 1 -> 6: #{counts.join(' -> ')}" if ENV["QUERY_COUNT_REPORT"]
    assert_equal counts.first, counts.last
  end

  test "session bootstrap" do
    assert_flat_queries(@student, :post, "/api/v1/sessions")
  end

  test "student dashboard" do
    # All enrollments are active, so the default status ordering can select a
    # different cohort after growth. Only this cohort has the student's submissions.
    assert_flat_queries(@student, :get, "/api/v1/dashboard", cohort_id: @cohort.id) do
      assert_equal @cohort.id, response.parsed_body.dig("dashboard", "cohort", "id")
    end
  end

  test "staff dashboard across cohorts" do
    assert_flat_queries(@instructor, :get, "/api/v1/dashboard")
  end

  test "Today stays flat at fifteen inbox rows with optional database latency" do
    travel_to FIXTURE_TIME.in_time_zone(LearningCalendar::TIMEZONE).beginning_of_day + 8.hours
    samples = [ 1, 15 ].map do |size|
      grow_to(size)
      request_as(@instructor, :get, "/api/v1/dashboard", {})
      delayed_queries = 0
      delay = lambda do |*, payload|
        next unless ENV["TODAY_LATENCY"]
        next if QueryCounter::IGNORED_NAMES.include?(payload[:name]) || payload[:sql].match?(QueryCounter::IGNORED_SQL) || payload[:cached]

        delayed_queries += 1
        sleep(0.01)
      end
      started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      queries = nil
      ActiveSupport::Notifications.subscribed(delay, "sql.active_record") do
        queries = count_queries { request_as(@instructor, :get, "/api/v1/dashboard", {}) }
      end
      elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
      assert_response :success
      assert response.parsed_body.dig("dashboard", "today", "items").size >= size
      assert_equal size, response.parsed_body.dig("dashboard", "today", "counts", "quiet")
      assert_equal size * 2, response.parsed_body.dig("dashboard", "today", "upcoming").size
      puts "Today size=#{size} queries=#{queries} seconds=#{elapsed.round(3)} latency_ms=#{ENV['TODAY_LATENCY'] ? 10 : 0} delayed_queries=#{delayed_queries}" if ENV["QUERY_COUNT_REPORT"]
      queries
    end
    assert_equal samples.first, samples.last
  end

  test "lesson page for a student" do
    assert_flat_queries(@student, :get, -> { "/api/v1/lessons/#{@lessons.first.id}" })
  end

  test "lesson page for staff" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/lessons/#{@lessons.first.id}" })
  end

  test "grading inbox" do
    assert_flat_queries(@instructor, :get, "/api/v1/submissions", ungraded: "true")
  end

  # Every attempt in scope (installed mobile builds' queue, older queue links).
  test "submission list" do
    assert_flat_queries(@instructor, :get, "/api/v1/submissions")
  end

  test "submission list for one cohort" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/submissions?cohort_id=#{@cohort.id}" })
  end

  # The Grading workbench: one page, with its counts, filter options and module grids.
  test "grading workbench queue" do
    assert_flat_queries(@instructor, :get, "/api/v1/grading_queue", per_page: 3) do
      assert_equal 3.clamp(0, @size * 2), response.parsed_body["submissions"].length
    end
  end

  test "grading workbench queue for an admin across every cohort, newest first, all attempts" do
    assert_flat_queries(@admin, :get, "/api/v1/grading_queue", filter: "all", sort: "newest")
  end

  test "grading workbench queue with every filter and a focused item" do
    assert_flat_queries(@instructor, :get, -> {
      "/api/v1/grading_queue?cohort_id=#{@cohort.id}&module_id=#{@module.id}&student_id=#{@student.id}&lesson_id=#{@lessons.last.id}" \
        "&focus_id=#{Submission.where(user: @student).order(:id).last.id}&per_page=2"
    }) do
      assert_equal 1, response.parsed_body.dig("meta", "total_count")
    end
  end

  test "module grading grid" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/cohorts/#{@cohort.id}/modules/#{@module.id}/submissions" })
  end

  # L-3.2: help on one lesson or one module, linked from the content pages' counts.
  # One test each, so each measures its own growth from one record to five.
  test "support queue filtered to a lesson" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/support_queue?lesson_id=#{@lessons.first.id}" })
  end

  test "support queue filtered to a module in one cohort" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/support_queue?module_id=#{@module.id}&cohort_id=#{@cohort.id}" })
  end

  test "support queue" do
    assert_flat_queries(@instructor, :get, "/api/v1/support_queue")
  end

  test "help request list" do
    assert_flat_queries(@instructor, :get, "/api/v1/help_requests")
  end

  test "channel list" do
    assert_flat_queries(@instructor, :get, "/api/v1/channels")
  end

  test "channel messages" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/channels/#{@cohort.workspace.channels.first.id}" })
  end

  test "conversation list" do
    assert_flat_queries(@instructor, :get, "/api/v1/direct_conversations")
  end

  test "conversation messages with sources for staff" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/direct_conversations/#{@conversation.id}" })
  end

  test "conversation messages with sources for the learner" do
    assert_flat_queries(@student, :get, -> { "/api/v1/direct_conversations/#{@conversation.id}" })
  end

  test "message search across sourced messages" do
    assert_flat_queries(@instructor, :get, "/api/v1/messages/search", q: "about")
  end

  test "notifications" do
    assert_flat_queries(@instructor, :get, "/api/v1/notifications")
  end

  test "student summary" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/student/#{@student.id}/summary" })
  end

  test "lesson summary" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/lesson/#{@lessons.first.id}/summary" })
  end

  test "cohort summary" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/cohort/#{@cohort.id}/summary" })
  end

  # U-0.5: every staff roster reads LearnerProgress and LearnerActivity in a
  # fixed number of queries, however many learners the cohort holds.
  test "cohort home for staff" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/cohorts/#{@cohort.id}/home" })
  end

  test "cohort home for a learner" do
    assert_flat_queries(@student, :get, -> { "/api/v1/cohorts/#{@cohort.id}/home" })
  end

  test "cohort roster with last active" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/cohorts/#{@cohort.id}" })
  end

  test "student page progress" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/progress/student/#{@student.id}" }, cohort_id: @cohort.id)
  end

  test "enrollment detail with progress" do
    assert_flat_queries(@admin, :get, -> { "/api/v1/enrollments/#{@enrollment.id}" })
  end

  test "student related panel" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/student/#{@student.id}/related" }, cohort_id: @cohort.id)
  end

  test "lesson related panel" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/lesson/#{@lessons.first.id}/related" })
  end

  # L-3.2 / L-5: where content is used, for the curriculum, module and lesson pages and the editor.
  test "curriculum usage for an instructor" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/curriculum/#{@curriculum.id}/usage" })
  end

  test "curriculum usage for an admin" do
    assert_flat_queries(@admin, :get, -> { "/api/v1/records/curriculum/#{@curriculum.id}/usage" })
  end

  test "module usage" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/module/#{@module.id}/usage" })
  end

  test "lesson usage" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/lesson/#{@lessons.first.id}/usage" })
  end

  test "lesson block editor context" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/lessons/#{@lessons.first.id}/block_editor" })
  end

  test "team member page with grading load and owned follow-ups" do
    assert_flat_queries(@admin, :get, -> { "/api/v1/team_members/#{@instructor.id}" })
  end

  test "cohort related panel" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/cohort/#{@cohort.id}/related" })
  end

  test "submission related panel" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/submission/#{Submission.where(user: @student).order(:id).first.id}/related" })
  end

  test "help request related panel" do
    assert_flat_queries(@instructor, :get, -> { "/api/v1/records/help_request/#{HelpRequest.where(student: @student).order(:id).first.id}/related" })
  end

  private

  def assert_flat_queries(user, verb, path, params = {})
    # Each measurement must see a bigger world than the last: a second call in
    # one test would compare five records with five.
    assert_equal 0, @size, "assert_flat_queries grows the fixtures itself; call it once per test"
    counts = [ 1, 5 ].map do |size|
      grow_to(size)
      resolved = path.respond_to?(:call) ? path.call : path
      # Warm identity attachment, first course open, and lazy school settings.
      # count_queries clears the SQL cache before each measured request.
      request_as(user, verb, resolved, params)
      assert_response :success
      yield if block_given?
      count = count_queries { request_as(user, verb, resolved, params) }
      assert_response :success
      yield if block_given?
      count
    end
    puts "\n#{name.delete_prefix('test_')} #{path.respond_to?(:call) ? path.call : path}: #{counts.join(' -> ')}" if ENV["QUERY_COUNT_REPORT"]
    assert_equal counts.first, counts.last, "#{verb.upcase} #{path.respond_to?(:call) ? path.call : path} sent #{counts.join(' then ')} queries for 1 then 5 records"
  end

  def grow_to(size)
    while @size < size
      i = @size
      @size += 1
      lesson = Lesson.create!(curriculum_module: @module, title: "Lesson #{i}", position: i, release_day: 0)
      lesson.content_blocks.create!(block_type: :video, title: "Watch #{i}", position: 0, s3_video_key: "content_videos/11111111-1111-4111-8111-111111111111/v#{i}.mp4")
      exercise = lesson.content_blocks.create!(block_type: :exercise, title: "Exercise #{i}", position: 1, submission_type: :text_submission)
      @lessons << lesson
      @lessons.first.content_blocks.create!(block_type: :exercise, title: "Extra #{i}", position: 10 + i, submission_type: :text_submission) if i.positive?
      linked_lesson = Lesson.create!(curriculum_module: @module, title: "Linked #{i}", position: 100 + i, release_day: 0)

      linked_lesson.content_blocks.create!(block_type: :text, title: "Read #{i}", position: 0, body: "Unfinished reading")
      peer = person("peer#{i}", :student)
      peer_enrollment = enroll(peer, @cohort)
      peer_submission = Submission.create!(user: peer, enrollment: peer_enrollment, content_block: exercise, submission_type: :text_submission, text: "Answer #{i}", created_at: 20.days.ago)
      own_submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: exercise, submission_type: :text_submission, text: "Mine #{i}")
      Progress.create!(enrollment: peer_enrollment, user: peer, content_block: exercise, status: :completed, completed_at: 1.hour.ago)
      ActivityEvent.where(subject_user_id: peer.id).update_all(created_at: 20.days.ago)
      peer_enrollment.update!(joined_at: 20.days.ago, enrolled_at: 20.days.ago)
      OfficeHour.create!(cohort: @cohort, title: "Office #{i}", starts_at: 1.hour.from_now, ends_at: 2.hours.from_now, meeting_url: "https://example.invalid/office")
      config = PrivateMeetingConfig.find_or_create_by!(cohort: @cohort) { |record| record.instructor = @instructor; record.duration_minutes = 30; record.weeks = 100 }
      starts = Time.current + 1.hour + i * 45.minutes
      slot = config.private_meeting_slots.create!(instructor: @instructor, starts_at: starts, ends_at: starts + 30.minutes)
      PrivateMeetingBooking.create!(private_meeting_slot: slot, cohort: @cohort, enrollment: peer_enrollment, student: peer, instructor: @instructor, starts_at: starts, ends_at: starts + 30.minutes, week_number: 1)
      help_request(peer, lesson)
      own_help = help_request(@student, lesson)
      Notification.create!(user: @instructor, actor: peer, notifiable: peer_submission, notification_type: :submission,
        title: "Submission #{i}", path: "/admin/submissions/#{peer_submission.id}")

      Message.create!(channel: @cohort.workspace.channels.first, author: peer, body: "Hello #{i}")
      peer_conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, peer ])
      Message.create!(direct_conversation: peer_conversation, author: peer, body: "Question #{i}")
      Message.create!(direct_conversation: @conversation, author: @student, body: "About my submission #{i}", source: own_submission)
      Message.create!(direct_conversation: @conversation, author: @student, body: "About a lesson #{i}", source: linked_lesson)
      Message.create!(direct_conversation: @conversation, author: @student, body: "About my question #{i}", source: own_help)

      other_cohort = Cohort.create!(curriculum: @curriculum, name: "Other cohort #{i}", start_date: LearningCalendar.today - 14, status: :active)
      other_cohort.cohort_instructor_assignments.create!(user: @instructor)
      enroll(@student, other_cohort)
    end
  end

  def help_request(student, lesson)
    HelpRequest.create!(student: student, cohort: @cohort, context_type: :lesson, context_source: :primary, context_id: lesson.id,
      context_label: lesson.title, context_path: "/lessons/#{lesson.id}", category: :concept, urgency: :normal, message: "Stuck on #{lesson.title}")
  end

  def person(name, role)
    User.create!(clerk_id: "load_#{name}", email: "load-#{name}@example.com", first_name: "Load", last_name: name.capitalize, role: role)
  end

  def enroll(user, cohort)
    Enrollment.create!(user: user, cohort: cohort, status: :active, joined_at: 1.day.ago).tap do |enrollment|
      ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @module, unlocked: true)
    end
  end

  def request_as(user, verb, path, params)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    send(verb, path, params: params, headers: { "Authorization" => "Bearer test_token" })
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
