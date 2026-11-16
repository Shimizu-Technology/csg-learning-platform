require "test_helper"
require_relative "../support/query_counter"

class StudentWorkspaceTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    @curriculum = Curriculum.create!(name: "Workspace curriculum")
    @cohort = Cohort.create!(name: "Workspace cohort", curriculum: @curriculum, start_date: Date.current - 3, status: :active)
    @teacher = person("teacher", :instructor)
    @other_teacher = person("other_teacher", :instructor)
    @admin = person("admin", :admin)
    @student = person("student", :student)
    @cohort.instructors << @teacher << @other_teacher
    @enrollment = Enrollment.create!(cohort: @cohort, user: @student, status: :active, joined_at: 1.day.ago)
    @module = @curriculum.modules.create!(name: "Workspace module", position: 0)
    @lesson = @module.lessons.create!(title: "Workspace lesson", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(title: "Workspace exercise", block_type: :exercise, submission_type: :text_submission, position: 0)
    @enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)
  end

  test "profile exposes only authorized enrollments and shared next review, media and status" do
    oldest = Submission.create!(enrollment: @enrollment, user: @student, content_block: @block, text: "Old attempt", created_at: 2.days.ago)
    latest = Submission.create!(enrollment: @enrollment, user: @student, content_block: @block, text: "Current attempt", created_at: 1.day.ago)
    other = Cohort.create!(name: "Hidden cohort", curriculum: @curriculum, start_date: Date.current, status: :active)
    hidden = Enrollment.create!(cohort: other, user: @student)
    get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_response :success
    body = response.parsed_body
    assert_equal [ @enrollment.id ], body.fetch("enrollments").pluck("id")
    assert_equal latest.id, body.dig("status", "next_review_submission_id")
    assert_not_equal oldest.id, body.dig("status", "next_review_submission_id")
    assert_equal 1, body.dig("status", "ungraded_count")
    assert_equal 0, body.dig("media_summary", "videos_completed")
    attention = AttentionProjection.new(enrollment_scope: Enrollment.where(id: @enrollment.id)).call[:enrollments].sole
    assert_equal attention[:reasons].map { |reason| reason[:label] }, body.dig("status", "reasons").pluck("label")
    assert_equal LearnerProgress.new(@enrollment.reload).overall.transform_keys(&:to_s), body["overall_progress"]
    get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@admin)
    assert_response :success
    assert_equal [ @enrollment.id, hidden.id ], response.parsed_body.fetch("enrollments").pluck("id")
    get profile_path, params: { cohort_id: other.id }, headers: headers(@teacher)
    assert_response :forbidden
    get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_response :forbidden
  end

  test "default staff profile chooses an authorized enrollment even if another cohort was joined first" do
    hidden_cohort = Cohort.create!(name: "Earlier hidden enrollment", curriculum: @curriculum, start_date: Date.current, status: :active)
    learner = person("hidden_first", :student)
    Enrollment.create!(user: learner, cohort: hidden_cohort)
    visible = Enrollment.create!(user: learner, cohort: @cohort)
    get "/api/v1/progress/student/#{learner.id}", headers: headers(@teacher)
    assert_response :success
    assert_equal visible.id, response.parsed_body.dig("enrollment", "id")
    assert_equal [ visible.id ], response.parsed_body.fetch("enrollments").pluck("id")
    assert_equal 1, response.parsed_body.dig("learning_evidence_scope", "enrollment_count")
  end

  test "media summary uses assigned learner status and cohort recording watch credit" do
    video = @lesson.content_blocks.create!(title: "Assigned clip", block_type: :video, position: 1)
    video.update_column(:s3_video_key, "qa/assigned.mp4")
    Progress.create!(user: @student, enrollment: @enrollment, content_block: video, status: :completed)
    unassigned = @curriculum.modules.create!(name: "Unassigned", position: 2)
    other_lesson = unassigned.lessons.create!(title: "Other lesson", position: 0)
    other_lesson.content_blocks.create!(title: "Other clip", block_type: :video, position: 0).update_column(:s3_video_key, "qa/unassigned.mp4")
    recording = @cohort.recordings.create!(title: "Class clip", source_kind: "external", source_url: "https://example.invalid/clip")
    WatchProgress.create!(user: @student, recording: recording, total_watched_seconds: 90, duration_seconds: 100)
    get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_response :success
    assert_equal({ "recordings_completed" => 1, "recordings_total" => 1, "lesson_videos_completed" => 1, "lesson_videos_total" => 1, "videos_completed" => 2 }, response.parsed_body["media_summary"])
  end

  test "module cards count shared latest evidence, lesson-only assignments and no archived or paused students" do
    Progress.create!(user: @student, enrollment: @enrollment, content_block: @block, status: :completed)
    Submission.create!(user: @student, enrollment: @enrollment, content_block: @block, text: "Redo", grade: "R")
    learner = person("lesson_only", :student)
    enrollment = Enrollment.create!(cohort: @cohort, user: learner, status: :active)
    enrollment.lesson_assignments.create!(lesson: @lesson, unlocked: true)
    Submission.create!(user: learner, enrollment: enrollment, content_block: @block, text: "Waiting")
    paused = Enrollment.create!(cohort: @cohort, user: person("paused", :student), status: :paused)
    paused.module_assignments.create!(curriculum_module: @module)
    archived_user = person("archived", :student)
    archived_user.update!(archived_at: Time.current)
    archived = Enrollment.create!(cohort: @cohort, user: archived_user)
    archived.module_assignments.create!(curriculum_module: @module)
    get "/api/v1/cohorts/#{@cohort.id}", headers: headers(@teacher)
    assert_response :success
    mod = response.parsed_body.fetch("cohort").fetch("modules").sole
    assert_equal [ @enrollment.id, enrollment.id ].sort, mod.fetch("assigned_enrollment_ids").sort
    assert_equal 2, mod["assigned_count"]
    assert_equal [ 1, 2, 50.0 ], mod.values_at("completed_lessons", "total_lessons", "progress_percentage")
  end

  test "communication respects cohort, DM membership, deleted messages and meeting instructor" do
    own = conversation(@teacher)
    other = conversation(@other_teacher)
    visible = own.messages.create!(author: @teacher, body: "Visible reply")
    own.messages.create!(author: @student, body: "Deleted", deleted_at: Time.current)
    other.messages.create!(author: @student, body: "Private to another teacher")
    channel = @cohort.workspace.channels.create!(name: "class", visibility: :cohort, position: 5)
    activity = channel.messages.create!(author: @student, body: "My class activity")
    channel.messages.create!(author: @teacher, body: "Another person's class activity")
    meeting = book(@teacher, 1)
    other_meeting = book(@other_teacher, 2)
    get communication_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_response :success
    body = response.parsed_body.fetch("communication")
    assert_equal [ visible.id ], body.fetch("messages").pluck("id")
    assert_equal [ activity.id ], body.fetch("channel_activity").pluck("id")
    assert_equal [ meeting.id ], body.fetch("meetings").pluck("id")
    assert_equal "class", body.fetch("channel_activity").sole["channel_name"]
    get communication_path, params: { cohort_id: @cohort.id }, headers: headers(@admin)
    assert_response :success
    assert_empty response.parsed_body.dig("communication", "messages"), "admins cannot read a DM they do not belong to"
    assert_equal [ meeting.id, other_meeting.id ].sort, response.parsed_body.dig("communication", "meetings").pluck("id").sort
    get communication_path, params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_response :forbidden
    outsider = person("outsider", :instructor)
    get communication_path, params: { cohort_id: @cohort.id }, headers: headers(outsider)
    assert_response :not_found
    get communication_path, headers: headers(@teacher)
    assert_response :bad_request
  end

  test "communication is bounded and query counts stay flat as messages, channels and meetings grow" do
    own = conversation(@teacher)
    channel = @cohort.workspace.channels.create!(name: "activity", position: 5)
    counts = [ 1, 5 ].map do |size|
      size.times do |index|
        own.messages.create!(author: @student, body: "Reply #{size}:#{index}")
        channel.messages.create!(author: @student, body: "Channel #{size}:#{index}")
        book(@teacher, size + index, status: :canceled)
      end
      get communication_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
      count_queries do
        get communication_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
        assert_response :success
      end
    end
    puts "Student workspace #{name}: #{counts.inspect}" if ENV["QUERY_COUNT_REPORT"]
    assert_equal counts.first, counts.last, counts.inspect
    12.times { |index| own.messages.create!(author: @student, body: "Most recent #{index}") }
    get communication_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_equal 10, response.parsed_body.dig("communication", "messages").size
    assert_equal "Most recent 11", response.parsed_body.dig("communication", "messages", 0, "body")
  end

  test "profile and cohort module endpoints stay flat across enrollments, modules, lessons and media" do
    counts = [ 1, 5 ].map do |size|
      size.times do |index|
        cohort = Cohort.create!(name: "Extra #{size}-#{index}", curriculum: @curriculum, start_date: Date.current, status: :active)
        cohort.instructors << @teacher
        Enrollment.create!(cohort: cohort, user: @student)
        learner = person("learner#{size}_#{index}", :student)
        enrollment = Enrollment.create!(cohort: @cohort, user: learner)
        mod = @curriculum.modules.create!(name: "Module #{size}-#{index}", position: size + index)
        lesson = mod.lessons.create!(title: "Video lesson #{size}-#{index}", position: 0, release_day: 0)
        lesson.content_blocks.create!(title: "Clip", block_type: :video, position: 0).update_column(:s3_video_key, "qa/#{size}-#{index}.mp4")
        enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
        @enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
        @cohort.recordings.create!(title: "Recording #{size}-#{index}", source_kind: "external", source_url: "https://example.invalid/clip")
      end
      get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
      get "/api/v1/cohorts/#{@cohort.id}", headers: headers(@teacher)
      [ count_queries { get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher); assert_response :success },
        count_queries { get "/api/v1/cohorts/#{@cohort.id}", headers: headers(@teacher); assert_response :success } ]
    end
    puts "Student workspace #{name}: #{counts.inspect}" if ENV["QUERY_COUNT_REPORT"]
    assert_equal counts.first, counts.last, counts.inspect
  end

  private

  def person(name, role)
    User.create!(clerk_id: "workspace_#{name}", email: "workspace_#{name}@example.com", first_name: name, last_name: "Test", role: role)
  end

  def conversation(teacher)
    DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ teacher, @student ])
  end

  def book(teacher, offset, status: :confirmed)
    config = @cohort.private_meeting_config || @cohort.create_private_meeting_config!(instructor: teacher, weeks: 30)
    starts = Time.current + offset.days
    # A second instructor can retain canceled/historical bookings after reassignment.
    config.update!(instructor: teacher)
    slot = config.private_meeting_slots.create!(instructor: teacher, starts_at: starts, ends_at: starts + 1.hour)
    PrivateMeetingBooking.create!(cohort: @cohort, enrollment: @enrollment, instructor: teacher, student: @student,
      private_meeting_slot: slot, starts_at: starts, ends_at: starts + 1.hour, week_number: offset, status: status)
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
  def profile_path = "/api/v1/progress/student/#{@student.id}"
  def communication_path = "#{profile_path}/communication"
end
