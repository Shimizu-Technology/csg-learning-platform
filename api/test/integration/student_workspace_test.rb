require "test_helper"
require "json_schemer"
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
    recording = @cohort.recordings.create!(title: "Class clip", source_kind: "external", source_url: "https://example.invalid/clip", status: :published)
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
    archived.module_assignments.create!(curriculum_module: @module, unlocked: true)
    get "/api/v1/cohorts/#{@cohort.id}", headers: headers(@teacher)
    assert_response :success
    mod = response.parsed_body.fetch("cohort").fetch("modules").sole
    assert_equal [ @enrollment.id, enrollment.id ].sort, mod.fetch("assigned_enrollment_ids").sort
    assert_equal 2, mod["assigned_count"]
    assert_equal 1, mod["unlocked_count"], "archived learners do not inflate unlocked counts"
    assert_equal 1, mod["accessible_count"], "assignment access uses the same live module-assignment scope"
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

  test "communication retains blocked previews in both directions and disables unavailable DM actions" do
    own = conversation(@teacher)
    hidden = own.messages.create!(author: @student, body: "Blocked private body")
    reply = own.messages.create!(author: @teacher, body: "My permitted reply")
    channel = @cohort.workspace.channels.create!(name: "blocked-activity", position: 5)
    activity = channel.messages.create!(author: @student, body: "Blocked class body")
    [ [ @teacher, @student ], [ @student, @teacher ] ].each do |blocker, blocked|
      block = UserBlock.create!(blocker: blocker, blocked_user: blocked)
      get communication_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
      assert_response :success
      body = response.parsed_body.fetch("communication")
      assert_equal [ reply.id, hidden.id ], body.fetch("messages").pluck("id")
      assert_equal "Message hidden", body.fetch("messages").find { |row| row["id"] == hidden.id }.fetch("body")
      assert_equal "My permitted reply", body.fetch("messages").find { |row| row["id"] == reply.id }.fetch("body")
      assert body.fetch("messages").none? { |row| row.fetch("can_open") }
      assert_equal false, body.fetch("can_message")
      get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
      assert_equal false, response.parsed_body.fetch("can_message")
      assert_equal [ activity.id ], body.fetch("channel_activity").pluck("id")
      assert_equal "Message hidden", body.fetch("channel_activity").sole.fetch("body")
      assert body.fetch("channel_activity").sole.fetch("can_open")
      get "/api/v1/channels/#{channel.id}", headers: headers(@teacher)
      assert_response :success
      refute_includes response.body, "Blocked class body"
      block.destroy!
    end
  end

  test "communication is bounded and query counts stay flat as messages, channels and meetings grow" do
    own = conversation(@teacher)
    channel = @cohort.workspace.channels.create!(name: "activity", position: 5)
    # This scenario asserts timestamp ordering, not the runner wall clock.
    # WSL clock correction between inserts must not reorder its fixture groups.
    base_time = Time.current - 1.hour
    sequence = 0
    counts = [ 1, 5 ].map do |size|
      size.times do |index|
        own.messages.create!(author: @student, body: "Reply #{size}:#{index}", created_at: base_time + (sequence += 1).seconds)
        channel.messages.create!(author: @student, body: "Channel #{size}:#{index}", created_at: base_time + sequence.seconds)
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
    12.times { |index| own.messages.create!(author: @student, body: "Most recent #{index}", created_at: base_time + (sequence += 1).seconds) }
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

  test "workspace wire contracts cover complete payloads and reject undocumented record fields" do
    own = conversation(@teacher)
    own.messages.create!(author: @student, body: "Contract example")
    document = JSON.parse(File.read(Rails.root.join("..", "docs", "openapi.json")))
    [
      [ profile_path, "StudentWorkspaceProgressResponse", nil ],
      [ "/api/v1/cohorts/#{@cohort.id}", "CohortWorkspaceResponse", "cohort" ],
      [ communication_path, "StudentCommunicationResponse", "communication" ],
      [ "/api/v1/cohorts/#{@cohort.id}/learning_insights", "LearningInsightContextResponse", "learning_insights" ]
    ].each do |path, name, nested|
      get path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
      assert_response :success
      body = response.parsed_body
      contract = JSONSchemer.schema({ "$ref" => "#/components/schemas/#{name}", "components" => document.fetch("components") })
      assert contract.valid?(body), contract.validate(body).to_a.inspect
      extra = body.deep_dup
      (nested ? extra.fetch(nested) : extra)["undocumented_wire_field"] = true
      refute contract.valid?(extra), "#{name} must reject extra fixed-record fields"
      if nested == "cohort"
        %w[id name students].each do |key|
          incomplete = body.deep_dup
          incomplete.fetch("cohort").delete(key)
          refute contract.valid?(incomplete), "#{key} is a guaranteed cohort field"
        end
      end
    end
  end

  %w[unassigned personal_plan lesson_only].each do |mode|
    test "lesson video card and list share assignments and completion in #{mode}" do
      clip = @lesson.content_blocks.create!(title: "Assigned clip", block_type: :video, position: 1)
      clip.update_column(:s3_video_key, "qa/assigned.mp4")
      Progress.create!(user: @student, enrollment: @enrollment, content_block: clip, status: :completed)
      other = @curriculum.modules.create!(name: "Unassigned videos", position: 2)
      lesson = other.lessons.create!(title: "Outside assignment", position: 0)
      lesson.content_blocks.create!(title: "Outside clip", block_type: :video, position: 0).update_column(:s3_video_key, "qa/outside.mp4")
      if mode == "lesson_only"
        @enrollment.module_assignments.destroy_all
        @enrollment.lesson_assignments.create!(lesson: @lesson, unlocked: true)
      elsif mode == "personal_plan"
        @enrollment.create_learning_plan!(active: true, title: "Personal", milestones: [ { title: "Next", due_on: "2026-12-01", lesson_ids: [ @lesson.id ] } ])
      end
      get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
      assert_response :success
      summary = response.parsed_body.fetch("media_summary")
      get "/api/v1/watch_progress/student/#{@student.id}/lesson_videos", params: { cohort_id: @cohort.id }, headers: headers(@teacher)
      assert_response :success
      videos = response.parsed_body.fetch("lesson_videos")
      assert_equal [ clip.id ], videos.pluck("content_block_id")
      assert_equal summary.fetch("lesson_videos_total"), videos.size
      assert_equal summary.fetch("lesson_videos_completed"), videos.count { |row| row["completed"] }
    end
  end

  test "recording card and staff list exclude completed draft recordings" do
    [ :draft, :published ].each do |status|
      recording = @cohort.recordings.create!(title: status.to_s, source_kind: "external", source_url: "https://example.invalid/clip", status: status)
      WatchProgress.create!(user: @student, recording: recording, total_watched_seconds: 90, duration_seconds: 100)
    end
    get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    summary = response.parsed_body.fetch("media_summary")
    get "/api/v1/watch_progress/student/#{@student.id}", params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_response :success
    rows = response.parsed_body.fetch("watch_progresses")
    assert_equal [ "published" ], rows.pluck("recording_title")
    assert_equal 1, summary.fetch("recordings_total")
    assert_equal summary.fetch("recordings_total"), rows.size
    assert_equal summary.fetch("recordings_completed"), rows.count { |row| row["completed"] }
  end

  test "waiting review metric equals the scoped server queue including retained attempts" do
    Submission.create!(enrollment: @enrollment, user: @student, content_block: @block, text: "Earlier", grade: "A")
    Submission.create!(enrollment: @enrollment, user: @student, content_block: @block, text: "Latest waiting")
    @enrollment.module_assignments.destroy_all
    get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    count = response.parsed_body.dig("status", "ungraded_count")
    get "/api/v1/grading_queue", params: { cohort_id: @cohort.id, student_id: @student.id, filter: "ungraded" }, headers: headers(@teacher)
    assert_response :success
    assert_equal 1, count
    assert_equal count, response.parsed_body.dig("meta", "total_count")
  end

  test "open support metric equals the server student active-request scope" do
    other = person("other_help", :student)
    Enrollment.create!(cohort: @cohort, user: other)
    [ [ @student, :open ], [ @student, :acknowledged ], [ @student, :resolved ], [ other, :open ] ].each_with_index do |(student, status), index|
      context = @module.lessons.create!(title: "Help context #{index}", position: index + 3)
      HelpRequest.create!(student: student, cohort: @cohort, context_type: :lesson, context_id: context.id, context_label: context.title, context_path: "/lessons/#{context.id}", category: :concept, urgency: :normal, message: "Support example", status: status, owner: @teacher, acknowledged_at: Time.current, staff_response: "Reply", resolved_at: Time.current)
    end
    get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    count = response.parsed_body.dig("status", "help_request_count")
    get "/api/v1/support_queue", params: { cohort_id: @cohort.id, student_id: @student.id }, headers: headers(@teacher)
    assert_response :success
    rows = response.parsed_body.dig("support_queue", "help_requests")
    assert_equal 2, count
    assert_equal count, rows.size
    assert_equal [ @student.id ], rows.map { |row| row.dig("student", "id") }.uniq
  end

  test "module percentage uses the same whole-lesson basis as its label" do
    Progress.create!(user: @student, enrollment: @enrollment, content_block: @block, status: :completed)
    second = @module.lessons.create!(title: "Many steps", position: 1)
    3.times { |index| second.content_blocks.create!(title: "Step #{index}", block_type: :text, position: index) }
    get "/api/v1/cohorts/#{@cohort.id}", headers: headers(@teacher)
    assert_response :success
    mod = response.parsed_body.dig("cohort", "modules").find { |row| row["id"] == @module.id }
    assert_equal [ 1, 2, 50.0 ], mod.values_at("completed_lessons", "total_lessons", "progress_percentage")
  end

  test "full meeting history keeps the Communication instructor-host privacy scope" do
    mine = book(@teacher, 1)
    other = book(@other_teacher, 2)
    @cohort.private_meeting_config.update!(instructor: @teacher)
    get "/api/v1/staff/private_meetings", params: { cohort_id: @cohort.id, student_id: @student.id }, headers: headers(@teacher)
    assert_response :success
    assert_equal [ mine.id ], response.parsed_body.fetch("cohorts").flat_map { |row| row["bookings"] }.pluck("id")
    get "/api/v1/staff/private_meetings", params: { cohort_id: @cohort.id, student_id: @student.id }, headers: headers(@admin)
    assert_response :success
    assert_equal [ mine.id, other.id ].sort, response.parsed_body.fetch("cohorts").flat_map { |row| row["bookings"] }.pluck("id").sort
  end

  test "communication fixtures stay inside one course week near local midnight" do
    travel_to(Time.current.change(hour: 13, min: 30, sec: 0)) do
      booking = book(@teacher, 17, status: :canceled)
      config = @cohort.private_meeting_config
      assert_equal config.week_for(booking.starts_at), config.week_for(booking.ends_at - 1.second)
    end
  end

  test "filtered full communication lists and media lists keep flat query counts" do
    conversation(@teacher).messages.create!(author: @student, body: "Scoped message")
    outsider = person("another_learner", :student)
    Enrollment.create!(cohort: @cohort, user: outsider)
    DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @teacher, outsider ])
    book(@teacher, 1)
    paths = [ [ "/api/v1/direct_conversations", { cohort_id: @cohort.id, student_id: @student.id } ],
      [ "/api/v1/staff/private_meetings", { cohort_id: @cohort.id, student_id: @student.id } ],
      [ "/api/v1/support_queue", { cohort_id: @cohort.id, student_id: @student.id } ],
      [ "/api/v1/watch_progress/student/#{@student.id}", { cohort_id: @cohort.id } ],
      [ "/api/v1/watch_progress/student/#{@student.id}/lesson_videos", { cohort_id: @cohort.id } ] ]
    counts = [ 1, 4 ].map do |size|
      size.times do |index|
        member = person("group_#{size}_#{index}", :student)
        Enrollment.create!(cohort: @cohort, user: member)
        DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @teacher, @student, member ])
        lesson = @module.lessons.create!(title: "Video #{size}:#{index}", position: size + index)
        lesson.content_blocks.create!(title: "Clip", block_type: :video, position: 0).update_column(:s3_video_key, "qa/flat#{size}:#{index}.mp4")
        @cohort.recordings.create!(title: "Published", source_kind: "external", source_url: "https://example.invalid/clip", status: :published)
        book(@teacher, 10 + size + index, status: :canceled)
        HelpRequest.create!(student: @student, cohort: @cohort, context_type: :lesson, context_id: lesson.id, context_label: lesson.title, context_path: "/lessons/#{lesson.id}", category: :concept, message: "Help")
      end
      paths.map do |path, params|
        get path, params: params, headers: headers(@teacher)
        count_queries { get path, params: params, headers: headers(@teacher); assert_response :success }
      end
    end
    assert_equal counts.first, counts.last, counts.inspect
    get paths[0][0], params: paths[0][1], headers: headers(@teacher)
    assert_equal DirectConversationMember.where(user_id: @student.id).pluck(:direct_conversation_id).sort, response.parsed_body.fetch("direct_conversations").pluck("id").sort
    own = book(@teacher, 28, status: :confirmed)
    own.update!(student: outsider, enrollment: outsider.enrollments.find_by!(cohort: @cohort))
    get paths[1][0], params: paths[1][1], headers: headers(@teacher)
    refute_includes response.parsed_body.fetch("cohorts").flat_map { |row| row["bookings"] }.pluck("id"), own.id
    slots = response.parsed_body.fetch("cohorts").flat_map { |row| row["slots"] }
    assert_equal false, slots.find { |row| row["id"] == own.private_meeting_slot_id }.fetch("available"), "filtering the student must not free another learner's booked slot"
  end

  test "workspace curriculum names redact a hidden copy owner and enrollment counts use staff scope" do
    copy = Curriculum.create!(name: "Shared lab (Hidden birch cohort)")
    hidden = Cohort.create!(name: "Hidden birch cohort", curriculum: copy, start_date: Date.current, status: :active)
    CurriculumCopy.create!(cohort: hidden, source_curriculum: @curriculum, copy_curriculum: copy, created_by: @admin)
    # Legacy/shared copies can have more than one cohort; this is the privacy boundary.
    @cohort.update_column(:curriculum_id, copy.id)
    Enrollment.create!(user: @student, cohort: hidden)
    get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_response :success
    refute_includes response.body, hidden.name
    assert_equal "Shared lab (copy)", response.parsed_body.dig("learning_evidence_scope", "curriculum_name")
    assert_equal 1, response.parsed_body.dig("learning_evidence_scope", "enrollment_count")
    assert_equal [ @cohort.id ], response.parsed_body.fetch("enrollments").pluck("cohort_id")
    get "/api/v1/cohorts/#{@cohort.id}", headers: headers(@teacher)
    assert_response :success
    assert_equal "Shared lab (copy)", response.parsed_body.dig("cohort", "curriculum_name")
    refute_includes response.body, hidden.name
    get "/api/v1/records/curriculum/#{copy.id}/usage", headers: headers(@teacher)
    assert_response :success
    refute_includes response.body, hidden.name
    assert_equal 1, response.parsed_body.dig("usage", "other_cohorts_count")
    get profile_path, params: { cohort_id: @cohort.id }, headers: headers(@admin)
    assert_response :success
    assert_equal "Shared lab (Hidden birch cohort)", response.parsed_body.dig("learning_evidence_scope", "curriculum_name")
    assert_equal 2, response.parsed_body.dig("learning_evidence_scope", "enrollment_count")
  end

  test "student support scope composes with the shared lesson and module filters" do
    other = person("filtered_help", :student)
    Enrollment.create!(user: other, cohort: @cohort)
    extra = @module.lessons.create!(title: "Other lesson", position: 4)
    [ [ @student, @lesson ], [ other, @lesson ], [ @student, extra ] ].each do |student, lesson|
      HelpRequest.create!(student: student, cohort: @cohort, context_type: :lesson, context_id: lesson.id,
        context_label: lesson.title, context_path: "/lessons/#{lesson.id}", category: :concept, message: "Filtered help")
    end
    [ { lesson_id: @lesson.id }, { module_id: @module.id } ].each do |filter|
      get "/api/v1/support_queue", params: { cohort_id: @cohort.id, student_id: @student.id, **filter }, headers: headers(@teacher)
      assert_response :success
      rows = response.parsed_body.dig("support_queue", "help_requests")
      assert_equal(filter[:lesson_id] ? 1 : 2, rows.size)
      assert_equal [ @student.id ], rows.map { |row| row.dig("student", "id") }.uniq
      assert_equal(filter[:lesson_id] ? "lesson" : "module", response.parsed_body.dig("support_queue", "help_filter", "type"))
    end
  end

  test "staff cohort scope exposes only taught cohorts as a relation and hidden cohorts only as a count" do
    hidden = Cohort.create!(name: "Unseen cohort", curriculum: @curriculum, start_date: Date.current)
    teacher = StaffCohortScope.new(@teacher)
    assert_equal [ @cohort.id ], teacher.visible_cohorts.pluck(:id)
    assert_equal 1, teacher.other_count(@curriculum.id)
    assert_equal [ @cohort.id ], teacher.visible_ids(@curriculum.id)
    assert_includes StaffCohortScope.new(@admin).visible_cohorts.pluck(:id), hidden.id
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
    # Mid-day in the meeting's own time zone: a slot near local midnight can cross
    # into the next course week, which PrivateMeetingSlot rejects (CI time-of-day flake).
    starts = (Time.current + offset.days).in_time_zone(config.timezone).change(hour: 10)
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
