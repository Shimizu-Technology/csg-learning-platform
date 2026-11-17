require "test_helper"
require_relative "../support/query_counter"

class LearningInsightsTest < ActionDispatch::IntegrationTest
  include QueryCounter
  def setup
    @curriculum = Curriculum.create!(name: "Evidence curriculum")
    @objective = @curriculum.learning_objectives.create!(code: "WEB.1", title: "Ship a working interface", success_criteria: "I can ship and verify a working interface.", position: 0)
    @retrieval_objective = @curriculum.learning_objectives.create!(code: "WEB.2", title: "Explain the browser model", success_criteria: "I can explain request and response flow.", position: 1)
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Web foundations", position: 0)
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Interfaces", position: 0, release_day: 0)
    @rubric = Rubric.create!(curriculum: @curriculum, title: "Interface quality", rubric_criteria_attributes: [
      { title: "Behavior", description: "The interface works as intended.", learning_objective: @objective }
    ])
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Responsive interface", rubric: @rubric)
    @check_block = @lesson.content_blocks.create!(block_type: :checkpoint, position: 1, title: "Browser model check")
    @check = KnowledgeCheck.create!(content_block: @check_block, learning_objective: @retrieval_objective, prompt: "What happens first?", options: [ "Request", "Response" ], correct_option: 0, explanation: "A request begins the exchange.")
    ObjectiveAlignment.create!(learning_objective: @objective, lesson: @lesson, content_block: @block)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Evidence cohort", start_date: Date.current, status: :active)
    @staff = User.create!(clerk_id: "insights_staff", email: "insights-staff@example.com", first_name: "Inez", last_name: "Instructor", role: :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @staff)
    @student = create_student("insights_one", "one@example.com", "Maya", "Santos")
    @redo_student = create_student("insights_two", "two@example.com", "Noah", "Cruz")
    @other_student = create_student("insights_other", "other@example.com", "Other", "Student", enroll: false)

    passing = Submission.create!(user: @student, enrollment: @cohort.enrollments.find_by!(user: @student), content_block: @block, text: "private passing work", grade: :A, feedback: "private feedback", grader: @staff, graded_at: 2.days.ago, num_submissions: 1)
    passing.submission_criterion_results.create!(rubric_criterion: @rubric.rubric_criteria.first, rating: :meets, feedback: "private criterion feedback")
    redo_submission = Submission.create!(user: @redo_student, enrollment: @cohort.enrollments.find_by!(user: @redo_student), content_block: @block, text: "private redo work", grade: :R, feedback: "private redo feedback", grader: @staff, graded_at: 1.day.ago, num_submissions: 2, repo_url: "https://github.com/noah/project", commit_sha: "def456")
    redo_submission.submission_criterion_results.create!(rubric_criterion: @rubric.rubric_criteria.first, rating: :redo)
    redo_submission.github_check_runs.create!(external_id: 91, name: "test", head_sha: "def456", status: "completed", conclusion: "failure", fetched_at: Time.current)
    @check.attempts.create!(user: @student, enrollment: @cohort.enrollments.find_by!(user: @student), selected_option: 0, correct: true)
  end

  test "cohort insights explain objective status and drill down without private content" do
    as_user(@staff) { get "/api/v1/cohorts/#{@cohort.id}/learning_insights", headers: auth_headers }

    assert_response :success
    insights = JSON.parse(response.body).fetch("learning_insights")
    first = insights.fetch("objectives").find { |objective| objective.fetch("id") == @objective.id }
    assert_equal 1, first.fetch("status_counts").fetch("demonstrated")
    assert_equal 1, first.fetch("status_counts").fetch("needs_revision")
    redo_evidence = first.fetch("students").find { |student| student.dig("user", "id") == @redo_student.id }.fetch("evidence").first
    assert_equal "rubric_criterion", redo_evidence.fetch("kind")
    assert_equal @lesson.title, redo_evidence.fetch("lesson_title")
    assert_equal @mod.name, redo_evidence.fetch("module_name")
    assert redo_evidence.fetch("submission_id")
    assert_equal 1, redo_evidence.dig("github_checks", "failed")
    assert_equal redo_evidence.fetch("submission_id"), insights.fetch("revision_patterns").sole.fetch("records").sole.fetch("submission_id")
    refute_includes response.body, "private passing work"
    refute_includes response.body, "private feedback"
    refute_includes response.body, "private criterion feedback"
  end

  test "retrieval-only evidence remains developing and the endpoint supports one enrolled learner" do
    as_user(@staff) { get "/api/v1/cohorts/#{@cohort.id}/learning_insights", params: { user_id: @student.id }, headers: auth_headers }

    assert_response :success
    insights = JSON.parse(response.body).fetch("learning_insights")
    retrieval = insights.fetch("objectives").find { |objective| objective.fetch("id") == @retrieval_objective.id }
    assert_equal "developing", retrieval.fetch("students").sole.fetch("status")
    assert_equal 1, insights.dig("summary", "learner_count")
  end

  test "insights require staff and selected learners must belong to the cohort" do
    as_user(@student) { get "/api/v1/cohorts/#{@cohort.id}/learning_insights", headers: auth_headers }
    assert_response :forbidden

    as_user(@staff) { get "/api/v1/cohorts/#{@cohort.id}/learning_insights", params: { user_id: @other_student.id }, headers: auth_headers }
    assert_response :not_found
  end

  test "objective name context stays flat across learners, modules and evidence" do
    counts = [ 1, 5 ].map do |size|
      size.times do |index|
        mod = @curriculum.modules.create!(name: "Context #{size}-#{index}", position: size + index)
        lesson = mod.lessons.create!(title: "Context lesson #{size}-#{index}", position: 0, release_day: 0)
        block = lesson.content_blocks.create!(title: "Context work", block_type: :exercise, submission_type: :text_submission, position: 0)
        ObjectiveAlignment.create!(learning_objective: @objective, lesson: lesson, content_block: block)
        student = create_student("context_#{size}_#{index}", "context-#{size}-#{index}@example.com", "Test", "Context")
        Submission.create!(user: student, enrollment: @cohort.enrollments.find_by!(user: student), content_block: block, text: "Work", grade: "A")
      end
      as_user(@staff) do
        get "/api/v1/cohorts/#{@cohort.id}/learning_insights", headers: auth_headers
        count_queries do
          get "/api/v1/cohorts/#{@cohort.id}/learning_insights", headers: auth_headers
          assert_response :success
          evidence = response.parsed_body.fetch("learning_insights").fetch("objectives").flat_map { |objective| objective.fetch("students").flat_map { |student| student.fetch("evidence") } }
          assert evidence.all? { |item| item["lesson_title"].present? && item["module_name"].present? }
        end
      end
    end
    puts "Learning insight context: #{counts.inspect}" if ENV["QUERY_COUNT_REPORT"]
    assert_equal counts.first, counts.last, counts.inspect
  end

  private

  def create_student(clerk_id, email, first_name, last_name, enroll: true)
    user = User.create!(clerk_id: clerk_id, email: email, first_name: first_name, last_name: last_name, role: :student)
    Enrollment.create!(user: user, cohort: @cohort, status: :active) if enroll
    user
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
