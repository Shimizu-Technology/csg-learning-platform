require "test_helper"

# W9.1 (personal start date and learner-chosen pace) must not change anything
# for a cohort that doesn't turn it on. This compares what a learner in a
# program cohort (Cohort 3's shape, with the new student experience off and on),
# a guided cohort with pace off, and the alumni library sees, byte for byte,
# with a golden file recorded on origin/main (6c169d6d) before W9.1 existed:
# Today and the dashboard, the course outline, the weekly plan, progress, each
# module, whether each lesson opens, the staff progress view, and the daily
# unlock digest candidates.
#
# Every record has a fixed id and every sequence restarts at a fixed value, so
# the payloads don't depend on test order. Re-record only on purpose, with
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
    golden = JSON.parse(GOLDEN.read)
    golden.each_key do |key|
      assert_equal golden[key], JSON.parse(snapshot[key].to_json), "#{key} changed for a cohort without personal pace"
    end
    assert_equal golden.keys.sort, snapshot.keys.sort
  end

  private

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
