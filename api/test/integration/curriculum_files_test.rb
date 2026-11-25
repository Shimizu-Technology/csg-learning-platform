require "test_helper"
require_relative "../support/after_commit_helpers"
require_relative "../support/cohort_files_helpers"

# Curriculum template files: who can read and change them, the upload flow,
# doc saves and the auto-copy rule.
class CurriculumFilesTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include CohortFilesHelpers

  setup do
    @templates_path = "/api/v1/curricula/#{@curriculum.id}/files"
  end

  test "admins add links and docs without storage; instructors on the curriculum read them; others are refused" do
    assert_not S3Service.configured?
    as_user(@admin) { post "#{@templates_path}/links", params: { external_url: "https://docs.google.com/spreadsheets/d/x/edit", title: "Schedule", folder: "General" }, headers: headers, as: :json }
    assert_response :created
    link = response.parsed_body.fetch("file")
    assert_equal [ "link", "google_sheet", true, false ], link.values_at("kind", "link_provider", "ready", "auto_copy_to_students")

    as_user(@admin) { post "#{@templates_path}/docs", params: { title: "Job Search Plan", folder: "Career & Job Search", doc_content: "- [ ] Apply", auto_copy_to_students: true }, headers: headers, as: :json }
    assert_response :created
    doc = response.parsed_body.fetch("file")
    assert_equal [ "doc", true, 1 ], doc.values_at("kind", "auto_copy_to_students", "doc_version")

    as_user(@teacher) { get @templates_path, headers: headers }
    assert_response :success
    assert_equal [ "Job Search Plan", "Schedule" ], response.parsed_body.fetch("files").map { |file| file["title"] }
    assert_equal false, response.parsed_body.fetch("can_manage")
    assert_equal [ false ], response.parsed_body.fetch("files").map { |file| file["can_manage"] }.uniq
    as_user(@teacher) { get "#{@templates_path}/#{doc['id']}/doc", headers: headers }
    assert_equal [ "- [ ] Apply", false ], response.parsed_body.values_at("doc_content", "can_edit_doc")

    as_user(@teacher) { post "#{@templates_path}/links", params: { external_url: "https://example.com/a" }, headers: headers, as: :json }
    assert_response :forbidden
    as_user(@teacher) { patch "#{@templates_path}/#{link['id']}", params: { title: "Mine" }, headers: headers, as: :json }
    assert_response :forbidden
    [ @outside_teacher, @student ].each do |viewer|
      as_user(viewer) { get @templates_path, headers: headers }
      assert_response :forbidden, viewer.role
    end
  end

  test "templates follow the cohort file rules for links, Markdown and auto-copy" do
    [ "http://example.com", "https://localhost/a", "https://100.64.0.1/", "https://192.88.99.1/", "https://[2001:db8::1]/", "https://user:pw@example.com/" ].each do |url|
      as_user(@admin) { post "#{@templates_path}/links", params: { external_url: url }, headers: headers, as: :json }
      assert_response :unprocessable_entity, url
    end
    as_user(@admin) { post "#{@templates_path}/docs", params: { doc_content: "Hi <script>alert(1)</script>" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@admin) { post "#{@templates_path}/docs", params: { doc_content: "```html\n<script>ok()</script>\n```" }, headers: headers, as: :json }
    assert_response :created
    doc = CurriculumFile.find(response.parsed_body.dig("file", "id"))

    as_user(@admin) { post "#{@templates_path}/docs", params: { title: "Notes", visibility: "staff_only", auto_copy_to_students: true }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@admin) { patch "#{@templates_path}/#{doc.id}", params: { auto_copy_to_students: true }, headers: headers, as: :json }
    assert_response :success
    as_user(@admin) { patch "#{@templates_path}/#{doc.id}", params: { visibility: "staff_only" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    assert_match(/shared with students/, response.parsed_body.fetch("errors").join)
    as_user(@admin) { patch "#{@templates_path}/#{doc.id}", params: { visibility: "staff_only", auto_copy_to_students: false }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "staff_only", false ], doc.reload.values_at(:visibility, :auto_copy_to_students)
    assert_raises(ActiveRecord::StatementInvalid) { doc.update_columns(auto_copy_to_students: true) }
  end

  test "doc saves need the loaded version and a stale one returns the latest doc" do
    doc = @curriculum.curriculum_files.create!(kind: "doc", title: "Cheat Sheet", doc_content: "v1", ready: true, uploaded_by: @admin)
    path = "#{@templates_path}/#{doc.id}"
    as_user(@admin) { patch path, params: { doc_content: "v2" }, headers: headers, as: :json }
    assert_response :conflict
    as_user(@admin) { patch path, params: { doc_content: "v2", base_doc_version: 1 }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "v2", 2 ], doc.reload.values_at(:doc_content, :doc_version)
    as_user(@admin) { patch path, params: { doc_content: "v3", title: "Renamed", base_doc_version: 1 }, headers: headers, as: :json }
    assert_response :conflict
    assert_equal [ "v2", 2 ], response.parsed_body.values_at("doc_content", "doc_version")
    assert_equal "Cheat Sheet", doc.reload.title
    as_user(@admin) { patch path, params: { folder: "Week 1" }, headers: headers, as: :json }
    assert_response :success, "details alone need no version"
    assert_equal "Week 1", doc.reload.folder
  end

  test "archived curricula are read only and drafts and active ones are editable" do
    @curriculum.update!(status: :draft)
    as_user(@admin) { post "#{@templates_path}/docs", params: { title: "Draft doc" }, headers: headers, as: :json }
    assert_response :created
    @curriculum.update_columns(status: Curriculum.statuses.fetch("archived"))
    as_user(@admin) { post "#{@templates_path}/docs", params: { title: "Late doc" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@admin) { get @templates_path, headers: headers }
    assert_equal false, response.parsed_body.fetch("can_manage")
  end

  test "uploads publish after the bytes check, copying with no transaction open" do
    with_storage do
      as_user(@admin) { post @templates_path, params: upload_params(folder: "Week 1", auto_copy_to_students: true), headers: headers, as: :json }
      assert_response :created
      file = CurriculumFile.find(response.parsed_body.dig("file", "id"))
      assert_match %r{\Acurriculum_file_uploads/curriculum_#{@curriculum.id}/}, file.upload_key
      assert_not file.ready?

      @prefix = "PK\x03\x04".b
      as_user(@admin) { post "#{@templates_path}/#{file.id}/complete", headers: headers }
      assert_response :unprocessable_entity
      assert_not file.reload.ready?

      @prefix = "%PDF-1.7".b
      calls = []
      record_external_calls(S3Service, :copy_object, calls: calls) do
        as_user(@admin) { post "#{@templates_path}/#{file.id}/complete", headers: headers }
      end
      assert_response :success
      assert_sent_after_commit(calls, "template publish copy")
      assert_equal [ file.upload_key, file.s3_key ], calls.first[:args]
      assert_equal "fixture-etag", calls.first[:kwargs][:etag]
      assert file.reload.ready?

      as_user(@teacher) { get "#{@templates_path}/#{file.id}/download", headers: headers }
      assert_response :success
      as_user(@teacher) { get "#{@templates_path}/#{file.id}/preview", headers: headers }
      assert_equal "pdf", response.parsed_body.fetch("preview_mode")
    end
  end

  test "an upload abandoned while its copy runs is not published and its copy is removed" do
    with_storage do
      as_user(@admin) { post @templates_path, params: upload_params, headers: headers, as: :json }
      file = CurriculumFile.find(response.parsed_body.dig("file", "id"))
      abandon = -> { CurriculumFile.find(file.id).destroy! }
      record_external_calls(S3Service, :copy_object, returns: ->(*_args, **_kwargs) { abandon.call }) do
        as_user(@admin) { post "#{@templates_path}/#{file.id}/complete", headers: headers }
      end
      assert_response :not_found
      assert_not CurriculumFile.exists?(file.id)
    end
  end

  test "deleting a template queues its stored objects in the same transaction, kept while storage is unconfigured" do
    file = curriculum_template("guide.pdf")
    as_user(@admin) { delete "#{@templates_path}/#{file.id}", params: { pending_only: true }, headers: headers }
    assert_response :unprocessable_entity
    assert_not S3Service.configured?
    as_user(@admin) { delete "#{@templates_path}/#{file.id}", headers: headers }
    assert_response :no_content
    assert_equal [ file.upload_key, file.s3_key ].sort, PendingS3Deletion.where(reason: "curriculum_file_destroyed").pluck(:key).sort
    assert_equal :skipped, S3ObjectCleanup.delete_unreferenced(file.s3_key)
  end

  test "deleting a curriculum deletes its templates and queues their objects" do
    curriculum = Curriculum.create!(name: "Throwaway course")
    template = curriculum.curriculum_files.create!(kind: "file", title: "Guide", filename: "guide.pdf", content_type: "application/pdf", file_size: 10,
      s3_key: "curriculum_files/curriculum_#{curriculum.id}/#{SecureRandom.uuid}/guide.pdf", upload_key: "curriculum_file_uploads/curriculum_#{curriculum.id}/#{SecureRandom.uuid}/guide.pdf",
      upload_expires_at: Time.current, ready: true)
    assert curriculum.destroy
    assert_not CurriculumFile.exists?(template.id)
    assert PendingS3Deletion.exists?(key: template.s3_key)
  end

  private

  def curriculum_template(filename, **attributes)
    token = SecureRandom.uuid
    @curriculum.curriculum_files.create!({ kind: "file", title: filename, filename: filename, content_type: "application/pdf", file_size: 123,
      s3_key: "curriculum_files/curriculum_#{@curriculum.id}/#{token}/#{filename}", upload_key: "curriculum_file_uploads/curriculum_#{@curriculum.id}/#{token}/#{filename}",
      upload_expires_at: Time.current, ready: true, uploaded_by: @admin }.merge(attributes))
  end
end
