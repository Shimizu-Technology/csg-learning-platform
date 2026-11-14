require "test_helper"

# L-1.8: a staff DM written from a submission, help request or lesson keeps
# that record on the message, so the learner sees what it's about.
class MessageSourcesTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Sources curriculum")
    mod = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0)
    @lesson = Lesson.create!(curriculum_module: mod, title: "Make decisions", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, title: "Ticket prices", position: 0, submission_type: :text_submission)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.current, status: :active)
    @instructor = person("instructor", :instructor)
    @outsider = person("outsider", :instructor)
    @student = person("student", :student)
    @classmate = person("classmate", :student)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort.cohort_instructor_assignments.create!(user: @outsider)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    Enrollment.create!(user: @classmate, cohort: @cohort, status: :active)
    @submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @block,
      submission_type: :text_submission, text: "Synthetic answer")
    @help_request = HelpRequest.create!(student: @student, cohort: @cohort, category: :concept, context_type: :lesson,
      context_id: @lesson.id, context_label: "Make decisions", context_path: "/lessons/#{@lesson.id}?cohort_id=#{@cohort.id}",
      message: "Synthetic question")
    @conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student ])
  end

  test "staff attach a submission and the learner sees a link to their lesson" do
    post_message(@instructor, source_type: "submission", source_id: @submission.id)
    assert_response :created
    source = response.parsed_body.dig("message", "source")
    assert_equal({ "type" => "submission", "id" => @submission.id, "title" => "Make decisions", "lesson_id" => @lesson.id,
      "cohort_id" => @cohort.id, "learner_path" => "/lessons/#{@lesson.id}?cohort_id=#{@cohort.id}#block-#{@block.id}" }, source)
    assert_equal [ "Submission", @submission.id ], Message.last.then { |message| [ message.source_type, message.source_id ] }

    as_user(@student) { get "/api/v1/direct_conversations/#{@conversation.id}", headers: auth_headers }
    assert_response :success
    message = response.parsed_body.fetch("messages").find { |item| item["id"] == Message.last.id }
    assert_equal "/lessons/#{@lesson.id}?cohort_id=#{@cohort.id}#block-#{@block.id}", message.dig("source", "learner_path")
  end

  test "help requests link learners to where they asked and lessons to the cohort lesson" do
    post_message(@instructor, source_type: "help_request", source_id: @help_request.id)
    assert_response :created
    assert_equal "/lessons/#{@lesson.id}?cohort_id=#{@cohort.id}", response.parsed_body.dig("message", "source", "learner_path")
    assert_equal "help_request", response.parsed_body.dig("message", "source", "type")

    post_message(@instructor, source_type: "lesson", source_id: @lesson.id, client_message_id: "lesson-source")
    assert_response :created
    assert_equal({ "type" => "lesson", "id" => @lesson.id, "title" => "Make decisions", "lesson_id" => @lesson.id,
      "cohort_id" => @cohort.id, "learner_path" => "/lessons/#{@lesson.id}?cohort_id=#{@cohort.id}" }, response.parsed_body.dig("message", "source"))
  end

  test "messages without a source keep a null source" do
    post_message(@instructor)
    assert_response :created
    assert response.parsed_body.fetch("message").key?("source")
    assert_nil response.parsed_body.dig("message", "source")
  end

  test "rejects types outside the allowlist and malformed ids" do
    [ { source_type: "user", source_id: @student.id }, { source_type: "Submission", source_id: @submission.id },
      { source_type: "submission", source_id: "1 OR 1=1" }, { source_type: "submission" }, { source_id: @submission.id } ].each do |source|
      post_message(@instructor, **source)
      assert_response :unprocessable_entity, source.inspect
    end
    assert_equal 0, @conversation.messages.count
  end

  test "staff can't attach another learner's work, and learners only their own" do
    classmate_submission = Submission.create!(user: @classmate, enrollment: @classmate.enrollments.first, content_block: @block,
      submission_type: :text_submission, text: "Classmate answer")

    post_message(@instructor, source_type: "submission", source_id: classmate_submission.id)
    assert_response :unprocessable_entity
    assert_includes response.parsed_body.fetch("errors").join, "isn't available to everyone in this conversation"

    peer = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @instructor, @student, @classmate ])
    as_user(@instructor) do
      post "/api/v1/direct_conversations/#{peer.id}/messages",
        params: { body: "Group note", source_type: "submission", source_id: @submission.id }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity, "A submission can't be shown to a learner it doesn't belong to"
    assert_equal 0, Message.where.not(source_id: nil).count

    own = @conversation.messages.new(author: @student, body: "About my work", source: @submission)
    assert own.valid?, own.errors.full_messages.to_sentence
    other = @conversation.messages.new(author: @student, body: "About theirs", source: classmate_submission)
    refute other.valid?
    outsider = @conversation.messages.new(author: @outsider, body: "Not my cohort", source: @submission)
    refute outsider.valid?
  end

  test "records from another cohort, archived lessons and other curricula are rejected" do
    other_enrollment = Enrollment.create!(user: @student, cohort: @other_cohort, status: :active)
    other_submission = Submission.create!(user: @student, enrollment: other_enrollment, content_block: @block,
      submission_type: :text_submission, text: "Other cohort")
    post_message(@instructor, source_type: "submission", source_id: other_submission.id)
    assert_response :unprocessable_entity

    foreign = Lesson.create!(curriculum_module: CurriculumModule.create!(curriculum: Curriculum.create!(name: "Other"), name: "Other", position: 0),
      title: "Elsewhere", position: 0, release_day: 0)
    post_message(@instructor, source_type: "lesson", source_id: foreign.id)
    assert_response :unprocessable_entity

    @lesson.archive!
    post_message(@instructor, source_type: "lesson", source_id: @lesson.id)
    assert_response :unprocessable_entity

    post_message(@instructor, source_type: "submission", source_id: Submission.maximum(:id) + 100)
    assert_response :unprocessable_entity
    assert_equal 0, Message.where.not(source_id: nil).count
  end

  test "channel messages and thread replies can't carry a source" do
    channel = @cohort.channels.first || @cohort.channels.create!(name: "class", workspace: @cohort.workspace)
    as_user(@instructor) do
      post "/api/v1/channels/#{channel.id}/messages", params: { body: "Hi", source_type: "lesson", source_id: @lesson.id }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity

    post_message(@instructor)
    root_id = response.parsed_body.dig("message", "id")
    post_message(@instructor, parent_message_id: root_id, source_type: "submission", source_id: @submission.id, client_message_id: "reply")
    assert_response :unprocessable_entity
  end

  test "a retried send with a different source is a conflict, the same source replays" do
    post_message(@instructor, source_type: "submission", source_id: @submission.id, client_message_id: "retry-1")
    assert_response :created
    post_message(@instructor, source_type: "submission", source_id: @submission.id, client_message_id: "retry-1")
    assert_response :ok
    post_message(@instructor, client_message_id: "retry-1")
    assert_response :conflict
    assert_equal 1, @conversation.messages.count
  end

  test "later edits don't re-check a source the learner can no longer reach" do
    post_message(@instructor, source_type: "submission", source_id: @submission.id)
    message = Message.find(response.parsed_body.dig("message", "id"))
    @cohort.cohort_instructor_assignments.where(user: @instructor).delete_all
    assert message.reload.update(body: "Edited note")
  end

  test "the database rejects half a source or an unknown type" do
    message = @conversation.messages.create!(author: @instructor, body: "Plain")
    assert_raises(ActiveRecord::StatementInvalid) { message.update_columns(source_type: "Submission", source_id: nil) }
    assert_raises(ActiveRecord::StatementInvalid) { message.update_columns(source_type: "User", source_id: @student.id) }
  end

  private

  def person(name, role)
    User.create!(clerk_id: "source_#{name}", email: "source-#{name}@example.com", first_name: "Source", last_name: name.capitalize,
      role: role, community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
  end

  def post_message(user, body: "About your work", **params)
    as_user(user) do
      post "/api/v1/direct_conversations/#{@conversation.id}/messages", params: { body: body, **params }, headers: auth_headers, as: :json
    end
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
