require "test_helper"

# W9.1 (personal start date and learner-chosen pace) must not change anything
# for a cohort that doesn't turn it on. This compares what a learner in a
# program cohort (Cohort 3's shape, with the new student experience off and on),
# a guided cohort with pace off, and the alumni library sees, byte for byte,
# with a golden file recorded on origin/main (6c169d6d) before W9.1 existed:
# X-6 adds only the intentional default-Off github_app and github_issue_delivery_v2
# feature keys to this baseline, W9.3 adds only the default-Off learner_nudges key,
# and W9.8/AS-9 adds only the default-Off self_paced_peer_space key; all existing
# fields and behavior remain unchanged.
# Today and the dashboard, the course outline, the weekly plan, progress, each
# module, whether each lesson opens, the staff progress view, and the daily
# unlock digest candidates.
#
# Every record has a fixed id, every sequence restarts at a fixed value and the
# clock is frozen, so the payloads don't depend on test order; lists the app
# reads without ORDER BY are compared in id order (UNORDERED). Re-record only on purpose, with
# UPDATE_GOLDEN=1, and say why in the commit.
class PersonalPaceOffCohortParityTest < ActionDispatch::IntegrationTest
  GOLDEN = Rails.root.join("test/golden/personal_pace_off_cohorts.json")
  ZONE = Time.find_zone!("Pacific/Guam")
  NOW = ZONE.local(2026, 11, 18, 10)

  setup do
    travel_to NOW
    ActiveRecord::Base.connection.select_values("SELECT schemaname || '.' || sequencename FROM pg_sequences WHERE schemaname = 'public'").each do |name|
      ActiveRecord::Base.connection.execute("SELECT setval(#{ActiveRecord::Base.connection.quote(name)}, 9500000, false)")
    end
    @admin = person(9_100_001, "admin", :admin)
    @teacher = person(9_100_002, "teacher", :instructor)
    @curriculum = Curriculum.create!(id: 9_100_100, name: "Parity curriculum")
    @prework = @curriculum.modules.create!(id: 9_100_200, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays")
    @live = @curriculum.modules.create!(id: 9_100_201, name: "Live", position: 1, day_offset: 14, schedule_days: "mwf")
    @lessons = []
    # Three weeks of prework (weekdays) and three of live (Mon, Wed, Fri), a
    # project and an optional lesson, so dates, weeks and kinds all vary.
    (0..2).each { |week| [ 0, 2, 4 ].each { |day| @lessons << lesson(@prework, "Prework #{week + 1}.#{day}", week * 7 + day) } }
    (0..2).each { |week| [ 0, 2, 4 ].each { |day| @lessons << lesson(@live, "Live #{week + 1}.#{day}", week * 7 + day) } }
    @lessons << lesson(@live, "Final project", 18, type: :project)
    @lessons << lesson(@live, "Stretch reading", 16, required: false)
  end

  teardown { travel_back }

  test "Off program windows and submit enforcement remain identical without extensions" do
    program = cohort(9_100_450, "Lance-shaped Off program", start: Date.new(2026, 10, 5), features: { "student_experience_v2" => false })
    student = person(9_100_020, "window-parity", :student)
    enrollment = Enrollment.create!(user: student, cohort: program, status: :active)
    enrollment.module_assignments.create!(curriculum_module: @prework)
    lesson = @lessons.first
    block = lesson.content_blocks.last
    [ nil, NOW + 1.hour, NOW ].each do |close_at|
      program.cohort_module_submission_windows.destroy_all
      program.cohort_module_submission_windows.create!(curriculum_module: @prework, week_number: 1, submissions_close_at: close_at) if close_at
      program.cohort_module_submission_windows.reload
      enrollment.reload
      original = SubmissionWindowStatus.for_lesson(cohort: program, lesson: lesson, at: NOW)
      effective = SubmissionWindowStatus.for_lesson(cohort: program, lesson: lesson, enrollment: enrollment, at: NOW)
      assert_equal original.to_json, effective.to_json
      get "/api/v1/lessons/#{lesson.id}", params: { cohort_id: program.id }, headers: headers(student)
      assert_response :success
      assert_equal JSON.parse(original.to_json), response.parsed_body.dig("lesson", "submission_window")
      post "/api/v1/submissions", params: { content_block_id: block.id, cohort_id: program.id, text: "Parity answer" }, headers: headers(student), as: :json
      close_at && close_at <= NOW ? assert_response(:forbidden) : assert_response(:success)
    end
  end

  test "off cohorts produce the same learner and staff payloads as before W9.1" do
    snapshot = {
      "program_v2_off" => learner_snapshot(cohort(9_100_400, "Program cohort", start: Date.new(2026, 10, 5), features: { "student_experience_v2" => false }), 9_100_010, plan: true),
      "program_v2_on" => learner_snapshot(cohort(9_100_401, "Program v2 cohort", start: Date.new(2026, 10, 5), features: { "student_experience_v2" => true }), 9_100_011),
      "guided_pace_off" => learner_snapshot(cohort(9_100_402, "Guided cohort", start: Date.new(2026, 11, 2), delivery: "guided", features: { "student_experience_v2" => true }), 9_100_012),
      "alumni" => learner_snapshot(cohort(9_100_403, "Alumni library", start: Date.new(2026, 1, 5), type: :alumni, features: { "student_experience_v2" => true }), 9_100_013)
    }
    snapshot["daily_unlock_candidates"] = DailyUnlockNotifications.new.send(:candidates, NOW).map { |delivery| [ delivery[:enrollment].id, delivery[:lessons].map(&:id) ] }.sort
    snapshot["daily_unlock_preview"] = DailyUnlockNotifications.new.preview(now: NOW)

    if ENV["UPDATE_GOLDEN"] == "1"
      GOLDEN.dirname.mkpath
      GOLDEN.write(JSON.pretty_generate(snapshot) + "\n")
    end
    golden = canonical(JSON.parse(GOLDEN.read))
    actual = canonical(JSON.parse(snapshot.to_json))
    assert_equal golden.keys.sort, actual.keys.sort
    golden.each_key do |key|
      found = differences(golden[key], actual[key], key)
      assert_empty found, "#{key} changed for a cohort without personal pace:\n#{found.first(20).join("\n")}"
    end
  end

  # W9.3: reminders need the school switch and the cohort's own opt-in. With
  # the school switch on, every cohort that hasn't opted in (Cohort 3's shape
  # among them) gets no reminder rows, notifications or emails from the
  # hourly tick, its payloads carry no reminder flags, and the task's queries
  # don't grow with those cohorts.
  test "cohorts that haven't opted in get no reminders, rows, sends or payload changes" do
    SchoolSetting.current.update!(features: { "learner_nudges" => true })
    task = ScheduledTick::TASKS.find { |item| item.name == "learner_nudges" }
    nudges = LearnerNudges.new
    baseline = count_tick_queries(nudges)
    cohorts = [
      cohort(9_100_410, "Lance-shaped Off program", start: Date.new(2026, 10, 5), features: { "student_experience_v2" => false }),
      cohort(9_100_411, "Program v2", start: Date.new(2026, 10, 5), features: { "student_experience_v2" => true }),
      cohort(9_100_412, "Guided, pace off", start: Date.new(2026, 11, 2), delivery: "guided"),
      cohort(9_100_413, "Alumni library", start: Date.new(2026, 1, 5), type: :alumni, features: { "learner_nudges" => true }),
      cohort(9_100_414, "Explicitly off", start: Date.new(2026, 11, 2), delivery: "guided", features: { "learner_nudges" => false })
    ]
    paced = cohort(9_100_415, "Paced, not opted in", start: Date.new(2026, 11, 16), delivery: "guided")
    paced.update!(learner_pace_weeks: [ 3 ])
    cohorts << paced
    snapshots = cohorts.each_with_index.map { |item, index| learner_snapshot(item, 9_100_030 + index) }
    # Everything a reminder could be about is due: access and support end soon.
    Enrollment.update_all(access_expires_at: NOW + 2.days, support_expires_at: NOW + 1.day)

    assert_equal baseline, count_tick_queries(nudges)
    (0..20).each do |day|
      [ 8, 13, 20 ].each { |hour| ScheduledTick.new(now: ZONE.local(2026, 11, 18, hour) + day.days, tasks: [ task ]).call }
    end
    assert_equal 0, LearnerNudge.count
    assert_equal 0, Notification.where(notifiable_type: "LearnerNudge").count
    snapshots.each_with_index do |snapshot, index|
      enrollment = snapshot.dig("staff_progress", "body", "enrollment")
      assert_not enrollment.key?("learner_nudges_enabled"), cohorts[index].name
    end
    Enrollment.includes(:user).find_each do |enrollment|
      get "/api/v1/profile", headers: headers(enrollment.user)
      assert response.parsed_body.fetch("enrollments").none? { |item| item.key?("learner_nudges_enabled") }
    end
  end

  test "the comparison names the key path of each difference and ignores only database row order" do
    expected = { "body" => { "enrollment" => { "module_assignments" => [ { "id" => 1, "a" => 1 }, { "id" => 2, "a" => 2 } ] }, "list" => [ 1, 2 ] } }
    swapped = { "body" => { "enrollment" => { "module_assignments" => [ { "id" => 2, "a" => 2 }, { "id" => 1, "a" => 1 } ] }, "list" => [ 1, 2 ] } }
    assert_empty differences(canonical(expected), canonical(swapped), "x")
    changed = { "body" => { "enrollment" => { "module_assignments" => [ { "id" => 2, "a" => 3 }, { "id" => 1, "a" => 1 } ] }, "list" => [ 2, 1 ] } }
    assert_equal [ "x.body.enrollment.module_assignments[1].a: expected 2, got 3", "x.body.list[0]: expected 1, got 2", "x.body.list[1]: expected 2, got 1" ],
      differences(canonical(expected), canonical(changed), "x")
  end

  private

  # Lists the app reads with no ORDER BY, so the database may return them in
  # any order (CI run 44237525378 swapped staff progress's two module
  # assignments, with prepared statements on). They are compared in id order;
  # every other list keeps its order, and every value is still compared.
  UNORDERED = { "module_assignments" => "id" }.freeze

  def canonical(node)
    case node
    when Hash
      node.to_h do |key, value|
        value = canonical(value)
        value = value.sort_by { |item| item[UNORDERED[key]] } if UNORDERED.key?(key) && value.is_a?(Array) && value.all?(Hash)
        [ key, value ]
      end
    when Array then node.map { |item| canonical(item) }
    else node
    end
  end

  # Every difference as "path: expected X, got Y", so a failure names the field.
  def differences(expected, actual, path)
    if expected.is_a?(Hash) && actual.is_a?(Hash)
      (expected.keys | actual.keys).flat_map do |key|
        next [ "#{path}.#{key}: missing" ] unless actual.key?(key)
        next [ "#{path}.#{key}: unexpected #{actual[key].inspect[0, 120]}" ] unless expected.key?(key)

        differences(expected[key], actual[key], "#{path}.#{key}")
      end
    elsif expected.is_a?(Array) && actual.is_a?(Array)
      sizes = expected.size == actual.size ? [] : [ "#{path}: expected #{expected.size} items, got #{actual.size}" ]
      sizes + expected.zip(actual).each_with_index.flat_map { |(left, right), index| index < actual.size ? differences(left, right, "#{path}[#{index}]") : [] }
    elsif expected == actual
      []
    else
      [ "#{path}: expected #{expected.inspect[0, 120]}, got #{actual.inspect[0, 120]}" ]
    end
  end

  def learner_snapshot(cohort, user_id, plan: false)
    student = person(user_id, "student#{user_id}", :student)
    base = 9_200_000 + (user_id - 9_100_000) * 100
    enrollment = Enrollment.create!(id: base + 1, user: student, cohort: cohort, status: :active)
    unless cohort.alumni?
      enrollment.module_assignments.create!(id: base + 2, curriculum_module: @prework)
      enrollment.module_assignments.create!(id: base + 3, curriculum_module: @live)
    end
    done, redone, waiting = @lessons.values_at(0, 1, 2)
    unless cohort.alumni?
      done.completion_blocks.each_with_index do |block, index|
        Progress.create!(id: base + 10 + index, enrollment: enrollment, user: student, content_block: block, status: :completed, completed_at: NOW - 2.days)
      end
      Submission.create!(id: base + 20, user: student, enrollment: enrollment, content_block: redone.content_blocks.last, text: "Answer",
        grade: "R", feedback: "Try again", graded_at: NOW - 1.day, graded_by_id: @teacher.id)
      Submission.create!(id: base + 21, user: student, enrollment: enrollment, content_block: waiting.content_blocks.last, text: "Answer")
    end
    if plan
      learning_plan = LearningPlan.create!(id: base + 30, enrollment: enrollment, title: "Catch up", target_date: Date.new(2026, 12, 4),
        milestones: [ { "title" => "First stretch", "due_on" => "2026-11-25", "lesson_ids" => @lessons.values_at(3, 4).map(&:id) } ])
      learning_plan.revisions.create!(id: base + 31, author: @teacher, snapshot: learning_plan.snapshot)
    end

    out = {}
    out["dashboard"] = get_json("/api/v1/dashboard", student, cohort_id: cohort.id)
    out["course_outline"] = get_json("/api/v1/course_outline", student, cohort_id: cohort.id)
    out["weekly_plan"] = get_json("/api/v1/weekly_plan", student, cohort_id: cohort.id)
    out["progress"] = get_json("/api/v1/progress", student, cohort_id: cohort.id)
    out["modules"] = [ @prework, @live ].to_h { |mod| [ mod.name, get_json("/api/v1/modules/#{mod.id}", student, cohort_id: cohort.id) ] }
    out["lessons"] = @lessons.to_h do |lesson|
      get "/api/v1/lessons/#{lesson.id}", params: { cohort_id: cohort.id }, headers: headers(student)
      [ lesson.title, [ response.status, response.status == 200 ? nil : response.parsed_body ] ]
    end
    out["read_access"] = @lessons.to_h { |lesson| [ lesson.title, LessonReadAccess.check(student, lesson, cohort_id: cohort.id).error ] }
    out["staff_progress"] = get_json("/api/v1/progress/student/#{student.id}", @admin, cohort_id: cohort.id)
    out
  end

  def count_tick_queries(nudges)
    queries = []
    callback = ->(*, payload) { queries << payload[:sql] unless %w[SCHEMA TRANSACTION].include?(payload[:name]) }
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { nudges.call(now: ZONE.local(2026, 11, 18, 9)) }
    queries.size
  end

  def get_json(path, user, params)
    get path, params: params, headers: headers(user)
    { "status" => response.status, "body" => response.parsed_body }
  end

  def cohort(id, name, start:, delivery: "program", type: :bootcamp, features: {})
    Cohort.create!(id: id, curriculum: @curriculum, name: name, start_date: start, end_date: start + 16.weeks, status: :active,
      course_delivery: delivery, cohort_type: type, settings: { "features" => features }).tap do |record|
      record.cohort_instructor_assignments.create!(user: @teacher)
    end
  end

  def lesson(mod, title, release_day, type: :exercise, required: true)
    @next_lesson_id ||= 9_100_300
    @next_block_id ||= 9_100_600
    lesson = mod.lessons.create!(id: @next_lesson_id += 1, title: title, position: release_day, release_day: release_day, lesson_type: type, required: required)
    lesson.content_blocks.create!(id: @next_block_id += 1, block_type: :text, position: 0, title: "Read", body: "Text")
    lesson.content_blocks.create!(id: @next_block_id += 1, block_type: :exercise, position: 1, title: "Practice", submission_type: :text_submission)
    lesson
  end

  def person(id, name, role)
    User.create!(id: id, clerk_id: "parity_#{name}", email: "parity-#{name}@example.com", first_name: name.capitalize, last_name: "Synthetic", role: role)
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
end
