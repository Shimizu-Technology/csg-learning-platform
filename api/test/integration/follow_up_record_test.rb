require "test_helper"

# L-2.5 / L-5.1: the follow-up plan record links its evidence through the
# destination contract, and "Message" opens the conversation with the plan as
# its source. Follow-up plans stay staff records: learners never see one, and
# instructors see only the cohorts they teach.
class FollowUpRecordTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Follow-up course")
    @other_curriculum = Curriculum.create!(name: "Other course")
    mod = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0)
    other_mod = CurriculumModule.create!(curriculum: @other_curriculum, name: "Elsewhere", position: 0)
    @lesson = Lesson.create!(curriculum_module: mod, title: "Arrays", position: 0, release_day: 0)
    @foreign_lesson = Lesson.create!(curriculum_module: other_mod, title: "Not this course", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, title: "Sum an array", position: 0, submission_type: :text_submission)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 7", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 8", start_date: Date.current, status: :active)
    @instructor = person("instructor", :instructor)
    @outsider = person("outsider", :instructor)
    @admin = person("admin", :admin)
    @student = person("student", :student)
    @classmate = person("classmate", :student)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort.cohort_instructor_assignments.create!(user: @outsider)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @classmate_enrollment = Enrollment.create!(user: @classmate, cohort: @cohort, status: :active)
    @own = Submission.create!(user: @student, enrollment: @enrollment, content_block: @block, submission_type: :text_submission, text: "Synthetic answer", grade: :R)
    @theirs = Submission.create!(user: @classmate, enrollment: @classmate_enrollment, content_block: @block, submission_type: :text_submission, text: "Other answer", grade: :R)
    @help = HelpRequest.create!(student: @student, cohort: @cohort, category: :concept, context_type: :exercise, context_id: @block.id,
      context_label: "Sum an array", context_path: "/lessons/#{@lesson.id}?cohort_id=#{@cohort.id}#block-#{@block.id}", message: "Synthetic question")
    @plan = plan(trigger_type: :redo, evidence: { "submission_ids" => [ @own.id, @theirs.id, 999_999_999 ], "count" => 3 })
    @conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
  end

  test "evidence ids come back as destinations for records still in this enrollment only" do
    as_user(@instructor) { get "/api/v1/interventions/#{@plan.id}", headers: auth_headers }

    assert_response :success
    links = response.parsed_body.dig("intervention", "evidence_links")
    assert_equal [ [ "submission_ids", @own.id ] ], links.map { |link| [ link["key"], link["id"] ] },
      "another learner's submission and a missing id stay plain text"
    assert_equal({ "kind" => "submission", "id" => @own.id, "context" => { "cohort_id" => @cohort.id, "student_id" => @student.id }, "anchor" => {} },
      links.first["destination"])
  end

  test "a plan started from a help request links the request and the lesson it was asked from" do
    from_help = plan(trigger_type: :help_request, help_request: @help, evidence: InterventionEvidenceBuilder.new(enrollment: @enrollment, trigger_type: :help_request, help_request: @help).call)

    as_user(@admin) { get "/api/v1/interventions/#{from_help.id}", headers: auth_headers }

    links = response.parsed_body.dig("intervention", "evidence_links").to_h { |link| [ link["key"], link ] }
    assert_equal "help_request", links.dig("help_request_id", "destination", "kind")
    assert_equal "Sum an array", links.dig("help_request_id", "label")
    assert_equal({ "kind" => "lesson", "id" => @lesson.id, "context" => { "cohort_id" => @cohort.id }, "anchor" => {} }, links.dig("context_id", "destination"))
    assert_equal "Arrays", links.dig("context_id", "label")

    # A lesson outside the cohort's curriculum is never linked.
    @help.update_columns(context_type: HelpRequest.context_types[:lesson], context_id: @foreign_lesson.id)
    as_user(@admin) { get "/api/v1/interventions/#{from_help.id}", headers: auth_headers }
    refute response.parsed_body.dig("intervention", "evidence_links").any? { |link| link["key"] == "context_id" }
  end

  test "learners never read follow-up plans, and instructors only in cohorts they teach" do
    as_user(@student) { get "/api/v1/interventions/#{@plan.id}", headers: auth_headers }
    assert_response :forbidden

    as_user(@outsider) { get "/api/v1/interventions/#{@plan.id}", headers: auth_headers }
    assert_response :not_found

    as_user(@student) { get "/api/v1/help_requests/#{@help.id}", headers: auth_headers }
    refute response.parsed_body.fetch("help_request").key?("follow_up")
  end

  test "Message from a follow-up plan carries the plan as its source for staff, and learners never see it" do
    post_message(@instructor, source_type: "intervention", source_id: @plan.id)

    assert_response :created
    assert_equal({ "type" => "intervention", "id" => @plan.id, "title" => @student.full_name, "lesson_id" => nil, "cohort_id" => @cohort.id, "learner_path" => nil },
      response.parsed_body.dig("message", "source"))
    message = Message.last
    assert_equal [ "Intervention", @plan.id ], [ message.source_type, message.source_id ]

    as_user(@student) { get "/api/v1/direct_conversations/#{@conversation.id}", headers: auth_headers }
    assert_response :success
    seen = response.parsed_body.fetch("messages").find { |item| item["id"] == message.id }
    assert_nil seen.fetch("source"), "a learner never learns a follow-up plan exists"

    as_user(@student) { get "/api/v1/messages/search", params: { q: "follow-up plan" }, headers: auth_headers }
    assert_response :success
    found = response.parsed_body.fetch("results").find { |item| item["id"] == message.id }
    assert found, "the learner finds the message in search"
    assert_nil found.fetch("source")

    as_user(@instructor) { get "/api/v1/messages/search", params: { q: "follow-up plan" }, headers: auth_headers }
    assert_equal "intervention", response.parsed_body.fetch("results").find { |item| item["id"] == message.id }.dig("source", "type")
  end

  test "only staff who teach the cohort attach a plan, and only to that learner's conversation" do
    post_message(@student, source_type: "intervention", source_id: @plan.id, body: "Learner tries")
    assert_response :unprocessable_entity

    classmate_plan = plan(trigger_type: :manual, enrollment: @classmate_enrollment)
    post_message(@instructor, source_type: "intervention", source_id: classmate_plan.id, client_message_id: "wrong-learner")
    assert_response :unprocessable_entity

    other_enrollment = Enrollment.create!(user: @student, cohort: @other_cohort, status: :active)
    other_plan = plan(trigger_type: :manual, enrollment: other_enrollment, owner: @outsider)
    post_message(@instructor, source_type: "intervention", source_id: other_plan.id, client_message_id: "wrong-cohort")
    assert_response :unprocessable_entity

    assert_equal 0, Message.where(source_type: "Intervention").count
  end

  private

  def plan(trigger_type:, evidence: {}, help_request: nil, enrollment: @enrollment, owner: @instructor)
    Intervention.create!(enrollment: enrollment, help_request: help_request, trigger_type: trigger_type, severity: :normal, status: :open,
      evidence_snapshot: evidence, owner: owner, created_by: owner, action_summary: "Check in.", next_follow_up_at: 2.days.from_now)
  end

  def post_message(user, body: "About your follow-up plan", **params)
    as_user(user) do
      post "/api/v1/direct_conversations/#{@conversation.id}/messages", params: { body: body, **params }, headers: auth_headers, as: :json
    end
  end

  def person(name, role)
    User.create!(clerk_id: "follow_up_#{name}", email: "follow-up-#{name}@example.com", first_name: "Follow", last_name: name.capitalize,
      role: role, community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
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
