require "test_helper"
require_relative "../support/query_counter"

# AS-10: Today (dashboard), the weekly plan, the personal learning plan, the
# lesson page and the staff view of a learner give every lesson the same status
# and name the same next step, with a fixed number of queries.
class LearnerProgressConsumersTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    @curriculum = Curriculum.create!(name: "Agreement curriculum")
    @mod = @curriculum.modules.create!(name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Agreement cohort", start_date: Date.current - 3, status: :active)
    @teacher = User.create!(clerk_id: "agreement_teacher", email: "agreement-teacher@example.com", first_name: "Tia", last_name: "Teacher", role: :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @student = User.create!(clerk_id: "agreement_student", email: "agreement-student@example.com", first_name: "Sam", last_name: "Student", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    @lessons = {}
    @size = 0
  end

  [ :guided, :personal_plan, :self_paced ].each do |mode|
    test "every consumer agrees on status and next step (#{mode})" do
      build_course
      expected_next = @lessons[:redo]
      if mode == :personal_plan
        @enrollment.create_learning_plan!(title: "Plan", active: true,
          milestones: [ { "title" => "First", "due_on" => (Date.current + 7).iso8601, "lesson_ids" => [ @lessons[:open].id, @lessons[:redo].id ] } ])
        expected_next = @lessons[:open]
      end
      @cohort.update!(course_delivery: "self_paced") if mode == :self_paced

      statuses = dashboard_statuses
      assert_equal "redo", statuses[@lessons[:redo].id], "a stale completed flag must not make a redo complete"
      assert_equal "awaiting_review", statuses[@lessons[:waiting].id]
      assert_equal "done", statuses[@lessons[:done].id]
      assert_equal "open", statuses[@lessons[:open].id]
      assert_equal(mode == :self_paced ? "open" : "upcoming", statuses[@lessons[:locked].id])
      assert_equal expected_next.id, @dashboard.dig("continue_lesson", "id")
      redo_lesson = @dashboard["modules"].first["lessons"].find { |lesson| lesson["id"] == @lessons[:redo].id }
      assert_equal [ false, 0, 1 ], redo_lesson.values_at("completed", "completed_blocks", "total_blocks")
      assert_equal 2, @dashboard.dig("overall_progress", "completed")

      get "/api/v1/weekly_plan", headers: headers(@student)
      assert_response :success
      weekly = response.parsed_body["weekly_plan"]
      if mode == :self_paced
        assert_equal expected_next.id, weekly.dig("course_overview", "next_lesson", "lesson_id")
      else
        items = weekly["required"] + weekly["optional"]
        assert_includes items.map { |item| item["lesson_id"] }, @lessons[:redo].id, "an open redo carries forward"
        items.each do |item|
          status = LearnerProgress.status_for(completed: item["state"] == "completed", available: item["state"] != "upcoming",
            submissions_closed: item["state"] == "closed", review_status: item["review_status"])
          assert_equal statuses[item["lesson_id"]], status, item["title"]
        end
        assert_equal 0, weekly.dig("summary", "required_completed_count") - weekly["required"].count { |item| item["state"] == "completed" }
      end
      if mode == :personal_plan
        plan = weekly["personal_plan"]
        assert_equal expected_next.id, plan.dig("next_lesson", "lesson_id")
        plan_lesson = plan["milestones"].first["lessons"].find { |lesson| lesson["lesson_id"] == @lessons[:redo].id }
        assert_equal [ false, true, "redo_requested" ], plan_lesson.values_at("completed", "available", "review_status")
        assert_equal expected_next.id, @dashboard.dig("personal_plan", "next_lesson", "lesson_id")
      end

      @lessons.each_value do |lesson|
        get "/api/v1/lessons/#{lesson.id}", headers: headers(@student)
        if statuses[lesson.id] == "upcoming"
          assert_response :forbidden
          next
        end
        assert_response :success
        body = response.parsed_body["lesson"]
        assert_equal statuses[lesson.id], body["learner_status"], lesson.title
        assert_equal({ "id" => expected_next.id, "title" => expected_next.title, "module_id" => @mod.id }, body["next_step"])
      end

      get "/api/v1/progress/student/#{@student.id}?cohort_id=#{@cohort.id}", headers: headers(@teacher)
      assert_response :success
      staff = response.parsed_body
      assert_equal @dashboard["overall_progress"], staff["overall_progress"]
      staff_lessons = staff["modules"].first["lessons"].index_by { |lesson| lesson["id"] }
      @dashboard["modules"].first["lessons"].each do |lesson|
        assert_equal lesson.slice("completed", "available", "completed_blocks", "total_blocks", "review_status"),
          staff_lessons.fetch(lesson["id"]).slice("completed", "available", "completed_blocks", "total_blocks", "review_status")
      end
    end
  end

  test "nothing to act on leaves every consumer without a next step" do
    build_course
    record(@lessons[:redo], grades: [ "R", nil ])
    record(@lessons[:open], progress: :completed, grades: [ nil ])
    @lessons[:optional].update!(required: true)
    record(@lessons[:optional], progress: :completed)

    statuses = dashboard_statuses
    assert_nil @dashboard["continue_lesson"]
    assert_equal "awaiting_review", statuses[@lessons[:redo].id]
    get "/api/v1/lessons/#{@lessons[:done].id}", headers: headers(@student)
    assert_nil response.parsed_body.dig("lesson", "next_step")
    @cohort.update!(course_delivery: "self_paced") # opens the locked lesson too
    record(@lessons[:locked], progress: :completed, grades: [ nil ])
    get "/api/v1/weekly_plan", headers: headers(@student)
    assert_nil response.parsed_body.dig("weekly_plan", "course_overview", "next_lesson")
  end

  test "a closed redo keeps its feedback card but is not the next step, and imported redos are past feedback" do
    build_course
    @cohort.update!(start_date: Date.current - 8)
    @lessons[:open].update!(release_day: 7)
    @cohort.cohort_module_submission_windows.create!(curriculum_module: @mod, week_number: 1, submissions_close_at: 1.hour.ago)
    imported = @lessons[:optional].content_blocks.create!(block_type: :checkpoint, position: 2, title: "Imported checkpoint")
    Submission.create!(user: @student, enrollment: @enrollment, content_block: imported, text: "Old", grade: "R", graded_at: 1.day.ago)

    statuses = dashboard_statuses
    assert_equal "redo", statuses[@lessons[:redo].id]
    assert_equal @lessons[:open].id, @dashboard.dig("continue_lesson", "id")
    redo_item = @dashboard["action_items"].sole
    assert_equal [ @lessons[:redo].id, true ], redo_item.values_at("lesson_id", "submissions_closed")
    assert_includes @dashboard["recently_graded"].map { |item| item["content_block_id"] }, imported.id

    get "/api/v1/lessons/#{@lessons[:redo].id}", headers: headers(@student)
    body = response.parsed_body["lesson"]
    assert_equal [ "redo", 0, 1, @lessons[:open].id ], [ body["learner_status"], body["completed_blocks"], body["total_blocks"], body.dig("next_step", "id") ]
  end

  test "the lesson status enum matches the OpenAPI contract" do
    documented = OpenapiContract::DOCUMENT.dig("components", "schemas", "LearnerLessonStatus", "enum")
    assert_equal LearnerProgress::Status::ALL.sort, documented.sort
    assert_equal LearnerProgress::Status::ALL.sort, JSON.parse(Rails.root.join("../fixtures/shared-logic-parity.json").read)["statuses"].map { |row| row["expected"] }.uniq.sort
  end

  [ :guided, :personal_plan, :self_paced ].each do |mode|
    test "progress consumers send the same queries for one or five lessons of each state (#{mode})" do
      @cohort.update!(course_delivery: "self_paced") if mode == :self_paced
      requests = [
        [ @student, "/api/v1/dashboard" ],
        [ @student, "/api/v1/weekly_plan" ],
        [ @student, -> { "/api/v1/lessons/#{@lessons[:open].id}" } ],
        [ @teacher, -> { "/api/v1/progress/student/#{@student.id}?cohort_id=#{@cohort.id}" } ]
      ]
      counts = [ 1, 5 ].map do |size|
        grow_to(size, plan: mode == :personal_plan)
        requests.map do |user, path|
          resolved = path.respond_to?(:call) ? path.call : path
          get resolved, headers: headers(user)
          count = count_queries { get resolved, headers: headers(user) }
          assert_response :success
          count
        end
      end
      puts "\nprogress consumers #{mode}: #{counts.first.zip(counts.last).map { |pair| pair.join(' -> ') }.join(', ')}" if ENV["QUERY_COUNT_REPORT"]
      assert_equal counts.first, counts.last, "dashboard, weekly plan, lesson page, staff view"
    end
  end

  # Fix round 1: with every lesson done, the next step scans the whole course,
  # so each module's availability is read. That must not cost a query per module.
  [ :guided, :self_paced ].each do |mode|
    test "progress consumers send the same queries for one or five finished modules (#{mode})" do
      @cohort.update!(course_delivery: "self_paced") if mode == :self_paced
      @mod.update!(position: 99)
      first_lesson = nil
      modules = 0
      requests = [
        [ @student, "/api/v1/dashboard" ],
        [ @student, "/api/v1/weekly_plan" ],
        [ @student, -> { "/api/v1/lessons/#{first_lesson.id}" } ],
        [ @teacher, -> { "/api/v1/progress/student/#{@student.id}?cohort_id=#{@cohort.id}" } ]
      ]
      counts = [ 1, 5 ].map do |size|
        while modules < size
          mod = @curriculum.modules.create!(name: "Finished #{modules}", position: modules, day_offset: 0, schedule_days: "daily")
          @enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
          # Two lessons per module, so even one module's lessons load as a list.
          2.times do |index|
            done = mod.lessons.create!(title: "Finished lesson #{modules}.#{index}", position: index, release_day: index)
            block = done.content_blocks.create!(block_type: :exercise, position: 0, title: "Finished exercise #{modules}.#{index}", submission_type: :text_submission)
            Progress.create!(enrollment: @enrollment, user: @student, content_block: block, status: :completed)
            Submission.create!(user: @student, enrollment: @enrollment, content_block: block, text: "Answer", grade: "A", graded_at: Time.current)
            first_lesson ||= done
          end
          modules += 1
        end
        requests.map do |user, path|
          resolved = path.respond_to?(:call) ? path.call : path
          get resolved, headers: headers(user)
          assert_response :success
          assert_nil response.parsed_body.dig("lesson", "next_step") if resolved.start_with?("/api/v1/lessons/")
          count_queries { get resolved, headers: headers(user) }
        end
      end
      puts "\nfinished modules #{mode}: #{counts.first.zip(counts.last).map { |pair| pair.join(' -> ') }.join(', ')}" if ENV["QUERY_COUNT_REPORT"]
      assert_equal counts.first, counts.last, "dashboard, weekly plan, lesson page, staff view"
    end
  end

  private

  def build_course
    @lessons[:redo] = lesson("Redo lesson", 0)
    @lessons[:waiting] = lesson("Waiting lesson", 1)
    @lessons[:done] = lesson("Done lesson", 2)
    @lessons[:open] = lesson("Open lesson", 3)
    @lessons[:optional] = lesson("Optional lesson", 0, required: false, position: 9)
    @lessons[:locked] = lesson("Locked lesson", 30)
    record(@lessons[:redo], progress: :completed, grades: [ "R" ])
    record(@lessons[:waiting], progress: :completed, grades: [ nil ])
    record(@lessons[:done], progress: :completed, grades: [ "A" ])
  end

  # Each step adds a redo, a lesson waiting for review, a graded lesson and an open one.
  def grow_to(size, plan:)
    while @size < size
      i = @size
      @size += 1
      redo_lesson = lesson("Redo #{i}", i * 4)
      waiting = lesson("Waiting #{i}", i * 4 + 1)
      graded = lesson("Graded #{i}", i * 4 + 2)
      open = lesson("Open #{i}", i * 4 + 3)
      @lessons[:open] ||= open
      record(redo_lesson, progress: :in_progress, grades: [ nil, "R" ])
      record(waiting, progress: :completed, grades: [ nil ])
      record(graded, progress: :completed, grades: [ "B" ])
    end
    @cohort.update!(start_date: Date.current - (size * 4))
    return unless plan

    ids = @mod.lessons.order(:id).pluck(:id)
    plan = @enrollment.learning_plan || @enrollment.build_learning_plan(title: "Plan", active: true)
    plan.update!(milestones: [ { "title" => "All", "due_on" => (Date.current + 30).iso8601, "lesson_ids" => ids.reverse } ])
  end

  def lesson(title, release_day, required: true, position: release_day)
    lesson = @mod.lessons.create!(title: title, position: position, release_day: release_day, required: required)
    lesson.content_blocks.create!(block_type: :video, position: 0, title: "#{title} video", video_url: "https://www.youtube.com/watch?v=example")
    lesson.content_blocks.create!(block_type: :exercise, position: 1, title: "#{title} exercise", submission_type: :text_submission)
    lesson
  end

  def record(lesson, progress: nil, grades: [])
    block = lesson.content_blocks.find(&:exercise?)
    Progress.find_or_initialize_by(enrollment: @enrollment, content_block: block).update!(user: @student, status: progress) if progress
    grades.each do |grade|
      Submission.create!(user: @student, enrollment: @enrollment, content_block: block, text: "Answer", grade: grade, graded_at: grade && Time.current)
    end
  end

  def dashboard_statuses
    get "/api/v1/dashboard", headers: headers(@student)
    assert_response :success
    @dashboard = response.parsed_body["dashboard"]
    @dashboard["modules"].flat_map { |mod| mod["lessons"] }.to_h { |lesson| [ lesson["id"], lesson["learner_status"] ] }
  end

  def headers(user) = { "Authorization" => "Bearer test_token_#{user.id}" }
end
