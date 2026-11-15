require "test_helper"

# Lesson editing is admin-only unless an admin gives an instructor editing
# access for a cohort, and then only for curricula used exclusively by
# cohorts that instructor has access for (W5 PR 5.3 part 2, LessonEditAccess).
class LessonEditingGrantsTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Synthetic Web Lab")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.new(2026, 9, 1), status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "JavaScript basics", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Make decisions", position: 0, release_day: 0)
    @text = @lesson.content_blocks.create!(block_type: :text, position: 0, title: "Why", body: "Use `if`.")

    @admin = user(:admin, "admin", first_name: "Leon")
    @instructor = user(:instructor, "instructor")
    @other_instructor = user(:instructor, "other-instructor")
    @student = user(:student, "student")
    @assignment = CohortInstructorAssignment.create!(cohort: @cohort, user: @instructor)
    CohortInstructorAssignment.create!(cohort: @cohort, user: @other_instructor)
  end

  # Permission matrix -------------------------------------------------------

  test "admins edit; instructors without a grant read only; students can't open the editor" do
    get_editor(@admin)
    assert_response :success
    assert_equal({ "can_edit" => true, "reason" => "admin" }, response.parsed_body["access"].slice("can_edit", "reason"))
    put_editor(@admin, title: "Admin title")
    assert_response :success

    get_editor(@instructor)
    assert_response :success
    access = response.parsed_body["access"]
    assert_equal [ false, "no_grant" ], [ access["can_edit"], access["reason"] ]
    assert_match "Ask an admin", access["message"]
    put_editor(@instructor, title: "Instructor title")
    assert_response :forbidden
    assert_equal "lesson_editing_not_granted", response.parsed_body["code"]

    get_editor(@student)
    assert_response :forbidden
    assert_equal "Admin title", @lesson.reload.title

    # Opening create to granted instructors keeps the staff-only indexes closed to students.
    [ "/api/v1/learning_objectives?curriculum_id=#{@curriculum.id}", "/api/v1/rubrics?curriculum_id=#{@curriculum.id}", "/api/v1/modules/#{@module.id}/lessons" ].each do |path|
      as_user(@student) { get path, headers: auth_headers }
      assert_response :forbidden, path
    end
  end

  test "a granted instructor edits a curriculum only their cohorts use, and sees who gave the access" do
    grant!(@assignment, at: Time.zone.local(2026, 11, 14, 9, 30))

    get_editor(@instructor)
    assert_response :success
    access = response.parsed_body["access"]
    assert_equal [ true, "granted" ], [ access["can_edit"], access["reason"] ]
    grant = access["grants"].sole
    assert_equal [ @cohort.id, "Cohort 3" ], [ grant.dig("cohort", "id"), grant.dig("cohort", "name") ]
    assert_equal "Leon Tester", grant.dig("granted_by", "full_name")
    assert_equal "2026-11-14", grant["granted_at"].to_date.iso8601
    assert_empty access["shared_with"]

    put_editor(@instructor, title: "Instructor title")
    assert_response :success
    assert_equal "Instructor title", @lesson.reload.title
  end

  test "a curriculum shared with a cohort the instructor has no grant for is read only" do
    grant!(@assignment)
    Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.new(2027, 1, 12), status: :upcoming)

    get_editor(@instructor)
    access = response.parsed_body["access"]
    assert_equal [ false, "shared" ], [ access["can_edit"], access["reason"] ]
    assert_equal [ "Cohort 4" ], access["shared_with"].map { |cohort| cohort["name"] }
    assert_match "Cohort 4", access["message"]

    put_editor(@instructor, title: "Shared title")
    assert_response :forbidden
    assert_equal "curriculum_shared", response.parsed_body["code"]
    assert_equal "Make decisions", @lesson.reload.title

    put_editor(@admin, title: "Admins still edit the shared version")
    assert_response :success
  end

  test "ended cohorts still count as using the curriculum" do
    grant!(@assignment)
    Cohort.create!(curriculum: @curriculum, name: "Cohort 2", start_date: Date.new(2026, 3, 2), status: :archived)

    put_editor(@instructor, title: "Changed")
    assert_response :forbidden
    assert_equal "curriculum_shared", response.parsed_body["code"]
  end

  test "grants for every cohort sharing the curriculum allow editing" do
    grant!(@assignment)
    cohort_four = Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.new(2027, 1, 12), status: :upcoming)
    grant!(CohortInstructorAssignment.create!(cohort: cohort_four, user: @instructor))

    put_editor(@instructor, title: "Both cohorts")
    assert_response :success
  end

  test "a grant on another curriculum's cohort doesn't reach this one" do
    other = Curriculum.create!(name: "Synthetic Data Lab")
    other_cohort = Cohort.create!(curriculum: other, name: "Data 1", start_date: Date.current, status: :active)
    grant!(CohortInstructorAssignment.create!(cohort: other_cohort, user: @instructor))

    put_editor(@instructor, title: "Changed")
    assert_response :forbidden
    assert_equal "lesson_editing_not_granted", response.parsed_body["code"]
  end

  test "revoked and removed instructors lose editing" do
    grant!(@assignment)
    put_editor(@instructor, title: "First")
    assert_response :success

    as_user(@admin) { patch grant_path(@instructor), params: { can_edit_lessons: false }, headers: auth_headers, as: :json }
    assert_response :success
    put_editor(@instructor, title: "After revoke")
    assert_response :forbidden

    grant!(@assignment.reload)
    put_editor(@instructor, title: "Granted again")
    assert_response :success

    as_user(@admin) { delete "/api/v1/cohorts/#{@cohort.id}/instructor_assignments/#{@instructor.id}", headers: auth_headers }
    assert_response :no_content
    put_editor(@instructor, title: "After removal")
    assert_response :forbidden
    assert_equal "Granted again", @lesson.reload.title

    # Assigning them again starts without editing access.
    as_user(@admin) { post "/api/v1/cohorts/#{@cohort.id}/instructor_assignments", params: { user_id: @instructor.id }, headers: auth_headers, as: :json }
    assert_response :created
    refute response.parsed_body.dig("instructor", "can_edit_lessons")
    put_editor(@instructor, title: "Reassigned")
    assert_response :forbidden
  end

  test "an archived instructor's grant does nothing" do
    grant!(@assignment)
    @instructor.update!(archived_at: Time.current)
    assert_equal "not_staff", LessonEditAccess.for(@instructor, @curriculum).reason
    refute LessonEditAccess.any_grant?(@instructor)
  end

  # Every write path ----------------------------------------------------------

  test "every lesson write path follows the same rule for granted and ungranted instructors" do
    objective = LearningObjective.create!(curriculum: @curriculum, code: "JS.1", title: "Choose a path", success_criteria: "I can pick a branch.")
    writes = {
      "legacy block create" => -> { post "/api/v1/lessons/#{@lesson.id}/content_blocks", params: { block_type: "text", body: "New", position: 5 }, headers: auth_headers, as: :json },
      "legacy block update" => -> { patch "/api/v1/content_blocks/#{@text.id}", params: { body: "Changed" }, headers: auth_headers, as: :json },
      "mobile editor" => -> { patch "/api/v1/lessons/#{@lesson.id}/editor", params: { editor: { title: "Mobile title", base_updated_at: @lesson.reload.updated_at.iso8601(6) } }, headers: auth_headers, as: :json },
      "objective alignments" => -> { patch "/api/v1/lessons/#{@lesson.id}/objective_alignments", params: { alignments: [ { learning_objective_id: objective.id } ] }, headers: auth_headers, as: :json },
      "new objective" => -> { post "/api/v1/learning_objectives", params: { learning_objective: { curriculum_id: @curriculum.id, code: "JS.#{SecureRandom.hex(2)}", title: "Loop", success_criteria: "I can loop." } }, headers: auth_headers, as: :json },
      "new rubric" => -> { post "/api/v1/rubrics", params: { rubric: { curriculum_id: @curriculum.id, title: "Rubric #{SecureRandom.hex(2)}", criteria: [ { title: "Works", description: "It runs." } ] } }, headers: auth_headers, as: :json },
      "legacy block delete" => -> { delete "/api/v1/content_blocks/#{@lesson.content_blocks.order(:id).last.id}", headers: auth_headers }
    }

    writes.each do |label, request|
      as_user(@instructor) { request.call }
      assert_response :forbidden, "#{label} without a grant"
      assert_equal "lesson_editing_not_granted", response.parsed_body["code"], label
    end

    grant!(@assignment)
    writes.each do |label, request|
      as_user(@instructor) { request.call }
      assert_includes [ 200, 201, 204 ], response.status, "#{label} with a grant: #{response.body}"
    end
    assert_equal "Mobile title", @lesson.reload.title

    Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.new(2027, 1, 12), status: :upcoming)
    writes.except("legacy block delete").each do |label, request|
      as_user(@instructor) { request.call }
      assert_response :forbidden, "#{label} on a shared curriculum"
      assert_equal "curriculum_shared", response.parsed_body["code"], label
    end
  end

  test "a new objective aligned from the editor changes the lesson's version, so an open editor reloads" do
    grant!(@assignment)
    opened_at = @lesson.reload.updated_at
    travel 1.second do
      as_user(@instructor) do
        post "/api/v1/learning_objectives", params: { learning_objective: { curriculum_id: @curriculum.id, code: "JS.9", title: "Loop", success_criteria: "I can loop." }, lesson_id: @lesson.id }, headers: auth_headers, as: :json
      end
    end
    assert_response :created
    assert_equal [ "JS.9" ], @lesson.objective_alignments.map { |alignment| alignment.learning_objective.code }
    assert_operator @lesson.reload.updated_at, :>, opened_at

    put_editor_at(@instructor, opened_at, title: "Stale title")
    assert_response :conflict
  end

  test "mobile's editor save shows a plain refusal to an instructor without access" do
    as_user(@instructor) do
      patch "/api/v1/lessons/#{@lesson.id}/editor", params: { editor: { title: "Mobile", base_updated_at: @lesson.updated_at.iso8601(6) } }, headers: auth_headers, as: :json
    end
    assert_response :forbidden
    body = response.parsed_body
    assert_equal "Only admins can edit lessons. Ask an admin to give you editing access for your cohort.", body["error"]
    assert_equal "lesson_editing_not_granted", body["code"]
  end

  test "lesson media uploads need a grant somewhere; lesson structure stays admin-only" do
    as_user(@instructor) { post "/api/v1/video_presign", params: { filename: "a.mp4", content_type: "video/mp4" }, headers: auth_headers, as: :json }
    assert_response :forbidden
    as_user(@instructor) { post "/api/v1/uploads/multipart/initiate", params: { filename: "a.mp4", content_type: "video/mp4", file_size: 10 }, headers: auth_headers, as: :json }
    assert_response :forbidden

    grant!(@assignment)
    with_s3_unconfigured do
      as_user(@instructor) { post "/api/v1/video_presign", params: { filename: "a.mp4", content_type: "video/mp4" }, headers: auth_headers, as: :json }
      assert_response :service_unavailable, "past the permission check"
    end

    [
      -> { patch "/api/v1/lessons/#{@lesson.id}/archive", params: { base_updated_at: @lesson.reload.updated_at.iso8601(6) }, headers: auth_headers, as: :json },
      -> { post "/api/v1/lessons/#{@lesson.id}/duplicate", headers: auth_headers, as: :json },
      -> { post "/api/v1/lessons/#{@lesson.id}/move", params: { module_id: @module.id, release_day: 1, position: 0, base_updated_at: @lesson.updated_at.iso8601(6) }, headers: auth_headers, as: :json },
      -> { post "/api/v1/modules/#{@module.id}/lessons", params: { title: "New", release_day: 0, position: 1 }, headers: auth_headers, as: :json }
    ].each do |request|
      as_user(@instructor) { request.call }
      assert_response :forbidden
    end
  end

  test "the curriculum payload tells staff whether they can edit its lessons" do
    as_user(@instructor) { get "/api/v1/curricula/#{@curriculum.id}", headers: auth_headers }
    assert_response :success
    assert_equal false, response.parsed_body.dig("curriculum", "editing", "can_edit")

    grant!(@assignment)
    as_user(@instructor) { get "/api/v1/curricula/#{@curriculum.id}", headers: auth_headers }
    assert_equal [ true, "granted" ], response.parsed_body.dig("curriculum", "editing").values_at("can_edit", "reason")
  end

  # Granting ------------------------------------------------------------------

  test "an admin grants and revokes per instructor per cohort, and each change is audited once" do
    freeze_time do
      as_user(@admin) { patch grant_path(@instructor), params: { can_edit_lessons: true }, headers: auth_headers, as: :json }
      assert_response :success
      instructor = response.parsed_body["instructor"]
      assert_equal true, instructor["can_edit_lessons"]
      assert_equal({ "id" => @admin.id, "full_name" => "Leon Tester" }, instructor["edit_granted_by"])
      assert_equal Time.current.iso8601, instructor["edit_granted_at"]

      # Granting again changes nothing and records nothing.
      as_user(@admin) { patch grant_path(@instructor), params: { can_edit_lessons: true }, headers: auth_headers, as: :json }
      assert_response :success
    end

    as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/instructor_assignments", headers: auth_headers }
    assert_response :success
    rows = response.parsed_body["instructors"].index_by { |row| row["id"] }
    assert rows.fetch(@instructor.id)["can_edit_lessons"]
    refute rows.fetch(@other_instructor.id)["can_edit_lessons"], "grants are per instructor"
    assert_nil rows.fetch(@other_instructor.id)["edit_granted_by"]

    as_user(@admin) { patch grant_path(@instructor), params: { can_edit_lessons: false }, headers: auth_headers, as: :json }
    assert_response :success
    assert_nil response.parsed_body.dig("instructor", "edit_granted_by")
    assert_nil response.parsed_body.dig("instructor", "edit_granted_at")

    events = ActivityEvent.where(subject_user: @instructor).order(:id)
    assert_equal %w[lesson_editing_granted lesson_editing_revoked], events.map(&:event_type)
    assert events.all? { |event| event.actor_id == @admin.id && event.cohort_id == @cohort.id && event.record_type.nil? }
  end

  test "removing a granted instructor records a revoke; removing an ungranted one records nothing" do
    grant!(@assignment)
    as_user(@admin) { delete "/api/v1/cohorts/#{@cohort.id}/instructor_assignments/#{@instructor.id}", headers: auth_headers }
    as_user(@admin) { delete "/api/v1/cohorts/#{@cohort.id}/instructor_assignments/#{@other_instructor.id}", headers: auth_headers }

    assert_equal %w[lesson_editing_granted lesson_editing_revoked], ActivityEvent.where(subject_user: @instructor, actor: @admin).order(:id).pluck(:event_type)
    assert_empty ActivityEvent.where(subject_user: @other_instructor)
  end

  test "the content audit category lists grant events for admins" do
    grant!(@assignment)
    as_user(@admin) { get "/api/v1/activity_events", params: { feed: "school", category: "content" }, headers: auth_headers }
    assert_response :success
    assert_equal [ "lesson_editing_granted" ], response.parsed_body["activity_events"].map { |event| event["event_type"] }

    # Feeds built around learners leave them out unless asked.
    as_user(@admin) { get "/api/v1/activity_events", params: { feed: "cohort", cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :success
    assert_empty response.parsed_body["activity_events"]
    as_user(@instructor) { get "/api/v1/activity_events", headers: auth_headers }
    assert_empty response.parsed_body["activity_events"]
    as_user(@admin) { get "/api/v1/activity_events", params: { feed: "school", event_type: "lesson_editing_granted" }, headers: auth_headers }
    assert_equal 1, response.parsed_body["activity_events"].length
  end

  test "deleting a cohort keeps its grant audit rows and detaches them" do
    grant!(@assignment)
    @assignment.reload.set_lesson_editing!(false, by: @admin)

    as_user(@admin) { delete "/api/v1/cohorts/#{@cohort.id}", headers: auth_headers }

    assert_response :no_content
    refute Cohort.exists?(@cohort.id)
    events = ActivityEvent.where(subject_user: @instructor).order(:id)
    assert_equal %w[lesson_editing_granted lesson_editing_revoked], events.map(&:event_type)
    assert events.all? { |event| event.cohort_id.nil? && event.actor_id == @admin.id }
  end

  # Day changes in the block editor -------------------------------------------

  test "a granted instructor can't move a lesson's day past a learner with work; title-only and already-open days still save" do
    grant!(@assignment)
    student = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    travel_to Time.zone.local(2026, 11, 18, 10) do
      CohortModuleSchedule.create!(cohort: @cohort, curriculum_module: @module, start_date: Date.new(2026, 11, 16))
      ModuleAssignment.create!(enrollment: student, curriculum_module: @module, unlocked: false)
      Progress.create!(user: @student, enrollment: student, content_block: @text, status: :completed)
      assert LessonReadAccess.allowed?(@student, @lesson.reload)

      put_editor(@instructor, title: "Make decisions", release_day: 4)
      assert_response :unprocessable_entity
      assert_equal "learner_access", response.parsed_body["code"]
      assert_match "1 learner with work", response.parsed_body["error"]
      assert_equal 0, @lesson.reload.release_day

      put_editor(@instructor, title: "Decisions, renamed")
      assert_response :success
      assert_equal [ "Decisions, renamed", 0 ], [ @lesson.reload.title, @lesson.release_day ]

      put_editor(@instructor, title: "Decisions, renamed", release_day: 2)
      assert_response :success, "a day that has already opened keeps the lesson open"
      assert_equal 2, @lesson.reload.release_day
      assert LessonReadAccess.allowed?(@student, @lesson)
    end
  end

  test "a day change with no learner work behind it saves" do
    grant!(@assignment)
    travel_to Time.zone.local(2026, 11, 18, 10) do
      CohortModuleSchedule.create!(cohort: @cohort, curriculum_module: @module, start_date: Date.new(2026, 11, 16))
      ModuleAssignment.create!(enrollment: Enrollment.create!(user: @student, cohort: @cohort, status: :active), curriculum_module: @module, unlocked: false)

      put_editor(@instructor, title: "Make decisions", release_day: 4)
      assert_response :success
      assert_equal 4, @lesson.reload.release_day
    end
  end

  test "only admins grant, and the flag must be a boolean" do
    as_user(@instructor) { patch grant_path(@instructor), params: { can_edit_lessons: true }, headers: auth_headers, as: :json }
    assert_response :forbidden
    as_user(@admin) { patch grant_path(@instructor), params: { can_edit_lessons: "yes" }, headers: auth_headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@admin) { patch grant_path(@student), params: { can_edit_lessons: true }, headers: auth_headers, as: :json }
    assert_response :not_found
    refute @assignment.reload.can_edit_lessons
    assert_empty ActivityEvent.where(event_type: ActivityEvent::CONTENT_TYPES)
  end

  test "a grant must name the admin who gave it" do
    @assignment.assign_attributes(can_edit_lessons: true, edit_granted_by: @other_instructor, edit_granted_at: Time.current)
    refute @assignment.valid?
    assert_includes @assignment.errors[:edit_granted_by], "must be an admin"
  end

  private

  def grant!(assignment, at: Time.current)
    travel_to(at) { assignment.set_lesson_editing!(true, by: @admin) }
  end

  def grant_path(person)
    "/api/v1/cohorts/#{@cohort.id}/instructor_assignments/#{person.id}/lesson_editing"
  end

  def user(role, slug, first_name: slug.titleize)
    User.create!(clerk_id: "clerk_grants_#{slug}", email: "#{slug}-grants@example.invalid", first_name: first_name, last_name: "Tester", role: role)
  end

  def get_editor(person)
    as_user(person) { get "/api/v1/lessons/#{@lesson.id}/block_editor", headers: auth_headers }
  end

  def put_editor(person, title:, **settings)
    @lesson.reload
    body = {
      base_updated_at: @lesson.updated_at.iso8601(6),
      title: title,
      blocks: @lesson.content_blocks.map { |block| { id: block.id, block_type: block.block_type, title: block.title, body: block.body } },
      **settings
    }
    as_user(person) { put "/api/v1/lessons/#{@lesson.id}/block_editor", params: { lesson: body }, headers: auth_headers, as: :json }
  end

  def put_editor_at(person, base_updated_at, title:)
    body = {
      base_updated_at: base_updated_at.iso8601(6),
      title: title,
      blocks: @lesson.content_blocks.map { |block| { id: block.id, block_type: block.block_type, title: block.title, body: block.body } }
    }
    as_user(person) { put "/api/v1/lessons/#{@lesson.id}/block_editor", params: { lesson: body }, headers: auth_headers, as: :json }
  end

  def with_s3_unconfigured
    original = S3Service.method(:configured?)
    S3Service.define_singleton_method(:configured?) { false }
    yield
  ensure
    S3Service.define_singleton_method(:configured?, original)
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
