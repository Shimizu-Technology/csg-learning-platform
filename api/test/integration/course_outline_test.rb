require "test_helper"
require_relative "../support/query_counter"

# W8 PR 8.1: the one course outline (C-2, U-5.6, S-1, S-9). Statuses, counts
# and the next lesson come from LearnerProgress; kinds from the lesson's
# blocks; program weeks carry dates, self-paced sections never do.
class CourseOutlineTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    @curriculum = Curriculum.create!(name: "Outline curriculum")
    @foundations = @curriculum.modules.create!(name: "Foundations", position: 0, day_offset: 0, schedule_days: "weekdays")
    @dom = @curriculum.modules.create!(name: "The DOM", position: 1, day_offset: 14, schedule_days: "weekdays")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Outline cohort", start_date: Date.current - 9, end_date: Date.current + 60, status: :active)
    @teacher = person("teacher", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @student = person("alex", :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    [ @foundations, @dom ].each { |mod| @enrollment.module_assignments.create!(curriculum_module: mod) }

    # Week 1: a reading done, an exercise graded Redo, an imported "exercise"
    # that is really a video. Week 2: the next exercise and a checkpoint.
    @reading = lesson(@foundations, "Intro to Functions", 0, 0, :reading)
    @redo = lesson(@foundations, "Functions Recap", 1, 1, :work)
    @video = lesson(@foundations, "Working with the DOM", 2, 2, :imported_video)
    @next = lesson(@foundations, "Loops and Iteration", 0, 7, :work)
    @check = lesson(@foundations, "Check: if and else", 1, 8, :checkpoint)
    @locked = lesson(@dom, "Array Methods", 0, 0, :reading)
    complete(@reading)
    @redo_submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @redo.content_blocks.last, text: "Answer", grade: "R", graded_at: 1.hour.ago)
    complete(@video)
  end

  test "a program outline has weeks with dates, real kinds, server statuses and the next lesson" do
    get "/api/v1/course_outline", params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_response :success
    outline = response.parsed_body["outline"]
    assert_equal "program", outline["mode"]
    assert_equal({ "completed_lessons" => 2, "total_lessons" => 6 }, outline["counts"])
    assert_equal({ "current" => 2, "total" => 10 }, outline["course_week"])

    foundations = outline["modules"].first
    assert_equal [ "Week 1", "Week 2" ], foundations["groups"].map { |group| group["label"] }
    week1, week2 = foundations["groups"]
    assert_equal({ "completed_lessons" => 2, "total_lessons" => 3 }, week1["counts"])
    assert_equal [ "reading", "exercise", "video" ], week1["lessons"].map { |item| item["kind"] }, "imports store exercise for every lesson; the kind comes from the blocks"
    assert_equal [ "done", "redo", "done" ], week1["lessons"].map { |item| item["status"] }
    assert_equal @redo_submission.content_block_id, week1["lessons"].second["redo_block_id"], "a redo row opens at its block"
    assert_equal @cohort.start_date.to_s, week1["opens_on"]
    assert_equal [ "exercise", "checkpoint" ], week2["lessons"].map { |item| item["kind"] }
    assert week2["this_week"], "the week that opened most recently is this week"

    # The redo is the first required lesson the learner can act on, so it is next and its week opens.
    assert_equal @redo.id, outline.dig("next_lesson", "id")
    assert_equal week1["key"], outline["current_group_key"]
    assert week1["current"]
    refute week2["current"]
    assert_equal({ "todo" => 3, "redo" => 1 }, outline["filters"])

    dom = outline["modules"].second
    assert_equal false, dom["available"]
    locked = dom["groups"].sole["lessons"].sole
    assert_equal [ "Week 3", "upcoming", false, (@cohort.start_date + 14).to_s ], [ dom["groups"].sole["label"], locked["status"], locked["todo"], locked["opens_on"] ]

    # Learn and Today read the same numbers and next step.
    get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers(@student)
    dashboard = response.parsed_body["dashboard"]
    assert_equal outline["counts"], dashboard["overall_progress"].slice("completed_lessons", "total_lessons")
    assert_equal outline.dig("next_lesson", "id"), dashboard.dig("continue_lesson", "id")
    assert_equal week1["lessons"].map { |item| item["kind"] }, dashboard["modules"].first["lessons"].first(3).map { |item| item["kind"] }
    assert_equal true, dashboard.dig("cohort", "features", "student_experience_v2"), "the switch defaults on"
  end

  test "self-paced sections are numbered in course order without dates" do
    @cohort.update!(course_delivery: "self_paced", support_instructor: @teacher)
    get "/api/v1/course_outline", params: { cohort_id: @cohort.id }, headers: headers(@student)
    outline = response.parsed_body["outline"]
    assert_equal "self_paced", outline["mode"]
    assert_nil outline["course_week"]
    groups = outline["modules"].flat_map { |mod| mod["groups"] }
    assert groups.all? { |group| group["opens_on"].nil? && group["week"].nil? }, "self-paced ignores unlock dates (S-1)"
    assert groups.flat_map { |group| group["lessons"] }.all? { |item| item["opens_on"].nil? }
    assert_equal [ "Part 1 · lessons 1–3", "Part 2 · lessons 4–5", nil ], groups.map { |group| group["label"] }
    assert_equal (1..6).to_a, groups.flat_map { |group| group["lessons"].map { |item| item["number"] } }
    assert_equal [ 1, 2 ], outline["modules"].map { |mod| mod["number"] }
    assert outline["modules"].second["available"], "self-paced modules open as soon as they are assigned"
  end

  test "the alumni library is browsed, not tracked" do
    @cohort.update!(cohort_type: :alumni)
    get "/api/v1/course_outline", params: { cohort_id: @cohort.id }, headers: headers(@student)
    outline = response.parsed_body["outline"]
    assert_equal "library", outline["mode"]
    assert_nil outline["counts"]
    assert_nil outline["next_lesson"]
    assert_equal({ "todo" => 0, "redo" => 1 }, outline["filters"])
    assert outline["modules"].all? { |mod| mod["counts"].nil? && mod["groups"].size == 1 && mod["groups"].sole["label"].nil? }
  end

  test "a paused learner reads past lessons without a next step" do
    @enrollment.update!(status: :paused, paused_at: Time.current)
    get "/api/v1/course_outline", params: { cohort_id: @cohort.id }, headers: headers(@student)
    outline = response.parsed_body["outline"]
    assert outline["read_only"]
    assert_equal "paused", outline["enrollment_status"]
    assert_equal LearningCalendar.today.to_s, outline["paused_since"]
    assert_nil outline["next_lesson"]
    assert_equal 0, outline.dig("filters", "todo")
    titles = outline["modules"].flat_map { |mod| mod["groups"].flat_map { |group| group["lessons"].map { |item| item["title"] } } }
    refute_includes titles, @locked.title, "newer content stays hidden while paused"
  end

  test "a personal plan decides what counts and what is next" do
    @enrollment.create_learning_plan!(title: "Plan", active: true, target_date: Date.current + 14,
      milestones: [ { "title" => "Loops first", "due_on" => (Date.current + 7).iso8601, "lesson_ids" => [ @next.id ] } ],
      lesson_overrides: [ { "lesson_id" => @redo.id, "required" => false, "reason" => "Covered in class" } ])
    get "/api/v1/course_outline", params: { cohort_id: @cohort.id }, headers: headers(@student)
    outline = response.parsed_body["outline"]
    assert_equal @next.id, outline.dig("next_lesson", "id"), "the plan's milestone order wins"
    week1 = outline["modules"].first["groups"].first
    assert_equal false, week1["lessons"].second["required"]
    assert_equal({ "completed_lessons" => 2, "total_lessons" => 2 }, week1["counts"], "an optional lesson is not counted")
  end

  test "access follows the cohort and staff read one enrolled learner" do
    other = Cohort.create!(curriculum: @curriculum, name: "Other cohort", start_date: Date.current, status: :active)
    get "/api/v1/course_outline", params: { cohort_id: other.id }, headers: headers(@student)
    assert_response :forbidden
    get "/api/v1/course_outline", params: { cohort_id: 0 }, headers: headers(@student)
    assert_response :forbidden
    get "/api/v1/course_outline", headers: headers(@student)
    assert_response :success
    assert_equal @cohort.id, response.parsed_body.dig("outline", "cohort", "id")
    get "/api/v1/course_outline", headers: headers(person("unenrolled", :student))
    assert_response :not_found

    get "/api/v1/course_outline", params: { cohort_id: @cohort.id }, headers: headers(@teacher)
    assert_response :unprocessable_entity
    get "/api/v1/course_outline", params: { cohort_id: @cohort.id, student_id: @student.id }, headers: headers(@teacher)
    assert_response :success
    assert_equal @redo.id, response.parsed_body.dig("outline", "next_lesson", "id")
    get "/api/v1/course_outline", params: { cohort_id: other.id, student_id: @student.id }, headers: headers(@teacher)
    assert_response :forbidden
  end

  test "queries stay flat as the course grows" do
    measure = lambda do
      count_queries { get "/api/v1/course_outline", params: { cohort_id: @cohort.id }, headers: headers(@student) }.tap { assert_response :success }
    end
    measure.call
    baseline = measure.call
    extra = @curriculum.modules.create!(name: "Extra", position: 2, day_offset: 28, schedule_days: "weekdays")
    @enrollment.module_assignments.create!(curriculum_module: extra, unlocked: true)
    12.times { |index| lesson(extra, "Extra #{index}", index % 3, (index / 3) * 7, index.even? ? :work : :imported_video) }
    lone = lesson(@dom, "Assigned on its own", 1, 1, :checkpoint)
    @enrollment.lesson_assignments.create!(lesson: lone, unlocked: true)
    Submission.create!(user: @student, enrollment: @enrollment, content_block: extra.lessons.first.content_blocks.last, text: "Answer", grade: "R", graded_at: Time.current)
    extra.lessons.each { |item| complete(item) if item.position == 1 }
    grown = measure.call
    assert_operator response.parsed_body.dig("outline", "lesson_count"), :>=, 19, "the fixture really grew"
    assert_equal baseline, grown, "an outline costs the same queries for 6 lessons or 19"
  end

  test "the switch is an ordinary feature: school default on, cohort override off, audited" do
    admin = person("admin", :admin)
    get "/api/v1/feature_settings", headers: headers(admin)
    assert_equal true, response.parsed_body.dig("features", "student_experience_v2")
    patch "/api/v1/cohorts/#{@cohort.id}/feature_settings", params: { features: { student_experience_v2: false } }, headers: headers(admin), as: :json
    assert_response :success
    assert_equal({ "student_experience_v2" => false }, response.parsed_body["overrides"])
    assert_equal admin, FeatureSwitchChange.last.actor

    get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: headers(@student)
    assert_equal false, response.parsed_body.dig("dashboard", "cohort", "features", "student_experience_v2")
    assert_equal false, response.parsed_body.dig("dashboard", "capabilities", "features", "student_experience_v2")
    post "/api/v1/sessions", headers: headers(@student)
    assert_equal false, response.parsed_body["enrollments"].sole.dig("cohort", "features", "student_experience_v2")
    assert_equal true, response.parsed_body.dig("school", "features", "student_experience_v2")
    get "/api/v1/cohorts/accessible", headers: headers(@student)
    assert_equal false, response.parsed_body["cohorts"].sole.dig("capabilities", "features", "student_experience_v2")
  end

  private

  def lesson(mod, title, position, release_day, shape)
    lesson = mod.lessons.create!(title: title, position: position, release_day: release_day, lesson_type: :exercise)
    case shape
    when :reading
      lesson.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "Text")
    when :work
      lesson.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "Text")
      lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Practice", submission_type: :text_submission)
    when :imported_video
      lesson.content_blocks.create!(block_type: :video, position: 0, title: "Watch", video_url: "https://www.youtube.com/watch?v=example")
      lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "Instructions", body: "Follow along")
    when :checkpoint
      lesson.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "Text")
      lesson.content_blocks.create!(block_type: :checkpoint, position: 1, title: "Check")
    end
    lesson
  end

  def complete(lesson)
    lesson.completion_blocks.each do |block|
      Progress.create!(enrollment: @enrollment, user: @student, content_block: block, status: :completed, completed_at: 1.day.ago)
    end
  end

  def person(name, role)
    User.create!(clerk_id: "outline_#{name}", email: "outline-#{name}@example.com", first_name: name.capitalize, last_name: "Synthetic", role: role)
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
end
