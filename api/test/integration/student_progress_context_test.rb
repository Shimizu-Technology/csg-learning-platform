require "test_helper"

class StudentProgressContextTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Connected learning")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Foundations", position: 0)
    lesson = Lesson.create!(curriculum_module: @mod, title: "Relationships", position: 0, release_day: 0)
    lesson.content_blocks.create!(block_type: :text, title: "Connected records", position: 0)
    @student = User.create!(clerk_id: "context_student", email: "context@example.com", first_name: "Context", last_name: "Student", role: :student)
    @staff = User.create!(clerk_id: "context_staff", email: "staff-context@example.com", first_name: "Context", last_name: "Staff", role: :instructor)
    @active_cohort = Cohort.create!(curriculum: @curriculum, name: "Current cohort", start_date: Date.current, status: :active)
    @past_cohort = Cohort.create!(curriculum: @curriculum, name: "Past cohort", start_date: 1.year.ago, status: :completed)
    [ @active_cohort, @past_cohort ].each { |cohort| cohort.cohort_instructor_assignments.create!(user: @staff) }
    [ @active_cohort, @past_cohort ].each do |cohort|
      enrollment = Enrollment.create!(user: @student, cohort: cohort, status: cohort.active? ? :active : :completed)
      enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    end
  end

  test "legacy pause uses a fixed read cutoff without claiming a known pause date" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    cutoff = 2.days.ago
    enrollment.update_columns(status: Enrollment.statuses[:paused], paused_at: nil, read_cutoff_at: cutoff)
    assert_nil enrollment.pause_date
    assert enrollment.content_available_for_read?(3.days.ago)
    refute enrollment.content_available_for_read?(1.day.ago)
    enrollment.update!(support_expires_at: 1.month.from_now)
    assert_equal cutoff, enrollment.reload.read_cutoff_at
    refute enrollment.content_available_for_read?(1.day.ago)
    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers }
    assert_response :success
    assert_nil response.parsed_body.dig("dashboard", "paused_since")
    enrollment.update!(status: :active)
    enrollment.update!(status: :paused)
    assert enrollment.paused_at
    assert enrollment.content_available_for_read?(1.day.ago), "A real new pause supersedes the legacy cutoff"
    assert_equal cutoff, enrollment.reload.read_cutoff_at
    enrollment.update_columns(paused_at: nil, read_cutoff_at: nil)
    refute enrollment.content_available_for_read?(3.days.ago), "Missing cutoff must fail closed"
  end

  test "paused dashboard retains lessons and forbids learning writes" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    enrollment.update!(status: :paused)
    as_user(@student) do
      get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_response :success
      dashboard = response.parsed_body.fetch("dashboard")
      assert_equal "paused", dashboard["enrollment_status"]
      assert_equal true, dashboard.dig("capabilities", "read_only")
      assert_equal enrollment.pause_date.iso8601, dashboard["paused_since"]
      assert_equal @mod.id, dashboard["modules"].first["id"]
      future_lesson = @mod.lessons.create!(title: "After pause", position: 20, release_day: 0, created_at: 1.day.from_now)
      get "/api/v1/lessons/#{future_lesson.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_response :forbidden
      conversation = DirectConversation.find_or_create_for!(workspace: @active_cohort.workspace, users: [ @student, @staff ])
      assert conversation.can_post?(@student)
      refute @active_cohort.channels.first.can_post?(@student)
      block = @mod.lessons.first.content_blocks.first
      patch "/api/v1/progress", params: { cohort_id: @active_cohort.id, content_block_id: block.id, status: "completed" }, headers: auth_headers, as: :json
      assert_response :forbidden
      post "/api/v1/submissions", params: { cohort_id: @active_cohort.id, content_block_id: block.id, body: "No write" }, headers: auth_headers, as: :json
      assert_response :forbidden
    end
  end

  test "alumni dashboard offers optional library lessons" do
    @active_cohort.update!(cohort_type: :alumni)
    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers }
    assert_response :success
    assert_equal "alumni", response.parsed_body.dig("dashboard", "cohort", "cohort_type")
    assert response.parsed_body.dig("dashboard", "modules").any?
  end

  test "paused cutoff uses Guam dates and stays fixed through edits until reactivation or drop" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    travel_to Time.utc(2026, 11, 14, 16) do
      enrollment.update!(status: :paused)
      assert_equal Date.new(2026, 11, 15), enrollment.pause_date
      cutoff = enrollment.paused_at
      travel 2.days
      enrollment.update!(support_expires_at: 1.month.from_now)
      assert_equal cutoff, enrollment.reload.paused_at
      as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers }
      assert_equal "2026-11-15", response.parsed_body.dig("dashboard", "paused_since")
      enrollment.update!(status: :active)
      assert_nil enrollment.paused_at
      enrollment.update!(status: :paused)
      assert enrollment.paused_at
      enrollment.update!(status: :dropped)
      assert_nil enrollment.paused_at
    end
  end

  test "paused lesson streams and navigation exclude content released after the school pause date" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    @active_cohort.update!(start_date: 1.week.ago.to_date)
    @mod.update!(schedule_days: "daily")
    past = @mod.lessons.first
    past.update!(created_at: 3.days.ago)
    enrollment.module_assignments.find_by!(module_id: @mod.id).update_columns(created_at: 3.days.ago, availability_changed_at: 3.days.ago)
    future = @mod.lessons.create!(title: "Hidden future title", position: 1, release_day: 0)
    unlocking = @mod.lessons.create!(title: "Hidden late unlock", position: 2, release_day: 0, created_at: 3.days.ago)
    enrollment.lesson_assignments.create!(lesson: unlocking, unlock_date_override: LearningCalendar.today)
    enrollment.update!(status: :paused)
    enrollment.update_column(:paused_at, 1.day.ago)
    video = past.content_blocks.create!(block_type: :video, position: 1, s3_video_key: "content_videos/block_1/20261010010000_abcdef12_past.mp4")
    future_video = future.content_blocks.create!(block_type: :video, position: 0, s3_video_key: "content_videos/block_2/20261010010000_abcdef12_future.mp4")
    configured = S3Service.method(:configured?)
    signed = S3Service.method(:generate_presigned_url)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:generate_presigned_url) { |*args, **kwargs| "https://signed.example/video" }
    as_user(@student) do
      get "/api/v1/content_blocks/#{video.id}/video_stream", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_response :success
      get "/api/v1/content_blocks/#{future_video.id}/video_stream", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_response :forbidden
      get "/api/v1/lessons/#{unlocking.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_response :forbidden
      get "/api/v1/lessons/#{past.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_response :success
      assert_nil response.parsed_body.dig("lesson", "next_lesson")
      get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_equal [ past.id ], response.parsed_body.dig("dashboard", "modules").flat_map { |mod| mod["lessons"].map { |lesson| lesson["id"] } }
      get "/api/v1/weekly_plan", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_response :success
      refute_includes response.body, future.title
      refute_includes response.body, unlocking.title
    end
  ensure
    S3Service.define_singleton_method(:configured?, configured) if configured
    S3Service.define_singleton_method(:generate_presigned_url, signed) if signed
  end

  test "unlocking an existing lesson assignment after pause does not grant read access" do
    @active_cohort.update!(start_date: 1.week.ago.to_date)
    lesson = @mod.lessons.first
    lesson.update!(created_at: 4.days.ago)
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    assignment = enrollment.lesson_assignments.create!(lesson: lesson, unlocked: false, created_at: 3.days.ago)
    enrollment.update!(status: :paused)
    enrollment.update_column(:paused_at, 1.day.ago)
    assignment.update!(unlocked: true)
    assert assignment.availability_changed_at
    as_user(@student) do
      get "/api/v1/lessons/#{lesson.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_response :forbidden
      get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      refute_includes response.body, lesson.title
    end
    assignment.update!(unlock_date_override: 2.days.ago.to_date)
    as_user(@student) { get "/api/v1/lessons/#{lesson.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers }
    assert_response :forbidden
    enrollment.update!(status: :active)
    as_user(@student) { get "/api/v1/lessons/#{lesson.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers }
    assert_response :success
  end

  [ :self_paced, :alumni ].each do |kind|
    test "paused #{kind} learner cannot open an old lesson or video from a module assigned after pause" do
      enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
      @active_cohort.update!(kind == :alumni ? { cohort_type: :alumni } : { course_delivery: "self_paced", support_instructor: @staff })
      past = @mod.lessons.first
      past.update!(created_at: 4.days.ago)
      assignment = enrollment.module_assignments.find_by!(module_id: @mod.id)
      assignment.update_columns(created_at: 3.days.ago, availability_changed_at: 3.days.ago)
      later_module = @curriculum.modules.create!(name: "Assigned after pause", position: 1)
      later_lesson = later_module.lessons.create!(title: "Old lesson newly assigned", position: 0, release_day: 0, created_at: 4.days.ago)
      video = later_lesson.content_blocks.create!(block_type: :video, position: 0, s3_video_key: "content_videos/block_2/20261010010000_abcdef12_future.mp4")
      enrollment.update!(status: :paused)
      enrollment.update_column(:paused_at, 1.day.ago)
      admin = User.create!(clerk_id: "module_admin", email: "module-admin@example.com", role: :admin)
      as_user(admin) do
        post "/api/v1/enrollments/#{enrollment.id}/module_assignments", params: { module_id: later_module.id, unlocked: true }, headers: auth_headers, as: :json
        assert_response :created
      end
      assert enrollment.module_assignments.exists?(module_id: later_module.id)
      as_user(@student) do
        get "/api/v1/lessons/#{past.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
        assert_response :success
        get "/api/v1/lessons/#{later_lesson.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
        assert_response :forbidden
        get "/api/v1/content_blocks/#{video.id}/video_stream", params: { cohort_id: @active_cohort.id }, headers: auth_headers
        assert_response :forbidden
        get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers
        assert_response :success
        refute_includes response.body, later_lesson.title
        assert_includes response.body, past.title
      end
    end
  end

  test "later module unlocks and backdated overrides cannot expand a paused guided library" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    @active_cohort.update!(start_date: 1.week.ago.to_date)
    lesson = @mod.lessons.first
    lesson.update!(created_at: 4.days.ago)
    assignment = enrollment.module_assignments.find_by!(module_id: @mod.id)
    assignment.update_columns(created_at: 4.days.ago, availability_changed_at: 4.days.ago, unlocked: false, unlock_date_override: 1.week.from_now.to_date)
    enrollment.update!(status: :paused)
    enrollment.update_column(:paused_at, 1.day.ago)
    assignment.update!(unlocked: true)
    as_user(@student) { get "/api/v1/lessons/#{lesson.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers }
    assert_response :forbidden
    assignment.update!(unlock_date_override: 1.week.ago.to_date)
    as_user(@student) { get "/api/v1/lessons/#{lesson.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers }
    assert_response :forbidden
    lesson_assignment = enrollment.lesson_assignments.create!(lesson: lesson, unlocked: true)
    lesson_assignment.update_columns(created_at: 3.days.ago, availability_changed_at: 3.days.ago)
    # A guided lesson override governs independently of the module assignment.
    as_user(@student) { get "/api/v1/lessons/#{lesson.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers }
    assert_response :success
  end

  test "paused learner sees only staff DMs and cannot read or mutate class chat or create peer DMs" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    @student.update!(community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
    peer = User.create!(clerk_id: "pause_peer", email: "pause-peer@example.com", first_name: "Peer", role: :student)
    Enrollment.create!(user: peer, cohort: @active_cohort)
    workspace = @active_cohort.workspace
    channel = workspace.channels.first
    message = channel.messages.create!(author: @student, body: "Existing class message")
    reaction = message.message_reactions.create!(user: @student, emoji: "thumbsup")
    peer_dm = DirectConversation.find_or_create_for!(workspace: workspace, users: [ @student, peer ])
    staff_dm = DirectConversation.find_or_create_for!(workspace: workspace, users: [ @student, @staff ])
    enrollment.update!(status: :paused)
    assert_includes Workspace.visible_for(@student), workspace
    assert workspace.visible_to?(@student)
    as_user(@student) do
      get "/api/v1/channels", headers: auth_headers
      refute_includes response.parsed_body.fetch("channels").map { |item| item["id"] }, channel.id
      get "/api/v1/channels/#{channel.id}", headers: auth_headers
      assert_response :forbidden
      get "/api/v1/workspaces/#{workspace.id}", headers: auth_headers
      assert_response :success
      assert_equal 0, response.parsed_body.dig("workspace", "member_count")
      assert_empty response.parsed_body.dig("workspace", "members")
      post "/api/v1/messages/#{message.id}/reactions", params: { emoji: "heart" }, headers: auth_headers, as: :json
      assert_response :forbidden
      delete "/api/v1/messages/#{message.id}/reactions", params: { emoji: reaction.emoji }, headers: auth_headers, as: :json
      assert_response :forbidden
      patch "/api/v1/messages/#{message.id}", params: { body: "Changed" }, headers: auth_headers, as: :json
      assert_response :forbidden
      delete "/api/v1/messages/#{message.id}", headers: auth_headers
      assert_response :forbidden
      assert_equal "Existing class message", message.reload.body
      assert MessageReaction.exists?(reaction.id)
      get "/api/v1/direct_conversations/available_users", params: { workspace_id: workspace.id }, headers: auth_headers
      assert_equal [ @staff.id ], response.parsed_body.fetch("users").map { |user| user["id"] }
      post "/api/v1/direct_conversations", params: { workspace_id: workspace.id, user_ids: [ peer.id ] }, headers: auth_headers, as: :json
      assert_response :not_found
      get "/api/v1/direct_conversations/#{peer_dm.id}", headers: auth_headers
      assert_response :forbidden
      get "/api/v1/direct_conversations", headers: auth_headers
      assert_equal [ staff_dm.id ], response.parsed_body.fetch("direct_conversations").map { |dm| dm["id"] }
      post "/api/v1/direct_conversations", params: { workspace_id: workspace.id, user_ids: [ @staff.id ] }, headers: auth_headers, as: :json
      assert_response :created
      post "/api/v1/direct_conversations/#{staff_dm.id}/messages", params: { body: "Can I resume?" }, headers: auth_headers, as: :json
      assert_response :created
      assert_equal "Can I resume?", staff_dm.messages.last.body
    end
  end

  test "paused self-paced dashboard targets its assigned support instructor" do
    support = User.create!(clerk_id: "configured_support", email: "configured-support@example.com", first_name: "Assigned", role: :instructor)
    @active_cohort.cohort_instructor_assignments.create!(user: support)
    @active_cohort.update!(course_delivery: "self_paced", support_instructor: support)
    @student.enrollments.find_by!(cohort: @active_cohort).update!(status: :paused)
    as_user(@student) do
      get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_equal support.id, response.parsed_body.dig("dashboard", "support_instructor_id")
      post "/api/v1/direct_conversations", params: { cohort_id: @active_cohort.id, user_ids: [ support.id ] }, headers: auth_headers, as: :json
      assert_response :created
      get "/api/v1/direct_conversations/available_users", params: { cohort_id: @active_cohort.id }, headers: auth_headers
      assert_equal [ support.id ], response.parsed_body.fetch("users").map { |user| user["id"] }
    end
  end

  test "completed learner gets a default dashboard and expired paused enrollment is fully denied" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    enrollment.update!(status: :completed)
    as_user(@student) { get "/api/v1/dashboard", headers: auth_headers }
    assert_response :success
    assert response.parsed_body.dig("dashboard", "enrolled")
    assert_equal "completed", response.parsed_body.dig("dashboard", "enrollment_status")
    enrollment.update!(status: :paused, access_expires_at: 1.second.ago)
    as_user(@student) do
      [ "/api/v1/dashboard", "/api/v1/weekly_plan", "/api/v1/lessons/#{@mod.lessons.first.id}" ].each do |endpoint|
        get endpoint, params: { cohort_id: @active_cohort.id }, headers: auth_headers
        assert_response :forbidden
      end
      get "/api/v1/workspaces/#{@active_cohort.workspace.id}", headers: auth_headers
      assert_response :forbidden
    end
  end

  test "staff progress resolves the explicitly requested enrollment" do
    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @past_cohort.id }, headers: auth_headers
    end

    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal @past_cohort.id, payload.dig("cohort", "id")
    assert_equal "completed", payload.dig("enrollment", "status")
    assert_equal "enrollment", payload.dig("learning_evidence_scope", "kind")
    assert_equal @curriculum.id, payload.dig("learning_evidence_scope", "curriculum_id")
    assert_equal 2, payload.dig("learning_evidence_scope", "enrollment_count")
    refute payload.dig("learning_evidence_scope", "shared_across_enrollments")
  end

  test "staff progress rejects a cohort the student never joined" do
    unrelated = Cohort.create!(curriculum: @curriculum, name: "Unrelated", start_date: Date.current, status: :active)

    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: unrelated.id }, headers: auth_headers
    end

    assert_response :not_found
    assert_equal "Student is not enrolled in this cohort", JSON.parse(response.body).fetch("error")
  end

  test "lesson-only dashboard and staff progress count only assigned learning steps" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    enrollment.module_assignments.destroy_all
    assigned_lesson = @mod.lessons.first
    enrollment.lesson_assignments.create!(lesson: assigned_lesson, unlocked: true)
    sibling = @mod.lessons.create!(title: "Unassigned sibling", position: 1, release_day: 0)
    sibling.content_blocks.create!(block_type: :text, position: 0, body: "Not assigned")
    Progress.create!(user: @student, enrollment: enrollment, content_block: assigned_lesson.content_blocks.first, status: :completed)
    Progress.create!(user: @student, enrollment: enrollment, content_block: sibling.content_blocks.first, status: :completed)

    as_user(@student) do
      get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers
    end
    assert_response :success
    dashboard = JSON.parse(response.body).fetch("dashboard")
    assert_equal({ "completed" => 1, "total" => 1, "percentage" => 100.0 }, dashboard.fetch("overall_progress"))
    mod = dashboard.fetch("modules").sole
    assert_equal @mod.id, mod.fetch("id")
    assert mod.fetch("available")
    assert_equal [ assigned_lesson.id ], mod.fetch("lessons").map { |lesson| lesson["id"] }
    assert_equal 1, mod.fetch("total_blocks")

    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
    end
    assert_response :success
    assert_equal({ "completed" => 1, "total" => 1, "percentage" => 100.0 }, JSON.parse(response.body).fetch("overall_progress"))
  end

  test "staff retain removed module evidence without counting it as assigned work" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    block = @mod.lessons.first.content_blocks.first
    Progress.create!(user: @student, enrollment: enrollment, content_block: block, status: :completed)
    submission = Submission.create!(user: @student, enrollment: enrollment, content_block: block, grade: :A, feedback: "Saved feedback")
    retained_module = @curriculum.modules.create!(name: "Still assigned", position: 1)
    retained_lesson = retained_module.lessons.create!(title: "Current work", position: 0)
    retained_lesson.content_blocks.create!(block_type: :text, title: "Pending", position: 0)
    enrollment.module_assignments.create!(curriculum_module: retained_module)
    enrollment.module_assignments.find_by!(module_id: @mod.id).destroy!
    # A different enrollment's newer evidence must never replace this history.
    other_enrollment = @student.enrollments.find_by!(cohort: @past_cohort)
    Submission.create!(user: @student, enrollment: other_enrollment, content_block: block, grade: :R)

    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
    end
    assert_response :success
    payload = JSON.parse(response.body)
    removed = payload.fetch("modules").find { |mod| mod["id"] == @mod.id }
    saved = removed.fetch("lessons").sole.fetch("blocks").sole
    assert_equal "completed", saved.fetch("status")
    assert saved.fetch("completed_at")
    assert_equal submission.id, saved.dig("submission", "id")
    assert_equal "A", saved.dig("submission", "grade")
    assert_equal "Saved feedback", saved.dig("submission", "feedback")
    assert_equal false, removed.fetch("lessons").sole.fetch("assigned")
    assert_equal false, removed.fetch("lessons").sole.fetch("available")
    assert_equal 0, removed.fetch("completed_blocks")
    assert_equal 0, removed.fetch("total_blocks")
    assert_equal 0, removed.fetch("lessons").sole.fetch("total_blocks")
    assert_equal({ "completed" => 0, "total" => 1, "percentage" => 0.0 }, payload.fetch("overall_progress"))
    assert_includes payload.fetch("recent_activity").map { |activity| activity["content_block_id"] }, block.id
  end

  test "staff support facts use the selected enrollment first-open time" do
    selected = @student.enrollments.find_by!(cohort: @active_cohort)
    selected.update!(first_opened_at: Time.utc(2026, 10, 20), support_expires_at: Time.utc(2026, 12, 20))
    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
    end
    assert_response :success
    assert_equal selected.first_opened_at.iso8601(3), JSON.parse(response.body).dig("enrollment", "first_opened_at")
    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @past_cohort.id }, headers: auth_headers
    end
    assert_response :success
    assert_nil JSON.parse(response.body).fetch("enrollment").fetch("first_opened_at")
  end

  private

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
