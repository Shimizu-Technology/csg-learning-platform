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
    assert_equal @lesson.reload.updated_at.iso8601(6), JSON.parse(response.body).dig("lesson", "updated_at")
  end

  test "staff video preview streams without returning or writing progress" do
    Progress.create!(user: @admin, content_block: @video_block, status: :in_progress, video_last_position: 12)

    with_s3_stream_url("https://signed.example/lesson.mp4") do
      as_user(@admin) do
        get "/api/v1/content_blocks/#{@video_block.id}/video_stream", headers: auth_headers
      end
    end

    assert_response :success
    assert_nil JSON.parse(response.body)["video_progress"]

    as_user(@admin) do
      patch "/api/v1/content_blocks/#{@video_block.id}/video_progress",
            params: { last_position_seconds: 20, total_watched_seconds: 20, duration_seconds: 100 },
            headers: auth_headers,
            as: :json
    end

    assert_response :forbidden
    assert_equal 12, Progress.find_by!(user: @admin, content_block: @video_block).video_last_position
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
      patch "/api/v1/lessons/#{created_lesson_id}/archive",
            params: { base_updated_at: Lesson.find(created_lesson_id).updated_at.iso8601(6) },
            headers: auth_headers,
            as: :json
    end
    assert_response :success

    as_user(@instructor) do
      patch "/api/v1/lessons/#{created_lesson_id}/restore",
            params: { base_updated_at: Lesson.find(created_lesson_id).updated_at.iso8601(6) },
            headers: auth_headers,
            as: :json
    end
    assert_response :success
  end

  test "staff can create optional exercises without changing the required default" do
    optional_lesson = nil
    default_lesson = nil

    as_user(@instructor) do
      post "/api/v1/modules/#{@curriculum_module.id}/exercises",
           params: {
             title: "Optional association review",
             release_day: 2,
             instructions: "Review the association recording.",
             submission_type: "manual_complete",
             required: false
           },
           headers: auth_headers,
           as: :json
      assert_response :created
      optional_lesson = Lesson.find(JSON.parse(response.body).dig("lesson", "id"))

      post "/api/v1/modules/#{@curriculum_module.id}/exercises",
           params: {
             title: "Required serializer work",
             release_day: 3,
             instructions: "Add serializers.",
             submission_type: "repo_url_submission"
           },
           headers: auth_headers,
           as: :json
      assert_response :created
      default_lesson = Lesson.find(JSON.parse(response.body).dig("lesson", "id"))
    end

    assert_equal false, optional_lesson.required
    assert_equal true, default_lesson.required
  end

  test "staff can change whether an exercise is required through the editor" do
    assert_equal true, @lesson.required

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
                title: @lesson.title,
                required: false,
                requires_submission: false,
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :success
    assert_equal false, @lesson.reload.required
    assert_equal false, JSON.parse(response.body).dig("lesson", "required")
  end

  test "staff can author exact recording sections without replacing other metadata" do
    @video_block.update!(metadata: { "archive_role" => "current" })

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
                title: @lesson.title,
                required: true,
                requires_submission: false,
                video: {
                  id: @video_block.id,
                  title: @video_block.title,
                  video_url: nil,
                  video_segments: [
                    { label: "Optional Q&A", start_seconds: 120, end_seconds: 180, required: false },
                    { label: "Schema planning", start_seconds: 12, end_seconds: 95, required: true }
                  ]
                },
                alignments: []
              }
            },
            headers: auth_headers,
            as: :json
    end

    assert_response :success
    metadata = @video_block.reload.metadata
    assert_equal "current", metadata.fetch("archive_role")
    assert_equal 1, metadata.fetch("video_segments_version")
    assert_equal [ "Schema planning", "Optional Q&A" ], metadata.fetch("video_segments").pluck("label")
  end

  test "editor rejects a recording section that ends before it starts" do
    original_metadata = @video_block.metadata

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
                title: @lesson.title,
                required: true,
                requires_submission: false,
                video: {
                  id: @video_block.id,
                  title: @video_block.title,
                  video_url: nil,
                  video_segments: [ { label: "Broken", start_seconds: 20, end_seconds: 10, required: true } ]
                },
                alignments: []
              }
            },
            headers: auth_headers,
            as: :json
    end

    assert_response :unprocessable_entity
    assert_equal original_metadata, @video_block.reload.metadata
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
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
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
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
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

  test "editor rejects a stale lesson version without overwriting newer work" do
    stale_version = @lesson.updated_at.iso8601(6)
    @lesson.update!(title: "Newer editor title")

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: stale_version,
                title: "Stale editor title",
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :conflict
    assert_equal "stale_editor", JSON.parse(response.body).fetch("code")
    assert_equal "Newer editor title", @lesson.reload.title
  end

  test "content-only editor saves advance the version used by other open editors" do
    shared_version = @lesson.updated_at.iso8601(6)

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: shared_version,
                title: @lesson.title,
                video: { id: @video_block.id, title: "Updated video title" },
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :success
    assert_equal "Updated video title", @video_block.reload.title
    refute_equal shared_version, JSON.parse(response.body).dig("lesson", "updated_at")

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: shared_version,
                title: "Overwritten from stale editor",
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :conflict
    assert_equal "Lesson 1", @lesson.reload.title
  end

  test "editor requires a lesson version" do
    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: { editor: { title: "Unversioned edit", alignments: [] } },
            headers: auth_headers
    end

    assert_response :conflict
    assert_equal "Lesson changed after this editor was opened. Reload the latest version before saving.", JSON.parse(response.body).fetch("error")
    assert_equal "Lesson 1", @lesson.reload.title
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
                  base_updated_at: @lesson.reload.updated_at.iso8601(6),
                  title: "Saved despite cleanup",
                  requires_submission: false,
                  video: {
                    id: @video_block.id,
                    title: "Saved video",
                    s3_video_key: replacement_key,
                    s3_video_content_type: "video/mp4",
                    s3_video_size: 1.megabyte
                  },
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
                  base_updated_at: @lesson.reload.updated_at.iso8601(6),
                  title: "Replace editor video",
                  requires_submission: false,
                  video: {
                    id: @video_block.id,
                    title: "Replacement",
                    s3_video_key: new_key,
                    s3_video_content_type: "video/quicktime",
                    s3_video_size: 12.megabytes
                  },
                  alignments: []
                }
              },
              headers: auth_headers
      end
    end

    assert_response :success
    @video_block.reload
    assert_equal new_key, @video_block.s3_video_key
    assert_equal "video/quicktime", @video_block.s3_video_content_type
    assert_equal 12.megabytes, @video_block.s3_video_size
    assert_equal [ old_key ], deleted_keys
  end

  test "editor rejects invalid hosted video metadata without changing the lesson" do
    original_updated_at = @lesson.updated_at

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: @lesson.updated_at.iso8601(6),
                title: "Unsafe upload",
                video: {
                  id: @video_block.id,
                  title: "Unsafe upload",
                  s3_video_key: "content_videos/#{SecureRandom.uuid}/payload.mp4",
                  s3_video_content_type: "text/html",
                  s3_video_size: 123
                },
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :unprocessable_entity
    assert_equal "content_type must be a video/* MIME type", JSON.parse(response.body).fetch("error")
    assert_equal "Lesson 1", @lesson.reload.title
    assert_equal original_updated_at, @lesson.updated_at
  end

  test "editor rejects a hosted video key without its exact metadata" do
    old_key = "content_videos/block_#{@video_block.id}/20260831010330_old.mp4"
    new_key = "content_videos/#{SecureRandom.uuid}/missing-metadata.mp4"
    @video_block.update_columns(s3_video_key: old_key, s3_video_content_type: "video/mp4", s3_video_size: 456)
    original_updated_at = @lesson.updated_at

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: @lesson.updated_at.iso8601(6),
                title: "Incomplete upload",
                video: { id: @video_block.id, title: "Incomplete upload", s3_video_key: new_key },
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :unprocessable_entity
    assert_equal "Hosted video uploads require s3_video_content_type and s3_video_size", JSON.parse(response.body).fetch("error")
    assert_equal "Lesson 1", @lesson.reload.title
    assert_equal old_key, @video_block.reload.s3_video_key
    assert_equal "video/mp4", @video_block.s3_video_content_type
    assert_equal 456, @video_block.s3_video_size
    assert_equal original_updated_at, @lesson.updated_at
  end

  test "editor allows unrelated changes when an unchanged legacy video has no metadata" do
    legacy_key = "content_videos/block_#{@video_block.id}/20260831010340_legacy.mp4"
    @video_block.update_columns(s3_video_key: legacy_key, s3_video_content_type: nil, s3_video_size: nil)

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
                title: "Legacy lesson updated",
                video: { id: @video_block.id, title: "Legacy video", s3_video_key: legacy_key, s3_video_content_type: "video/webm", s3_video_size: 999 },
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :success
    assert_equal "Legacy lesson updated", @lesson.reload.title
    assert_equal legacy_key, @video_block.reload.s3_video_key
    assert_nil @video_block.s3_video_content_type
    assert_nil @video_block.s3_video_size
  end

  test "editor clears hosted video metadata when removing its key" do
    old_key = "content_videos/block_#{@video_block.id}/20260831010345_removed.mp4"
    @video_block.update_columns(s3_video_key: old_key, s3_video_content_type: "video/mp4", s3_video_size: 789)
    deleted_keys = []

    with_s3_delete_capture(deleted_keys) do
      as_user(@admin) do
        patch "/api/v1/lessons/#{@lesson.id}/editor",
              params: {
                editor: {
                  base_updated_at: @lesson.reload.updated_at.iso8601(6),
                  title: @lesson.title,
                  video: { id: @video_block.id, title: @video_block.title, s3_video_key: nil },
                  alignments: []
                }
              },
              headers: auth_headers
      end
    end

    assert_response :success
    @video_block.reload
    assert_nil @video_block.s3_video_key
    assert_nil @video_block.s3_video_content_type
    assert_nil @video_block.s3_video_size
    assert_equal [ old_key ], deleted_keys
  end

  test "editor rejects hosted videos larger than the upload limit" do
    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: @lesson.updated_at.iso8601(6),
                title: @lesson.title,
                video: {
                  id: @video_block.id,
                  title: "Oversized upload",
                  s3_video_key: "content_videos/#{SecureRandom.uuid}/large.mp4",
                  s3_video_content_type: "video/mp4",
                  s3_video_size: 6.gigabytes
                },
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :unprocessable_entity
    assert_equal "s3_video_size must be between 1 byte and 5 GB", JSON.parse(response.body).fetch("error")
    assert_equal "Lesson 1", @lesson.reload.title
  end

  test "editor rejects non-numeric and zero hosted video sizes without changing state" do
    [ [ "invalid", "s3_video_size must be a whole number" ], [ 0, "s3_video_size must be between 1 byte and 5 GB" ] ].each do |size, expected_error|
      original_updated_at = @lesson.reload.updated_at
      original_video = @video_block.reload.attributes.slice("s3_video_key", "s3_video_content_type", "s3_video_size")

      as_user(@admin) do
        patch "/api/v1/lessons/#{@lesson.id}/editor",
              params: {
                editor: {
                  base_updated_at: original_updated_at.iso8601(6),
                  title: "Invalid video size",
                  video: {
                    id: @video_block.id,
                    title: "Invalid video size",
                    s3_video_key: "content_videos/#{SecureRandom.uuid}/invalid.mp4",
                    s3_video_content_type: "video/mp4",
                    s3_video_size: size
                  },
                  alignments: []
                }
              },
              headers: auth_headers
      end

      assert_response :unprocessable_entity
      assert_equal expected_error, JSON.parse(response.body).fetch("error")
      assert_equal "Lesson 1", @lesson.reload.title
      assert_equal original_updated_at, @lesson.updated_at
      assert_equal original_video, @video_block.reload.attributes.slice("s3_video_key", "s3_video_content_type", "s3_video_size")
    end
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
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
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

  test "editor creates a retrieval check without repurposing a narrative checkpoint" do
    narrative = @lesson.content_blocks.create!(
      block_type: :checkpoint,
      position: 2,
      title: "Pause and reflect",
      body: "Write down one question before continuing."
    )

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
                title: @lesson.title,
                retrieval_check: {
                  enabled: true,
                  title: "Recall the command",
                  prompt: "Which command prints the current folder?",
                  options: [ "cd", "pwd" ],
                  correct_option: 1,
                  explanation: "pwd means print working directory."
                },
                alignments: []
              }
            },
            headers: auth_headers
    end

    assert_response :success
    assert_equal "Pause and reflect", narrative.reload.title
    assert_equal "Write down one question before continuing.", narrative.body
    assert_nil narrative.knowledge_check

    check_blocks = @lesson.reload.content_blocks.select { |block| block.knowledge_check.present? }
    assert_equal 1, check_blocks.length
    assert_not_equal narrative.id, check_blocks.first.id
  end

  test "disabling a retrieval check keeps its objective aligned at lesson level" do
    objective = LearningObjective.create!(
      curriculum: @curriculum,
      code: "TERM.4",
      title: "Recall a terminal command",
      success_criteria: "I can select the command that prints my current folder."
    )
    block = @lesson.content_blocks.create!(block_type: :checkpoint, position: 2, title: "Recall the command")
    block.create_knowledge_check!(prompt: "Which command?", options: [ "cd", "pwd" ], correct_option: 1, explanation: "pwd is correct.", learning_objective: objective)
    @lesson.objective_alignments.create!(learning_objective: objective, content_block: block, position: 0)

    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor",
            params: {
              editor: {
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
                title: @lesson.title,
                retrieval_check: { enabled: false, content_block_id: block.id },
                alignments: [ { learning_objective_id: objective.id, content_block_id: block.id } ]
              }
            },
            headers: auth_headers
    end

    assert_response :success
    assert_not ContentBlock.exists?(block.id)
    alignment = @lesson.reload.objective_alignments.find_by!(learning_objective: objective)
    assert_nil alignment.content_block_id
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
                base_updated_at: @lesson.reload.updated_at.iso8601(6),
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
      patch "/api/v1/lessons/#{@lesson.id}/archive",
            params: { base_updated_at: @lesson.reload.updated_at.iso8601(6) },
            headers: auth_headers,
            as: :json
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
      patch "/api/v1/lessons/#{@lesson.id}/restore",
            params: { base_updated_at: @lesson.reload.updated_at.iso8601(6) },
            headers: auth_headers,
            as: :json
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
