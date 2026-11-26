require "test_helper"
require_relative "../support/after_commit_helpers"
require_relative "../support/cohort_files_helpers"

# Learn Docs: create, copy, edit with revisions and conflicts, pause projections.
class CohortLearnDocsTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include CohortFilesHelpers

  test "staff create class docs without storage and copy them once into each active student's folder" do
    assert_not S3Service.configured?
    as_user(@teacher) { post files_path, params: doc_params, headers: headers, as: :json }
    assert_response :created
    created = response.parsed_body.fetch("file")
    assert_equal [ "doc", true, true, "students" ], created.values_at("kind", "ready", "can_edit_doc", "visibility")
    assert_nil created.fetch("filename")
    assert_equal "teacher", created.fetch("doc_updated_by_name")
    doc = CohortFile.find(created.fetch("id"))
    assert_equal [ @teacher.id, "# Plan\n\n- [ ] Draft" ], [ doc.doc_updated_by_id, doc.doc_content ]
    assert_not_nil doc.shared_at
    assert_equal doc.doc_updated_at.iso8601(6), created.fetch("doc_updated_at")

    as_user(@teacher) { post files_path, params: doc_params(title: "", visibility: "staff_only"), headers: headers, as: :json }
    assert_equal [ "Untitled doc", "staff_only" ], response.parsed_body.fetch("file").values_at("title", "visibility")

    as_user(@student) { get files_path, headers: headers }
    listed = response.parsed_body.fetch("class_files").find { |file| file["id"] == doc.id }
    assert_equal [ false, false, "none", 0 ], listed.values_at("can_edit_doc", "can_manage", "review_status", "comment_count")
    as_user(@student) { get doc_path(doc), headers: headers }
    assert_response :success
    assert_equal [ "# Plan\n\n- [ ] Draft", false, 0 ], response.parsed_body.values_at("doc_content", "can_edit_doc", "revision_count")
    as_user(@student) { patch doc_path(doc), params: { base_doc_version: doc.reload.doc_version, doc_content: "mine now" }, headers: headers, as: :json }
    assert_response :forbidden
    with_storage do
      as_user(@student) { get download_path(doc), headers: headers }
      assert_response :unprocessable_entity
      assert_equal "Learn Docs open in the app", response.parsed_body.fetch("error")
    end

    as_user(@teacher) { post copy_path(doc), headers: headers, as: :json }
    assert_response :success
    assert_equal [ 2, 0 ], response.parsed_body.values_at("copied_count", "skipped_count")
    copy = CohortFile.find_by!(source_file: doc, student: @student)
    assert_equal [ "doc", doc.doc_content, doc.title, "students", @teacher.id ], [ copy.kind, copy.doc_content, copy.title, copy.visibility, copy.uploaded_by_id ]
    as_user(@teacher) { post copy_path(doc), headers: headers, as: :json }
    assert_equal [ 0, 2 ], response.parsed_body.values_at("copied_count", "skipped_count")

    # The student edits their copy (staff put it there) but cannot rename or delete it.
    as_user(@student) { get files_path, headers: headers }
    mine = response.parsed_body.fetch("my_files").find { |file| file["id"] == copy.id }
    assert_equal [ true, false ], mine.values_at("can_edit_doc", "can_manage")
    as_user(@student) { patch doc_path(copy), params: { base_doc_version: copy.reload.doc_version, doc_content: "# Plan\n\n- [x] Draft" }, headers: headers, as: :json }
    assert_response :success
    assert_equal "# Plan\n\n- [x] Draft", copy.reload.doc_content
    assert_equal "# Plan\n\n- [ ] Draft", doc.reload.doc_content
    as_user(@student) { delete file_path(copy), headers: headers }
    assert_response :not_found
  end

  test "active students create docs only in their own folder and doc content stays Markdown" do
    as_user(@student) { post files_path, params: doc_params(folder: "Notes"), headers: headers, as: :json }
    assert_response :created
    doc = CohortFile.find(response.parsed_body.dig("file", "id"))
    assert_equal [ @student.id, @student.id, true ], [ doc.student_id, doc.uploaded_by_id, response.parsed_body.dig("file", "can_manage") ]
    as_user(@student) { post files_path, params: doc_params(student_id: @classmate.id), headers: headers, as: :json }
    assert_response :forbidden
    as_user(@student) { post files_path, params: doc_params(visibility: "staff_only"), headers: headers, as: :json }
    assert_response :forbidden
    as_user(@classmate) { get doc_path(doc), headers: headers }
    assert_response :not_found
    as_user(@teacher) { post files_path, params: doc_params(student_id: @student.id, visibility: "staff_only"), headers: headers, as: :json }
    assert_response :created
    as_user(@teacher) { post files_path, params: doc_params(student_id: @outsider.id), headers: headers, as: :json }
    assert_response :unprocessable_entity

    code = "Use a script tag:\n\n```html\n<script src=\"app.js\"></script>\n```\n\nor `<svg>` inline."
    as_user(@student) { patch doc_path(doc), params: { base_doc_version: doc.reload.doc_version, doc_content: code }, headers: headers, as: :json }
    assert_response :success
    [ "<script>alert(1)</script>", "Hi <svg onload=x>", "<!DOCTYPE html><html>", "nul \u0000 byte", "a" * (CohortFile::MAX_DOC_LENGTH + 1),
      "```\nfenced\n```\n<script>after</script>" ].each do |content|
      as_user(@student) { patch doc_path(doc), params: { base_doc_version: doc.reload.doc_version, doc_content: content }, headers: headers, as: :json }
      assert_response :unprocessable_entity, content.first(40)
    end
    assert_equal code, doc.reload.doc_content
    as_user(@student) { patch doc_path(doc), params: { base_doc_version: doc.reload.doc_version, doc_content: { nested: true } }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@student) { post files_path, params: doc_params(doc_content: "<script>x</script>"), headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@student) { patch file_path(doc), params: { external_url: "https://example.com" }, headers: headers, as: :json }
    assert_response :unprocessable_entity

    @enrollment.update!(status: :paused)
    as_user(@student) { post files_path, params: doc_params, headers: headers, as: :json }
    assert_response :forbidden
  end

  test "edits keep the original, coalesce one editor's saves and checkpoint new editors, windows and named saves" do
    doc = create_doc(student: @student, uploaded_by: @student, content: "v0")
    original_at = doc.reload.doc_updated_at
    travel 1.minute
    as_user(@student) { patch doc_path(doc), params: { doc_content: "v1", base_doc_version: 1 }, headers: headers, as: :json }
    assert_response :success
    assert_equal 2, response.parsed_body.fetch("revision_count")
    assert_equal [ [ 1, "v0", original_at ], [ 2, "v1", doc.reload.doc_updated_at ] ],
      doc.doc_revisions.order(:revision_number).map { |revision| [ revision.revision_number, revision.content, revision.created_at ] }

    travel 1.minute
    save(doc, @student, "v2")
    save(doc, @student, "v2")
    assert_equal 2, doc.doc_revisions.count, "one editor's saves inside the window share a revision"

    travel 1.minute
    save(doc, @teacher, "v3 teacher")
    assert_equal [ "v0", "v1", "v2", "v3 teacher" ], doc.doc_revisions.order(:revision_number).pluck(:content),
      "a new editor keeps the student's last state and starts their own revision"
    travel 1.minute
    save(doc, @teacher, "v3b teacher")
    travel CohortFile::DOC_REVISION_WINDOW + 1.minute
    save(doc, @teacher, "v4 teacher")
    assert_equal [ "v3b teacher", "v4 teacher" ], doc.doc_revisions.order(:revision_number).last(2).map(&:content),
      "after the window the resting state and the new one are both kept"
    travel 1.minute
    save(doc, @teacher, "v4b teacher")
    assert_equal 6, doc.doc_revisions.count
    save(doc, @teacher, "v5 teacher", save_revision: true, summary: "Ready for class")
    latest = doc.doc_revisions.order(:revision_number).last
    assert_equal [ 7, "v5 teacher", "Ready for class" ], [ latest.revision_number, latest.content, latest.summary ]
    assert_equal (1..7).to_a, doc.doc_revisions.order(:revision_number).pluck(:revision_number)

    as_user(@student) { get revisions_path(doc), headers: headers }
    assert_response :success
    listed = response.parsed_body.fetch("revisions")
    assert_equal (1..7).to_a.reverse, listed.pluck("revision_number")
    assert_equal [ "teacher", "student" ], listed.values_at(0, 6).pluck("edited_by_name")
    assert_not listed.first.key?("content")
    first = doc.doc_revisions.find_by!(revision_number: 1)
    as_user(@student) { get "#{revisions_path(doc)}/#{first.id}", headers: headers }
    assert_equal "v0", response.parsed_body.dig("revision", "content")

    as_user(@student) { post "#{revisions_path(doc)}/#{first.id}/restore", params: { base_doc_version: doc.reload.doc_version }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "v0", 8 ], response.parsed_body.values_at("doc_content", "revision_count")
    assert_equal "Restored revision 1", doc.doc_revisions.order(:revision_number).last.summary
    as_user(@classmate) { post "#{revisions_path(doc)}/#{first.id}/restore", headers: headers, as: :json }
    assert_response :not_found
    other = create_doc(student: @classmate, uploaded_by: @classmate, content: "theirs")
    save(other, @classmate, "theirs 2")
    as_user(@student) { post "#{revisions_path(doc)}/#{other.doc_revisions.first.id}/restore", headers: headers, as: :json }
    assert_response :not_found
  end

  test "a missing or stale base_doc_version returns 409 with the latest doc and nothing is saved" do
    doc = create_doc(student: @student, uploaded_by: @student, content: "start")
    loaded = doc.doc_version
    save(doc, @teacher, "teacher feedback")
    assert_equal loaded + 1, doc.doc_version
    as_user(@student) { patch doc_path(doc), params: { doc_content: "student overwrite", base_doc_version: loaded }, headers: headers, as: :json }
    assert_response :conflict
    body = response.parsed_body
    assert_equal "This document was updated by someone else. Load the latest version before saving.", body.fetch("error")
    assert_equal [ "teacher feedback", doc.doc_version, doc.reload.doc_updated_at.iso8601(6), "teacher" ], body.values_at("doc_content", "doc_version", "doc_updated_at", "doc_updated_by_name")
    assert_equal [ doc.id, doc.doc_version ], body.fetch("file").values_at("id", "doc_version")
    assert_equal "teacher feedback", doc.doc_content
    [ nil, "", "two", -1 ].each do |base|
      as_user(@student) { patch doc_path(doc), params: { doc_content: "no base", base_doc_version: base }.compact, headers: headers, as: :json }
      assert_response :conflict, base.inspect
    end

    first = doc.doc_revisions.first
    as_user(@student) { post "#{revisions_path(doc)}/#{first.id}/restore", params: { base_doc_version: loaded }, headers: headers, as: :json }
    assert_response :conflict
    as_user(@student) { post "#{revisions_path(doc)}/#{first.id}/restore", headers: headers, as: :json }
    assert_response :conflict
    as_user(@student) { patch doc_path(doc), params: { doc_content: "student reply", base_doc_version: body.fetch("doc_version"), title: "  Renamed   doc " }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "student reply", "Renamed doc", loaded + 2 ], doc.reload.values_at(:doc_content, :title, :doc_version)
    assert_equal loaded + 2, response.parsed_body.fetch("doc_version")
    # An unchanged repeat of the same save is a no-op, so it never conflicts or advances the version.
    saved_at = doc.doc_updated_at
    as_user(@student) { patch doc_path(doc), params: { doc_content: "student reply", title: "Renamed doc", base_doc_version: doc.doc_version }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ saved_at, loaded + 2 ], doc.reload.values_at(:doc_updated_at, :doc_version)
  end

  test "a learner's doc save, restore, review change and comment lock their enrollment before the file" do
    doc = create_doc(student: @student, uploaded_by: @student, content: "start")
    save(doc, @student, "next")
    revision = doc.doc_revisions.first
    requests = [
      -> { patch doc_path(doc), params: { base_doc_version: doc.reload.doc_version, doc_content: "locked" }, headers: headers, as: :json },
      -> { post "#{revisions_path(doc)}/#{revision.id}/restore", params: { base_doc_version: doc.reload.doc_version }, headers: headers, as: :json },
      -> { patch review_path(doc), params: { review_status: "needs_review" }, headers: headers, as: :json },
      -> { post comments_path(doc), params: { body: "Ready" }, headers: headers, as: :json },
      -> { delete "#{comments_path(doc)}/#{doc.comments.last.id}", headers: headers }
    ]
    requests.each_with_index do |request, index|
      statements = []
      subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") { |*, payload| statements << payload[:sql] }
      as_user(@student) { instance_exec(&request) }
      ActiveSupport::Notifications.unsubscribe(subscriber)
      assert_includes [ 200, 201, 204 ], response.status, "request #{index}"
      enrollment = statements.index { |sql| sql.match?(/FROM "enrollments".*FOR UPDATE/m) }
      file = statements.index { |sql| sql.match?(/FROM "cohort_files".*FOR UPDATE/m) }
      assert enrollment && file && enrollment < file, "request #{index}: #{statements.grep(/FOR UPDATE/).join("\n")}"
    end
  end

  test "paused learners read the doc as it was at their pause, read-only, and cannot write" do
    class_doc = create_doc(content: "before pause", title: "Class guide")
    mine = create_doc(student: @student, uploaded_by: @student, content: "my notes")
    as_user(@teacher) { post comments_path(mine), params: { body: "Before pause" }, headers: headers, as: :json }
    travel 1.minute
    @enrollment.update!(status: :paused)
    travel 1.minute
    save(class_doc, @teacher, "after pause", title: "Class guide v2")
    save(mine, @teacher, "staff edit after pause")
    as_user(@teacher) { post comments_path(mine), params: { body: "After pause" }, headers: headers, as: :json }
    late = create_doc(content: "new after pause", title: "Late doc")

    as_user(@student) { get files_path, headers: headers }
    body = response.parsed_body
    listed = body.fetch("class_files").find { |file| file["id"] == class_doc.id }
    assert_equal [ "Class guide", false ], listed.values_at("title", "can_edit_doc")
    assert_not body.fetch("class_files").any? { |file| file["id"] == late.id }
    assert_equal [ false, 1 ], body.fetch("my_files").find { |file| file["id"] == mine.id }.values_at("can_edit_doc", "comment_count")

    as_user(@student) { get doc_path(class_doc), headers: headers }
    assert_equal [ "before pause", false, 1 ], response.parsed_body.values_at("doc_content", "can_edit_doc", "revision_count")
    assert_equal "Class guide", response.parsed_body.dig("file", "title")
    as_user(@student) { get doc_path(mine), headers: headers }
    assert_equal "my notes", response.parsed_body.fetch("doc_content")
    as_user(@student) { get revisions_path(mine), headers: headers }
    assert_equal [ "my notes" ], mine.doc_revisions.where(id: response.parsed_body.fetch("revisions").pluck("id")).pluck(:content)
    hidden = mine.doc_revisions.order(:revision_number).last
    as_user(@student) { get "#{revisions_path(mine)}/#{hidden.id}", headers: headers }
    assert_response :not_found
    as_user(@student) { get comments_path(mine), headers: headers }
    assert_equal [ [ "Before pause" ], false ], [ response.parsed_body.fetch("comments").pluck("body"), response.parsed_body.fetch("can_comment") ]
    as_user(@student) { get doc_path(late), headers: headers }
    assert_response :forbidden

    as_user(@student) { patch doc_path(mine), params: { base_doc_version: mine.reload.doc_version, doc_content: "paused edit" }, headers: headers, as: :json }
    assert_response :forbidden
    as_user(@student) { post "#{revisions_path(mine)}/#{mine.doc_revisions.first.id}/restore", headers: headers, as: :json }
    assert_response :forbidden
    as_user(@student) { patch review_path(mine), params: { review_status: "needs_review" }, headers: headers, as: :json }
    assert_response :forbidden
    as_user(@student) { post comments_path(mine), params: { body: "paused" }, headers: headers, as: :json }
    assert_response :forbidden
    as_user(@student) { delete "#{comments_path(mine)}/#{mine.comments.first.id}", headers: headers }
    assert_response :forbidden
    assert_equal [ "staff edit after pause", "none", 2 ], [ mine.reload.doc_content, mine.review_status, mine.comments.count ]

    @enrollment.update!(status: :active, access_expires_at: 1.minute.ago)
    as_user(@student) { get doc_path(mine), headers: headers }
    assert_response :forbidden
  end

  test "a pause between two saves keeps the paused learner's state as a revision" do
    doc = create_doc(content: "draft")
    travel 1.minute
    save(doc, @teacher, "first edit")
    travel 1.minute
    save(doc, @teacher, "pre-pause edit")
    assert_equal 2, doc.doc_revisions.count
    travel 30.seconds
    @enrollment.update!(status: :paused)
    travel 30.seconds
    save(doc, @teacher, "post-pause edit")
    assert_equal [ "draft", "first edit", "pre-pause edit" ], doc.doc_revisions.order(:revision_number).pluck(:content)
    as_user(@student) { get doc_path(doc), headers: headers }
    assert_equal "pre-pause edit", response.parsed_body.fetch("doc_content")
  end

  private

  def doc_params(**overrides)
    { kind: "doc", title: "Job search plan", folder: "Career", doc_content: "# Plan\n\n- [ ] Draft" }.merge(overrides)
  end

  def create_doc(content:, title: "Doc", student: nil, uploaded_by: @admin, folder: "Docs")
    @cohort.cohort_files.create!(kind: "doc", title: title, folder: folder, student: student, uploaded_by: uploaded_by, ready: true,
      doc_content: content, doc_updated_at: Time.current, doc_updated_by: uploaded_by)
  end

  def save(doc, user, content, **params)
    as_user(user) { patch doc_path(doc), params: { base_doc_version: doc.reload.doc_version, doc_content: content, **params }, headers: headers, as: :json }
    assert_response :success, response.body
    doc.reload
  end

  def doc_path(file)
    "#{file_path(file)}/doc"
  end

  def revisions_path(file)
    "#{file_path(file)}/revisions"
  end

  def review_path(file)
    "#{file_path(file)}/review"
  end

  def comments_path(file)
    "#{file_path(file)}/comments"
  end
end
