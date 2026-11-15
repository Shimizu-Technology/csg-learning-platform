require "test_helper"

# L-0.4: record pages read GET /api/v1/records/:type/:id/related for their
# related panel and breadcrumb. Counts are permission-checked: staff only for
# cohorts they can access, students only for their own lesson work. Anything
# else is a 404, and a switched-off feature's row is left out.
class RecordRelatedTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Related curriculum")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Make decisions", position: 0, release_day: 0)
    @rubric = Rubric.new(curriculum: @curriculum, title: "Ticket rubric")
    @rubric.rubric_criteria.build(title: "Correct output", description: "Returns the right price", position: 0)
    @rubric.rubric_criteria.build(title: "Readable", description: "Clear names", position: 1)
    @rubric.save!
    @exercise = @lesson.content_blocks.create!(block_type: :exercise, title: "Ticket prices", position: 0, submission_type: :text_submission, rubric: @rubric)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current - 14, end_date: Date.current + 80, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.current, status: :active)
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @outsider = person("outsider", :instructor)
    @student = person("student", :student)
    @classmate = person("classmate", :student)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort.cohort_instructor_assignments.create!(user: @outsider)
    @enrollment = enroll(@student, @cohort)
    @classmate_enrollment = enroll(@classmate, @cohort)
  end

  test "staff see a submission's lesson, module grid, rubric, other attempts, help and conversation" do
    first = submit(@enrollment, grade: :R)
    submission = submit(@enrollment)
    help(@student, context_type: :exercise, context_id: @exercise.id)
    help(@classmate)
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
    Message.create!(direct_conversation: conversation, author: @student, body: "Synthetic hello")

    related = fetch(@instructor, "submission", submission.id)
    assert_response :success
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_equal({ "cohort" => { "id" => @cohort.id, "name" => "Cohort 3" }, "student" => { "id" => @student.id, "name" => "Source Student" },
                   "lesson" => { "id" => @lesson.id, "title" => "Make decisions" }, "module" => { "id" => @module.id, "name" => "Week 1" } }, related["context"])
    rows = rows_of(related)
    assert_equal %w[lesson module_grid rubric other_attempts help conversation], rows.keys
    assert_equal @lesson.id, rows.dig("lesson", "lesson_id")
    assert_equal [ @cohort.id, @module.id ], rows["module_grid"].values_at("cohort_id", "module_id")
    assert_equal 2, rows.dig("rubric", "count")
    assert_equal 1, rows.dig("other_attempts", "count"), "Counts attempt #{first.id}, not the open one"
    assert_equal 1, rows.dig("help", "count"), "Only this learner's help on this exercise"
    assert_equal conversation.id, rows.dig("conversation", "direct_conversation_id")
    assert rows.dig("conversation", "last_message_at")
    refute_includes response.body, "Synthetic", "Rows never carry answers, questions or messages"
  end

  test "related counts are 404 for students, other learners and staff without cohort access" do
    submission = submit(@enrollment)
    request = help(@student)
    intervention = follow_up(request)

    [ [ "submission", submission.id ], [ "help_request", request.id ], [ "intervention", intervention.id ], [ "student", @student.id, { cohort_id: @cohort.id } ], [ "cohort", @cohort.id ] ].each do |type, id, params|
      [ @student, @classmate, @outsider ].each do |viewer|
        fetch(viewer, type, id, **(params || {}))
        assert_response :not_found, "#{viewer.last_name} #{type}"
        assert_equal({ "error" => "Not found" }, response.parsed_body)
      end
      fetch(@instructor, type, id, **(params || {}))
      assert_response :success, "assigned instructor #{type}"
      fetch(@admin, type, id, **(params || {}))
      assert_response :success, "admin #{type}"
    end

    fetch(@instructor, "student", @student.id)
    assert_response :not_found, "A student workspace is one cohort; cohort_id is required"
    fetch(@instructor, "student", @student.id, cohort_id: @other_cohort.id)
    assert_response :not_found
    fetch(@instructor, "nope", 1)
    assert_response :not_found
    fetch(@instructor, "cohort", "1abc")
    assert_response :not_found
  end

  test "students see only their own work and help on a lesson they can open" do
    submit(@enrollment, grade: :R)
    submit(@classmate_enrollment)
    help(@classmate)
    help(@student, status: :resolved)
    @cohort.recordings.create!(title: "Live class", source_kind: "external", source_url: "https://example.com/v", status: :published)
    @cohort.recordings.create!(title: "Draft", source_kind: "external", source_url: "https://example.com/d")

    related = fetch(@student, "lesson", @lesson.id)
    assert_response :success
    assert_equal "learner", related["view"]
    assert_equal({ "id" => @cohort.id, "name" => "Cohort 3" }, related.dig("context", "cohort"))
    rows = rows_of(related)
    assert_equal %w[your_work help recordings], rows.keys
    assert_equal [ 1, "redo_requested", @exercise.id ], rows["your_work"].values_at("count", "value", "content_block_id")
    assert_equal [ 1, 0 ], rows["help"].values_at("count", "open_count"), "Their own resolved request, not the classmate's"
    assert_equal 1, rows.dig("recordings", "count"), "Only published recordings"

    fetch(@student, "lesson", @lesson.id, cohort_id: @other_cohort.id)
    assert_response :not_found
    fetch(@student, "lesson", @lesson.id, student_id: @classmate.id)
    assert_response :not_found, "A learner can't ask for a classmate's rows"
    fetch(person("stranger", :student), "lesson", @lesson.id)
    assert_response :not_found
  end

  test "staff previewing one learner see that learner's rows only in cohorts they can access" do
    submit(@classmate_enrollment)
    preview = fetch(@instructor, "lesson", @lesson.id, cohort_id: @cohort.id, student_id: @classmate.id)
    assert_response :success
    assert_equal "learner", preview["view"]
    assert_equal 1, rows_of(preview).dig("your_work", "count")

    fetch(@outsider, "lesson", @lesson.id, cohort_id: @cohort.id, student_id: @classmate.id)
    assert_response :not_found
    fetch(@instructor, "lesson", @lesson.id, cohort_id: @cohort.id, student_id: @outsider.id)
    assert_response :not_found
  end

  test "staff lesson counts cover only cohorts they can access" do
    submit(@enrollment)
    stranger = enroll(person("stranger", :student), @other_cohort)
    submit(stranger)
    help(stranger.user, cohort: @other_cohort)

    rows = rows_of(fetch(@instructor, "lesson", @lesson.id))
    assert_equal "staff", response.parsed_body.dig("related", "view")
    assert_equal 1, rows.dig("waiting_review", "count")
    assert_equal 0, rows.dig("open_help", "count")
    assert_equal 1, rows.dig("used_in", "count")
    assert_equal 2, rows_of(fetch(@admin, "lesson", @lesson.id)).dig("waiting_review", "count")
    fetch(@instructor, "lesson", @lesson.id, cohort_id: @other_cohort.id)
    assert_response :not_found
  end

  test "a switched-off feature's rows disappear" do
    request = help(@student)
    intervention = follow_up(request)
    submission = submit(@enrollment)
    @cohort.update!(settings: { "features" => { "help_requests" => false, "interventions" => false, "recordings" => false, "private_meetings" => false, "announcements" => false } })

    assert_equal %w[lesson module_grid rubric other_attempts conversation], rows_of(fetch(@instructor, "submission", submission.id)).keys
    assert_equal %w[lesson conversation], rows_of(fetch(@instructor, "help_request", request.id)).keys
    assert_equal %w[evidence recovery_plan conversation], rows_of(fetch(@instructor, "intervention", intervention.id)).keys
    assert_equal %w[cohort conversation other_enrollments], rows_of(fetch(@instructor, "student", @student.id, cohort_id: @cohort.id)).keys
    assert_equal %w[students waiting_review], rows_of(fetch(@instructor, "cohort", @cohort.id)).keys
    assert_equal %w[your_work], rows_of(fetch(@student, "lesson", @lesson.id)).keys
  end

  test "help requests, follow-up plans, student workspaces and cohorts link their related records" do
    request = help(@student)
    help(@student, context_type: :exercise, context_id: @exercise.id, status: :resolved)
    intervention = follow_up(request, evidence: { "help_request_id" => request.id, "days_waiting" => 2 })
    RecoveryPlan.create!(enrollment: @enrollment, intervention: intervention, owner: @instructor, created_by: @instructor, source: :manual,
      target_pace: "Two lessons a week", required_scope: "Week 1", next_check_in_at: 3.days.from_now)
    enroll(@student, @other_cohort)
    submit(@enrollment)

    rows = rows_of(fetch(@instructor, "help_request", request.id))
    assert_equal [ 1, intervention.id ], rows["follow_up"].values_at("count", "intervention_id")
    assert_equal 1, rows.dig("other_requests", "count")
    assert_equal @lesson.id, rows.dig("lesson", "lesson_id")
    assert_nil rows.dig("conversation", "direct_conversation_id"), "No conversation yet"

    rows = rows_of(fetch(@instructor, "intervention", intervention.id))
    assert_equal 2, rows.dig("evidence", "count")
    assert_equal [ 1, "Active" ], rows["recovery_plan"].values_at("count", "value")
    assert_equal request.id, rows.dig("help_request", "help_request_id")

    rows = rows_of(fetch(@instructor, "student", @student.id, cohort_id: @cohort.id))
    assert_equal [ 2, 1 ], rows["help_requests"].values_at("count", "open_count")
    assert_equal 1, rows.dig("follow_ups", "count")
    assert_equal 0, rows.dig("other_enrollments", "count"), "The other cohort isn't this instructor's"
    assert_equal [ 1, @other_cohort.id ], rows_of(fetch(@admin, "student", @student.id, cohort_id: @cohort.id))["other_enrollments"].values_at("count", "cohort_id")

    rows = rows_of(fetch(@instructor, "cohort", @cohort.id))
    assert_equal [ 2, 1, 1, 1 ], %w[students waiting_review open_help follow_ups].map { |key| rows.dig(key, "count") }
  end

  test "a submission's rows count only its own cohort, even when the learner is in another one" do
    elsewhere = enroll(@student, @other_cohort)
    submit(elsewhere, grade: :R)
    help(@student, cohort: @other_cohort, context_type: :exercise, context_id: @exercise.id)
    away = DirectConversation.find_or_create_for!(workspace: @other_cohort.workspace, users: [ @admin, @student ])
    Message.create!(direct_conversation: away, author: @student, body: "Synthetic hello")
    submission = submit(@enrollment)

    [ @instructor, @admin ].each do |viewer|
      rows = rows_of(fetch(viewer, "submission", submission.id))
      assert_equal 0, rows.dig("other_attempts", "count"), "#{viewer.last_name}: the attempt in Cohort 4 isn't this cohort's"
      assert_equal 0, rows.dig("help", "count"), "#{viewer.last_name}: help asked in Cohort 4"
      assert_nil rows.dig("conversation", "direct_conversation_id"), "#{viewer.last_name}: the conversation lives in Cohort 4's workspace"
    end
    assert_equal 1, rows_of(fetch(@outsider, "submission", Submission.where(enrollment: elsewhere).pick(:id))).dig("help", "count")
  end

  test "a help request asked from another cohort's recording or lesson shows no link to it" do
    away = @other_cohort.recordings.create!(title: "Away class", source_kind: "external", source_url: "https://example.com/a", status: :published)
    other_curriculum = Curriculum.create!(name: "Away curriculum")
    away_lesson = Lesson.create!(curriculum_module: CurriculumModule.create!(curriculum: other_curriculum, name: "Away", position: 0), title: "Away lesson", position: 0, release_day: 0)
    from_recording = help(@student, context_type: :recording, context_id: away.id)
    from_lesson = help(@student, context_type: :lesson, context_id: away_lesson.id)

    assert_equal %w[follow_up conversation other_requests], rows_of(fetch(@admin, "help_request", from_recording.id)).keys
    assert_equal %w[follow_up conversation other_requests], rows_of(fetch(@admin, "help_request", from_lesson.id)).keys
    own = help(@student, context_type: :recording, context_id: @cohort.recordings.create!(title: "Live", source_kind: "external", source_url: "https://example.com/v", status: :published).id)
    assert_equal "recording", rows_of(fetch(@admin, "help_request", own.id)).keys.first
  end

  test "a record the viewer can't open costs at most one query more than a missing one and loads nothing protected" do
    submission = submit(@enrollment)
    request = help(@student)
    intervention = follow_up(request)
    stranger = person("stranger", :student)
    # Only the record's cohort id may be read before the access check: no whole rows, and nothing about the learner, cohort or lesson.
    protected = /SELECT "\w+"\.\* |FROM "(users|cohorts|content_blocks|lessons|curriculum_modules|curriculums|rubrics|workspaces)"/

    cases = {
      "submission" => [ @outsider, [ "submission", submission.id ], [ "submission", 999_999 ] ],
      "help_request" => [ @outsider, [ "help_request", request.id ], [ "help_request", 999_999 ] ],
      "intervention" => [ @outsider, [ "intervention", intervention.id ], [ "intervention", 999_999 ] ],
      "student" => [ @outsider, [ "student", @student.id, { cohort_id: @cohort.id } ], [ "student", 999_999, { cohort_id: 999_999 } ] ],
      "cohort" => [ @outsider, [ "cohort", @cohort.id ], [ "cohort", 999_999 ] ],
      "staff lesson" => [ @outsider, [ "lesson", @lesson.id, { cohort_id: @cohort.id } ], [ "lesson", 999_999, { cohort_id: 999_999 } ] ],
      "staff preview" => [ @outsider, [ "lesson", @lesson.id, { cohort_id: @cohort.id, student_id: @student.id } ], [ "lesson", 999_999, { cohort_id: 999_999, student_id: 999_999 } ] ]
    }
    cases.each do |label, (viewer, denied_args, missing_args)|
      denied = related_queries(viewer, *denied_args.first(2), **(denied_args[2] || {}))
      missing = related_queries(viewer, *missing_args.first(2), **(missing_args[2] || {}))
      assert_operator denied.size, :<=, missing.size + 1, "#{label} denied:\n#{denied.join("\n")}\nmissing:\n#{missing.join("\n")}"
      assert_empty denied.grep(protected), "#{label} loaded protected rows before authorizing:\n#{denied.join("\n")}"
    end

    # A learner's lesson outside their curriculum: only the lesson row and their own access check.
    denied = related_queries(stranger, "lesson", @lesson.id)
    missing = related_queries(stranger, "lesson", 999_999)
    assert_operator denied.size, :<=, missing.size + 1, denied.join("\n")
    assert_empty denied.grep(/FROM "(content_blocks|curriculums|submissions|help_requests|recordings)"/), denied.join("\n")
    classmate = related_queries(@student, "lesson", @lesson.id, student_id: @classmate.id)
    assert_empty classmate, "A classmate's rows are refused before any query"

    granted = related_queries(@instructor, "submission", submission.id)
    assert granted.grep(/FROM "content_blocks"/).any?, "Builds the panel once allowed"
  end

  test "each feature row follows its cohort's own switch, not the school default" do
    SchoolSetting.current.update!(features: FeatureSwitches::KEYS.index_with(false))
    on = FeatureSwitches::KEYS.index_with(true)
    @other_cohort.update!(settings: { "features" => on })
    @other_cohort.cohort_instructor_assignments.create!(user: @instructor)
    elsewhere = enroll(@student, @other_cohort)

    records = { @cohort => @enrollment, @other_cohort => elsewhere }.to_h do |cohort, enrollment|
      recording = cohort.recordings.create!(title: "Live #{cohort.id}", source_kind: "external", source_url: "https://example.com/#{cohort.id}", status: :published)
      request = help(@student, cohort: cohort)
      from_recording = help(@student, cohort: cohort, context_type: :recording, context_id: recording.id)
      Intervention.create!(enrollment: enrollment, help_request: request, owner: @instructor, created_by: @instructor, trigger_type: :help_request, next_follow_up_at: 2.days.from_now)
      [ cohort, { submission: submit(enrollment), request: request, from_recording: from_recording, intervention: Intervention.find_by!(help_request: request) } ]
    end

    expected = {
      submission: %w[help],
      request: %w[follow_up other_requests],
      from_recording: %w[recording follow_up other_requests],
      intervention: %w[help_request],
      student: %w[help_requests follow_ups meetings],
      cohort: %w[open_help follow_ups recordings updates],
      lesson: %w[open_help recordings]
    }
    { @cohort => false, @other_cohort => true }.each do |cohort, enabled|
      ids = records.fetch(cohort)
      rows = {
        submission: fetch(@instructor, "submission", ids[:submission].id),
        request: fetch(@instructor, "help_request", ids[:request].id),
        from_recording: fetch(@instructor, "help_request", ids[:from_recording].id),
        intervention: fetch(@instructor, "intervention", ids[:intervention].id),
        student: fetch(@instructor, "student", @student.id, cohort_id: cohort.id),
        cohort: fetch(@instructor, "cohort", cohort.id),
        lesson: fetch(@instructor, "lesson", @lesson.id, cohort_id: cohort.id)
      }.transform_values { |related| rows_of(related).keys }
      expected.each do |record, keys|
        keys.each do |key|
          assert_equal enabled, rows[record].include?(key), "#{cohort.name} #{record}: #{key} should be #{enabled ? 'shown' : 'hidden'} (got #{rows[record]})"
        end
      end
    end

    # A learner sees help and recordings only in the cohort that has them on.
    assert_equal %w[your_work], rows_of(fetch(@student, "lesson", @lesson.id, cohort_id: @cohort.id)).keys
    assert_equal %w[your_work help recordings], rows_of(fetch(@student, "lesson", @lesson.id, cohort_id: @other_cohort.id)).keys

    # Unscoped, the lesson's open help counts only the cohort with help on.
    unscoped = rows_of(fetch(@instructor, "lesson", @lesson.id))
    assert_equal 1, unscoped.dig("open_help", "count"), "Cohort 3 has help off; its open request isn't counted"
    assert_equal 2, unscoped.dig("used_in", "count")
    @other_cohort.update!(settings: { "features" => on.merge("help_requests" => false) })
    refute_includes rows_of(fetch(@instructor, "lesson", @lesson.id)).keys, "open_help", "No cohort has help on"
  end

  private

  def person(name, role)
    User.create!(clerk_id: "related_#{name}", email: "related-#{name}@example.com", first_name: "Source", last_name: name.capitalize, role: role)
  end

  def enroll(user, cohort)
    Enrollment.create!(user: user, cohort: cohort, status: :active, joined_at: 1.day.ago).tap do |enrollment|
      ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @module, unlocked: true)
    end
  end

  def submit(enrollment, grade: nil)
    Submission.create!(user: enrollment.user, enrollment: enrollment, content_block: @exercise, submission_type: :text_submission,
      text: "Synthetic answer", grade: grade, graded_at: grade && Time.current)
  end

  def help(student, cohort: @cohort, context_type: :lesson, context_id: @lesson.id, status: :open)
    HelpRequest.create!(student: student, cohort: cohort, category: :concept, context_type: context_type, context_id: context_id, status: status,
      context_label: "Make decisions", context_path: "/lessons/#{@lesson.id}", message: "Synthetic question",
      **(status == :resolved ? { owner: @instructor, acknowledged_at: 1.hour.ago, resolved_at: Time.current, staff_response: "Synthetic reply" } : {}))
  end

  def follow_up(request, evidence: {})
    Intervention.create!(enrollment: @enrollment, help_request: request, owner: @instructor, created_by: @instructor, trigger_type: :help_request,
      next_follow_up_at: 2.days.from_now, evidence_snapshot: evidence)
  end

  # SQL RecordRelated runs for one viewer, after the viewer's own row is loaded.
  def related_queries(user, type, id, **params)
    user.reload
    queries = []
    callback = lambda do |*, payload|
      queries << payload[:sql] unless payload[:name] == "SCHEMA" || payload[:sql].match?(/\A\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/)
    end
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") do
      RecordRelated.for(viewer: user, type: type, id: id, **params)
    end
    queries
  end

  def rows_of(related)
    related.fetch("items").index_by { |row| row["key"] }
  end

  def fetch(user, type, id, **params)
    as_user(user) { get "/api/v1/records/#{type}/#{id}/related", params: params, headers: auth_headers }
    response.parsed_body["related"]
  end

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
