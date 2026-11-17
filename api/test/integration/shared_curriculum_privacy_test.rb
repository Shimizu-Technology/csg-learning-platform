require "test_helper"

# L-3.2 privacy rule on every lesson-editing payload: an instructor with editing
# access to Cohort A, which shares its curriculum with Cohort B, sees A by name
# and in counts, and B only as a number. The copy-before-edit warning (#276)
# still says the curriculum is shared, without naming B. Admins see both.
class SharedCurriculumPrivacyTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Shared synthetic lab", status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "JavaScript basics", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Make decisions", position: 0, release_day: 0)
    @exercise = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Ticket prices", submission_type: :text_submission)
    @checkpoint = @lesson.content_blocks.create!(block_type: :checkpoint, position: 1, title: "Quick check")
    @check = @checkpoint.create_knowledge_check!(prompt: "What does else run?", options: [ "Everything else", "Nothing" ], correct_option: 0, explanation: "Synthetic.")
    @a = Cohort.create!(curriculum: @curriculum, name: "Cohort Alder", start_date: Date.current, status: :active)
    @b = Cohort.create!(curriculum: @curriculum, name: "Cohort Birch", start_date: Date.current, status: :active)
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @a.cohort_instructor_assignments.create!(user: @instructor).set_lesson_editing!(true, by: @admin)
    [ [ @a, "alder" ], [ @b, "birch" ] ].each do |cohort, slug|
      learner = person(slug, :student)
      enrollment = Enrollment.create!(user: learner, cohort: cohort, status: :active)
      Submission.create!(user: learner, enrollment: enrollment, content_block: @exercise, submission_type: :text_submission, text: "Synthetic #{slug}")
      Progress.create!(user: learner, enrollment: enrollment, content_block: @exercise, status: :completed, completed_at: Time.current)
      KnowledgeCheckAttempt.create!(knowledge_check: @check, user: learner, enrollment: enrollment, selected_option: 0, correct: true)
    end
  end

  test "the block editor names only the instructor's cohort and counts only its work" do
    body = get_json(@instructor, "/api/v1/lessons/#{@lesson.id}/block_editor")
    access = body["access"]
    assert_equal [ "shared", false ], access.values_at("reason", "can_edit")
    assert_equal [], access["shared_with"]
    assert_equal 1, access["shared_with_others_count"]
    assert_includes access["message"], "1 other cohort", "The copy-before-edit warning still says the curriculum is shared"
    assert_equal [ "Cohort Alder" ], access["copy_cohorts"].map { |cohort| cohort["name"] }
    activity = body["block_activity"].index_by { |row| row["content_block_id"] }
    assert_equal [ 1, 1 ], activity[@exercise.id].values_at("submissions", "progress"), "Only Cohort Alder's work, not Birch's"
    assert_equal 1, activity[@checkpoint.id]["check_attempts"]
    assert_equal 1, body["lesson"]["content_blocks"].find { |block| block["id"] == @checkpoint.id }.dig("knowledge_check", "attempt_count")
    assert_equal [ "Cohort Alder" ], body.dig("context", "used_in").map { |cohort| cohort["name"] }
    assert_equal 1, body.dig("context", "submissions_count")
    refute_includes response.body, "Cohort Birch"
    refute_includes response.body, "Birch"

    admin = get_json(@admin, "/api/v1/lessons/#{@lesson.id}/block_editor")
    assert_equal 2, admin["block_activity"].find { |row| row["content_block_id"] == @exercise.id }["submissions"]
    assert_equal 2, admin["lesson"]["content_blocks"].find { |block| block["id"] == @checkpoint.id }.dig("knowledge_check", "attempt_count")
  end

  test "a refused save, the copy preview and other lesson payloads never name Cohort Birch" do
    as_user(@instructor) { put "/api/v1/lessons/#{@lesson.id}/block_editor", params: { lesson: { title: "Changed" } }, headers: auth_headers, as: :json }
    assert_response :forbidden
    assert_includes response.parsed_body["error"], "1 other cohort"
    refute_includes response.body, "Birch"

    preview = get_json(@instructor, "/api/v1/cohorts/#{@a.id}/curriculum_copy?source_curriculum_id=#{@curriculum.id}")["curriculum_copy_preview"]
    assert_equal [ [], 1 ], preview.values_at("shared_with", "shared_with_others_count")
    refute_includes response.body, "Birch"

    curriculum = get_json(@instructor, "/api/v1/curricula/#{@curriculum.id}")["curriculum"]
    assert_equal [ [], 1 ], curriculum["editing"].values_at("shared_with", "shared_with_others_count")
    assert_equal 1, curriculum["modules"].first["submissions_count"]
    refute_includes response.body, "Birch"

    assert_equal 1, get_json(@instructor, "/api/v1/modules/#{@module.id}")["module"]["submissions_count"]
    lesson = get_json(@instructor, "/api/v1/lessons/#{@lesson.id}")["lesson"]
    assert_equal 1, lesson["content_blocks"].find { |block| block["id"] == @checkpoint.id }.dig("knowledge_check", "attempt_count")

    admin = get_json(@admin, "/api/v1/cohorts/#{@a.id}/curriculum_copy?source_curriculum_id=#{@curriculum.id}")["curriculum_copy_preview"]
    assert_equal [ [ "Cohort Birch" ], 0 ], [ admin["shared_with"].map { |cohort| cohort["name"] }, admin["shared_with_others_count"] ]
    assert_equal 2, get_json(@admin, "/api/v1/curricula/#{@curriculum.id}")["curriculum"]["modules"].first["submissions_count"]
  end

  test "an instructor who also teaches Birch, without editing it, sees it named" do
    @b.cohort_instructor_assignments.create!(user: @instructor)
    access = get_json(@instructor, "/api/v1/lessons/#{@lesson.id}/block_editor")["access"]
    assert_equal [ [ "Cohort Birch" ], 0 ], [ access["shared_with"].map { |cohort| cohort["name"] }, access["shared_with_others_count"] ]
    assert_includes access["message"], "Cohort Birch"
  end

  test "a copy's cohort stays unnamed for an instructor who doesn't teach it" do
    copy = Curriculum.create!(name: "Birch copy", status: :active)
    CurriculumCopy.create!(cohort: @b, source_curriculum: @curriculum, copy_curriculum: copy, created_by: @admin)
    origin = get_json(@instructor, "/api/v1/curricula/#{copy.id}")["curriculum"]["editing"]["copy_of"]
    assert_nil origin["cohort"]
    assert_equal "Shared synthetic lab", origin.dig("source_curriculum", "name")
    assert_equal "Cohort Birch", get_json(@admin, "/api/v1/curricula/#{copy.id}")["curriculum"]["editing"].dig("copy_of", "cohort", "name")
  end

  # Fix round 2 (P1): an admin copies the curriculum for Birch. Its name never names Birch to
  # Alder's instructor: Content, the curriculum page, a copied lesson's page and peek, the editor.
  test "a copy made for Birch is named without Birch for Alder's instructor, and with it for the admin" do
    copy = CurriculumCopyForCohort.new(cohort: @b, user: @admin, source_curriculum_id: @curriculum.id).copy!.copy.copy_curriculum
    assert_equal "Shared synthetic lab (copy)", copy.reload.name, "New copies don't store the cohort's name"
    copied_lesson = Lesson.joins(:curriculum_module).find_by!(modules: { curriculum_id: copy.id }, title: "Make decisions")

    [
      "/api/v1/curricula", "/api/v1/curricula/#{copy.id}", "/api/v1/records/curriculum/#{copy.id}/usage",
      "/api/v1/records/module/#{copied_lesson.module_id}/usage", "/api/v1/records/lesson/#{copied_lesson.id}/usage",
      "/api/v1/records/lesson/#{copied_lesson.id}/summary", "/api/v1/lessons/#{copied_lesson.id}/block_editor",
      "/api/v1/records/curriculum/#{@curriculum.id}/usage"
    ].each do |path|
      get_json(@instructor, path)
      refute_includes response.body, "Birch", path
    end
    names = get_json(@instructor, "/api/v1/curricula")["curricula"].map { |curriculum| curriculum["name"] }
    assert_includes names, "Shared synthetic lab (copy)"
    assert_equal "JavaScript basics · Shared synthetic lab (copy)", get_json(@instructor, "/api/v1/records/lesson/#{copied_lesson.id}/summary")["summary"]["subtitle"]
    assert_equal "Shared synthetic lab (copy)", get_json(@instructor, "/api/v1/records/lesson/#{copied_lesson.id}/usage")["usage"]["curriculum"]["name"]

    assert_equal "Shared synthetic lab (Cohort Birch)", get_json(@admin, "/api/v1/curricula/#{copy.id}")["curriculum"]["name"]
    assert_equal [ "Shared synthetic lab (Cohort Birch)" ], get_json(@admin, "/api/v1/records/curriculum/#{@curriculum.id}/usage")["usage"]["copies"].map { |row| row.dig("copy_curriculum", "name") }
    assert_equal "Shared synthetic lab (Cohort Birch)", get_json(@admin, "/api/v1/cohorts/#{@b.id}")["cohort"]["curriculum_name"]
  end

  test "names stored the old way, or renamed to include the cohort, are redacted for viewers who can't see it" do
    legacy = Curriculum.create!(name: "Shared synthetic lab (Cohort Birch)", status: :active)
    CurriculumCopy.create!(cohort: @b, source_curriculum: @curriculum, copy_curriculum: legacy, created_by: @admin)
    renamed = Curriculum.create!(name: "Cohort Birch evening track", status: :active)
    CurriculumCopy.create!(cohort: Cohort.create!(curriculum: renamed, name: "Cohort Birch evening", start_date: Date.current, status: :active),
      source_curriculum: @curriculum, copy_curriculum: renamed, created_by: @admin)

    names = get_json(@instructor, "/api/v1/curricula")["curricula"].map { |curriculum| curriculum["name"] }
    assert_includes names, "Shared synthetic lab (copy)"
    refute(names.any? { |name| name.include?("Birch") }, names.inspect)
    assert_equal "Shared synthetic lab (Cohort Birch)", get_json(@admin, "/api/v1/curricula/#{legacy.id}")["curriculum"]["name"]
    @b.cohort_instructor_assignments.create!(user: @instructor)
    assert_equal "Shared synthetic lab (Cohort Birch)", get_json(@instructor, "/api/v1/curricula/#{legacy.id}")["curriculum"]["name"], "Birch's own instructor sees it"
  end

  # Fix round 2 (P2): a saved Support link with Alder's cohort and the shared lesson's (or module's)
  # id still finds Alder's help after Alder moves to its own copy.
  test "Support's lesson and module filters follow a cohort's copy" do
    learner = Enrollment.find_by!(cohort: @a).user
    question = HelpRequest.create!(student: learner, cohort: @a, category: :concept, context_type: :lesson, context_id: @lesson.id, status: :open,
      context_label: "Make decisions", context_path: "/lessons/#{@lesson.id}", message: "Synthetic question")
    CurriculumCopyForCohort.new(cohort: @a, user: @instructor, source_curriculum_id: @curriculum.id).copy!
    refute_equal @lesson.id, question.reload.context_id, "The copy moved the question to Alder's lesson"

    [ { lesson_id: @lesson.id }, { module_id: @module.id } ].each do |filter|
      as_user(@instructor) { get "/api/v1/support_queue", params: { cohort_id: @a.id, **filter }, headers: auth_headers }
      assert_response :success
      queue = response.parsed_body["support_queue"]
      assert_equal [ question.id ], queue["help_requests"].map { |request| request["id"] }, filter.inspect
      assert_equal "Make decisions", queue.dig("help_filter", "name") if filter[:lesson_id]
    end
  end

  private

  def person(slug, role)
    User.create!(clerk_id: "privacy_#{slug}", email: "privacy-#{slug}@example.invalid", first_name: "Privacy", last_name: slug.capitalize, role: role)
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def get_json(user, path)
    as_user(user) { get path, headers: auth_headers }
    assert_response :success, "#{user.role} #{path}"
    response.parsed_body
  end
end
