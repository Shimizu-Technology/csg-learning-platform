require "test_helper"
require_relative "../support/curriculum_copy_fixture"

# "Make a copy for this cohort": who can preview and copy, and how the
# shared curriculum's old ids keep working for the copied cohort's learners
# (installed apps, delivered notifications, sent links).
class CurriculumCopyTest < ActionDispatch::IntegrationTest
  include CurriculumCopyFixture

  # Runs `callback` (when set) after a learner write resolved its block id
  # and before it checks the learner's enrollment.
  module BeforeLearnerCheck
    mattr_accessor :callback

    private

    def authorize_content_block_write!(content_block)
      callback = BeforeLearnerCheck.callback
      BeforeLearnerCheck.callback = nil
      callback&.call
      super
    end
  end

  [ Api::V1::SubmissionsController, Api::V1::ProgressController ].each do |controller|
    controller.prepend(BeforeLearnerCheck) unless controller.ancestors.include?(BeforeLearnerCheck)
  end

  setup { @f = build_shared_curriculum }
  teardown { BeforeLearnerCheck.callback = nil }

  # Permissions ---------------------------------------------------------------

  test "a granted instructor previews, copies, and then edits the cohort's copy" do
    as_user(@f.instructor) { get "/api/v1/lessons/#{@f.lessons[:intro].id}/block_editor", headers: auth_headers }
    access = response.parsed_body["access"]
    assert_equal [ false, "shared" ], [ access["can_edit"], access["reason"] ]
    assert_equal [ { "id" => @f.cohort.id, "name" => @f.cohort.name } ], access["copy_cohorts"]
    assert_nil access["copy_of"]
    assert_match "Make a copy for #{@f.cohort.name} in Content", access["message"]

    preview!(@f.instructor)
    assert_response :success
    preview = response.parsed_body["curriculum_copy_preview"]
    assert preview["can_copy"]
    assert_equal "#{@f.curriculum.name} (#{@f.cohort.name})", preview["copy_name"]
    assert_equal [ @f.other_cohort.id ], preview["shared_with"].map { |cohort| cohort["id"] }
    assert_equal 2, preview.dig("counts", "submissions")

    copy_request!(@f.instructor)
    assert_response :created
    body = response.parsed_body["curriculum_copy"]
    copy_id = body.dig("copy_curriculum", "id")
    new_intro = body.dig("lesson_ids", @f.lessons[:intro].id.to_s)
    assert_equal [ copy_id, false ], [ @f.cohort.reload.curriculum_id, body["already_copied"] ]
    assert_equal @f.instructor.id, body.dig("created_by", "id")

    as_user(@f.instructor) { get "/api/v1/lessons/#{new_intro}/block_editor", headers: auth_headers }
    access = response.parsed_body["access"]
    assert_equal [ true, "granted" ], [ access["can_edit"], access["reason"] ]
    assert_equal @f.cohort.id, access.dig("copy_of", "cohort", "id")
    assert_equal @f.curriculum.id, access.dig("copy_of", "source_curriculum", "id")
    lesson = Lesson.find(body.dig("lesson_ids", @f.lessons[:later].id.to_s))
    blocks = lesson.content_blocks.map { |block| { id: block.id, block_type: block.block_type, title: block.title, body: block.body } }
    as_user(@f.instructor) do
      put "/api/v1/lessons/#{lesson.id}/block_editor", params: { lesson: { base_updated_at: lesson.updated_at.iso8601(6), title: "Later for Cohort 3", blocks: blocks } },
        headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "Later for Cohort 3", lesson.reload.title
    assert_equal "Later", @f.lessons[:later].reload.title, "the shared lesson is unchanged"

    # Asking again (a client retry names the curriculum it saw) returns the same copy.
    copy_request!(@f.instructor, source: @f.curriculum.id)
    assert_response :ok
    assert response.parsed_body.dig("curriculum_copy", "already_copied")
    assert_equal copy_id, response.parsed_body.dig("curriculum_copy", "copy_curriculum", "id")
    preview!(@f.instructor, source: @f.curriculum.id)
    assert_equal [ true, copy_id ], response.parsed_body["curriculum_copy_preview"].values_at("already_copied", "copy_curriculum_id")
  end

  test "admins can copy any shared cohort; other staff and learners can't; an unshared curriculum needs no copy" do
    as_user(@f.admin) { get "/api/v1/lessons/#{@f.lessons[:intro].id}/block_editor", headers: auth_headers }
    assert_equal [ @f.cohort.id, @f.other_cohort.id ].sort, response.parsed_body.dig("access", "copy_cohorts").map { |cohort| cohort["id"] }.sort

    preview!(@f.ungranted)
    assert_response :forbidden
    assert_equal "not_allowed", response.parsed_body["code"]
    copy_request!(@f.ungranted)
    assert_response :forbidden
    assert_equal "not_allowed", response.parsed_body["code"]
    copy_request!(@f.learner)
    assert_response :forbidden
    assert_equal @f.curriculum.id, @f.cohort.reload.curriculum_id

    copy_request!(@f.admin, cohort: @f.other_cohort)
    assert_response :created
    assert_equal [ @f.cohort.id ], Cohort.where(curriculum_id: @f.curriculum.id).ids

    # Cohort 3 is now alone on the shared curriculum: nothing to copy.
    as_user(@f.instructor) { get "/api/v1/lessons/#{@f.lessons[:intro].id}/block_editor", headers: auth_headers }
    assert_equal [ true, "granted", [] ], response.parsed_body["access"].values_at("can_edit", "reason", "copy_cohorts")
    preview!(@f.instructor)
    assert_response :success
    assert_equal [ false, [ "copy_not_needed" ] ], [ response.parsed_body.dig("curriculum_copy_preview", "can_copy"),
      response.parsed_body.dig("curriculum_copy_preview", "blockers").map { |blocker| blocker["code"] } ]
    copy_request!(@f.instructor)
    assert_response :unprocessable_entity
    assert_equal "copy_not_needed", response.parsed_body["code"]
    copy_request!(@f.admin)
    assert_response :unprocessable_entity
    assert_equal "copy_not_needed", response.parsed_body["code"]
  end

  test "after the copy, asking about the shared curriculum reports the cohort's copy" do
    copy_request!(@f.admin)
    assert_response :created
    preview!(@f.admin, source: @f.curriculum.id)
    preview = response.parsed_body["curriculum_copy_preview"]
    assert preview["already_copied"], "the cohort's own copy of it is reported"
    copy_request!(@f.admin, source: preview["copy_curriculum_id"])
    assert_response :unprocessable_entity
    assert_equal "copy_not_needed", response.parsed_body["code"]
  end

  test "a copy request for a curriculum the cohort no longer uses answers content_moved" do
    # The page loaded while Cohort 3 was on the shared curriculum; an admin
    # then moved the cohort to another curriculum.
    elsewhere = Curriculum.create!(name: "Elsewhere #{SecureRandom.hex(3)}", status: :active)
    @f.cohort.update_columns(curriculum_id: elsewhere.id)

    copy_request!(@f.admin, source: @f.curriculum.id)

    assert_response :conflict
    assert_equal "content_moved", response.parsed_body["code"]
    assert_match "Reload", response.parsed_body["error"]
    refute CurriculumCopy.exists?(cohort_id: @f.cohort.id)
  end

  test "a client that timed out while the copy committed gets the same copy when it retries" do
    # The first request's client gave up (the web client waits 30 s); the server committed anyway.
    first = CurriculumCopyForCohort.new(cohort: @f.cohort, user: @f.instructor, source_curriculum_id: @f.curriculum.id).copy!
    refute first.already_copied

    copy_request!(@f.instructor, source: @f.curriculum.id)

    assert_response :ok
    body = response.parsed_body["curriculum_copy"]
    assert body["already_copied"]
    assert_equal first.copy.id, body["id"]
    assert_equal first.copy.copy_curriculum_id, body.dig("copy_curriculum", "id")
    assert_equal first.lesson_ids.transform_values(&:to_i), body["lesson_ids"].transform_values(&:to_i), "the editor can reopen the same lesson in the copy"
    assert_equal 1, CurriculumCopy.where(cohort_id: @f.cohort.id).count
  end

  # Old ids after the copy ------------------------------------------------------

  test "old lesson, module and progress ids open the cohort's copy for its learners, with their progress" do
    ids = copy_as_admin!
    old_intro = @f.lessons[:intro].id
    new_intro = ids.fetch(old_intro.to_s)

    # Installed builds: a cached lesson id, with and without the cohort.
    [ "?cohort_id=#{@f.cohort.id}", "" ].each do |query|
      as_user(@f.learner) { get "/api/v1/lessons/#{old_intro}#{query}", headers: auth_headers }
      assert_response :success, query
      lesson = response.parsed_body["lesson"]
      assert_equal new_intro, lesson["id"]
      new_read = ContentRedirect.find_by!(record_type: "ContentBlock", old_id: @f.blocks[:read].id).new_id
      assert_equal [ old_intro, new_read ], [ lesson.dig("moved_from", "lesson_id"), lesson.dig("moved_from", "block_ids", @f.blocks[:read].id.to_s) ]
      read = lesson["content_blocks"].find { |block| block["title"] == "Read" }
      assert_equal "completed", read.dig("progress", "status"), "the learner's progress came with the lesson"
    end

    as_user(@f.learner) { get "/api/v1/progress?lesson_id=#{old_intro}&cohort_id=#{@f.cohort.id}", headers: auth_headers }
    assert_response :success
    assert_equal 3, response.parsed_body["progress"].size
    new_week1 = ContentRedirect.find_by!(record_type: "CurriculumModule", old_id: @f.modules.first.id).new_id
    as_user(@f.learner) { get "/api/v1/modules/#{@f.modules.first.id}?cohort_id=#{@f.cohort.id}", headers: auth_headers }
    assert_response :success
    assert_equal new_week1, response.parsed_body.dig("module", "id")
    as_user(@f.learner) { get "/api/v1/records/lesson/#{old_intro}/summary?cohort_id=#{@f.cohort.id}", headers: auth_headers }
    assert_response :success
    assert_equal new_intro, response.parsed_body.dig("summary", "id")

    # The other cohort's learner and staff without a cohort still get the shared lesson.
    as_user(@f.other_learner) { get "/api/v1/lessons/#{old_intro}", headers: auth_headers }
    assert_response :success
    assert_equal old_intro, response.parsed_body.dig("lesson", "id")
    assert_nil response.parsed_body.dig("lesson", "moved_from")
    as_user(@f.admin) { get "/api/v1/lessons/#{old_intro}", headers: auth_headers }
    assert_equal old_intro, response.parsed_body.dig("lesson", "id")
    as_user(@f.admin) { get "/api/v1/lessons/#{old_intro}?cohort_id=#{@f.cohort.id}", headers: auth_headers }
    assert_equal new_intro, response.parsed_body.dig("lesson", "id"), "a link naming the copied cohort opens its copy"
  end

  test "learner writes against old block and check ids land on the copy" do
    copy_as_admin!
    new_id = ->(type, record) { ContentRedirect.find_by!(cohort_id: @f.cohort.id, record_type: type, old_id: record.id).new_id }

    as_user(@f.classmate) { patch "/api/v1/progress", params: { content_block_id: @f.blocks[:video].id, status: "completed" }, headers: auth_headers, as: :json }
    assert_response :success
    assert_equal new_id.call("ContentBlock", @f.blocks[:video]), response.parsed_body.dig("progress", "content_block_id")

    as_user(@f.classmate) do
      post "/api/v1/knowledge_checks/#{@f.check.id}/attempts", params: { selected_option: 0, cohort_id: @f.cohort.id }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal new_id.call("KnowledgeCheck", @f.check), KnowledgeCheckAttempt.order(:id).last.knowledge_check_id

    as_user(@f.classmate) do
      patch "/api/v1/content_blocks/#{@f.blocks[:video].id}/video_progress", params: { position_seconds: 60, duration_seconds: 100, watched_seconds: 20 }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal new_id.call("ContentBlock", @f.blocks[:video]), response.parsed_body.dig("video_progress", "content_block_id")

    as_user(@f.classmate) do
      post "/api/v1/submissions", params: { content_block_id: @f.blocks[:exercise].id, text: "Second try", cohort_id: @f.cohort.id }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal new_id.call("ContentBlock", @f.blocks[:exercise]), response.parsed_body.dig("submission", "content_block_id")

    # The shared blocks got nothing from Cohort 3's learner.
    assert_empty Progress.where(user_id: @f.classmate.id, content_block_id: @f.blocks.values.map(&:id))
  end

  test "help requests and lesson messages sent with old ids are saved on the copy" do
    ids = copy_as_admin!
    HelpRequest.where(student_id: @f.classmate.id).update_all(status: HelpRequest.statuses.fetch("resolved"), owner_id: @f.admin.id, acknowledged_at: Time.current, resolved_at: Time.current, staff_response: "Done")
    new_intro = ids.fetch(@f.lessons[:intro].id.to_s)

    as_user(@f.classmate) do
      post "/api/v1/help_requests", params: { cohort_id: @f.cohort.id, context_type: "lesson", context_id: @f.lessons[:intro].id, category: "concept", message: "Where is this?" }, headers: auth_headers, as: :json
    end
    assert_response :created
    assert_equal [ new_intro, "/lessons/#{new_intro}?cohort_id=#{@f.cohort.id}" ], HelpRequest.order(:id).last.then { |request| [ request.context_id, request.context_path ] }
    # Asking again with the old id finds the same open request.
    as_user(@f.classmate) do
      post "/api/v1/help_requests", params: { cohort_id: @f.cohort.id, context_type: "lesson", context_id: @f.lessons[:intro].id, category: "concept", message: "Again" }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal false, response.parsed_body["created"]

    conversation = DirectConversation.find_or_create_for!(workspace: @f.cohort.workspace, users: [ @f.admin, @f.classmate ])
    as_user(@f.admin) do
      post "/api/v1/direct_conversations/#{conversation.id}/messages", params: { body: "Look here", source_type: "lesson", source_id: @f.lessons[:intro].id }, headers: auth_headers, as: :json
    end
    assert_response :created
    assert_equal new_intro, Message.order(:id).last.source_id
  end

  test "a notification sent before the copy opens the copied lesson" do
    ids = copy_as_admin!
    notification = Notification.find_by!(user: @f.learner)
    new_project = ids.fetch(@f.lessons[:project].id.to_s)
    assert_match %r{\A/lessons/#{new_project}\?}, notification.path

    # A push delivered before the copy still carries the old path; the app opens it.
    as_user(@f.learner) { get "/api/v1/lessons/#{@f.lessons[:project].id}?cohort_id=#{@f.cohort.id}", headers: auth_headers }
    assert_response :success
    assert_equal new_project, response.parsed_body.dig("lesson", "id")
    as_user(@f.learner) { get "/api/v1/notifications", headers: auth_headers }
    row = response.parsed_body["notifications"].find { |item| item["id"] == notification.id }
    assert_equal new_project.to_s, row.dig("destination", "id").to_s
  end

  test "a submission whose block was resolved just before the copy committed is refused with reload, not forbidden" do
    BeforeLearnerCheck.callback = -> { CurriculumCopyForCohort.new(cohort: Cohort.find(@f.cohort.id), user: @f.admin, source_curriculum_id: @f.curriculum.id).copy! }

    as_user(@f.classmate) { post "/api/v1/submissions", params: { content_block_id: @f.blocks[:exercise].id, text: "Raced" }, headers: auth_headers, as: :json }

    assert_response :conflict
    assert_equal "content_moved", response.parsed_body["code"]
    assert_empty Submission.where(user_id: @f.classmate.id, text: "Raced")

    # The reload resolves the old id to the copy and saves there.
    as_user(@f.classmate) { post "/api/v1/submissions", params: { content_block_id: @f.blocks[:exercise].id, text: "Raced" }, headers: auth_headers, as: :json }
    assert_response :created
    assert_equal ContentRedirect.find_by!(cohort_id: @f.cohort.id, record_type: "ContentBlock", old_id: @f.blocks[:exercise].id).new_id,
      response.parsed_body.dig("submission", "content_block_id")
  end

  # A learner who left (or lost access to) a cohort still on the shared
  # curriculum: that enrollment doesn't keep old ids on the shared blocks.
  {
    "dropped" => ->(enrollment) { enrollment.update!(status: :dropped) },
    "expired" => ->(enrollment) { enrollment.update_columns(access_expires_at: 1.day.ago) }
  }.each do |state, change|
    test "a learner whose #{state} enrollment is on the shared curriculum still saves old ids on the copy" do
      copy_as_admin!
      old_enrollment = Enrollment.create!(user: @f.classmate, cohort: @f.other_cohort, status: :active)
      change.call(old_enrollment)

      as_user(@f.classmate) { post "/api/v1/submissions", params: { content_block_id: @f.blocks[:exercise].id, text: "From an old link" }, headers: auth_headers, as: :json }

      assert_response :created
      assert_equal ContentRedirect.find_by!(cohort_id: @f.cohort.id, record_type: "ContentBlock", old_id: @f.blocks[:exercise].id).new_id,
        response.parsed_body.dig("submission", "content_block_id")
    end
  end

  test "a learner active in the copied cohort and finished in a shared one works on the copy; one only finished in a shared one reads it" do
    copy_as_admin!
    finished = Enrollment.create!(user: @f.classmate, cohort: @f.other_cohort, status: :completed)
    new_intro = ContentRedirect.find_by!(cohort_id: @f.cohort.id, record_type: "Lesson", old_id: @f.lessons[:intro].id).new_id

    assert_equal new_intro, MovedContent.id_for(@f.classmate, "Lesson", @f.lessons[:intro].id)
    @f.cohort.enrollments.find_by!(user: @f.classmate).update!(status: :completed)
    assert_equal @f.lessons[:intro].id, MovedContent.id_for(@f.classmate, "Lesson", @f.lessons[:intro].id), "with no active cohort, a readable one that shares it keeps the shared lesson"
    finished.update!(status: :dropped)
    assert_equal new_intro, MovedContent.id_for(@f.classmate, "Lesson", @f.lessons[:intro].id)
  end

  test "a staff page loaded before the copy sets a learner's module and lesson overrides on the copy" do
    copy_as_admin!
    enrollment = @f.cohort.enrollments.find_by!(user: @f.classmate)
    new_week2 = ContentRedirect.find_by!(cohort_id: @f.cohort.id, record_type: "CurriculumModule", old_id: @f.modules.second.id).new_id
    new_project = ContentRedirect.find_by!(cohort_id: @f.cohort.id, record_type: "Lesson", old_id: @f.lessons[:project].id).new_id

    as_user(@f.admin) { post "/api/v1/enrollments/#{enrollment.id}/module_assignments", params: { module_id: @f.modules.second.id, unlocked: true }, headers: auth_headers, as: :json }
    assert_response :created
    assert_equal new_week2, response.parsed_body.dig("module_assignment", "module_id")
    assert ModuleAssignment.find_by!(enrollment_id: enrollment.id, module_id: new_week2).unlocked

    as_user(@f.admin) { post "/api/v1/enrollments/#{enrollment.id}/lesson_assignments", params: { lesson_id: @f.lessons[:project].id, unlocked: true }, headers: auth_headers, as: :json }
    assert_response :created
    assert_equal new_project, response.parsed_body.dig("lesson_assignment", "lesson_id")
    assert_empty ModuleAssignment.where(enrollment_id: enrollment.id, module_id: @f.modules.map(&:id))
    assert_empty LessonAssignment.where(enrollment_id: enrollment.id, lesson_id: @f.lessons.values.map(&:id))
  end

  test "a learning write that began before the copy committed is refused with reload, not lost" do
    copy_as_admin!
    enrollment = @f.cohort.enrollments.find_by!(user: @f.classmate)
    enrollment.update_columns(content_moved_at: 1.minute.from_now)

    as_user(@f.classmate) { patch "/api/v1/progress", params: { content_block_id: @f.blocks[:video].id, status: "completed" }, headers: auth_headers, as: :json }

    assert_response :conflict
    assert_equal "content_moved", response.parsed_body["code"]
    assert_match "Reload, then save again", response.parsed_body["error"]
  end

  private

  def copy_as_admin!
    copy_request!(@f.admin)
    assert_response :created
    response.parsed_body.dig("curriculum_copy", "lesson_ids")
  end

  def preview!(user, cohort: @f.cohort, source: cohort.curriculum_id)
    as_user(user) { get "/api/v1/cohorts/#{cohort.id}/curriculum_copy?source_curriculum_id=#{source}", headers: auth_headers }
  end

  def copy_request!(user, cohort: @f.cohort, source: cohort.reload.curriculum_id)
    as_user(user) { post "/api/v1/cohorts/#{cohort.id}/curriculum_copy", params: { source_curriculum_id: source }, headers: auth_headers, as: :json }
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(person)
    payload = { "sub" => person.clerk_id, "email" => person.email, "first_name" => person.first_name, "last_name" => person.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
