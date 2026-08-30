require "test_helper"

class LessonsApiTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    @curriculum_module = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Week 1",
      position: 0,
      day_offset: 0,
      schedule_days: "daily"
    )
    @lesson = Lesson.create!(
      curriculum_module: @curriculum_module,
      title: "Lesson 1",
      position: 0,
      release_day: 0
    )
    @video_block = @lesson.content_blocks.create!(
      block_type: :video,
      position: 1,
      title: "Intro",
      s3_video_key: "content_videos/11111111-1111-4111-8111-111111111111/intro.mp4"
    )

    @student = User.create!(
      clerk_id: "clerk_student_lessons_api",
      email: "student-lessons@example.com",
      first_name: "Student",
      last_name: "Viewer",
      role: :student
    )
    @admin = User.create!(
      clerk_id: "clerk_admin_lessons_api",
      email: "admin-lessons@example.com",
      first_name: "Admin",
      last_name: "Editor",
      role: :admin
    )
    @instructor = User.create!(
      clerk_id: "clerk_instructor_lessons_api",
      email: "instructor-lessons@example.com",
      first_name: "Instructor",
      last_name: "Editor",
      role: :instructor
    )

    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @curriculum_module, unlocked: true)
  end

  test "student lesson payload includes self-hosted video key" do
    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end

    assert_response :success
    lesson = JSON.parse(response.body).fetch("lesson")
    assert_equal @cohort.id, lesson.fetch("cohort_id")
    block = lesson.fetch("content_blocks").find { |item| item["id"] == @video_block.id }
    assert_equal @video_block.s3_video_key, block["s3_video_key"]
    assert_equal true, block["completion_required"]
    refute block.key?("s3_video_content_type")
  end

  test "lesson payload identifies only actionable completion blocks when an exercise exists" do
    exercise = @lesson.content_blocks.create!(block_type: :exercise, position: 2, title: "Submit")
    submission = Submission.create!(user: @student, content_block: exercise, text: "Versioned draft base")

    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end

    assert_response :success
    blocks = JSON.parse(response.body).dig("lesson", "content_blocks").index_by { |item| item["id"] }
    assert_equal false, blocks.fetch(@video_block.id)["completion_required"]
    assert_equal true, blocks.fetch(exercise.id)["completion_required"]
    assert_equal submission.updated_at.to_i, Time.iso8601(blocks.fetch(exercise.id).dig("submissions", 0, "updated_at")).to_i
  end

  test "staff lesson payload still includes video metadata" do
    @video_block.update!(
      s3_video_content_type: "video/mp4",
      s3_video_size: 123,
      s3_video_uploaded_by: @admin,
      s3_video_uploaded_at: Time.zone.parse("2026-04-29 16:30")
    )

    as_user(@admin) do
      get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end

    assert_response :success
    block = JSON.parse(response.body).dig("lesson", "content_blocks").find { |item| item["id"] == @video_block.id }
    assert_equal @video_block.s3_video_key, block["s3_video_key"]
    assert_equal "video/mp4", block["s3_video_content_type"]
    assert_equal 123, block["s3_video_size"]
    assert_equal @admin.full_name, block["s3_video_uploaded_by"]
    assert block["s3_video_uploaded_at"].present?
  end

  test "staff content block update stamps self-hosted video upload metadata" do
    @video_block.update!(s3_video_key: nil)

    as_user(@admin) do
      patch "/api/v1/content_blocks/#{@video_block.id}",
            params: {
              s3_video_key: "content_videos/block_#{@video_block.id}/20260831010000_class.mp4",
              s3_video_content_type: "video/mp4",
              s3_video_size: 123
            },
            headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body).fetch("content_block")
    assert_equal "content_videos/block_#{@video_block.id}/20260831010000_class.mp4", body.fetch("s3_video_key")
    assert_equal @admin.full_name, body.fetch("s3_video_uploaded_by")
    assert body.fetch("s3_video_uploaded_at").present?
  end

  test "content block replacement deletes the unreferenced old video" do
    old_key = "content_videos/block_#{@video_block.id}/20260831010000_old.mp4"
    new_key = "content_videos/block_#{@video_block.id}/20260831010100_new.mp4"
    @video_block.update_columns(s3_video_key: old_key)
    deleted_keys = []

    with_s3_delete_capture(deleted_keys) do
      as_user(@admin) do
        patch "/api/v1/content_blocks/#{@video_block.id}",
              params: { s3_video_key: new_key, s3_video_content_type: "video/mp4", s3_video_size: 123 },
              headers: auth_headers
      end
    end

    assert_response :success
    assert_equal new_key, @video_block.reload.s3_video_key
    assert_equal [ old_key ], deleted_keys
  end

  test "content block removal preserves an old video that is still referenced" do
    old_key = "content_videos/block_#{@video_block.id}/20260831010200_shared.mp4"
    @video_block.update_columns(s3_video_key: old_key)
    @lesson.content_blocks.create!(block_type: :video, position: 2, s3_video_key: old_key)
    deleted_keys = []

    with_s3_delete_capture(deleted_keys) do
      as_user(@admin) do
        patch "/api/v1/content_blocks/#{@video_block.id}",
              params: { s3_video_key: nil },
              headers: auth_headers
      end
    end

    assert_response :success
    assert_nil @video_block.reload.s3_video_key
    assert_empty deleted_keys
  end

  test "content block removal deletes an unreferenced old video" do
    old_key = "content_videos/block_#{@video_block.id}/20260831010230_removed.mp4"
    @video_block.update_columns(s3_video_key: old_key)
    deleted_keys = []

    with_s3_delete_capture(deleted_keys) do
      as_user(@admin) do
        patch "/api/v1/content_blocks/#{@video_block.id}",
              params: { s3_video_key: nil },
              headers: auth_headers
      end
    end

    assert_response :success
    assert_nil @video_block.reload.s3_video_key
    assert_equal [ old_key ], deleted_keys
  end

  test "instructor creates an exercise with a reserved upload target and attaches the completed video" do
    created_lesson_id = nil
    video_block_id = nil

    as_user(@instructor) do
      post "/api/v1/modules/#{@curriculum_module.id}/exercises",
           params: {
             title: "Async upload exercise",
             release_day: 1,
             instructions: "Keep working while the video uploads.",
             submission_type: "manual_complete",
             video_upload_pending: true
           },
           headers: auth_headers,
           as: :json
    end

    assert_response :created
    lesson = JSON.parse(response.body).fetch("lesson")
    created_lesson_id = lesson.fetch("id")
    blocks = lesson.fetch("content_blocks")
    video = blocks.find { |block| block.fetch("block_type") == "video" }
    assert video, "expected a reserved video content block"
    assert_nil video["s3_video_key"]
    video_block_id = video.fetch("id")
    assert blocks.any? { |block| block.fetch("block_type") == "exercise" }

    as_user(@instructor) do
      patch "/api/v1/content_blocks/#{video_block_id}",
            params: {
              s3_video_key: "content_videos/block_#{video_block_id}/20260831010200_async.mp4",
              s3_video_content_type: "video/mp4",
              s3_video_size: 456
            },
            headers: auth_headers,
            as: :json
    end

    assert_response :success
    assert_equal "content_videos/block_#{video_block_id}/20260831010200_async.mp4", ContentBlock.find(video_block_id).s3_video_key

    as_user(@instructor) do
      patch "/api/v1/lessons/#{created_lesson_id}/archive", headers: auth_headers
    end
    assert_response :success

    as_user(@instructor) do
      patch "/api/v1/lessons/#{created_lesson_id}/restore", headers: auth_headers
    end
    assert_response :success
  end

  test "instructor can read reusable curriculum resources but cannot permanently delete exercise content" do
    objective = LearningObjective.create!(
      curriculum: @curriculum,
      code: "SAFE.1",
      title: "Attach a safe upload",
      success_criteria: "I can attach the uploaded recording."
    )
    rubric = Rubric.new(curriculum: @curriculum, title: "Upload quality")
    rubric.rubric_criteria.build(title: "Attached video", description: "The exercise includes the intended video.", position: 0)
    rubric.save!

    as_user(@instructor) do
      get "/api/v1/learning_objectives", params: { curriculum_id: @curriculum.id }, headers: auth_headers
    end
    assert_response :success
    assert_equal objective.id, JSON.parse(response.body).dig("learning_objectives", 0, "id")

    as_user(@instructor) do
      get "/api/v1/rubrics", params: { curriculum_id: @curriculum.id }, headers: auth_headers
    end
    assert_response :success
    assert_equal rubric.id, JSON.parse(response.body).dig("rubrics", 0, "id")

    as_user(@instructor) do
      delete "/api/v1/content_blocks/#{@video_block.id}", headers: auth_headers
    end
    assert_response :forbidden
    assert ContentBlock.exists?(@video_block.id)

    as_user(@instructor) do
      delete "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end
    assert_response :forbidden
    assert Lesson.exists?(@lesson.id)
  end

  test "admin can create and align reusable objectives while students receive active success criteria" do
    objective_id = nil
    as_user(@admin) do
      post "/api/v1/learning_objectives",
           params: {
             learning_objective: {
               curriculum_id: @curriculum.id,
               code: " rb.1 ",
               title: "Explain variables",
               description: "Connect names to stored values.",
               success_criteria: "I can assign, read, and update a variable.",
               position: 1
             }
           },
           headers: auth_headers
      assert_response :created
      objective_id = JSON.parse(response.body).dig("learning_objective", "id")

      put "/api/v1/lessons/#{@lesson.id}/objective_alignments",
          params: { alignments: [ { learning_objective_id: objective_id, content_block_id: @video_block.id } ] },
          headers: auth_headers
      assert_response :success
    end

    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end
    assert_response :success
    objective = JSON.parse(response.body).dig("lesson", "objectives", 0)
    assert_equal "RB.1", objective.fetch("code")
    assert_equal "I can assign, read, and update a variable.", objective.fetch("success_criteria")
    assert_equal @video_block.id, objective.fetch("content_block_id")
  end

  test "objective alignment replacement rejects another curriculum and preserves existing alignments" do
    objective = LearningObjective.create!(
      curriculum: @curriculum,
      code: "BASE.1",
      title: "Use the terminal",
      success_criteria: "I can run a command and explain its output."
    )
    ObjectiveAlignment.create!(lesson: @lesson, learning_objective: objective)
    other_curriculum = Curriculum.create!(name: "Other")
    other_objective = LearningObjective.create!(
      curriculum: other_curriculum,
      code: "OTHER.1",
      title: "Unrelated",
      success_criteria: "I can complete the unrelated task."
    )

    as_user(@admin) do
      put "/api/v1/lessons/#{@lesson.id}/objective_alignments",
          params: { alignments: [ { learning_objective_id: other_objective.id } ] },
          headers: auth_headers
    end

    assert_response :unprocessable_entity
    assert_equal [ objective.id ], @lesson.reload.objective_alignments.pluck(:learning_objective_id)
  end

  test "admin creates and adds an objective to a lesson atomically" do
    as_user(@admin) do
      assert_difference([ "LearningObjective.count", "ObjectiveAlignment.count" ], 1) do
        post "/api/v1/learning_objectives",
             params: {
               lesson_id: @lesson.id,
               learning_objective: {
                 curriculum_id: @curriculum.id,
                 code: "TERM.1",
                 title: "Navigate folders",
                 success_criteria: "I can move between folders and verify my location."
               }
             },
             headers: auth_headers
      end
    end

    assert_response :created
    objective_id = JSON.parse(response.body).dig("learning_objective", "id")
    assert_equal [ objective_id ], @lesson.reload.objective_alignments.pluck(:learning_objective_id)
  end

  test "editor save rolls back lesson and block changes when an alignment is invalid" do
    other_curriculum = Curriculum.create!(name: "Other")
    other_objective = LearningObjective.create!(
      curriculum: other_curriculum,
      code: "OTHER.1",
      title: "Unrelated",
      success_criteria: "I can complete an unrelated task."
    )

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                title: "Changed title",
                requires_submission: false,
                video: { id: @video_block.id, title: "Changed video", video_url: "https://example.com/video" },
                alignments: [ { learning_objective_id: other_objective.id } ]
              }
            },
            headers: auth_headers
    end

    assert_response :unprocessable_entity
    assert_equal "Lesson 1", @lesson.reload.title
    assert_equal "Intro", @video_block.reload.title
    assert_nil @video_block.video_url
    assert_empty @lesson.objective_alignments
  end

  test "editor save commits lesson blocks and objectives together" do
    objective = LearningObjective.create!(
      curriculum: @curriculum,
      code: "TERM.2",
      title: "Create folders",
      success_criteria: "I can create a named folder."
    )

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                title: "Terminal practice",
                requires_submission: true,
                video: { id: @video_block.id, title: "Terminal practice", video_url: "https://example.com/video" },
                exercise: {
                  title: "Terminal practice",
                  body: "Create a folder.",
                  filename: "commands.txt",
                  submission_type: "text_submission",
                  submission_config: {}
                },
                alignments: [ { learning_objective_id: objective.id } ]
              }
            },
            headers: auth_headers
    end

    assert_response :success
    assert_equal "Terminal practice", @lesson.reload.title
    assert_equal "https://example.com/video", @video_block.reload.video_url
    assert_equal "Create a folder.", @lesson.content_blocks.find_by!(block_type: :exercise).body
    assert_equal [ objective.id ], @lesson.objective_alignments.pluck(:learning_objective_id)
  end

  test "editor save remains successful when post-commit S3 cleanup fails" do
    @video_block.update_columns(
      s3_video_key: "content_videos/block_#{@video_block.id}/20260831010245_failing.mp4"
    )
    replacement_key = "content_videos/#{SecureRandom.uuid}/replacement.mp4"
    with_failing_s3_delete do
      as_user(@admin) do
        patch "/api/v1/lessons/#{@lesson.id}/editor",
              params: {
                editor: {
                  title: "Saved despite cleanup",
                  requires_submission: false,
                  video: { id: @video_block.id, title: "Saved video", s3_video_key: replacement_key },
                  alignments: []
                }
              },
              headers: auth_headers
      end
    end

    assert_response :success
    assert_equal "Saved despite cleanup", @lesson.reload.title
    assert_equal replacement_key, @video_block.reload.s3_video_key
  end

  test "editor replacement deletes the unreferenced old video" do
    old_key = "content_videos/block_#{@video_block.id}/20260831010300_old.mp4"
    new_key = "content_videos/#{SecureRandom.uuid}/replacement.mp4"
    @video_block.update_columns(s3_video_key: old_key)
    deleted_keys = []

    with_s3_delete_capture(deleted_keys) do
      as_user(@admin) do
        patch "/api/v1/lessons/#{@lesson.id}/editor",
              params: {
                editor: {
                  title: "Replace editor video",
                  requires_submission: false,
                  video: { id: @video_block.id, title: "Replacement", s3_video_key: new_key },
                  alignments: []
                }
              },
              headers: auth_headers
      end
    end

    assert_response :success
    assert_equal new_key, @video_block.reload.s3_video_key
    assert_equal [ old_key ], deleted_keys
  end

  test "admin authors an objective-aligned retrieval check and students receive immediate evidence" do
    objective = LearningObjective.create!(
      curriculum: @curriculum,
      code: "TERM.3",
      title: "Identify the current folder",
      success_criteria: "I can choose the command that prints my current folder."
    )

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                title: @lesson.title,
                retrieval_check: {
                  enabled: true,
                  title: "Recall the command",
                  prompt: "Which command prints the current folder?",
                  options: [ "cd", "pwd", "mkdir" ],
                  correct_option: 1,
                  explanation: "pwd means print working directory.",
                  learning_objective_id: objective.id
                },
                alignments: []
              }
            },
            headers: auth_headers
    end
    assert_response :success
    check = @lesson.reload.content_blocks.find_by!(block_type: :checkpoint).knowledge_check

    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end
    assert_response :success
    student_check = JSON.parse(response.body).dig("lesson", "content_blocks").find { |block| block["knowledge_check"] }.fetch("knowledge_check")
    assert_equal [ "cd", "pwd", "mkdir" ], student_check.fetch("options")
    assert_nil student_check.fetch("latest_attempt")
    refute student_check.key?("correct_option")
    refute student_check.key?("explanation")

    as_user(@student) do
      post "/api/v1/knowledge_checks/#{check.id}/attempts", params: { selected_option: 0 }, headers: auth_headers
    end
    assert_response :created
    first_result = JSON.parse(response.body)
    assert_equal false, first_result.dig("knowledge_check", "latest_attempt", "correct")
    assert_equal 1, first_result.dig("knowledge_check", "latest_attempt", "correct_option")
    assert_equal "pwd means print working directory.", first_result.dig("knowledge_check", "latest_attempt", "explanation")
    assert_nil first_result.fetch("progress")

    as_user(@student) do
      post "/api/v1/knowledge_checks/#{check.id}/attempts", params: { selected_option: 1 }, headers: auth_headers
    end
    assert_response :created
    second_result = JSON.parse(response.body)
    assert_equal true, second_result.dig("knowledge_check", "latest_attempt", "correct")
    assert_equal 2, second_result.dig("knowledge_check", "attempt_count")
    assert_equal "completed", second_result.dig("progress", "status")
    assert @student.progresses.find_by!(content_block: check.content_block).completed?
  end

  test "student cannot bypass a retrieval check through generic progress" do
    block = @lesson.content_blocks.create!(block_type: :checkpoint, position: 2)
    check = KnowledgeCheck.create!(
      content_block: block,
      prompt: "Which command prints the current folder?",
      options: [ "cd", "pwd" ],
      correct_option: 1,
      explanation: "pwd is correct."
    )

    as_user(@student) do
      patch "/api/v1/progress", params: { content_block_id: block.id, status: "completed" }, headers: auth_headers
    end

    assert_response :unprocessable_entity
    assert_match "retrieval check", JSON.parse(response.body).fetch("error")
    assert_not Progress.exists?(user: @student, content_block: block, status: :completed)

    check.attempts.create!(user: @student, selected_option: check.correct_option, correct: true)
    as_user(@student) do
      patch "/api/v1/progress", params: { content_block_id: block.id, status: "completed" }, headers: auth_headers
    end

    assert_response :success
  end

  test "retrieval check rejects an objective from another curriculum atomically" do
    other_curriculum = Curriculum.create!(name: "Other")
    objective = LearningObjective.create!(
      curriculum: other_curriculum,
      code: "OTHER.CHECK",
      title: "Other objective",
      success_criteria: "I can answer an unrelated question."
    )

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                title: "Should roll back",
                retrieval_check: {
                  enabled: true,
                  prompt: "Question?",
                  options: [ "One", "Two" ],
                  correct_option: 0,
                  explanation: "One is correct.",
                  learning_objective_id: objective.id
                },
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :unprocessable_entity
    assert_equal "Lesson 1", @lesson.reload.title
    assert_nil @lesson.content_blocks.find_by(block_type: :checkpoint)
  end

  test "lesson deletion cannot report success while retrieval evidence exists" do
    block = @lesson.content_blocks.create!(block_type: :checkpoint, position: 2)
    check = KnowledgeCheck.create!(content_block: block, prompt: "Which one?", options: [ "One", "Two" ], correct_option: 0, explanation: "One is correct.")
    check.attempts.create!(user: @student, selected_option: 0, correct: true)

    as_user(@admin) do
      delete "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end

    assert_response :unprocessable_entity
    assert Lesson.exists?(@lesson.id)
    assert KnowledgeCheckAttempt.exists?(knowledge_check: check, user: @student)
  end

  test "admin archives and restores a lesson without deleting content or student evidence" do
    Progress.create!(user: @student, content_block: @video_block, status: :in_progress)

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/archive", headers: auth_headers
    end

    assert_response :success
    assert JSON.parse(response.body).dig("lesson", "archived_at").present?
    assert Lesson.exists?(@lesson.id)
    assert ContentBlock.exists?(@video_block.id)
    assert Progress.exists?(user: @student, content_block: @video_block)

    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end
    assert_response :forbidden

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/restore", headers: auth_headers
    end

    assert_response :success
    assert_nil JSON.parse(response.body).dig("lesson", "archived_at")
    refute @lesson.reload.archived?
  end

  test "student video stream response includes explicit signed URL expiry" do
    expires_in = with_s3_stream_url("https://signed.example/lesson.mp4") do
      as_user(@student) do
        get "/api/v1/content_blocks/#{@video_block.id}/video_stream", headers: auth_headers
      end
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "https://signed.example/lesson.mp4", body.fetch("stream_url")
    assert_equal S3Service::VIDEO_STREAM_EXPIRY, expires_in
    assert_in_delta S3Service::VIDEO_STREAM_EXPIRY.seconds.from_now.to_i, Time.iso8601(body.fetch("expires_at")).to_i, 2
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = {
      "sub" => user.clerk_id,
      "email" => user.email,
      "first_name" => user.first_name,
      "last_name" => user.last_name
    }

    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end

  def with_s3_stream_url(url)
    original_configured = S3Service.method(:configured?)
    original_url = S3Service.method(:generate_presigned_url)
    captured_expiry = nil

    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:generate_presigned_url) do |_key, expires_in:|
      captured_expiry = expires_in
      url
    end
    yield
    captured_expiry
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
    S3Service.define_singleton_method(:generate_presigned_url, original_url)
  end

  def with_failing_s3_delete
    original_configured = S3Service.method(:configured?)
    original_delete = S3Service.method(:delete_object)
    original_exists = S3Service.method(:object_exists?)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:delete_object) { |_key| raise IOError, "network unavailable" }
    S3Service.define_singleton_method(:object_exists?) { |_key| true }
    yield
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
    S3Service.define_singleton_method(:delete_object, original_delete)
    S3Service.define_singleton_method(:object_exists?, original_exists)
  end

  def with_s3_delete_capture(deleted_keys)
    original_configured = S3Service.method(:configured?)
    original_delete = S3Service.method(:delete_object)
    original_exists = S3Service.method(:object_exists?)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:delete_object) { |key| deleted_keys << key; true }
    S3Service.define_singleton_method(:object_exists?) { |_key| true }
    yield
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
    S3Service.define_singleton_method(:delete_object, original_delete)
    S3Service.define_singleton_method(:object_exists?, original_exists)
  end
end
