require "test_helper"
require_relative "../support/query_counter"

# L-3.2 / L-5: staff record pages for a curriculum, a module and a lesson read
# GET /api/v1/records/:type/:id/usage. Admins see every cohort using the
# content; instructors see only the cohorts they teach, with the rest as a
# bare number. Students and unknown records get 404.
class RecordUsageTest < ActionDispatch::IntegrationTest
  include QueryCounter

  def setup
    travel_to Time.zone.local(2026, 11, 17, 9, 0)
    @curriculum = Curriculum.create!(name: "Usage curriculum", status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "JavaScript basics", position: 0, day_offset: 0, schedule_days: "weekdays")
    @later_module = CurriculumModule.create!(curriculum: @curriculum, name: "Functions", position: 1, day_offset: 7, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Make decisions", position: 0, release_day: 2)
    @second_lesson = Lesson.create!(curriculum_module: @module, title: "Loops", position: 1, release_day: 3)
    @rubric = Rubric.new(curriculum: @curriculum, title: "Ticket rubric")
    @rubric.rubric_criteria.build(title: "Correct", description: "Right price", position: 0)
    @rubric.save!
    @exercise = @lesson.content_blocks.create!(block_type: :exercise, title: "Ticket prices", position: 0, submission_type: :text_submission, rubric: @rubric)
    @second_lesson.content_blocks.create!(block_type: :text, title: "Read about loops", position: 0, body: "Loops repeat.")
    @objective = LearningObjective.create!(curriculum: @curriculum, code: "JS.4", title: "Choose a branch", success_criteria: "I can pick one.", position: 0)
    ObjectiveAlignment.create!(learning_objective: @objective, lesson: @lesson, position: 0)

    # Starts Tue, Nov 10; release day 2 opens two days in, on Nov 12 (cohort start + day offset).
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort Teal", start_date: Date.new(2026, 11, 10), end_date: Date.new(2027, 2, 1), status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort Coral", start_date: Date.new(2026, 12, 1), status: :upcoming)
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @outsider = person("outsider", :instructor)
    @student = person("student", :student)
    @coral_student = person("coral", :student)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort.cohort_instructor_assignments.create!(user: @outsider)
    @enrollment = enroll(@student, @cohort)
    @coral_enrollment = enroll(@coral_student, @other_cohort)
  end

  test "an admin sees every cohort using a lesson, with release dates, work and help counts" do
    submit(@enrollment, grade: :R)
    submit(@enrollment)
    submit(@coral_enrollment)
    help(@student, @cohort)
    help(@coral_student, @other_cohort, context_type: :exercise, context_id: @exercise.id)

    usage = fetch(@admin, "lesson", @lesson.id)
    assert_response :success
    assert_equal "private, no-store", response.headers["Cache-Control"]
    assert_equal [ "Usage curriculum", "JavaScript basics", 1, "Wednesday" ],
      [ usage.dig("curriculum", "name"), usage.dig("module", "name"), usage["week"], usage["day_name"] ]
    assert_equal true, usage["can_edit"]
    assert_equal [ [ @exercise.id, "exercise", true ] ], usage["blocks"].map { |block| block.values_at("id", "block_type", "has_work") }
    assert_equal [ "JS.4" ], usage["objectives"].map { |objective| objective["code"] }

    teal, coral = usage["cohorts"]
    assert_equal [ "Cohort Teal", "program", "2026-11-12", 2, 1, 1 ], teal.values_at("name", "course_delivery", "release_date", "submissions", "waiting", "open_help"),
      "Two attempts, one waiting (the latest), one open question"
    assert_equal [ "Cohort Coral", "2026-12-03", 1, 1, 1 ], coral.values_at("name", "release_date", "submissions", "waiting", "open_help")
    assert_equal 0, usage["other_cohorts_count"]
    assert_equal({ "submissions" => 3, "waiting" => 2, "open_help" => 2 }, usage["totals"])
    assert_equal [ @student.id, @coral_student.id ].sort, usage["help_requests"].map { |request| request.dig("student", "id") }.sort
    refute_includes response.body, "Synthetic", "Rows never carry answers or questions"
  end

  test "an instructor sees only the cohort they teach, and the others only as a number" do
    submit(@enrollment)
    submit(@coral_enrollment)
    help(@coral_student, @other_cohort)

    %w[lesson module curriculum].each do |type|
      id = { "lesson" => @lesson.id, "module" => @module.id, "curriculum" => @curriculum.id }.fetch(type)
      usage = fetch(@instructor, type, id)
      assert_response :success, type
      assert_equal [ "Cohort Teal" ], usage["cohorts"].map { |cohort| cohort["name"] }, type
      assert_equal 1, usage["other_cohorts_count"], type
      refute_includes response.body, "Cohort Coral", "#{type} never names a cohort the instructor doesn't teach"
      refute_includes response.body, @coral_student.full_name, type
      assert_equal 1, usage.dig("totals", "waiting"), "#{type} counts only Cohort Teal's work"
      assert_equal 0, usage.dig("totals", "open_help"), "#{type} counts only Cohort Teal's help"
      assert_equal false, usage["can_edit"], type
    end
    assert_empty fetch(@instructor, "lesson", @lesson.id)["help_requests"]
  end

  test "students, archived staff, unknown types and bad ids get 404" do
    [ [ "lesson", @lesson.id ], [ "module", @module.id ], [ "curriculum", @curriculum.id ] ].each do |type, id|
      fetch(@student, type, id)
      assert_response :not_found, "student #{type}"
      assert_equal({ "error" => "Not found" }, response.parsed_body)
    end
    @outsider.update!(archived_at: Time.current)
    fetch(@outsider, "lesson", @lesson.id)
    refute response.successful?, "An archived instructor reads nothing"
    fetch(@admin, "cohort", @cohort.id)
    assert_response :not_found
    fetch(@admin, "lesson", "12abc")
    assert_response :not_found
    fetch(@admin, "lesson", 0)
    assert_response :not_found
    fetch(@admin, "module", CurriculumModule.maximum(:id) + 1)
    assert_response :not_found
  end

  test "a module lists its lessons by week and day, and each cohort's schedule and grading load" do
    @cohort.update!(content_defaults: { @module.id.to_s => { "assigned" => true }, @later_module.id.to_s => { "assigned" => false } })
    submit(@enrollment)

    usage = fetch(@admin, "module", @module.id)
    assert_response :success
    assert_equal [ [ "Make decisions", 1, "Wednesday", true ], [ "Loops", 1, "Thursday", false ] ],
      usage["lessons"].map { |lesson| lesson.values_at("title", "week", "day_name", "has_work") }
    teal = usage["cohorts"].find { |cohort| cohort["id"] == @cohort.id }
    assert_equal [ true, "2026-11-10", "2026-11-13", 1, 1 ], teal.values_at("assigned", "starts_on", "ends_on", "submissions", "waiting")
    assert_equal false, fetch(@admin, "module", @later_module.id)["cohorts"].find { |cohort| cohort["id"] == @cohort.id }["assigned"]
  end

  test "a curriculum lists modules, cohorts with delivery, copy history, rubrics and objectives" do
    self_paced = Cohort.create!(curriculum: @curriculum, name: "Cohort Sand", start_date: Date.new(2026, 11, 1), status: :active,
      cohort_type: :workshop, course_delivery: "self_paced")
    @curriculum.update_columns(course_package_key: "synthetic-usage-package", course_package_revision: "r7")
    copy = Curriculum.create!(name: "Cohort Coral's copy", status: :active)
    CurriculumCopy.create!(cohort: @other_cohort, source_curriculum: @curriculum, copy_curriculum: copy, created_by: @outsider, counts: { "lessons" => 2 })
    teal_copy = Curriculum.create!(name: "Cohort Teal's copy", status: :active)
    CurriculumCopy.create!(cohort: @cohort, source_curriculum: @curriculum, copy_curriculum: teal_copy, created_by: @admin, counts: { "lessons" => 2 })

    usage = fetch(@admin, "curriculum", @curriculum.id)
    assert_response :success
    assert_equal [ [ "JavaScript basics", 2 ], [ "Functions", 0 ] ], usage["modules"].map { |mod| mod.values_at("name", "lessons_count") }
    assert_equal [ [ "Cohort Sand", "self_paced" ], [ "Cohort Teal", "program" ], [ "Cohort Coral", "program" ] ],
      usage["cohorts"].map { |cohort| cohort.values_at("name", "course_delivery") }
    assert_equal({ "Cohort Sand" => 0, "Cohort Teal" => 1, "Cohort Coral" => 1 }, usage["cohorts"].to_h { |cohort| cohort.values_at("name", "students") })
    assert_equal [ true, "r7" ], usage.values_at("imported", "package_revision")
    assert_equal [ "Cohort Teal's copy", "Cohort Coral's copy" ], usage["copies"].map { |row| row.dig("copy_curriculum", "name") }
    assert_equal 0, usage["other_copies_count"]
    assert_equal [ [ "Ticket rubric", 1, [ "Make decisions" ] ] ], usage["rubrics"].map { |rubric| [ rubric["title"], rubric["criteria_count"], rubric["lessons"].map { |lesson| lesson["title"] } ] }
    assert_equal [ [ "JS.4", [ "Make decisions" ] ] ], usage["objectives"].map { |objective| [ objective["code"], objective["lessons"].map { |lesson| lesson["title"] } ] }
    assert_nil fetch(@admin, "curriculum", self_paced.curriculum_id)["copy_of"]

    copied = fetch(@admin, "curriculum", copy.id)
    assert_equal [ "Cohort Coral", "Usage curriculum" ], [ copied.dig("copy_of", "cohort", "name"), copied.dig("copy_of", "source_curriculum", "name") ]

    instructor_view = fetch(@instructor, "curriculum", @curriculum.id)
    assert_equal [ "Cohort Teal's copy" ], instructor_view["copies"].map { |row| row.dig("copy_curriculum", "name") }
    assert_equal 1, instructor_view["other_copies_count"]
    refute_includes response.body, "Cohort Coral\""
    hidden = fetch(@instructor, "curriculum", copy.id)
    assert_nil hidden.dig("copy_of", "cohort"), "The copy's cohort is not one the instructor teaches"
    assert_equal "Usage curriculum", hidden.dig("copy_of", "source_curriculum", "name")
  end

  # Fix round 1 (P3): "1 open help" on a lesson or module opens exactly that help in Support.
  test "Support narrows help to one lesson or one module, inside the viewer's cohorts" do
    on_lesson = help(@student, @cohort)
    on_exercise = help(@student, @cohort, context_type: :exercise, context_id: @exercise.id)
    on_other_lesson = help(@student, @cohort, context_id: @second_lesson.id)
    elsewhere = Lesson.create!(curriculum_module: @later_module, title: "Functions intro", position: 0, release_day: 0)
    in_other_module = help(@student, @cohort, context_id: elsewhere.id)
    coral = help(@coral_student, @other_cohort)

    queue = support(@instructor, lesson_id: @lesson.id)
    assert_equal [ on_lesson.id, on_exercise.id ].sort, queue["help_requests"].map { |request| request["id"] }.sort,
      "Not the other lesson's question, and not Cohort Coral's"
    assert_equal({ "type" => "lesson", "id" => @lesson.id, "name" => "Make decisions" }, queue["help_filter"])
    assert_equal 2, queue.dig("summary", "open_help_count")

    module_queue = support(@instructor, module_id: @module.id, cohort_id: @cohort.id)
    assert_equal [ on_lesson.id, on_exercise.id, on_other_lesson.id ].sort, module_queue["help_requests"].map { |request| request["id"] }.sort
    refute_includes module_queue["help_requests"].map { |request| request["id"] }, in_other_module.id

    assert_includes support(@admin, lesson_id: @lesson.id)["help_requests"].map { |request| request["id"] }, coral.id
    assert_empty support(@instructor, lesson_id: "abc")["help_requests"], "A malformed id matches nothing"
    foreign = Lesson.create!(curriculum_module: CurriculumModule.create!(curriculum: Curriculum.create!(name: "Elsewhere"), name: "M", position: 0, day_offset: 0, schedule_days: "daily"), title: "Secret title", position: 0, release_day: 0)
    filtered = support(@instructor, lesson_id: foreign.id)
    assert_nil filtered.dig("help_filter", "name"), "A lesson outside the viewer's cohorts is never named"
    refute_includes response.body, "Secret title"
  end

  # Fix round 2 (P3): Cohort Coral's newer questions don't push Teal's out of the preview.
  test "the lesson's help preview keeps up to five per cohort" do
    travel_to 2.days.ago do
      help(@student, @cohort)
    end
    teal_question = HelpRequest.where(cohort: @cohort).sole
    6.times do |i|
      learner = person("coral#{i}", :student)
      enroll(learner, @other_cohort)
      help(learner, @other_cohort)
    end

    preview = fetch(@admin, "lesson", @lesson.id)["help_requests"]
    assert_includes preview.map { |request| request["id"] }, teal_question.id
    assert_equal [ 5, 1 ], [ preview.count { |request| request["cohort_id"] == @other_cohort.id }, preview.count { |request| request["cohort_id"] == @cohort.id } ]
    assert_equal preview.map { |request| request["created_at"] }.sort.reverse, preview.map { |request| request["created_at"] }, "Newest first"
  end

  test "help counts are left out where help requests are switched off" do
    @cohort.update!(settings: { features: { help_requests: false } })
    help(@student, @cohort)
    usage = fetch(@instructor, "lesson", @lesson.id)
    assert_nil usage["cohorts"].first["open_help"]
    assert_nil usage.dig("totals", "open_help")
    assert_empty usage["help_requests"]
  end

  # Each viewer and type measures its own growth: the fixtures are rebuilt for
  # every combination, so each one compares one of everything with four.
  [ :admin, :instructor ].product(%w[lesson module curriculum]).each do |role, type|
    test "#{type} usage for #{role} keeps the same query count as cohorts, lessons and work grow" do
      viewer = role == :admin ? @admin : @instructor
      id = { "lesson" => @lesson.id, "module" => @module.id, "curriculum" => @curriculum.id }.fetch(type)
      sizes = []
      counts = [ 1, 4 ].map do |size|
        grow(size)
        sizes << [ Cohort.where(curriculum: @curriculum).count, Submission.count, Lesson.count, Rubric.count, CurriculumCopy.count ]
        fetch(viewer, type, id)
        assert_response :success
        count_queries { fetch(viewer, type, id) }
      end
      assert_operator sizes.last.zip(sizes.first).map { |after, before| after - before }.min, :>=, 3, "Every kind of record grew by three: #{sizes.inspect}"
      assert_equal counts.first, counts.last, "#{role} #{type} usage sent #{counts.join(' then ')} queries"
    end
  end

  test "a team member page stays flat as cohorts taught, waiting work and owned follow-ups grow" do
    sizes = []
    counts = [ 1, 4 ].map do |size|
      grow(size)
      sizes << @instructor.cohort_instructor_assignments.count
      while Intervention.where(owner: @instructor).count < size
        enrollment = Enrollment.where.not(cohort_id: @other_cohort.id).where.not(id: Intervention.select(:enrollment_id)).first
        Intervention.create!(enrollment: enrollment, owner: @instructor, created_by: @admin, trigger_type: :manual, action_summary: "Synthetic", next_follow_up_at: 1.day.from_now)
      end
      get_team_member(@instructor)
      assert_response :success
      count_queries { get_team_member(@instructor) }
    end
    assert_equal 3, sizes.last - sizes.first, "Cohorts taught grew between the measurements"
    assert_equal counts.first, counts.last, "team member page sent #{counts.join(' then ')} queries"
    assert_equal 4, response.parsed_body.dig("team_member", "workload", "follow_ups_count")
  end

  private

  def get_team_member(member)
    payload = { "sub" => @admin.clerk_id, "email" => @admin.email, "first_name" => @admin.first_name, "last_name" => @admin.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    get "/api/v1/team_members/#{member.id}", headers: { "Authorization" => "Bearer test_token" }
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end

  def grow(size)
    @grown ||= 0
    while @grown < size
      i = @grown
      @grown += 1
      cohort = Cohort.create!(curriculum: @curriculum, name: "Grown #{i}", start_date: Date.new(2026, 11, 10), status: :active, course_delivery: i.even? ? "program" : "self_paced", cohort_type: i.even? ? :bootcamp : :workshop)
      cohort.cohort_instructor_assignments.create!(user: @instructor)
      learner = person("grown#{i}", :student)
      enrollment = enroll(learner, cohort)
      Submission.create!(user: learner, enrollment: enrollment, content_block: @exercise, submission_type: :text_submission, text: "Synthetic #{i}")
      help(learner, cohort)
      lesson = Lesson.create!(curriculum_module: @module, title: "Grown lesson #{i}", position: 10 + i, release_day: 0)
      block = lesson.content_blocks.create!(block_type: :exercise, title: "Grown exercise #{i}", position: 0, submission_type: :text_submission, rubric: @rubric)
      Submission.create!(user: learner, enrollment: enrollment, content_block: block, submission_type: :text_submission, text: "Synthetic grown #{i}")
      @lesson.content_blocks.create!(block_type: :text, title: "Extra #{i}", position: 10 + i, body: "More")
      CurriculumModule.create!(curriculum: @curriculum, name: "Grown module #{i}", position: 10 + i, day_offset: 0, schedule_days: "weekdays")
      rubric = Rubric.new(curriculum: @curriculum, title: "Grown rubric #{i}")
      rubric.rubric_criteria.build(title: "C#{i}", description: "Criterion", position: 0)
      rubric.save!
      objective = LearningObjective.create!(curriculum: @curriculum, code: "G.#{i}", title: "Grown #{i}", success_criteria: "Yes", position: 10 + i)
      ObjectiveAlignment.create!(learning_objective: objective, lesson: lesson, position: 0)
      copy = Curriculum.create!(name: "Grown copy #{i}")
      CurriculumCopy.create!(cohort: cohort, source_curriculum: @curriculum, copy_curriculum: copy, created_by: @admin)
      Cohort.create!(curriculum: @curriculum, name: "Unassigned #{i}", start_date: Date.new(2026, 11, 10), status: :active)
    end
  end

  def person(name, role)
    User.create!(clerk_id: "usage_#{name}", email: "usage-#{name}@example.invalid", first_name: "Usage", last_name: name.capitalize, role: role)
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

  def help(student, cohort, context_type: :lesson, context_id: @lesson.id)
    HelpRequest.create!(student: student, cohort: cohort, category: :concept, context_type: context_type, context_id: context_id, status: :open,
      context_label: "Make decisions", context_path: "/lessons/#{@lesson.id}", message: "Synthetic question")
  end

  def support(user, **params)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    get "/api/v1/support_queue", params: params, headers: { "Authorization" => "Bearer test_token" }
    assert_response :success
    response.parsed_body["support_queue"]
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end

  def fetch(user, type, id)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    get "/api/v1/records/#{type}/#{id}/usage", headers: { "Authorization" => "Bearer test_token" }
    response.parsed_body["usage"]
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
