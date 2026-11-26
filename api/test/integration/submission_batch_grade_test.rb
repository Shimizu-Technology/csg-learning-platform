require "test_helper"

# Batch review and batch approval (POST /api/v1/submissions/batch_grade,
# GET /api/v1/submissions/batch_review).
class SubmissionBatchGradeTest < ActionDispatch::IntegrationTest
  # Locks on the grading rows (authentication may lock the viewer's own user row).
  LEARNING_LOCK = /FROM "(curricula|enrollments|submissions)".*FOR (UPDATE|NO KEY UPDATE|SHARE)/m

  setup do
    @curriculum = Curriculum.create!(name: "Drills", grading_scale: "pass_redo")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "weekdays", module_type: :live_class)
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Loops", position: 0, release_day: 0, requires_submission: true)
    @block = ContentBlock.create!(lesson: @lesson, block_type: :exercise, position: 0, title: "Count to ten", submission_type: :text_submission,
      submission_config: { "runner" => { "enabled" => true, "language" => "ruby", "checks" => [ { "id" => "c1", "name" => "Prints 10", "code" => "assert output.include?('10')" } ] } })
    @other_block = ContentBlock.create!(lesson: @lesson, block_type: :exercise, position: 1, title: "Sum", submission_type: :text_submission)

    @instructor = User.create!(clerk_id: "batch_instructor", email: "batch-instructor@example.invalid", first_name: "Ina", last_name: "Teach", role: :instructor)
    @admin = User.create!(clerk_id: "batch_admin", email: "batch-admin@example.invalid", first_name: "Ada", last_name: "Admin", role: :admin)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort A", start_date: Date.current, status: :active)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort B", start_date: Date.current, status: :active)

    @alice, @alice_enrollment, @alice_submission = learner("alice", @cohort, created_at: 3.hours.ago)
    @bob, @bob_enrollment, @bob_submission = learner("bob", @cohort, created_at: 2.hours.ago)
    @carol, @carol_enrollment, @carol_submission = learner("carol", @other_cohort, created_at: 1.hour.ago)
  end

  test "approves several submissions as Pass with every single-grade side effect, notifications after commit" do
    enqueued = []
    assert_enqueued_jobs 2, only: SubmissionNotificationJob do
      as_user(@instructor) do
        post "/api/v1/submissions/batch_grade", params: batch_params("P", [ @alice_submission, @bob_submission ], feedback: "Nice work!"),
          headers: auth_headers, as: :json
      end
      enqueued = enqueued_jobs.select { |job| job["job_class"] == "SubmissionNotificationJob" }
    end

    assert_response :success
    body = response.parsed_body
    assert_equal [ @alice_submission.id, @bob_submission.id ], body.fetch("graded").map { |item| item["submission_id"] }
    assert_equal [], body.fetch("skipped")
    [ @alice_submission, @bob_submission ].each do |submission|
      submission.reload
      assert_equal "P", submission.grade
      assert_equal "Nice work!", submission.feedback
      assert_equal @instructor.id, submission.graded_by_id
      assert_not_nil submission.graded_at
      assert Progress.find_by!(enrollment: submission.enrollment, content_block: @block).completed?
      assert ActivityEvent.exists?(event_type: "submission_graded", record_type: "Submission", record_id: submission.id, actor_id: @instructor.id)
    end
    assert_equal [ [ "graded", @alice_submission.id ], [ "graded", @bob_submission.id ] ].sort, enqueued.map { |job| job["arguments"].first(2) }.sort
  end

  test "blank shared feedback saves no feedback" do
    as_user(@instructor) do
      post "/api/v1/submissions/batch_grade", params: batch_params("P", [ @alice_submission ], feedback: "  "), headers: auth_headers, as: :json
    end
    assert_response :success
    assert_nil @alice_submission.reload.feedback
  end

  test "locks curricula, then enrollments, then submissions, each in ascending id order" do
    second = Curriculum.create!(name: "More drills", grading_scale: "pass_redo")
    mod = CurriculumModule.create!(curriculum: second, name: "Week 1", position: 0, day_offset: 0, schedule_days: "weekdays", module_type: :live_class)
    lesson = Lesson.create!(curriculum_module: mod, title: "Arrays", position: 0, release_day: 0, requires_submission: true)
    block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "Map", submission_type: :text_submission)
    cohort = Cohort.create!(curriculum: second, name: "Cohort C", start_date: Date.current, status: :active)
    cohort.cohort_instructor_assignments.create!(user: @instructor)
    _, _, dave_submission = learner("dave", cohort, block: block)

    statements = []
    recorder = ->(*, payload) { statements << payload[:sql] }
    ActiveSupport::Notifications.subscribed(recorder, "sql.active_record") do
      as_user(@instructor) do
        # Listed out of order: the locks still go in id order.
        post "/api/v1/submissions/batch_grade", params: batch_params("P", [ dave_submission, @bob_submission, @alice_submission ]),
          headers: auth_headers, as: :json
      end
    end
    assert_response :success
    assert_equal 3, response.parsed_body.fetch("graded").length

    curriculum_lock = statements.index { |sql| sql.match?(/FROM "curricula".*FOR SHARE/m) }
    enrollment_lock = statements.index { |sql| sql.match?(/FROM "enrollments".*FOR NO KEY UPDATE/m) }
    submission_lock = statements.index { |sql| sql.match?(/FROM "submissions".*FOR NO KEY UPDATE/m) }
    assert curriculum_lock && enrollment_lock && submission_lock, statements.grep(/FOR /).inspect
    assert_operator curriculum_lock, :<, enrollment_lock
    assert_operator enrollment_lock, :<, submission_lock
    # One statement per level, ordered by id, and no other submission or enrollment lock before them.
    assert_equal 1, statements.count { |sql| sql.match?(/FROM "curricula".*FOR SHARE/m) }
    assert_match(/ORDER BY "curricula"."id" ASC/, statements[curriculum_lock])
    assert_match(/ORDER BY "enrollments"."id" ASC/, statements[enrollment_lock])
    assert_match(/ORDER BY "submissions"."id" ASC/, statements[submission_lock])
    assert_empty statements[0...curriculum_lock].grep(LEARNING_LOCK)
    assert_empty statements[curriculum_lock...submission_lock].grep(/FROM "submissions".*FOR /m)
  end

  test "refuses Redo, A, C, enum integers and anything else before any lock" do
    [ "R", "A", "C", 4, "4", "p", nil, [ "P" ] ].each do |grade|
      statements = []
      recorder = ->(*, payload) { statements << payload[:sql] }
      ActiveSupport::Notifications.subscribed(recorder, "sql.active_record") do
        as_user(@instructor) do
          post "/api/v1/submissions/batch_grade", params: batch_params(grade, [ @alice_submission ]), headers: auth_headers, as: :json
        end
      end
      assert_response :unprocessable_entity, grade.inspect
      assert_equal [ SubmissionBatchGrade::GRADE_INVALID ], response.parsed_body.fetch("errors")
      assert_empty statements.grep(LEARNING_LOCK), grade.inspect
    end
    assert_nil @alice_submission.reload.grade
  end

  test "refuses malformed items" do
    base = @alice_submission.updated_at.iso8601(6)
    cases = {
      [] => "Choose at least one submission to approve.",
      nil => "Choose at least one submission to approve.",
      Array.new(51) { |index| { submission_id: index + 1, base_submission_updated_at: base } } => "Approve at most 50 submissions at a time.",
      [ { submission_id: @alice_submission.id, base_submission_updated_at: base } ] * 2 => "Each submission can appear only once.",
      [ { submission_id: "#{@alice_submission.id}", base_submission_updated_at: base } ] => "Each submission_id must be a positive integer.",
      [ { submission_id: 0, base_submission_updated_at: base } ] => "Each submission_id must be a positive integer.",
      [ { submission_id: @alice_submission.id, base_submission_updated_at: "yesterday" } ] => "Each base_submission_updated_at must be an ISO 8601 timestamp.",
      [ { submission_id: @alice_submission.id } ] => "Each base_submission_updated_at must be an ISO 8601 timestamp.",
      [ @alice_submission.id ] => "Each item needs a submission_id and base_submission_updated_at."
    }
    cases.each do |items, message|
      as_user(@instructor) do
        post "/api/v1/submissions/batch_grade", params: { grade: "P", items: items }, headers: auth_headers, as: :json
      end
      assert_response :unprocessable_entity, items.inspect
      assert_equal [ message ], response.parsed_body.fetch("errors")
    end
    assert_nil @alice_submission.reload.grade
  end

  test "skips work outside the instructor's cohorts exactly like a missing id, and never grades it" do
    as_user(@instructor) do
      post "/api/v1/submissions/batch_grade",
        params: { grade: "P", items: [ item(@alice_submission), item(@carol_submission), { submission_id: 9_999_999, base_submission_updated_at: Time.current.iso8601 } ] },
        headers: auth_headers, as: :json
    end
    assert_response :success
    skipped = response.parsed_body.fetch("skipped")
    assert_equal [ @carol_submission.id, 9_999_999 ], skipped.map { |item| item["submission_id"] }
    assert_equal [ "not_found" ], skipped.map { |item| item["code"] }.uniq
    assert_equal 1, skipped.map { |item| item["reason"] }.uniq.length
    assert_nil @carol_submission.reload.grade
    assert_equal "P", @alice_submission.reload.grade
  end

  test "an admin may approve across cohorts" do
    as_user(@admin) do
      post "/api/v1/submissions/batch_grade", params: batch_params("P", [ @alice_submission, @carol_submission ]), headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal 2, response.parsed_body.fetch("graded").length
  end

  test "students may not batch grade or batch review" do
    as_user(@alice) do
      post "/api/v1/submissions/batch_grade", params: batch_params("P", [ @alice_submission ]), headers: auth_headers, as: :json
    end
    assert_response :forbidden
    as_user(@alice) { get "/api/v1/submissions/batch_review", headers: auth_headers }
    assert_response :forbidden
    assert_nil @alice_submission.reload.grade
  end

  test "skips stale, superseded, already graded, rubric and off-scale items with reasons, and grades the rest" do
    stale_base = @alice_submission.updated_at.iso8601(6)
    @alice_submission.update!(text: "puts 10 # edited")
    newer = Submission.create!(user: @bob, enrollment: @bob_enrollment, content_block: @block, submission_type: :text_submission, text: "puts 10", num_submissions: 2)
    _, _, graded = learner("erin", @cohort)
    graded.update!(grade: "P", graded_at: Time.current)
    rubric = Rubric.new(curriculum: @curriculum, title: "Loops rubric")
    rubric.rubric_criteria.build(title: "Correct", description: "Correct", position: 0)
    rubric.save!
    rubric_block = ContentBlock.create!(lesson: @lesson, block_type: :exercise, position: 2, title: "Rubric drill", submission_type: :text_submission, rubric: rubric)
    _, _, rubric_submission = learner("finn", @cohort, block: rubric_block)
    _, _, fresh = learner("gail", @cohort)

    as_user(@instructor) do
      post "/api/v1/submissions/batch_grade", params: {
        grade: "P",
        items: [ { submission_id: @alice_submission.id, base_submission_updated_at: stale_base }, item(@bob_submission), item(graded), item(rubric_submission), item(fresh) ]
      }, headers: auth_headers, as: :json
    end
    assert_response :success
    body = response.parsed_body
    assert_equal [ fresh.id ], body.fetch("graded").map { |row| row["submission_id"] }
    assert_equal({ @alice_submission.id => "stale", @bob_submission.id => "superseded", graded.id => "already_graded", rubric_submission.id => "rubric" },
      body.fetch("skipped").to_h { |row| [ row["submission_id"], row["code"] ] })
    assert_equal "Requires individual rubric grading.", body.fetch("skipped").find { |row| row["code"] == "rubric" }["reason"]
    assert_nil @alice_submission.reload.grade
    assert_nil @bob_submission.reload.grade
    assert_nil newer.reload.grade
    assert_nil rubric_submission.reload.grade
    assert_equal "P", fresh.reload.grade
  end

  test "B on a Pass / Redo curriculum is off scale, and nothing graded answers 422 with every skip" do
    as_user(@instructor) do
      post "/api/v1/submissions/batch_grade", params: batch_params("B", [ @alice_submission, @bob_submission ]), headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    body = response.parsed_body
    assert_equal [ SubmissionBatchGrade::NONE_GRADED ], body.fetch("errors")
    assert_equal [], body.fetch("graded")
    assert_equal [ "off_scale" ], body.fetch("skipped").map { |row| row["code"] }.uniq
    assert_nil @alice_submission.reload.grade
  end

  test "P on an A / B / C / Redo curriculum is off scale; B grades there" do
    @curriculum.update!(grading_scale: "letter_abc_redo")
    as_user(@instructor) do
      post "/api/v1/submissions/batch_grade", params: batch_params("P", [ @alice_submission ]), headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal "off_scale", response.parsed_body.dig("skipped", 0, "code")

    as_user(@instructor) do
      post "/api/v1/submissions/batch_grade", params: batch_params("B", [ @alice_submission ]), headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "B", @alice_submission.reload.grade
  end

  test "skips a learner whose progress was restarted while the request was in flight" do
    @alice_enrollment.update_columns(learning_state_reset_at: 1.minute.from_now)
    as_user(@instructor) do
      post "/api/v1/submissions/batch_grade", params: batch_params("P", [ @alice_submission, @bob_submission ]), headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal [ [ @alice_submission.id, "learning_state_reset" ] ], response.parsed_body.fetch("skipped").map { |row| row.values_at("submission_id", "code") }
    assert_nil @alice_submission.reload.grade
    assert_equal "P", @bob_submission.reload.grade
  end

  test "skips work a cohort copy moved after it was read" do
    @alice_enrollment.update_columns(content_moved_at: 1.minute.from_now)
    as_user(@instructor) do
      post "/api/v1/submissions/batch_grade", params: batch_params("P", [ @alice_submission ]), headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert_equal "content_moved", response.parsed_body.dig("skipped", 0, "code")
  end

  test "accepts a fresh matching grade suggestion, as a single grade does" do
    SchoolSetting.current.update!(features: { "github_app" => true, "github_grade_suggestions" => true })
    @curriculum.update!(grading_scale: "letter_abc_redo")
    @cohort.update!(settings: { "features" => { "github_app" => true, "github_grade_suggestions" => true } })
    suggestion = SubmissionGradeSuggestion.create!(submission: @alice_submission, enrollment: @alice_enrollment, content_block: @block,
      outcome: "suggest_b", suggested_grade: "B", reason_code: "all_required_checks_passed", reason_summary: "Every required check passed.",
      evidence: {}, evaluated_at: Time.current)

    as_user(@instructor) do
      get "/api/v1/submissions/batch_review", params: { cohort_id: @cohort.id }, headers: auth_headers
    end
    assert_response :success
    row = response.parsed_body.fetch("submissions").find { |item| item["id"] == @alice_submission.id }
    assert_equal "suggest_b", row.dig("grade_suggestion", "outcome")

    as_user(@instructor) do
      post "/api/v1/submissions/batch_grade", params: batch_params("B", [ @alice_submission ]), headers: auth_headers, as: :json
    end
    assert_response :success
    suggestion.reload
    assert_equal "accepted", suggestion.decision
    assert_equal @instructor.id, suggestion.decided_by_id
    assert_nil suggestion.override_reason
  end

  test "batch review lists the waiting exercises and the chosen exercise's work, inside the viewer's cohorts" do
    learner("hana", @cohort, block: @other_block)
    as_user(@instructor) do
      get "/api/v1/submissions/batch_review", headers: auth_headers
    end
    assert_response :success
    body = response.parsed_body
    assert_equal [ [ @block.id, 2 ], [ @other_block.id, 1 ] ], body.fetch("exercises").map { |row| row.values_at("content_block_id", "waiting") }
    exercise = body.fetch("exercise")
    assert_equal @block.id, exercise.fetch("content_block_id")
    assert_equal "pass_redo", exercise.fetch("grading_scale")
    assert_equal false, exercise.fetch("has_rubric")
    assert_equal "assert output.include?('10')", exercise.dig("submission_config", "runner", "checks", 0, "code")
    # Oldest first; Carol's cohort is not this instructor's.
    assert_equal [ @alice_submission.id, @bob_submission.id ], body.fetch("submissions").map { |row| row["id"] }
    assert_equal "puts 10", body.dig("submissions", 0, "text")
    assert_equal @alice_submission.updated_at.iso8601(6), body.dig("submissions", 0, "updated_at")
    assert_equal 2, body.fetch("total_count")
    assert_equal 50, body.fetch("max_batch_size")

    as_user(@instructor) do
      get "/api/v1/submissions/batch_review", params: { content_block_id: @other_block.id, cohort_id: @cohort.id }, headers: auth_headers
    end
    assert_response :success
    assert_equal @other_block.id, response.parsed_body.dig("exercise", "content_block_id")
    assert_equal 1, response.parsed_body.fetch("submissions").length

    as_user(@instructor) do
      get "/api/v1/submissions/batch_review", params: { cohort_id: @other_cohort.id }, headers: auth_headers
    end
    assert_response :forbidden
  end

  test "batch review of a block outside the viewer's curricula reveals nothing" do
    hidden = Curriculum.create!(name: "Hidden")
    mod = CurriculumModule.create!(curriculum: hidden, name: "Week 1", position: 0, day_offset: 0, schedule_days: "weekdays", module_type: :live_class)
    lesson = Lesson.create!(curriculum_module: mod, title: "Secret", position: 0, release_day: 0)
    block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "Secret", submission_type: :text_submission)
    as_user(@instructor) do
      get "/api/v1/submissions/batch_review", params: { content_block_id: block.id }, headers: auth_headers
    end
    assert_response :success
    assert_nil response.parsed_body.fetch("exercise")
    assert_equal [], response.parsed_body.fetch("submissions")
  end

  private

  def learner(name, cohort, block: @block, created_at: Time.current)
    user = User.create!(clerk_id: "batch_#{name}", email: "batch-#{name}@example.invalid", first_name: name.capitalize, last_name: "Learner", role: :student)
    enrollment = Enrollment.create!(user: user, cohort: cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: block.lesson.curriculum_module, unlocked: true)
    submission = Submission.create!(user: user, enrollment: enrollment, content_block: block, submission_type: :text_submission, text: "puts 10", created_at: created_at)
    [ user, enrollment, submission ]
  end

  def item(submission)
    { submission_id: submission.id, base_submission_updated_at: submission.reload.updated_at.iso8601(6) }
  end

  def batch_params(grade, submissions, feedback: nil)
    { grade: grade, feedback: feedback, items: submissions.map { |submission| item(submission) } }
  end

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
