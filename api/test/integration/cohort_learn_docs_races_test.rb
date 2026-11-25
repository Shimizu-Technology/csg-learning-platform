require "test_helper"
require_relative "../support/after_commit_helpers"
require_relative "../support/cohort_files_helpers"

# Learn Docs and the review loop under concurrency, pauses and changes made
# between a request's checks and its locks.
class CohortLearnDocsRacesTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include CohortFilesHelpers

  test "a learner read re-reads the enrollment, so a pause committed mid-request never shows content saved after it" do
    doc = create_doc(content: "before", title: "Guide")
    travel 1.minute
    paused_at = Time.current
    travel 1.minute
    save(doc, @teacher, "after the pause", title: "Guide v2")
    as_user(@student) do
      pause_after_authorizing(paused_at) { get doc_path(doc), headers: headers }
    end
    assert_response :success
    assert_equal [ "before", false, nil ], response.parsed_body.values_at("doc_content", "can_edit_doc", "doc_version")
    @enrollment.update_columns(status: Enrollment.statuses.fetch("active"), paused_at: nil)
    as_user(@student) do
      pause_after_authorizing(paused_at) { get files_path, headers: headers }
    end
    assert_equal "Guide", response.parsed_body.fetch("class_files").find { |file| file["id"] == doc.id }.fetch("title")
    assert_equal false, response.parsed_body.fetch("can_upload_personal")
  end

  test "review changes and comments recheck the item and the learner once both locks are held" do
    comment = @mine.comments.create!(user: @student, body: "Mine")
    # Staged staff only between the check and the lock.
    [ -> { patch review_path(@mine), params: { review_status: "needs_review" }, headers: headers, as: :json },
      -> { post comments_path(@mine), params: { body: "Hi" }, headers: headers, as: :json },
      -> { delete "#{comments_path(@mine)}/#{comment.id}", headers: headers } ].each do |request|
      [ @student, @teacher ].each do |user|
        before_lock(CohortFile, ->(file) { CohortFile.where(id: file.id).update_all(visibility: "staff_only") }) do
          as_user(user) { instance_exec(&request) }
        end
        assert_response :unprocessable_entity, user.first_name
        @mine.update_columns(visibility: "students")
      end
    end
    # Paused, or past the access deadline, between the check and the lock.
    { paused: { status: Enrollment.statuses.fetch("paused"), paused_at: Time.current }, expired: { access_expires_at: 1.second.ago } }.each do |label, change|
      before_lock(Enrollment, ->(enrollment) { Enrollment.where(id: enrollment.id).update_all(change) }) do
        as_user(@student) { post comments_path(@mine), params: { body: "Late" }, headers: headers, as: :json }
      end
      assert_response :forbidden, label
      @enrollment.update_columns(status: Enrollment.statuses.fetch("active"), paused_at: nil, access_expires_at: 1.hour.from_now)
    end
    assert_equal [ "Mine" ], @mine.comments.pluck(:body)
    assert_equal "none", @mine.reload.review_status
  end

  test "restoring always keeps the state it replaces, even a draft inside one editor's revision window" do
    doc = create_doc(student: @student, uploaded_by: @student, content: "v0")
    travel 1.minute
    save(doc, @student, "v1")
    travel 1.minute
    save(doc, @student, "v2 unsaved in history")
    assert_equal [ "v0", "v1" ], doc.doc_revisions.order(:revision_number).pluck(:content)
    first = doc.doc_revisions.find_by!(revision_number: 1)
    as_user(@student) { post "#{revisions_path(doc)}/#{first.id}/restore", params: { base_doc_version: doc.doc_version }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "v0", "v1", "v2 unsaved in history", "v0" ], doc.doc_revisions.order(:revision_number).pluck(:content)
  end

  test "doc saves lock the readers' enrollments before the doc: the student for a folder doc, the cohort for a class doc" do
    folder_doc = create_doc(student: @student, content: "feedback")
    class_doc = create_doc(content: "class guide")
    { folder_doc => [ @enrollment.id ], class_doc => [ @enrollment.id, @classmate_enrollment.id ].sort }.each do |doc, expected|
      statements = capture_sql { save(doc, @teacher, "edited #{doc.id}") }
      enrollment_locks = statements.each_index.select { |index| statements[index].match?(/FROM "enrollments".*FOR UPDATE/m) }
      file_lock = statements.index { |sql| sql.match?(/FROM "cohort_files".*FOR UPDATE/m) }
      assert enrollment_locks.any? && file_lock && enrollment_locks.max < file_lock, statements.grep(/FOR UPDATE/).join("\n")
      assert_equal expected.size, Enrollment.where(id: expected).count
    end
  end

  test "renaming a doc through PATCH files is versioned, conflict-checked and kept in history" do
    doc = create_doc(student: @student, uploaded_by: @student, content: "notes", title: "Draft")
    as_user(@student) { patch file_path(doc), params: { title: "Final" }, headers: headers, as: :json }
    assert_response :conflict
    assert_equal [ "Draft", 1 ], doc.reload.values_at(:title, :doc_version)
    as_user(@student) { patch file_path(doc), params: { title: "Final", folder: "Career", base_doc_version: 1 }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "Final", "Career", 2, "notes" ], doc.reload.values_at(:title, :folder, :doc_version, :doc_content)
    assert_equal [ "Draft" ], doc.doc_revisions.pluck(:title).first(1)
    assert_equal 2, response.parsed_body.dig("file", "doc_version")
    # Other changes, and an unchanged title, need no version.
    as_user(@student) { patch file_path(doc), params: { title: "Final", description: "Ready" }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "Ready", 2 ], doc.reload.values_at(:description, :doc_version)
  end

  test "a learner edits a copy staff put in their folder but never renames it, also through a restore" do
    copy = create_doc(student: @student, uploaded_by: @teacher, content: "template", title: "Template")
    save(copy, @student, "filled in", title: "My rename")
    assert_equal [ "Template", "filled in" ], copy.values_at(:title, :doc_content)
    assert_equal false, response.parsed_body.dig("file", "can_manage")
    save(copy, @teacher, "staff edit", title: "Template v2")
    first = copy.doc_revisions.find_by!(revision_number: 1)
    as_user(@student) { post "#{revisions_path(copy)}/#{first.id}/restore", params: { base_doc_version: copy.reload.doc_version }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "Template v2", "template" ], copy.reload.values_at(:title, :doc_content)
  end

  test "paused learners see a review status only when the review came before their pause" do
    @mine.update!(review_status: "reviewed", reviewed_by: @teacher, reviewed_at: 2.minutes.ago)
    @from_staff.update!(review_status: "needs_review")
    @enrollment.update!(status: :paused)
    travel 1.minute
    @classmate_file.update!(review_status: "reviewed", reviewed_by: @teacher, reviewed_at: Time.current)
    staff_review = ready_file(title: "Reviewed after pause", filename: "after.pdf", student: @student)
    staff_review.update!(review_status: "reviewed", reviewed_by: @teacher, reviewed_at: Time.current)
    as_user(@student) { get files_path, headers: headers }
    mine = response.parsed_body.fetch("my_files").index_by { |file| file["id"] }
    assert_equal [ "reviewed", "teacher" ], mine.fetch(@mine.id).values_at("review_status", "reviewed_by_name")
    assert_equal [ "none", nil, nil ], mine.fetch(@from_staff.id).values_at("review_status", "reviewed_by_name", "reviewed_at")
    assert_not mine.key?(staff_review.id), "shared after the pause"
  end

  test "file notifications reach paused learners only for events before the pause" do
    @mine.update_columns(review_status: "needs_review")
    notice = Notification.create!(user: @student, notifiable: @mine, notification_type: :cohort_file, title: "File reviewed", path: "/resources")
    @enrollment.update!(status: :paused)
    assert Notification.visible_to(@student).exists?(id: notice.id)
    notice.update_columns(updated_at: 1.minute.from_now)
    assert_not Notification.visible_to(@student).exists?(id: notice.id)
    @enrollment.update!(status: :active)
    assert Notification.visible_to(@student).exists?(id: notice.id)

    # A reused row takes the new event's time.
    notice.update_columns(updated_at: 1.day.ago)
    as_user(@teacher) { post comments_path(@mine), params: { body: "New thoughts" }, headers: headers, as: :json }
    assert_operator notice.reload.updated_at, :>, 1.minute.ago
    assert_equal [ "New file comment", "A new comment was added in your files." ], notice.values_at(:title, :body)
  end

  test "copies are refused for staff-only items and skip a recipient paused before their copy is made" do
    staged_doc = create_doc(content: "draft", title: "Staged")
    staged_doc.update!(visibility: "staff_only")
    as_user(@teacher) { post copy_path(staged_doc), headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@teacher) { post copy_path(@staged), headers: headers, as: :json }
    assert_response :unprocessable_entity

    shared = create_doc(content: "guide", title: "Guide")
    @classmate_enrollment.update!(status: :paused)
    # The roster query races the pause: it still lists the classmate.
    with_active_scope_including_paused do
      as_user(@teacher) { post copy_path(shared), headers: headers, as: :json }
    end
    assert_response :success
    assert_equal [ 1, 1 ], response.parsed_body.values_at("copied_count", "skipped_count")
    assert_equal [ @student.id ], CohortFile.where(source_file: shared).pluck(:student_id)
  end

  test "revision summaries with null characters are refused" do
    doc = create_doc(student: @student, uploaded_by: @student, content: "a")
    as_user(@student) { patch doc_path(doc), params: { doc_content: "b", base_doc_version: 1, save_revision: true, summary: "bad \u0000 summary" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    assert_equal [ "a", 1 ], doc.reload.values_at(:doc_content, :doc_version)
  end

  private

  # Pauses the learner (as of `paused_at`) right after the request's access
  # check, as a pause committing mid-request would.
  def pause_after_authorizing(paused_at)
    controller = Api::V1::CohortFilesController
    original = controller.instance_method(:authorize_cohort!)
    enrollment = @enrollment
    controller.define_method(:authorize_cohort!) do
      original.bind_call(self).tap { Enrollment.where(id: enrollment.id).update_all(status: Enrollment.statuses.fetch("paused"), paused_at: paused_at) }
    end
    yield
  ensure
    controller.define_method(:authorize_cohort!, original)
  end

  # Runs `hook` with the record just before the first `lock!` on a `model`.
  def before_lock(model, hook)
    original = model.instance_method(:lock!)
    ran = false
    model.define_method(:lock!) do |*args|
      unless ran
        ran = true
        hook.call(self)
      end
      original.bind_call(self, *args)
    end
    yield
  ensure
    model.send(:remove_method, :lock!)
  end

  def with_active_scope_including_paused
    original = Enrollment.method(:active)
    Enrollment.define_singleton_method(:active) { |**| where(status: statuses.values_at("active", "paused")) }
    yield
  ensure
    Enrollment.define_singleton_method(:active, original)
  end

  def capture_sql
    statements = []
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") { |*, payload| statements << payload[:sql] }
    yield
    statements
  ensure
    ActiveSupport::Notifications.unsubscribe(subscriber)
  end

  def create_doc(content:, title: "Doc", student: nil, uploaded_by: @admin, folder: "Docs")
    @cohort.cohort_files.create!(kind: "doc", title: title, folder: folder, student: student, uploaded_by: uploaded_by, ready: true,
      doc_content: content, doc_updated_at: Time.current, doc_updated_by: uploaded_by)
  end

  def save(doc, user, content, **params)
    as_user(user) { patch doc_path(doc), params: { doc_content: content, base_doc_version: doc.reload.doc_version, **params }, headers: headers, as: :json }
    assert_response :success, response.body
    doc.reload
  end

  def doc_path(file) = "#{file_path(file)}/doc"
  def revisions_path(file) = "#{file_path(file)}/revisions"
  def review_path(file) = "#{file_path(file)}/review"
  def comments_path(file) = "#{file_path(file)}/comments"
end
