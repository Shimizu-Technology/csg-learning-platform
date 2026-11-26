require "test_helper"
require_relative "../support/after_commit_helpers"
require_relative "../support/cohort_files_helpers"

# Links, in-app previews, file versions and folder renames.
class CohortFileCabinetTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include CohortFilesHelpers

  test "links save without storage, are classified, and only public https addresses are accepted" do
    assert_not S3Service.configured?
    as_user(@teacher) { post files_path, params: link_params, headers: headers, as: :json }
    assert_response :created
    link = response.parsed_body.fetch("file")
    assert_equal "link", link.fetch("kind")
    assert_equal "google_doc", link.fetch("link_provider")
    assert_equal true, link.fetch("ready")
    assert_nil link.fetch("filename")
    assert_nil link.fetch("preview_mode")
    assert_equal false, link.fetch("previewable")
    assert_not_nil CohortFile.find(link.fetch("id")).shared_at

    [ "http://example.com/a", "javascript:alert(1)", "data:text/html,<script>1</script>", "file:///etc/passwd", "https://localhost/a",
      "https://127.0.0.1/", "https://[::1]/", "https://10.1.2.3/", "https://192.168.0.4/", "https://169.254.169.254/latest", "https://intranet/",
      "https://user:secret@example.com/", "https://example.com/#{'a' * 2048}", "https:// example.com", "" ].each do |url|
      as_user(@teacher) { post files_path, params: link_params(external_url: url), headers: headers, as: :json }
      assert_response :unprocessable_entity, url
    end
    as_user(@teacher) { post files_path, params: link_params(kind: "folder"), headers: headers, as: :json }
    assert_response :unprocessable_entity

    as_user(@teacher) { post files_path, params: link_params(external_url: "https://www.figma.com/design/abc", title: ""), headers: headers, as: :json }
    assert_equal [ "figma", "figma.com" ], response.parsed_body.fetch("file").values_at("link_provider", "title")
  end

  test "students add and edit links only in their own folder while active" do
    as_user(@student) { post files_path, params: link_params(folder: "Resumes & Portfolio", external_url: "https://github.com/student/portfolio"), headers: headers, as: :json }
    assert_response :created
    link = CohortFile.find(response.parsed_body.dig("file", "id"))
    assert_equal [ @student.id, "students", "github" ], [ link.student_id, link.visibility, link.link_provider ]
    as_user(@student) { post files_path, params: link_params(student_id: @classmate.id), headers: headers, as: :json }
    assert_response :forbidden
    as_user(@student) { post files_path, params: link_params(visibility: "staff_only"), headers: headers, as: :json }
    assert_response :forbidden

    as_user(@student) { patch file_path(link), params: { external_url: "https://www.notion.so/student/notes", title: "Notes" }, headers: headers, as: :json }
    assert_response :success
    assert_equal [ "notion", "Notes" ], link.reload.values_at(:link_provider, :title)
    as_user(@student) { patch file_path(link), params: { external_url: "http://example.com" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@student) { patch file_path(@mine), params: { external_url: "https://example.com" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    assert_nil @mine.reload.external_url

    as_user(@student) { get files_path, headers: headers }
    mine = response.parsed_body.fetch("my_files").find { |file| file["id"] == link.id }
    assert_equal true, mine.fetch("can_manage")
    with_storage do
      as_user(@student) { get download_path(link), headers: headers }
      assert_response :unprocessable_entity
      as_user(@student) { get preview_path(link), headers: headers }
      assert_response :unprocessable_entity
    end

    @enrollment.update!(status: :paused)
    as_user(@student) { post files_path, params: link_params, headers: headers, as: :json }
    assert_response :forbidden
    as_user(@student) { patch file_path(link), params: { title: "Paused edit" }, headers: headers, as: :json }
    assert_response :forbidden
    # Deleting a link needs no storage.
    @enrollment.update!(status: :active)
    as_user(@student) { delete file_path(link), headers: headers }
    assert_response :no_content
  end

  test "copy to all students duplicates a class link without storage, once per student" do
    link = @cohort.cohort_files.create!(kind: "link", title: "Capstone brief", external_url: "https://docs.google.com/presentation/d/x", uploaded_by: @admin, ready: true)
    as_user(@teacher) { post copy_path(link), headers: headers, as: :json }
    assert_response :success
    assert_equal [ 2, 0 ], response.parsed_body.values_at("copied_count", "skipped_count")
    copies = CohortFile.where(source_file_id: link.id)
    assert_equal [ @student.id, @classmate.id ].sort, copies.pluck(:student_id).sort
    assert copies.all? { |copy| copy.link? && copy.external_url == link.external_url && copy.link_provider == "google_slides" && copy.s3_key.nil? }
    as_user(@teacher) { post copy_path(link), headers: headers, as: :json }
    assert_equal [ 0, 2 ], response.parsed_body.values_at("copied_count", "skipped_count")
    # Files still need storage to copy.
    as_user(@teacher) { post copy_path(@template), headers: headers, as: :json }
    assert_response :service_unavailable
  end

  test "previews serve media inline with its allowlisted type and text as text" do
    with_storage do
      as_user(@student) { get preview_path(@slides), headers: headers }
      assert_response :success
      body = response.parsed_body
      assert_equal [ "pdf", "https://storage.test/download", false ], body.values_at("preview_mode", "url", "truncated")
      assert_nil body.fetch("text")
      assert_equal [ @slides.s3_key, "inline; filename=\"week-1.pdf\"", "application/pdf" ], @signed.last.values_at(0, 2, 3)
      assert @signed.last[1].between?(1, 3600)
      assert_equal "no-store", response.headers["Cache-Control"]

      notes = ready_file(title: "Notes", filename: "notes.md", content_type: "text/markdown")
      @prefix = "# Week 1\n\n- arrays\n- caf\xC3".b
      as_user(@student) { get preview_path(notes), headers: headers }
      body = response.parsed_body
      assert_equal "markdown", body.fetch("preview_mode")
      assert_equal "# Week 1\n\n- arrays\n- caf�", body.fetch("text")
      assert_nil body.fetch("url")
      big = ready_file(title: "Roster", filename: "roster.csv", content_type: "text/csv")
      big.update_column(:file_size, CohortFile::TEXT_PREVIEW_BYTES + 10)
      as_user(@student) { get preview_path(big), headers: headers }
      body = response.parsed_body
      assert_equal [ "csv", true ], body.values_at("preview_mode", "truncated")
      assert_equal "# Week 1\n\n- arrays\n- caf", body.fetch("text")
      assert_equal [ big.s3_key, nil ], @prefix_reads.last

      signed = @signed.size
      as_user(@student) { get preview_path(@template), headers: headers }
      assert_equal [ "download_only", nil, nil ], response.parsed_body.values_at("preview_mode", "url", "text")
      assert_equal signed, @signed.size

      # Same access rules as download.
      as_user(@student) { get preview_path(@staged), headers: headers }
      assert_response :not_found
      as_user(@outsider) { get preview_path(@slides), headers: headers }
      assert_response :forbidden
    end
    as_user(@student) { get preview_path(@slides), headers: headers }
    assert_response :service_unavailable
  end

  test "file json reports the preview mode for each type" do
    as_user(@student) { get files_path, headers: headers }
    modes = response.parsed_body.fetch("class_files").to_h { |file| [ file["filename"], file.values_at("preview_mode", "previewable", "version_number", "kind") ] }
    assert_equal [ "pdf", true, 1, "file" ], modes.fetch("week-1.pdf")
    assert_equal [ "download_only", false, 1, "file" ], modes.fetch("plan.docx")
    { "a.png" => "image", "a.jpeg" => "image", "a.webp" => "image", "a.mp3" => "audio", "a.m4a" => "audio", "a.mp4" => "video",
      "a.txt" => "text", "a.csv" => "csv", "a.md" => "markdown", "a.zip" => "download_only", "a.pptx" => "download_only", "a.xls" => "download_only" }.each do |name, mode|
      assert_equal mode, CohortFile.preview_mode_for(name), name
    end
  end

  test "publishing version 2 archives version 1, after the same checks, and keeps earlier versions readable" do
    original_key = @slides.s3_key
    original_ready_at = @slides.ready_at
    with_storage do
      as_user(@teacher) { post versions_path(@slides), params: version_params, headers: headers, as: :json }
      assert_response :created
      version = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      assert_equal [ 2, false ], [ version.version_number, version.ready? ]
      # History stays empty until a second version actually publishes.
      assert_equal [ version.id ], @slides.versions.pluck(:id)
      as_user(@student) { get versions_path(@slides), headers: headers }
      assert_equal [], response.parsed_body.fetch("versions")
      assert_equal 1, @slides.reload.version_number
      assert_match %r{\Acohort_file_uploads/cohort_#{@cohort.id}/}, version.upload_key

      @prefix = "<!doctype html><script>1</script>"
      as_user(@teacher) { post complete_version_path(@slides, version), headers: headers }
      assert_response :unprocessable_entity
      assert_not version.reload.ready?
      assert_not @slides.versions.exists?(version_number: 1)
      @prefix = "%PDF-1.7\n".b
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        as_user(@teacher) { post complete_version_path(@slides, version), headers: headers }
        assert_response :success
        assert_equal [ [ version.upload_key ] ], deletes.map { |call| call[:args] }
        assert_sent_after_commit(deletes, "staging cleanup")
      end
      assert_equal [ version.upload_key, version.s3_key, "fixture-etag" ], @copied.last
      @slides.reload
      assert_equal [ 2, version.s3_key, "week-1-v2.pdf" ], [ @slides.version_number, @slides.s3_key, @slides.filename ]
      first = @slides.versions.find_by!(version_number: 1)
      assert_equal [ original_key, true, "week-1.pdf" ], [ first.s3_key, first.ready?, first.filename ]
      assert_in_delta original_ready_at, first.ready_at, 1
      assert_equal 2, response.parsed_body.dig("file", "version_number")
      as_user(@teacher) { post complete_version_path(@slides, version), headers: headers }
      assert_response :success

      as_user(@student) { get versions_path(@slides), headers: headers }
      versions = response.parsed_body.fetch("versions")
      assert_equal [ [ 2, true, "Fixed a typo" ], [ 1, false, nil ] ], versions.map { |row| row.values_at("version_number", "current", "note") }
      as_user(@student) { get download_path(@slides), params: { version_id: first.id }, headers: headers }
      assert_response :success
      assert_equal [ original_key, "attachment; filename=\"week-1.pdf\"" ], @signed.last.values_at(0, 2)
      as_user(@student) { get preview_path(@slides), params: { version_id: first.id }, headers: headers }
      assert_equal [ 1, first.id ], response.parsed_body.values_at("version_number", "version_id")
      as_user(@student) { get download_path(@template), params: { version_id: first.id }, headers: headers }
      assert_response :not_found
    end
  end

  test "versions publish in order without gaps when a later upload finishes first" do
    with_storage do
      as_user(@teacher) { post versions_path(@slides), params: version_params(filename: "a.pdf"), headers: headers, as: :json }
      first = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      as_user(@teacher) { post versions_path(@slides), params: version_params(filename: "b.pdf"), headers: headers, as: :json }
      second = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      assert_equal [ 2, 3 ], [ first.version_number, second.version_number ]
      as_user(@teacher) { post complete_version_path(@slides, second), headers: headers }
      assert_response :success
      assert_equal [ 2, 3 ], [ second.reload.version_number, first.reload.version_number ]
      assert_equal [ 2, "b.pdf" ], @slides.reload.values_at(:version_number, :filename)
      as_user(@teacher) { post complete_version_path(@slides, first), headers: headers }
      assert_equal [ 3, "a.pdf" ], @slides.reload.values_at(:version_number, :filename)
      assert_equal [ 1, 2, 3 ], @slides.versions.ready.order(:version_number).pluck(:version_number)
    end
  end

  test "only staff and active owners can start a version, and only of a published upload" do
    with_storage do
      as_user(@student) { post versions_path(@slides), params: version_params, headers: headers, as: :json }
      assert_response :not_found
      as_user(@student) { post versions_path(@from_staff), params: version_params, headers: headers, as: :json }
      assert_response :not_found
      as_user(@student) { post versions_path(@mine), params: version_params(filename: "resume.html", content_type: "text/html"), headers: headers, as: :json }
      assert_response :unprocessable_entity
      as_user(@student) { post versions_path(@mine), params: version_params(file_size: "12"), headers: headers, as: :json }
      assert_response :unprocessable_entity
      as_user(@student) { post versions_path(@mine), params: version_params(filename: "resume-v2.pdf"), headers: headers, as: :json }
      assert_response :created
      assert_match %r{/student_#{@student.id}/}, CohortFileVersion.find(response.parsed_body.dig("version", "id")).s3_key
      as_user(@admin) { post versions_path(@pending), params: version_params, headers: headers, as: :json }
      assert_response :unprocessable_entity
      link = @cohort.cohort_files.create!(kind: "link", title: "Link", external_url: "https://example.com/a", uploaded_by: @admin, ready: true)
      as_user(@admin) { post versions_path(link), params: version_params, headers: headers, as: :json }
      assert_response :unprocessable_entity

      @enrollment.update!(status: :paused)
      as_user(@student) { post versions_path(@mine), params: version_params, headers: headers, as: :json }
      assert_response :forbidden
      pending = @mine.versions.find_by!(ready: false)
      as_user(@student) { post complete_version_path(@mine, pending), headers: headers }
      assert_response :forbidden
    end
    as_user(@teacher) { post versions_path(@slides), params: version_params, headers: headers, as: :json }
    assert_response :service_unavailable
  end

  test "paused learners keep the newest version published before their pause" do
    @slides.update_columns(created_at: 3.days.ago, ready_at: 3.days.ago, shared_at: 3.days.ago)
    first = @slides.versions.create!(version_number: 1, ready: true, ready_at: 3.days.ago, filename: "week-1.pdf", content_type: "application/pdf",
      file_size: 123, s3_key: @slides.s3_key, upload_key: @slides.upload_key, upload_expires_at: 3.days.ago)
    token = SecureRandom.uuid
    second = @slides.versions.create!(version_number: 2, ready: true, ready_at: 1.hour.ago, filename: "week-1-v2.pdf", content_type: "application/pdf",
      file_size: 456, s3_key: "cohort_files/cohort_#{@cohort.id}/shared/#{token}/week-1-v2.pdf",
      upload_key: "cohort_file_uploads/cohort_#{@cohort.id}/#{token}/week-1-v2.pdf", upload_expires_at: 2.hours.ago)
    @slides.update_columns(version_number: 2, s3_key: second.s3_key, upload_key: second.upload_key, filename: second.filename, file_size: 456, ready_at: second.ready_at)
    @enrollment.update!(status: :paused)
    @enrollment.update_column(:paused_at, 1.day.ago)

    with_storage do
      as_user(@student) { get files_path, headers: headers }
      shown = response.parsed_body.fetch("class_files").find { |file| file["id"] == @slides.id }
      assert_equal [ 1, "week-1.pdf", 123 ], shown.values_at("version_number", "filename", "file_size")
      as_user(@student) { get download_path(@slides), headers: headers }
      assert_response :success
      assert_equal first.s3_key, @signed.last.first
      as_user(@student) { get download_path(@slides), params: { version_id: second.id }, headers: headers }
      assert_response :forbidden
      as_user(@student) { get preview_path(@slides), params: { version_id: second.id }, headers: headers }
      assert_response :forbidden
      as_user(@student) { get versions_path(@slides), headers: headers }
      assert_equal [ [ 1, true ] ], response.parsed_body.fetch("versions").map { |row| row.values_at("version_number", "current") }
      as_user(@classmate) { get versions_path(@slides), headers: headers }
      assert_equal [ [ 2, true ], [ 1, false ] ], response.parsed_body.fetch("versions").map { |row| row.values_at("version_number", "current") }
      # Active classmates get the current version.
      as_user(@classmate) { get download_path(@slides), headers: headers }
      assert_equal second.s3_key, @signed.last.first
    end
  end

  test "deleting a file removes every version's stored objects" do
    with_storage do
      as_user(@teacher) { post versions_path(@slides), params: version_params, headers: headers, as: :json }
      version = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      as_user(@teacher) { post complete_version_path(@slides, version), headers: headers }
      first = @slides.versions.find_by!(version_number: 1)
      keys = [ first.upload_key, first.s3_key, version.upload_key, version.s3_key ]
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        as_user(@teacher) { delete file_path(@slides), headers: headers }
        assert_response :no_content
        assert_equal keys.sort, deletes.map { |call| call[:args].first }.sort
        # The current object goes last, so a failed delete leaves it in place.
        assert_equal version.s3_key, deletes.last[:args].first
      end
      assert_not CohortFileVersion.exists?(cohort_file_id: @slides.id)

      as_user(@teacher) { post versions_path(@template), params: version_params(filename: "plan-v2.docx", content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), headers: headers, as: :json }
      pending = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      still_referenced = []
      record_external_calls(S3Service, :delete_object, returns: ->(key) { still_referenced << key if CohortFileVersion.where(s3_key: key).exists?; true }) do |deletes|
        @template.destroy!
        assert_equal [ @template.upload_key, @template.s3_key, pending.upload_key, pending.s3_key ].sort, deletes.map { |call| call[:args].first }.sort
        assert_empty still_referenced
      end
    end
  end

  test "expired pending versions are purged under lock with their objects, and ready versions are kept" do
    with_storage do
      as_user(@teacher) { post versions_path(@slides), params: version_params, headers: headers, as: :json }
      first = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      as_user(@teacher) { post complete_version_path(@slides, first), headers: headers }
      first.reload
      as_user(@teacher) { post versions_path(@slides), params: version_params, headers: headers, as: :json }
      pending = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      pending.update_columns(upload_expires_at: 1.minute.ago)
      first.update_columns(upload_expires_at: 1.minute.ago)
      # Storage cleanup runs only once no row references the key any more.
      still_referenced = []
      record_external_calls(S3Service, :delete_object, returns: ->(key) { still_referenced << key if CohortFileVersion.where(s3_key: key).or(CohortFileVersion.where(upload_key: key)).exists?; true }) do |deletes|
        CohortFile.purge_expired_pending!
        assert_not CohortFileVersion.exists?(pending.id)
        assert CohortFileVersion.exists?(first.id)
        assert_equal [ pending.upload_key, pending.s3_key ], deletes.map { |call| call[:args].first }
        assert_empty still_referenced
      end
      # A storage failure is queued for retry.
      as_user(@teacher) { post versions_path(@slides), params: version_params, headers: headers, as: :json }
      again = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      again.update_columns(upload_expires_at: 1.minute.ago)
      record_external_calls(S3Service, :delete_object, returns: false) do
        ScheduledTick::TASKS.find { |task| task.name == "s3_cleanup_retries" }.call.call(Time.current, nil, {})
      end
      assert_not CohortFileVersion.exists?(again.id)
      assert_equal [ again.upload_key, again.s3_key ].sort, PendingS3Deletion.where(reason: "cohort_file_version_destroyed").pluck(:key).sort
    end
  end

  test "staff rename a class folder in one step; student folders keep their names" do
    @mine.update!(folder: "Slides")
    as_user(@teacher) { patch "#{files_path}/rename_folder", params: { from_folder: "Slides", to_folder: "  Week 1   Slides " }, headers: headers, as: :json }
    assert_response :success
    assert_equal({ "updated_count" => 2, "folder" => "Week 1 Slides" }, response.parsed_body)
    assert_equal [ "Week 1 Slides" ], [ @slides, @staged ].map { |file| file.reload.folder }.uniq
    assert_equal "Slides", @mine.reload.folder
    [ { from_folder: "", to_folder: "New" }, { from_folder: "Slides", to_folder: " " }, { from_folder: "Slides", to_folder: "x" * 81 } ].each do |body|
      as_user(@teacher) { patch "#{files_path}/rename_folder", params: body, headers: headers, as: :json }
      assert_response :unprocessable_entity
    end
    as_user(@student) { patch "#{files_path}/rename_folder", params: { from_folder: "Week 1 Slides", to_folder: "Mine" }, headers: headers, as: :json }
    assert_response :forbidden
    as_user(@outside_teacher) { patch "#{files_path}/rename_folder", params: { from_folder: "Week 1 Slides", to_folder: "Mine" }, headers: headers, as: :json }
    assert_response :forbidden
  end

  test "a link whose address changes after a pause leaves the paused library" do
    link = @cohort.cohort_files.create!(kind: "link", title: "Capstone brief", external_url: "https://docs.google.com/document/d/old", uploaded_by: @admin, ready: true)
    link.update_columns(created_at: 3.days.ago, ready_at: 3.days.ago, shared_at: 3.days.ago)
    @enrollment.update!(status: :paused)
    @enrollment.update_column(:paused_at, 1.day.ago)
    as_user(@student) { get files_path, headers: headers }
    assert_includes response.parsed_body.fetch("class_files").map { |file| file["id"] }, link.id

    as_user(@teacher) { patch file_path(link), params: { title: "Capstone brief (renamed)" }, headers: headers, as: :json }
    assert_in_delta 3.days.ago, link.reload.shared_at, 5
    as_user(@teacher) { patch file_path(link), params: { external_url: "https://docs.google.com/document/d/new" }, headers: headers, as: :json }
    assert_response :success
    assert_in_delta Time.current, link.reload.shared_at, 5
    as_user(@student) { get files_path, headers: headers }
    assert_not_includes response.parsed_body.fetch("class_files").map { |file| file["id"] }, link.id
    refute_includes response.body, "document/d/new"
    # Active classmates follow the new address.
    as_user(@classmate) { get files_path, headers: headers }
    assert_equal "https://docs.google.com/document/d/new", response.parsed_body.fetch("class_files").find { |file| file["id"] == link.id }.fetch("external_url")
  end

  test "deleting a versioned file is atomic: rows and queued keys commit together, then storage is cleaned" do
    with_storage do
      as_user(@teacher) { post versions_path(@slides), params: version_params, headers: headers, as: :json }
      version = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      as_user(@teacher) { post complete_version_path(@slides, version), headers: headers }
      first = @slides.versions.find_by!(version_number: 1)
      keys = [ first.upload_key, first.s3_key, version.upload_key, version.s3_key ]
      # Storage fails for the archived version only: nothing half-deleted stays readable.
      record_external_calls(S3Service, :delete_object, returns: ->(key) { key != first.s3_key }) do |deletes|
        as_user(@teacher) { delete file_path(@slides), headers: headers }
        assert_response :no_content
        assert_equal keys.sort, deletes.map { |call| call[:args].first }.sort
      end
      assert_not CohortFile.exists?(@slides.id)
      assert_not CohortFileVersion.exists?(cohort_file_id: @slides.id)
      assert_equal [ first.s3_key ], PendingS3Deletion.where(key: keys).pluck(:key)
      as_user(@teacher) { get download_path(@slides), params: { version_id: first.id }, headers: headers }
      assert_response :not_found
    end
  end

  test "a destroy that rolls back queues nothing and leaves storage alone" do
    with_storage do
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        CohortFile.transaction do
          @template.destroy!
          assert PendingS3Deletion.exists?(key: @template.s3_key)
          raise ActiveRecord::Rollback
        end
        assert_empty deletes
      end
      assert CohortFile.exists?(@template.id)
      assert_not PendingS3Deletion.exists?(key: [ @template.s3_key, @template.upload_key ])
    end
  end

  test "destroy locks the file row before snapshotting its keys" do
    statements = []
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") { |*, payload| statements << payload[:sql] }
    @template.destroy!
    ActiveSupport::Notifications.unsubscribe(subscriber)
    lock = statements.index { |sql| sql.match?(/FROM "cohort_files".*FOR UPDATE/m) }
    snapshot = statements.index { |sql| sql.include?(%(FROM "cohort_file_versions")) }
    assert lock && snapshot && lock < snapshot, statements.join("\n")
    assert PendingS3Deletion.exists?(key: @template.s3_key) || !S3Service.configured?
  end

  test "a pause that lands while an upload or version publishes rolls it back and cleans its objects" do
    with_storage do
      as_user(@student) { post versions_path(@mine), params: version_params(filename: "resume-v2.pdf"), headers: headers, as: :json }
      version = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      as_user(@student) { post files_path, params: upload_params, headers: headers, as: :json }
      pending = CohortFile.find(response.parsed_body.dig("file", "id"))
      enrollment_id = @enrollment.id
      # The pause commits between the request's first check and its publish.
      S3Service.define_singleton_method(:copy_object) { |*, **| Enrollment.where(id: enrollment_id).update_all(status: Enrollment.statuses.fetch("paused"), paused_at: Time.current) }
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        as_user(@student) { post complete_version_path(@mine, version), headers: headers }
        assert_response :forbidden
        assert_not CohortFileVersion.exists?(version.id)
        assert_equal [ 1, "resume.pdf" ], @mine.reload.values_at(:version_number, :filename)
        assert_not @mine.versions.exists?
        Enrollment.where(id: enrollment_id).update_all(status: Enrollment.statuses.fetch("active"), paused_at: nil)
        as_user(@student) { post complete_path(pending), headers: headers }
        assert_response :forbidden
        assert_not CohortFile.exists?(pending.id)
        assert_equal [ version.upload_key, version.s3_key, pending.upload_key, pending.s3_key ].sort, deletes.map { |call| call[:args].first }.sort
      end
    end
  end

  test "text previews with null bytes or page markup past the upload check are download only" do
    notes = ready_file(title: "Notes", filename: "notes.txt", content_type: "text/plain")
    with_storage do
      [ "Week 1\n#{'a' * 600}\x00binary".b, "Week 1\n#{'a' * 600}<script>steal()</script>" ].each do |prefix|
        @prefix = prefix
        as_user(@student) { get preview_path(notes), headers: headers }
        assert_response :success
        assert_equal [ "download_only", nil ], response.parsed_body.values_at("preview_mode", "text")
      end
      @prefix = "Week 1 notes"
      as_user(@student) { get preview_path(notes), headers: headers }
      assert_equal [ "text", "Week 1 notes" ], response.parsed_body.values_at("preview_mode", "text")
    end
  end

  test "abandoning a paused publish never removes an upload or version another request just published" do
    with_storage do
      as_user(@student) { post versions_path(@mine), params: version_params(filename: "resume-v2.pdf"), headers: headers, as: :json }
      version = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      as_user(@student) { post files_path, params: upload_params, headers: headers, as: :json }
      pending = CohortFile.find(response.parsed_body.dig("file", "id"))
      enrollment_id = @enrollment.id
      S3Service.define_singleton_method(:copy_object) { |*, **| Enrollment.where(id: enrollment_id).update_all(status: Enrollment.statuses.fetch("paused"), paused_at: Time.current) }
      original_lock = CohortFile.instance_method(:with_lock)
      published_elsewhere = nil
      # A staff publish commits after the paused publish rolls back, before its abandon takes the lock.
      CohortFile.define_method(:with_lock) do |*args, &block|
        published_elsewhere&.call
        original_lock.bind_call(self, *args, &block)
      end
      begin
        record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
          published_elsewhere = -> { CohortFileVersion.where(id: version.id).update_all(ready: true, ready_at: Time.current) }
          as_user(@student) { post complete_version_path(@mine, version), headers: headers }
          assert_response :forbidden
          Enrollment.where(id: enrollment_id).update_all(status: Enrollment.statuses.fetch("active"), paused_at: nil)
          published_elsewhere = -> { CohortFile.where(id: pending.id).update_all(ready: true, ready_at: Time.current, shared_at: Time.current) }
          as_user(@student) { post complete_path(pending), headers: headers }
          assert_response :forbidden
          assert_empty deletes
        end
      ensure
        CohortFile.define_method(:with_lock, original_lock)
      end
      assert CohortFileVersion.find(version.id).ready?
      assert CohortFile.find(pending.id).ready?
      assert_not PendingS3Deletion.where(key: [ version.s3_key, pending.s3_key ]).exists?
    end
  end

  test "a learner whose enrollment is deleted mid-publish gets 403 and the pending upload is cleaned" do
    with_storage do
      as_user(@student) { post files_path, params: upload_params, headers: headers, as: :json }
      pending = CohortFile.find(response.parsed_body.dig("file", "id"))
      enrollment_id = @enrollment.id
      S3Service.define_singleton_method(:copy_object) { |*, **| Enrollment.where(id: enrollment_id).delete_all }
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        as_user(@student) { post complete_path(pending), headers: headers }
        assert_response :forbidden
        assert_equal [ pending.upload_key, pending.s3_key ].sort, deletes.map { |call| call[:args].first }.sort
      end
      assert_not CohortFile.exists?(pending.id)
    end
  end

  test "a learner's publish locks their enrollment before the file" do
    with_storage do
      as_user(@student) { post files_path, params: upload_params, headers: headers, as: :json }
      pending = CohortFile.find(response.parsed_body.dig("file", "id"))
      statements = []
      subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") { |*, payload| statements << payload[:sql] }
      as_user(@student) { post complete_path(pending), headers: headers }
      ActiveSupport::Notifications.unsubscribe(subscriber)
      assert_response :success
      enrollment = statements.index { |sql| sql.match?(/FROM "enrollments".*FOR UPDATE/m) }
      file = statements.index { |sql| sql.match?(/FROM "cohort_files".*FOR UPDATE/m) }
      assert enrollment && file && enrollment < file, statements.grep(/FOR UPDATE/).join("\n")
    end
  end

  test "deleting while storage is not configured keeps every key queued until storage can delete it" do
    as_user(@student) { post versions_path(@mine), params: version_params, headers: headers, as: :json }
    assert_response :service_unavailable
    keys = [ @mine.upload_key, @mine.s3_key ]
    as_user(@student) { delete file_path(@mine), headers: headers }
    assert_response :no_content
    assert_equal keys.sort, PendingS3Deletion.where(key: keys).pluck(:key).sort
    with_storage do
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        assert_equal 2, PendingS3Deletion.drain!(now: 1.hour.from_now)
        assert_equal keys.sort, deletes.map { |call| call[:args].first }.sort
      end
    end
    assert_not PendingS3Deletion.where(key: keys).exists?
  end

  test "staff version history ignores version_id, so current always marks the file's own version" do
    with_storage do
      as_user(@teacher) { post versions_path(@slides), params: version_params, headers: headers, as: :json }
      version = CohortFileVersion.find(response.parsed_body.dig("version", "id"))
      as_user(@teacher) { post complete_version_path(@slides, version), headers: headers }
      first = @slides.versions.find_by!(version_number: 1)
      as_user(@teacher) { get versions_path(@slides), params: { version_id: first.id }, headers: headers }
      assert_equal [ [ 2, true ], [ 1, false ] ], response.parsed_body.fetch("versions").map { |row| row.values_at("version_number", "current") }
    end
  end

  test "a link without a title takes its host, cut to the title limit" do
    host = "#{Array.new(4) { 'a' * 60 }.join('.')}.com"
    as_user(@teacher) { post files_path, params: link_params(external_url: "https://#{host}/path", title: ""), headers: headers, as: :json }
    assert_response :created
    assert_equal host[0, 160], response.parsed_body.dig("file", "title")
  end

  test "an expired pending version purged while storage is not configured keeps both keys queued" do
    assert_not S3Service.configured?
    token = SecureRandom.uuid
    pending = @slides.versions.create!(version_number: 2, filename: "week-1-v2.pdf", content_type: "application/pdf", file_size: 123,
      s3_key: "cohort_files/cohort_#{@cohort.id}/shared/#{token}/week-1-v2.pdf",
      upload_key: "cohort_file_uploads/cohort_#{@cohort.id}/#{token}/week-1-v2.pdf", upload_expires_at: 1.minute.ago)
    CohortFile.purge_expired_pending!(@cohort.cohort_files)
    assert_not CohortFileVersion.exists?(pending.id)
    assert_equal [ pending.upload_key, pending.s3_key ].sort, PendingS3Deletion.where(reason: "cohort_file_version_destroyed").pluck(:key).sort
    with_storage do
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        assert_equal 2, PendingS3Deletion.drain!(now: 1.hour.from_now)
        assert_equal [ pending.upload_key, pending.s3_key ].sort, deletes.map { |call| call[:args].first }.sort
      end
    end
  end

  test "a cleanup that storage can't run yet stays queued" do
    key = "cohort_files/cohort_#{@cohort.id}/shared/#{SecureRandom.uuid}/orphan.pdf"
    assert_equal :skipped, S3ObjectCleanup.delete_or_enqueue(key, reason: "cohort_file_copy_rolled_back")
    assert PendingS3Deletion.exists?(key: key)
    assert_equal :skipped, S3ObjectCleanup.delete_or_enqueue("", reason: "cohort_file_copy_rolled_back")
    assert_equal 1, PendingS3Deletion.count
  end
end
