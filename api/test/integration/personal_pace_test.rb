require "test_helper"
require_relative "../support/query_counter"

# W9.1: a personal start date per enrollment (AS-1) and a learner-chosen pace
# (AS-2), for cohorts that turn it on with `learner_pace_weeks`.
class PersonalPaceTest < ActionDispatch::IntegrationTest
  include QueryCounter

  ZONE = Time.find_zone!("Pacific/Guam")
  # Wednesday; the guided cohort started Monday.
  NOW = ZONE.local(2026, 11, 18, 10)

  setup do
    travel_to NOW
    @curriculum = Curriculum.create!(name: "Python Fundamentals")
    @module = @curriculum.modules.create!(name: "Python", position: 0, day_offset: 0, schedule_days: "weekdays")
    # Twelve lessons over three curriculum weeks, then the final project.
    @lessons = (0..11).map { |index| lesson("Lesson #{index + 1}", (index / 4) * 7 + (index % 4)) }
    @project = lesson("Final project", 18, type: :project)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Python pilot", start_date: Date.new(2026, 11, 16), end_date: Date.new(2027, 1, 29),
      status: :active, course_delivery: "guided", learner_pace_weeks: [ 6, 3, 4 ], settings: { "features" => { "student_experience_v2" => true } })
    @teacher = person("leon", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @student = person("rehearsal", :student)
    @enrollment = enroll(@student, @cohort)
  end

  teardown { travel_back }

  test "the setting is off by default, normalized, and only for guided or self-paced courses" do
    program = Cohort.create!(curriculum: @curriculum, name: "Program", start_date: Date.new(2026, 10, 5))
    assert_nil program.learner_pace_weeks
    assert_not program.personal_pace?
    assert_equal [ 3, 4, 6 ], @cohort.learner_pace_weeks
    assert @cohort.personal_release?

    program.learner_pace_weeks = [ 4 ]
    assert_not program.valid?
    assert_includes program.errors[:learner_pace_weeks], "are only for guided or self-paced courses"
    @cohort.learner_pace_weeks = [ 0, 4 ]
    assert_not @cohort.valid?
    @cohort.learner_pace_weeks = [ 1, 2, 3, 4, 5 ]
    assert_not @cohort.valid?, "at most four choices"
    @cohort.learner_pace_weeks = []
    assert @cohort.valid?
    assert_nil @cohort.learner_pace_weeks, "an empty list is off"

    alumni = Cohort.create!(curriculum: @curriculum, name: "Library", start_date: Date.new(2026, 1, 5), cohort_type: :alumni, course_delivery: "guided")
    alumni.learner_pace_weeks = [ 4 ]
    assert_not alumni.valid?
  end

  test "staff turn pace on and off through the cohort settings" do
    admin = person("admin", :admin)
    patch "/api/v1/cohorts/#{@cohort.id}", params: { learner_pace_weeks: [ 4, 3 ] }, headers: headers(admin), as: :json
    assert_response :success
    assert_equal [ 3, 4 ], response.parsed_body.dig("cohort", "learner_pace_weeks")
    patch "/api/v1/cohorts/#{@cohort.id}", params: { learner_pace_weeks: nil }, headers: headers(admin), as: :json
    assert_response :success
    assert_nil response.parsed_body.dig("cohort", "learner_pace_weeks")
    assert_not @cohort.reload.personal_pace?
  end

  test "every lesson opens on the learner's own start: the cohort start, or their first open when later" do
    # Before the learner opens the course their start is the cohort's.
    assert_equal Date.new(2026, 11, 16), @enrollment.personal_start_on
    assert @lessons.all? { |item| LessonReadAccess.check(@student, item).allowed? }, "week 3 lessons are open on day one"
    assert LessonReadAccess.check(@student, @project).allowed?

    fetch_today
    assert_equal NOW, @enrollment.reload.first_opened_at
    assert_equal Date.new(2026, 11, 18), @enrollment.personal_start_on
    assert_nil @enrollment.support_expires_at, "guided support terms are not touched"

    # The lookup path (record pages) decides the same way from its partial rows.
    @lessons.each { |item| assert LessonReadAccess.lookup(@student, item.id).allowed? }
  end

  test "a late joiner and a staff-set start each get their own dates, and a future start keeps lessons closed" do
    travel_to NOW + 7.days
    late = person("late", :student)
    late_enrollment = enroll(late, @cohort)
    fetch_today(late)
    assert_equal Date.new(2026, 11, 25), late_enrollment.reload.personal_start_on

    admin = person("admin", :admin)
    put "/api/v1/enrollments/#{late_enrollment.id}/pace", params: { starts_on: "2026-12-02" }, headers: headers(admin), as: :json
    assert_response :success
    assert_equal "2026-12-02", response.parsed_body.dig("personal_pace", "starts_on")
    assert response.parsed_body.dig("personal_pace", "start_set_by_staff")
    result = LessonReadAccess.check(late, @lessons.first)
    assert_equal LessonReadAccess::NOT_UNLOCKED, result.error
    assert_equal LessonReadAccess::NOT_UNLOCKED, LessonReadAccess.lookup(late, @lessons.first.id).error

    outline = fetch_outline(late)
    first = outline["modules"].first["groups"].first["lessons"].first
    assert_equal [ false, "2026-12-02", "upcoming" ], first.values_at("available", "opens_on", "status")
    assert_equal "self_paced", outline["mode"]
    assert_equal({ "starts_on" => "2026-12-02", "weeks" => nil, "ends_on" => nil }, outline["personal_pace"])

    # Clearing it returns the learner to their own first-open start.
    put "/api/v1/enrollments/#{late_enrollment.id}/pace", params: { starts_on: nil }, headers: headers(admin), as: :json
    assert_response :success
    assert_equal "2026-11-25", response.parsed_body.dig("personal_pace", "starts_on")
    assert LessonReadAccess.check(late, @lessons.first).allowed?

    # A staff module date still wins over the personal start.
    late_enrollment.module_assignments.first.update!(unlock_date_override: Date.new(2026, 12, 9))
    assert_not LessonReadAccess.check(late, @lessons.first).allowed?
  end

  test "a learner picks 4 weeks and gets weekly milestones and one firm final-project date" do
    fetch_today
    pace = choose(4)
    assert_equal [ 4, "learner_pace", "on_track", "2026-11-18", "2026-12-15", 1, 2 ],
      pace.values_at("weeks", "plan_source", "status", "starts_on", "ends_on", "current_week", "changes_left")
    assert_equal [ [ "Week 1", "2026-11-24", 3 ], [ "Week 2", "2026-12-01", 3 ], [ "Week 3", "2026-12-08", 3 ], [ "Week 4", "2026-12-15", 3 ], [ "Final project", "2026-12-15", 1 ] ],
      pace["milestones"].map { |item| item.values_at("title", "due_on", "total") }
    assert_equal({ "lesson_id" => @project.id, "title" => "Final project", "due_on" => "2026-12-15", "status" => "open" }, pace["final_project"])
    assert_equal({ "id" => @student.id, "full_name" => "Rehearsal Synthetic" }, pace["chosen_by"])

    plan = @enrollment.reload.learning_plan
    assert_equal [ "learner_pace", 4, 0, Date.new(2026, 12, 15) ], [ plan.source, plan.pace_weeks, plan.pace_changes_count, plan.target_date ]
    assert_equal @lessons.first(3).map(&:id), plan.milestones.first["lesson_ids"]

    today = fetch_today
    assert_equal "Week 1", today.dig("personal_pace", "next_milestone", "title")
    assert_equal @lessons.first(3).map(&:id), today.dig("personal_pace", "next_milestone", "lessons").map { |item| item["id"] }
    assert_nil today["catch_up_plan"], "a chosen pace is not a catch-up plan"
    assert_nil today["this_week"]
    assert_nil today["course_week"]
    assert_equal false, today["can_ask_for_plan"]
    assert_equal({ "behind" => false, "weeks_behind" => 0, "overdue_count" => 0 }, today["pace"])
    assert_nil today.dig("next_lesson", "week")

    outline = fetch_outline
    lessons = outline["modules"].flat_map { |mod| mod["groups"].flat_map { |group| group["lessons"] } }
    assert_equal "2026-11-24", lessons.find { |item| item["id"] == @lessons.first.id }["due_on"]
    assert_equal "2026-12-15", lessons.find { |item| item["id"] == @project.id }["due_on"]
    assert_equal({ "starts_on" => "2026-11-18", "weeks" => 4, "ends_on" => "2026-12-15" }, outline["personal_pace"])
  end

  test "falling behind a milestone shows how far behind, and finishing it clears that" do
    fetch_today
    choose(4)
    complete(@lessons[0])
    travel_to NOW + 7.days # Nov 25: Week 1 was due Nov 24.
    today = fetch_today
    assert_equal [ "behind", 1 ], today["personal_pace"].values_at("status", "weeks_behind")
    assert_equal({ "behind" => true, "weeks_behind" => 1, "overdue_count" => 2 }, today["pace"])
    assert_equal %w[behind current upcoming upcoming upcoming], today.dig("personal_pace", "milestones").map { |item| item["status"] }
    assert_equal [ "Week 1", 1, 3 ], today.dig("personal_pace", "next_milestone").values_at("title", "completed", "total")

    @lessons[1..2].each { |item| complete(item) }
    today = fetch_today
    assert_equal [ "on_track", 0 ], today["personal_pace"].values_at("status", "weeks_behind")
    assert_equal "Week 2", today.dig("personal_pace", "next_milestone", "title")
    assert_equal 2, today.dig("personal_pace", "current_week")
  end

  test "changing to 6 weeks keeps finished past milestones, spreads the rest, and keeps the history" do
    fetch_today
    choose(4)
    @lessons.first(2).each { |item| complete(item) }
    travel_to NOW + 10.days # Nov 28, week 2.
    pace = choose(6)
    assert_equal [ 6, "2026-12-29", 1 ], pace.values_at("weeks", "ends_on", "changes_left")
    # Week 1 keeps the two lessons finished in it; the other ten move to weeks 2 to 6.
    assert_equal [ [ "Week 1", "2026-11-24", 2 ], [ "Week 2", "2026-12-01", 2 ], [ "Week 3", "2026-12-08", 2 ], [ "Week 4", "2026-12-15", 2 ],
      [ "Week 5", "2026-12-22", 2 ], [ "Week 6", "2026-12-29", 2 ], [ "Final project", "2026-12-29", 1 ] ],
      pace["milestones"].map { |item| item.values_at("title", "due_on", "total") }
    assert_equal "on_track", pace["status"]

    plan = @enrollment.reload.learning_plan
    assert_equal [ 6, 1 ], [ plan.pace_weeks, plan.pace_changes_count ]
    assert_equal [ 4, 6 ], plan.revisions.order(:id).map { |revision| revision.snapshot["pace_weeks"] }
    assert_equal [ @student.id ], plan.revisions.map(&:author_id).uniq

    # Picking the same pace again changes nothing.
    choose(6)
    assert_equal [ 1, 2 ], [ plan.reload.pace_changes_count, plan.revisions.count ]

    choose(3)
    put "/api/v1/enrollments/#{@enrollment.id}/pace", params: { weeks: 4 }, headers: headers(@student), as: :json
    assert_response :forbidden
    assert_match(/changed your pace 2 times/, response.parsed_body["error"])
    assert_equal false, fetch_today.dig("personal_pace", "can_change")
  end

  test "learners can only choose offered paces for their own enrollment, and only staff set a start" do
    fetch_today
    put "/api/v1/enrollments/#{@enrollment.id}/pace", params: { weeks: 5 }, headers: headers(@student), as: :json
    assert_response :unprocessable_entity
    put "/api/v1/enrollments/#{@enrollment.id}/pace", params: { starts_on: "2026-12-01" }, headers: headers(@student), as: :json
    assert_response :forbidden
    other = person("other", :student)
    enroll(other, @cohort)
    get "/api/v1/enrollments/#{@enrollment.id}/pace", headers: headers(other)
    assert_response :forbidden
    put "/api/v1/enrollments/#{@enrollment.id}/pace", params: { weeks: 4 }, headers: headers(other), as: :json
    assert_response :forbidden
    outsider = person("outsider", :instructor)
    get "/api/v1/enrollments/#{@enrollment.id}/pace", headers: headers(outsider)
    assert_response :forbidden
    assert_nil @enrollment.reload.learning_plan
  end

  test "staff see and override the pace, and an edited plan becomes a staff plan the learner can't replace" do
    fetch_today
    choose(4)
    choose(6)
    get "/api/v1/enrollments/#{@enrollment.id}/pace", headers: headers(@teacher)
    assert_response :success
    assert_equal [ 6, 1, "Rehearsal Synthetic" ], response.parsed_body["personal_pace"].values_at("weeks", "changes_left").push(response.parsed_body.dig("personal_pace", "chosen_by", "full_name"))

    put "/api/v1/enrollments/#{@enrollment.id}/pace", params: { weeks: 8 }, headers: headers(@teacher), as: :json
    assert_response :success
    pace = response.parsed_body["personal_pace"]
    assert_equal [ 8, 1, "Leon Synthetic", "learner_pace" ], [ pace["weeks"], pace["changes_left"], pace.dig("chosen_by", "full_name"), pace["plan_source"] ]

    get "/api/v1/enrollments/#{@enrollment.id}/learning_plan", headers: headers(@teacher)
    record = response.parsed_body["learning_plan"]
    assert_equal [ "learner_pace", 8, 1 ], record.values_at("source", "pace_weeks", "pace_changes_count")
    put "/api/v1/enrollments/#{@enrollment.id}/learning_plan", headers: headers(@teacher), as: :json,
      params: { learning_plan: record.slice("active", "description", "target_date", "next_check_in_on", "milestones", "lesson_overrides", "lock_version").merge("title" => "Catch up together") }
    assert_response :success
    assert_equal [ "staff", nil ], response.parsed_body["learning_plan"].values_at("source", "pace_weeks")

    put "/api/v1/enrollments/#{@enrollment.id}/pace", params: { weeks: 3 }, headers: headers(@student), as: :json
    assert_response :forbidden
    today = fetch_today
    assert_equal [ "staff_plan", false ], today["personal_pace"].values_at("status", "can_change")
    assert_equal "Catch up together", today.dig("catch_up_plan", "title")
  end

  test "learning plans switched off means no pace to choose" do
    @cohort.update!(settings: { "features" => { "student_experience_v2" => true, "learning_plans" => false } })
    today = fetch_today
    assert_equal [ false, false, "not_chosen" ], today["personal_pace"].values_at("available", "can_change", "status")
    put "/api/v1/enrollments/#{@enrollment.id}/pace", params: { weeks: 4 }, headers: headers(@student), as: :json
    assert_response :unprocessable_entity
  end

  test "self-paced courses keep everything open and pace from the first open" do
    self_paced = Cohort.create!(curriculum: @curriculum, name: "Python on demand", start_date: Date.new(2026, 1, 5), status: :active,
      course_delivery: "self_paced", learner_pace_weeks: [ 4 ])
    learner = person("buyer", :student)
    enrollment = enroll(learner, self_paced)
    assert_not self_paced.personal_release?
    assert_nil @project.unlock_date(self_paced, enrollment.module_assignments.first)
    fetch_today(learner, self_paced)
    assert enrollment.reload.support_expires_at.present?, "self-paced first open still starts support"
    put "/api/v1/enrollments/#{enrollment.id}/pace", params: { weeks: 4 }, headers: headers(learner), as: :json
    assert_response :success
    assert_equal [ "2026-11-18", "2026-12-15" ], response.parsed_body["personal_pace"].values_at("starts_on", "ends_on")
  end

  test "personal-pace cohorts send no unlock digests" do
    fetch_today
    assert_empty DailyUnlockNotifications.new.send(:candidates, Time.current)
  end

  test "Today, the outline and the pace stay flat in queries as lessons and milestones grow" do
    fetch_today
    choose(4)
    small = [ count_queries { fetch_today }, count_queries { fetch_outline }, count_queries { get "/api/v1/enrollments/#{@enrollment.id}/pace", headers: headers(@student) } ]

    18.times { |index| lesson("More #{index}", (index / 4) * 7 + 21 + (index % 4)) }
    @enrollment.learning_plan.destroy!
    choose(6)
    assert_operator @enrollment.reload.learning_plan.milestones.sum { |item| item["lesson_ids"].size }, :>, 25
    large = [ count_queries { fetch_today }, count_queries { fetch_outline }, count_queries { get "/api/v1/enrollments/#{@enrollment.id}/pace", headers: headers(@student) } ]
    assert_equal small, large
  end

  test "staff lists read every learner's pace in a fixed number of queries" do
    fetch_today
    choose(4)
    count = lambda do
      count_queries { LearnerProgress.for_all(Enrollment.where(cohort: @cohort)).each_value { |progress| progress.pace; progress.overall } }
    end
    one = count.call
    3.times do |index|
      learner = person("more#{index}", :student)
      enrollment = enroll(learner, @cohort)
      fetch_today(learner)
      put "/api/v1/enrollments/#{enrollment.id}/pace", params: { weeks: 6 }, headers: headers(learner), as: :json
      assert_response :success
    end
    assert_equal one, count.call
  end

  private

  def choose(weeks)
    put "/api/v1/enrollments/#{@enrollment.id}/pace", params: { weeks: weeks }, headers: headers(@student), as: :json
    assert_response :success
    response.parsed_body["personal_pace"]
  end

  def fetch_today(user = @student, cohort = @cohort)
    get "/api/v1/dashboard", params: { cohort_id: cohort.id }, headers: headers(user)
    assert_response :success
    response.parsed_body.dig("dashboard", "student_today")
  end

  def fetch_outline(user = @student)
    get "/api/v1/course_outline", params: { cohort_id: @cohort.id }, headers: headers(user)
    assert_response :success
    response.parsed_body["outline"]
  end

  def enroll(user, cohort)
    Enrollment.create!(user: user, cohort: cohort, status: :active).tap do |enrollment|
      enrollment.module_assignments.create!(curriculum_module: @module)
    end
  end

  def lesson(title, release_day, type: :exercise)
    item = @module.lessons.create!(title: title, position: release_day, release_day: release_day, lesson_type: type, required: true)
    item.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "Text")
    item.content_blocks.create!(block_type: :exercise, position: 1, title: "Practice", submission_type: :text_submission)
    item
  end

  def complete(item, enrollment = @enrollment)
    item.completion_blocks.each do |block|
      Progress.create!(enrollment: enrollment, user: enrollment.user, content_block: block, status: :completed, completed_at: Time.current)
    end
  end

  def person(name, role)
    User.create!(clerk_id: "pace_#{name}", email: "pace-#{name}@example.com", first_name: name.capitalize, last_name: "Synthetic", role: role)
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
end
