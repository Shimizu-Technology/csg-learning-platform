require "test_helper"

class LessonBlockEditorTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Synthetic Web Lab")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "JavaScript basics", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Make decisions", position: 0, release_day: 0)
    @text = @lesson.content_blocks.create!(block_type: :text, position: 0, title: "Why decisions matter", body: "## Why\nUse `if`.")
    @video = @lesson.content_blocks.create!(block_type: :video, position: 1, title: "Walkthrough", video_url: "https://example.invalid/walkthrough")
    @exercise = @lesson.content_blocks.create!(block_type: :exercise, position: 2, title: "Ticket prices", body: "Write `ticketPrice(age)`.",
                                               filename: "tickets.js", submission_type: :text_submission)
    @checkpoint = @lesson.content_blocks.create!(block_type: :checkpoint, position: 3, title: "Quick check")
    @check = @checkpoint.create_knowledge_check!(prompt: "What does else run?", options: [ "Everything else", "Nothing" ], correct_option: 0,
                                                 explanation: "else catches every other case.")

    @admin = user(:admin, "admin")
    @other_admin = user(:admin, "admin-two")
    @instructor = user(:instructor, "instructor")
    @student = user(:student, "student")
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
  end

  test "admin reads every block in order with editor context" do
    get_editor(@admin)

    assert_response :success
    body = response.parsed_body
    assert_equal [ @text.id, @video.id, @exercise.id, @checkpoint.id ], body.dig("lesson", "content_blocks").map { |block| block["id"] }
    assert_equal "Synthetic Web Lab", body.dig("context", "curriculum", "name")
    assert_equal "JavaScript basics", body.dig("context", "module", "name")
    assert_includes body.dig("context", "module", "release_days").map { |day| [ day["week"], day["day_name"] ] }, [ 1, "Monday" ]
    assert_equal [ "Cohort 3" ], body.dig("context", "used_in").map { |cohort| cohort["name"] }
    assert_equal 4, body["block_activity"].length
  end

  test "instructors and students can't open or save the block editor" do
    [ @instructor, @student ].each do |person|
      get_editor(person)
      assert_response :forbidden
      put_editor(person, payload)
      assert_response :forbidden
    end
    assert_equal "Make decisions", @lesson.reload.title
  end

  test "saves every block type, reorders in place and keeps block identity" do
    Progress.create!(user: @student, enrollment: @enrollment, content_block: @exercise, status: :completed)
    blocks = payload[:blocks].reverse
    blocks << { client_id: "new-code", block_type: "code_challenge", title: "Stretch", body: "Handle seniors.", submission_type: "manual_complete" }
    blocks << { client_id: "new-recording", block_type: "recording", title: "Class recording", video_url: "https://example.invalid/class" }

    put_editor(@admin, payload(title: "Make decisions with JavaScript", blocks: blocks))

    assert_response :success
    ids = response.parsed_body.dig("lesson", "content_blocks").map { |block| block["id"] }
    assert_equal [ @checkpoint.id, @exercise.id, @video.id, @text.id ], ids.first(4)
    assert_equal %w[checkpoint exercise video text code_challenge recording], @lesson.reload.content_blocks.map(&:block_type)
    assert_equal (0..5).to_a, @lesson.content_blocks.map(&:position)
    assert_equal "Make decisions with JavaScript", @lesson.title
    assert_equal 1, @exercise.progresses.count, "reordering keeps the same row, so progress stays attached"
  end

  test "duplicated blocks copy content, metadata and the retrieval check as new rows" do
    duplicate = block_payload(@checkpoint).except(:id).merge(client_id: "copy-1", metadata: { "language" => "javascript" })
    put_editor(@admin, payload(blocks: payload[:blocks] + [ duplicate ]))

    assert_response :success
    copy = @lesson.reload.content_blocks.last
    refute_equal @checkpoint.id, copy.id
    assert_equal "What does else run?", copy.knowledge_check.prompt
    refute_equal @check.id, copy.knowledge_check.id
    assert_equal "javascript", copy.metadata["language"]
  end

  test "objective alignments can point at blocks created in the same save" do
    objective = LearningObjective.create!(curriculum: @curriculum, code: "JS.1", title: "Choose a path", success_criteria: "I can pick a branch.")
    blocks = payload[:blocks] + [ { client_id: "new-text", block_type: "text", body: "More" } ]
    put_editor(@admin, payload(blocks: blocks, alignments: [ { learning_objective_id: objective.id, block_client_id: "new-text" } ]))

    assert_response :success
    assert_equal @lesson.reload.content_blocks.last.id, @lesson.objective_alignments.first.content_block_id
  end

  test "a failing block rolls back the whole save" do
    blocks = payload[:blocks]
    blocks[0] = blocks[0].merge(title: "Changed first")
    blocks[3] = blocks[3].merge(knowledge_check: { prompt: "", options: [ "only one" ], correct_option: 0, explanation: "" })

    put_editor(@admin, payload(title: "Should not save", blocks: blocks.reverse))

    assert_response :unprocessable_entity
    assert_equal "Make decisions", @lesson.reload.title
    assert_equal "Why decisions matter", @text.reload.title
    assert_equal [ @text.id, @video.id, @exercise.id, @checkpoint.id ], @lesson.content_blocks.map(&:id)
  end

  test "every existing block must be listed or explicitly removed" do
    put_editor(@admin, payload(blocks: payload[:blocks].first(3)))

    assert_response :unprocessable_entity
    assert_equal "blocks_mismatch", response.parsed_body["code"]
    assert_equal 4, @lesson.reload.content_blocks.count
  end

  test "removes blocks without learner work" do
    put_editor(@admin, payload(blocks: payload[:blocks].first(3), removed_block_ids: [ @checkpoint.id ]))

    assert_response :success
    assert_not ContentBlock.exists?(@checkpoint.id)
  end

  test "never deletes a block that holds learner work" do
    submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, text: "function ticketPrice() {}")
    Progress.create!(user: @student, enrollment: @enrollment, content_block: @video, status: :in_progress, video_total_watched: 40)
    KnowledgeCheckAttempt.create!(user: @student, enrollment: @enrollment, knowledge_check: @check, selected_option: 0, correct: true)

    [ @exercise, @video, @checkpoint ].each do |block|
      put_editor(@admin, payload(blocks: payload[:blocks].reject { |item| item[:id] == block.id }, removed_block_ids: [ block.id ]))

      assert_response :unprocessable_entity
      assert_equal "learner_data", response.parsed_body["code"]
      assert ContentBlock.exists?(block.id)
    end
    assert Submission.exists?(submission.id)

    get_editor(@admin)
    activity = response.parsed_body["block_activity"].index_by { |row| row["content_block_id"] }
    assert_equal 1, activity[@exercise.id]["submissions"]
    assert_equal 1, activity[@video.id]["watched"]
    assert_equal 1, activity[@checkpoint.id]["check_attempts"]
  end

  test "a block with learner work keeps its type and its retrieval check" do
    Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, text: "answer")
    KnowledgeCheckAttempt.create!(user: @student, enrollment: @enrollment, knowledge_check: @check, selected_option: 1, correct: false)

    blocks = payload[:blocks]
    blocks[2] = blocks[2].merge(block_type: "text")
    put_editor(@admin, payload(blocks: blocks))
    assert_response :unprocessable_entity
    assert_equal "learner_data", response.parsed_body["code"]
    assert @exercise.reload.exercise?

    blocks = payload[:blocks]
    blocks[3] = blocks[3].merge(knowledge_check: nil)
    put_editor(@admin, payload(blocks: blocks))
    assert_response :unprocessable_entity
    assert KnowledgeCheck.exists?(@check.id)
  end

  test "lesson and module deletes refuse blocks with learner work" do
    Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, text: "answer")

    assert_raises(ActiveRecord::RecordNotDestroyed) { Lesson.find(@lesson.id).destroy! }
    assert_raises(ActiveRecord::RecordNotDestroyed) { CurriculumModule.find(@module.id).destroy! }
    assert Lesson.exists?(@lesson.id)
    assert ContentBlock.exists?(@exercise.id)
    assert_equal 1, @exercise.submissions.count

    untouched = Progress.create!(user: @student, enrollment: @enrollment, content_block: @text, status: :not_started)
    ContentBlock.find(@text.id).destroy!
    assert_not Progress.exists?(untouched.id), "a progress row with no work can go with its block"
  end

  test "replacing a hosted video with watch time needs an explicit confirmation" do
    @video.update!(video_url: nil, s3_video_key: "content_videos/11111111-1111-4111-8111-111111111111/old.mp4", s3_video_content_type: "video/mp4", s3_video_size: 10)
    progress = Progress.create!(user: @student, enrollment: @enrollment, content_block: @video, status: :completed, video_total_watched: 300, video_duration: 300)
    blocks = payload[:blocks]
    blocks[1] = blocks[1].merge(s3_video_key: "content_videos/22222222-2222-4222-8222-222222222222/new.mp4", s3_video_content_type: "video/mp4", s3_video_size: 20)

    put_editor(@admin, payload(blocks: blocks))
    assert_response :unprocessable_entity
    assert_equal "confirm_watch_reset", response.parsed_body["code"]
    assert_equal 300, progress.reload.video_total_watched

    put_editor(@admin, payload(blocks: blocks, confirm_watch_reset_block_ids: [ @video.id ]))
    assert_response :success
    assert_equal "content_videos/22222222-2222-4222-8222-222222222222/new.mp4", @video.reload.s3_video_key
    assert_equal 0, progress.reload.video_total_watched
    assert Progress.exists?(progress.id), "the reset keeps the progress row"
  end

  test "a second admin saving from a stale version gets a conflict and changes nothing" do
    base = @lesson.updated_at.iso8601(6)
    put_editor(@admin, payload(title: "First admin", base: base))
    assert_response :success

    put_editor(@other_admin, payload(title: "Second admin", base: base))
    assert_response :conflict
    assert_equal "stale_editor", response.parsed_body["code"]
    assert_match(/Someone else saved this lesson/, response.parsed_body["error"])
    assert_equal "First admin", @lesson.reload.title
  end

  test "a missing version is treated as stale" do
    put_editor(@admin, payload.merge(base_updated_at: nil))
    assert_response :conflict
  end

  test "limits a lesson to twenty blocks" do
    extra = (1..17).map { |index| { client_id: "extra-#{index}", block_type: "text", body: "Extra #{index}" } }
    put_editor(@admin, payload(blocks: payload[:blocks] + extra))
    assert_response :unprocessable_entity
    assert_match(/between 1 and 20 blocks/, response.parsed_body["error"])
    assert_equal 4, @lesson.reload.content_blocks.count
  end

  test "schedule changes must match the module's days" do
    put_editor(@admin, payload(release_day: 5))
    assert_response :unprocessable_entity

    put_editor(@admin, payload(release_day: 8))
    assert_response :success
    assert_equal 8, @lesson.reload.release_day
  end

  test "blocks from another lesson can't be saved into this one" do
    other = Lesson.create!(curriculum_module: @module, title: "Other", position: 1, release_day: 0)
    foreign = other.content_blocks.create!(block_type: :text, position: 0, body: "Not yours")
    put_editor(@admin, payload(blocks: payload[:blocks] + [ { id: foreign.id, block_type: "text", body: "Taken" } ]))

    assert_response :not_found
    assert_equal "Not yours", foreign.reload.body
  end

  test "the mobile editor endpoint keeps its payload" do
    as_user(@admin) do
      patch "/api/v1/lessons/#{@lesson.id}/editor", params: { editor: { base_updated_at: @lesson.updated_at.iso8601(6), title: "From mobile",
                                                                          exercise: { id: @exercise.id, body: "Mobile body" } } }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "Mobile body", @exercise.reload.body
  end

  private

  def user(role, slug)
    User.create!(clerk_id: "clerk_block_editor_#{slug}", email: "#{slug}-block-editor@example.invalid", first_name: slug.titleize, last_name: "Tester", role: role)
  end

  def block_payload(block)
    {
      id: block.id, block_type: block.block_type, title: block.title, body: block.body, filename: block.filename,
      video_url: block.video_url, submission_type: block.submission_type,
      knowledge_check: block.knowledge_check && {
        prompt: block.knowledge_check.prompt, options: block.knowledge_check.options,
        correct_option: block.knowledge_check.correct_option, explanation: block.knowledge_check.explanation
      }
    }
  end

  def payload(title: "Make decisions", blocks: nil, base: nil, **extra)
    {
      base_updated_at: base || @lesson.reload.updated_at.iso8601(6),
      title: title,
      required: true,
      blocks: blocks || @lesson.content_blocks.reload.map { |block| block_payload(block) }
    }.merge(extra)
  end

  def get_editor(person)
    as_user(person) { get "/api/v1/lessons/#{@lesson.id}/block_editor", headers: auth_headers }
  end

  def put_editor(person, body)
    as_user(person) { put "/api/v1/lessons/#{@lesson.id}/block_editor", params: { lesson: body }, headers: auth_headers, as: :json }
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(person)
    payload = { "sub" => person.clerk_id, "email" => person.email, "first_name" => person.first_name, "last_name" => person.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
