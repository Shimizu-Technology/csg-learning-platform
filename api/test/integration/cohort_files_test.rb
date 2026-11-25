require "test_helper"
require_relative "../support/after_commit_helpers"

class CohortFilesTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers

  setup do
    @curriculum = Curriculum.create!(name: "Career files course")
    @cohort = Cohort.create!(name: "Cohort files", curriculum: @curriculum, start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(name: "Other cohort", curriculum: @curriculum, start_date: Date.current, status: :active)
    @admin = user("admin", :admin)
    @teacher = user("teacher", :instructor)
    @outside_teacher = user("outside_teacher", :instructor)
    @student = user("student", :student)
    @classmate = user("classmate", :student)
    @outsider = user("outsider", :student)
    CohortInstructorAssignment.create!(cohort: @cohort, user: @teacher)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, access_expires_at: 1.hour.from_now)
    @classmate_enrollment = Enrollment.create!(user: @classmate, cohort: @cohort)
    Enrollment.create!(user: @outsider, cohort: @other_cohort)

    @slides = ready_file(title: "Week 1 Slides", filename: "week-1.pdf", folder: "Slides")
    @staged = ready_file(title: "Instructor notes", filename: "notes.pdf", folder: "Slides", visibility: "staff_only")
    @template = ready_file(title: "Job Search Plan Template", filename: "plan.docx", folder: "Career & Job Search",
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    @mine = ready_file(title: "Resume Draft", filename: "resume.pdf", folder: "Resumes & Portfolio", student: @student, uploaded_by: @student)
    @from_staff = ready_file(title: "Coaching notes", filename: "coaching.pdf", folder: "Job Search & Career", student: @student)
    @staff_only_private = ready_file(title: "Staff note about student", filename: "private.pdf", student: @student, visibility: "staff_only")
    @classmate_file = ready_file(title: "Classmate resume", filename: "classmate.pdf", student: @classmate, uploaded_by: @classmate)
    pending_token = SecureRandom.uuid
    @pending = @cohort.cohort_files.create!(title: "Pending", filename: "pending.pdf", content_type: "application/pdf", file_size: 10,
      s3_key: "cohort_files/cohort_#{@cohort.id}/shared/#{pending_token}/pending.pdf",
      upload_key: "cohort_file_uploads/cohort_#{@cohort.id}/#{pending_token}/pending.pdf", upload_expires_at: 1.hour.from_now, uploaded_by: @admin)

    @signed = []
    @copied = []
    @metadata = { content_type: "application/pdf", content_length: 123, etag: "fixture-etag" }
    @prefix = "%PDF-1.7\n%synthetic".b
    @prefix_reads = []
    @prefix_error = nil
  end

  test "students see visible class files and only their own folder" do
    as_user(@student) { get files_path, headers: headers }
    assert_response :success
    body = response.parsed_body
    assert_equal [ @template.id, @slides.id ].sort, body.fetch("class_files").map { |file| file["id"] }.sort
    assert_equal [ @from_staff.id, @mine.id ].sort, body.fetch("my_files").map { |file| file["id"] }.sort
    assert_not body.key?("student_folders")
    assert_equal true, body.fetch("can_upload_personal")
    [ @staged, @staff_only_private, @classmate_file, @pending ].each { |hidden| refute_includes response.body, hidden.title }
    refute_includes response.body, "s3_key"
    mine = body.fetch("my_files").find { |file| file["id"] == @mine.id }
    assert_equal true, mine.fetch("can_manage")
    assert_equal "student", mine.fetch("uploaded_by_role")
    staff_copy = body.fetch("my_files").find { |file| file["id"] == @from_staff.id }
    assert_equal false, staff_copy.fetch("can_manage")
    assert_equal "staff", staff_copy.fetch("uploaded_by_role")
  end

  test "staff see every class file and a folder for each active or paused student" do
    @classmate_enrollment.update!(status: :paused)
    dropped = user("dropped", :student)
    Enrollment.create!(user: dropped, cohort: @cohort, status: :dropped)
    [ @admin, @teacher ].each do |viewer|
      as_user(viewer) { get files_path, headers: headers }
      assert_response :success
      body = response.parsed_body
      assert_equal [ @slides, @staged, @template ].map(&:id).sort, body.fetch("class_files").map { |file| file["id"] }.sort
      folders = body.fetch("student_folders").index_by { |folder| folder["student_id"] }
      assert_equal [ @student.id, @classmate.id ].sort, folders.keys.sort
      assert_equal 3, folders.fetch(@student.id).fetch("file_count")
      assert_equal "paused", folders.fetch(@classmate.id).fetch("enrollment_status")
      assert_equal false, body.fetch("can_upload_personal")
      assert_not body.key?("my_files")
    end
    fresh = user("fresh", :student)
    Enrollment.create!(user: fresh, cohort: @cohort)
    as_user(@teacher) { get files_path, headers: headers }
    folder = response.parsed_body.fetch("student_folders").find { |row| row["student_id"] == fresh.id }
    assert_equal 0, folder.fetch("file_count")
    assert_equal [], folder.fetch("files")
  end

  test "unrelated students and instructors cannot list or download" do
    get files_path
    assert_response :unauthorized
    with_storage do
      [ @outsider, @outside_teacher ].each do |viewer|
        as_user(viewer) { get files_path, headers: headers }
        assert_response :forbidden
        as_user(viewer) { get download_path(@slides), headers: headers }
        assert_response :forbidden
      end
    end
    assert_empty @signed
  end

  test "students cannot download staged files or another student's folder" do
    with_storage do
      [ @staged, @staff_only_private, @classmate_file, @pending ].each do |file|
        as_user(@student) { get download_path(file), headers: headers }
        assert_response :not_found
      end
      as_user(@student) { get download_path(@mine), headers: headers }
      assert_response :success
      assert_equal "no-store", response.headers["Cache-Control"]
      assert_equal "resume.pdf", response.parsed_body.fetch("filename")
      key, expiry, disposition = @signed.sole
      assert_equal @mine.s3_key, key
      assert expiry.between?(1, CohortFile::DOWNLOAD_EXPIRY)
      assert_equal "attachment; filename=\"resume.pdf\"", disposition
    end
  end

  test "download expiry cannot extend course access and expired learners are refused" do
    @enrollment.update!(access_expires_at: 30.seconds.from_now)
    with_storage do
      as_user(@student) { get download_path(@slides), headers: headers }
      assert_response :success
      assert @signed.last[1].between?(1, 30)
      @enrollment.update!(access_expires_at: 1.second.ago)
      as_user(@student) { get download_path(@slides), headers: headers }
      assert_response :forbidden
    end
  end

  test "paused students read files available before the pause but cannot write" do
    @slides.update_columns(created_at: 3.days.ago, ready_at: 2.days.ago, shared_at: 2.days.ago)
    @mine.update_columns(created_at: 3.days.ago, ready_at: 2.days.ago, shared_at: 2.days.ago)
    @enrollment.update!(status: :paused)
    @enrollment.update_column(:paused_at, 1.day.ago)
    with_storage do
      as_user(@student) { get files_path, headers: headers }
      assert_response :success
      body = response.parsed_body
      assert_equal [ @slides.id ], body.fetch("class_files").map { |file| file["id"] }
      assert_equal [ @mine.id ], body.fetch("my_files").map { |file| file["id"] }
      assert_equal false, body.fetch("can_upload_personal")
      assert_equal false, body.fetch("my_files").sole.fetch("can_manage")
      as_user(@student) { get download_path(@template), headers: headers }
      assert_response :forbidden
      as_user(@student) { post files_path, params: upload_params, headers: headers, as: :json }
      assert_response :forbidden
      as_user(@student) { patch file_path(@mine), params: { title: "Renamed" }, headers: headers, as: :json }
      assert_response :forbidden
    end
  end

  test "paused and completed students cannot delete their own uploads" do
    with_storage do
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        [ { status: :paused }, { status: :completed } ].each do |change|
          @enrollment.update!(change)
          as_user(@student) { delete file_path(@mine), headers: headers }
          assert_response :forbidden
        end
        assert CohortFile.exists?(@mine.id)
        assert_empty deletes
      end
    end
  end

  test "a file staged before a pause and shared after it stays outside the paused library" do
    @staged.update_columns(created_at: 3.days.ago, ready_at: 3.days.ago)
    @enrollment.update!(status: :paused)
    @enrollment.update_column(:paused_at, 1.day.ago)
    as_user(@teacher) { patch file_path(@staged), params: { visibility: "students" }, headers: headers, as: :json }
    assert_response :success
    assert_in_delta Time.current, @staged.reload.shared_at, 5
    with_storage do
      as_user(@student) { get files_path, headers: headers }
      refute_includes response.parsed_body.fetch("class_files").map { |file| file["id"] }, @staged.id
      as_user(@student) { get download_path(@staged), headers: headers }
      assert_response :forbidden
    end
    assert_empty @signed
    # Staging again clears the sharing time; active classmates still see the shared file.
    as_user(@classmate) { get files_path, headers: headers }
    assert_includes response.parsed_body.fetch("class_files").map { |file| file["id"] }, @staged.id
    as_user(@teacher) { patch file_path(@staged), params: { visibility: "staff_only" }, headers: headers, as: :json }
    assert_nil @staged.reload.shared_at
  end

  test "pending_only abandons an unfinished upload but never a published file" do
    with_storage do
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        as_user(@admin) { delete "#{file_path(@slides)}?pending_only=true", headers: headers }
        assert_response :unprocessable_entity
        assert CohortFile.exists?(@slides.id)
        assert_empty deletes
        as_user(@admin) { delete "#{file_path(@pending)}?pending_only=true", headers: headers }
        assert_response :no_content
        assert_not CohortFile.exists?(@pending.id)
      end
    end
  end

  test "starting an upload clears this cohort's expired pending uploads and their staging" do
    @pending.update_columns(upload_expires_at: 1.minute.ago)
    other = @other_cohort.cohort_files.create!(title: "Other pending", filename: "other.pdf", content_type: "application/pdf", file_size: 10,
      s3_key: "cohort_files/cohort_#{@other_cohort.id}/shared/#{SecureRandom.uuid}/other.pdf",
      upload_key: "cohort_file_uploads/cohort_#{@other_cohort.id}/#{SecureRandom.uuid}/other.pdf", upload_expires_at: 1.minute.ago)
    with_storage do
      # Storage cleanup runs only once no row references the key any more.
      still_referenced = []
      record_external_calls(S3Service, :delete_object, returns: ->(key) { still_referenced << key if CohortFile.where(s3_key: key).or(CohortFile.where(upload_key: key)).exists?; true }) do |deletes|
        as_user(@admin) { post files_path, params: upload_params, headers: headers, as: :json }
        assert_response :created
        assert_not CohortFile.exists?(@pending.id)
        assert CohortFile.exists?(other.id)
        # An unready row has no published object; only its staging upload is removed.
        assert_equal [ @pending.upload_key ], deletes.map { |call| call[:args].first }
        assert_empty still_referenced
      end
    end
  end

  test "uploads whose bytes do not match their type are not published" do
    @pending.update!(file_size: 123)
    with_storage do
      [ [ "<!DOCTYPE html><script>alert(1)</script>", "pdf" ], [ "<svg onload=alert(1)>", "pdf" ] ].each do |prefix, _|
        @prefix = prefix
        as_user(@admin) { post complete_path(@pending), headers: headers }
        assert_response :unprocessable_entity
        assert_match(/don't match its .pdf type/, response.parsed_body.fetch("error"))
      end
      token = SecureRandom.uuid
      notes = @cohort.cohort_files.create!(title: "Notes", filename: "notes.txt", content_type: "text/plain", file_size: 123, uploaded_by: @admin,
        s3_key: "cohort_files/cohort_#{@cohort.id}/shared/#{token}/notes.txt", upload_key: "cohort_file_uploads/cohort_#{@cohort.id}/#{token}/notes.txt",
        upload_expires_at: 1.hour.from_now)
      @metadata = @metadata.merge(content_type: "text/plain")
      [ "Week 1 notes\n<svg><script>steal()</script></svg>", "plain\x00binary" ].each do |prefix|
        @prefix = prefix
        as_user(@admin) { post complete_path(notes), headers: headers }
        assert_response :unprocessable_entity
      end
      assert_not notes.reload.ready?
      assert_empty @copied
      @prefix = "Week 1 notes: arrays, hashes and loops.\n"
      as_user(@admin) { post complete_path(notes), headers: headers }
      assert_response :success
      assert notes.reload.ready?
    end
  end

  test "student uploads go to their own folder, visible to staff, and publish after commit" do
    with_storage do
      as_user(@student) { post files_path, params: upload_params, headers: headers, as: :json }
      assert_response :created
      body = response.parsed_body
      assert_equal "https://storage.test/upload", body.fetch("upload_url")
      file = CohortFile.find(body.fetch("file").fetch("id"))
      assert_equal @student.id, file.student_id
      assert_equal "students", file.visibility
      assert_equal "Job Search & Career", file.folder
      assert_equal "cover-letter", file.title
      assert_equal "application/pdf", file.content_type
      assert_match %r{\Acohort_file_uploads/cohort_#{@cohort.id}/}, file.upload_key
      assert_match %r{\Acohort_files/cohort_#{@cohort.id}/student_#{@student.id}/}, file.s3_key
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        as_user(@student) { post complete_path(file), headers: headers }
        assert_response :success
        assert file.reload.ready?
        assert_equal [ [ file.upload_key, file.s3_key, "fixture-etag" ] ], @copied
        assert_equal [ [ file.upload_key, "fixture-etag" ] ], @prefix_reads
        assert_equal [ [ file.upload_key ] ], deletes.map { |call| call[:args] }
        assert_sent_after_commit(deletes, "staging delete")
      end
      as_user(@student) { post complete_path(file), headers: headers }
      assert_response :success
      assert_equal 1, @copied.size
    end
  end

  test "students cannot stage, target another folder, or complete someone else's upload" do
    with_storage do
      as_user(@student) { post files_path, params: upload_params(visibility: "staff_only"), headers: headers, as: :json }
      assert_response :forbidden
      as_user(@student) { post files_path, params: upload_params(student_id: @classmate.id), headers: headers, as: :json }
      assert_response :forbidden
      as_user(@student) { post complete_path(@pending), headers: headers }
      assert_response :not_found
      as_user(@student) { post copy_path(@template), headers: headers }
      assert_response :forbidden
    end
    assert_empty @copied
  end

  test "staff upload class files, stage them, and upload into an enrolled student's folder" do
    with_storage do
      as_user(@teacher) { post files_path, params: upload_params(visibility: "staff_only", folder: "Slides", title: "Draft slides"), headers: headers, as: :json }
      assert_response :created
      staged = CohortFile.find(response.parsed_body.fetch("file").fetch("id"))
      assert_nil staged.student_id
      assert_equal "staff_only", staged.visibility
      assert_match %r{/shared/}, staged.s3_key
      as_user(@admin) { post files_path, params: upload_params(student_id: @classmate.id), headers: headers, as: :json }
      assert_response :created
      assert_equal @classmate.id, CohortFile.find(response.parsed_body.fetch("file").fetch("id")).student_id
      as_user(@admin) { post files_path, params: upload_params(student_id: @outsider.id), headers: headers, as: :json }
      assert_response :unprocessable_entity
    end
  end

  test "unsafe, oversized, and malformed uploads are rejected" do
    with_storage do
      [
        upload_params(filename: "page.html", content_type: "text/html"),
        upload_params(filename: "logo.svg", content_type: "image/svg+xml"),
        upload_params(filename: "run.sh", content_type: "application/x-sh"),
        upload_params(filename: "app.js", content_type: "text/javascript"),
        upload_params(filename: "fake.pdf", content_type: "text/html"),
        upload_params(filename: "..", content_type: "application/pdf"),
        upload_params(filename: ".env", content_type: "text/plain"),
        upload_params(file_size: CohortFile::MAX_FILE_SIZE + 1),
        upload_params(file_size: 0),
        upload_params(file_size: "123"),
        upload_params(visibility: "public")
      ].each do |invalid|
        as_user(@admin) { post files_path, params: invalid, headers: headers, as: :json }
        assert_response :unprocessable_entity, invalid.inspect
      end
    end
  end

  test "uploads need storage and a matching staged object" do
    as_user(@admin) { post files_path, params: upload_params, headers: headers, as: :json }
    assert_response :service_unavailable
    with_storage do
      [ nil, @metadata.merge(content_type: "text/html"), @metadata.merge(content_length: 9) ].each do |metadata|
        @metadata = metadata
        as_user(@admin) { post complete_path(@pending), headers: headers }
        assert_response :unprocessable_entity
      end
      @pending.update!(upload_expires_at: 1.second.ago)
      as_user(@admin) { post complete_path(@pending), headers: headers }
      assert_response :unprocessable_entity
      assert_not @pending.reload.ready?
    end
    assert_empty @copied
  end

  test "share with students toggles a staged class file without re-uploading" do
    as_user(@teacher) { patch file_path(@staged), params: { visibility: "students", folder: "Guides & Handouts" }, headers: headers, as: :json }
    assert_response :success
    assert_equal "students", response.parsed_body.fetch("file").fetch("visibility")
    assert_equal "Guides & Handouts", @staged.reload.folder
    as_user(@student) { get files_path, headers: headers }
    assert_includes response.parsed_body.fetch("class_files").map { |file| file["id"] }, @staged.id
    as_user(@teacher) { patch file_path(@staged), params: { visibility: "hidden" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
    as_user(@teacher) { patch file_path(@mine), params: { visibility: "staff_only" }, headers: headers, as: :json }
    assert_response :unprocessable_entity
  end

  test "students rename only their own uploads and never change visibility" do
    as_user(@student) { patch file_path(@mine), params: { title: "Resume v2", visibility: "staff_only" }, headers: headers, as: :json }
    assert_response :success
    assert_equal "Resume v2", @mine.reload.title
    assert_equal "students", @mine.visibility
    [ @from_staff, @slides, @classmate_file ].each do |file|
      as_user(@student) { patch file_path(file), params: { title: "Mine now" }, headers: headers, as: :json }
      assert_response :not_found
    end
  end

  test "delete removes stored objects and is scoped to the owner" do
    with_storage do
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        [ @from_staff, @classmate_file, @slides ].each do |file|
          as_user(@student) { delete file_path(file), headers: headers }
          assert_response :not_found
        end
        as_user(@student) { delete file_path(@mine), headers: headers }
        assert_response :no_content
        assert_not CohortFile.exists?(@mine.id)
        assert_equal [ [ @mine.upload_key ], [ @mine.s3_key ] ], deletes.map { |call| call[:args] }
      end
      record_external_calls(S3Service, :delete_object, returns: false) do
        as_user(@teacher) { delete file_path(@classmate_file), headers: headers }
        assert_response :bad_gateway
        assert CohortFile.exists?(@classmate_file.id)
      end
    end
    as_user(@teacher) { delete file_path(@classmate_file), headers: headers }
    assert_response :no_content
    assert_not CohortFile.exists?(@classmate_file.id)
  end

  test "copy to all students copies once per active student and only reaches new students later" do
    paused = user("paused", :student)
    Enrollment.create!(user: paused, cohort: @cohort, status: :paused)
    with_storage do
      as_user(@teacher) { post copy_path(@template), params: { folder: "Job Search & Career" }, headers: headers, as: :json }
      assert_response :success
      body = response.parsed_body
      assert_equal 2, body.fetch("copied_count")
      assert_equal 0, body.fetch("skipped_count")
      copies = CohortFile.where(source_file_id: @template.id)
      assert_equal [ @student.id, @classmate.id ].sort, copies.pluck(:student_id).sort
      assert copies.all? { |copy| copy.ready? && copy.visibility == "students" && copy.folder == "Job Search & Career" }
      assert_equal copies.map { |copy| [ @template.s3_key, copy.s3_key, nil ] }.sort, @copied.sort
      assert copies.all? { |copy| copy.s3_key.start_with?("cohort_files/cohort_#{@cohort.id}/student_#{copy.student_id}/") }

      late = user("late", :student)
      Enrollment.create!(user: late, cohort: @cohort)
      as_user(@admin) { post copy_path(@template), headers: headers }
      assert_response :success
      assert_equal 1, response.parsed_body.fetch("copied_count")
      assert_equal 2, response.parsed_body.fetch("skipped_count")
      assert_equal "Career & Job Search", CohortFile.find_by!(source_file_id: @template.id, student_id: late.id).folder

      as_user(@student) { get files_path, headers: headers }
      assert_includes response.parsed_body.fetch("my_files").map { |file| file["title"] }, @template.title
      as_user(@classmate) { get files_path, headers: headers }
      assert_equal 1, response.parsed_body.fetch("my_files").count { |file| file["source_file_id"] == @template.id }

      [ @mine, @pending ].each do |not_a_class_file|
        as_user(@admin) { post copy_path(not_a_class_file), headers: headers }
        assert_response :unprocessable_entity
      end
    end
    as_user(@admin) { post copy_path(@template), headers: headers }
    assert_response :service_unavailable
  end

  test "an upload replaced while confirming is not published" do
    @pending.update!(file_size: 123)
    with_storage do
      @prefix_error = Aws::S3::Errors::PreconditionFailed.new(nil, "At least one of the pre-conditions you specified did not hold")
      as_user(@admin) { post complete_path(@pending), headers: headers }
      assert_response :unprocessable_entity
      assert_equal "Upload changed while confirming; try again", response.parsed_body.fetch("error")
      assert_equal [ [ @pending.upload_key, "fixture-etag" ] ], @prefix_reads
      assert_not @pending.reload.ready?
      assert_empty @copied
      # A copy refused by its own etag precondition is the same answer.
      @prefix_error = nil
      S3Service.define_singleton_method(:copy_object) { |*_args, **_kwargs| raise Aws::S3::Errors::PreconditionFailed.new(nil, "changed") }
      as_user(@admin) { post complete_path(@pending), headers: headers }
      assert_response :unprocessable_entity
      assert_not @pending.reload.ready?
    end
  end

  test "a copy whose storage call fails ambiguously is rolled back and queued for cleanup" do
    with_storage do
      S3Service.define_singleton_method(:copy_object) { |*_args, **_kwargs| raise Aws::S3::Errors::ServiceError.new(nil, "timeout after copy") }
      record_external_calls(S3Service, :delete_object, returns: false) do |deletes|
        as_user(@teacher) { post copy_path(@template), headers: headers, as: :json }
        assert_response :bad_gateway
        key = deletes.sole[:args].first
        assert_match %r{\Acohort_files/cohort_#{@cohort.id}/student_\d+/}, key
        assert_equal [ [ key, "cohort_file_copy_rolled_back" ] ], PendingS3Deletion.pluck(:key, :reason)
      end
    end
    assert_not CohortFile.exists?(source_file_id: @template.id)
  end

  test "an invalid copy folder fails before any object is copied" do
    with_storage do
      as_user(@teacher) { post copy_path(@template), params: { folder: "x" * 81 }, headers: headers, as: :json }
      assert_response :unprocessable_entity
    end
    assert_empty @copied
    assert_not CohortFile.exists?(source_file_id: @template.id)
  end

  test "a copy that loses a race to a concurrent copy is skipped and its object removed" do
    racing = nil
    test_case = self
    with_storage do
      S3Service.define_singleton_method(:copy_object) do |source, destination, etag: nil|
        test_case.instance_variable_get(:@copied) << [ source, destination, etag ]
        # Another request saves this student's copy between our copy and our save.
        if destination.include?("/student_#{test_case.instance_variable_get(:@student).id}/") && racing.nil?
          racing = test_case.send(:ready_file, title: "Raced copy", filename: "plan.docx", student: test_case.instance_variable_get(:@student),
            source_file: test_case.instance_variable_get(:@template), content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        end
      end
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        as_user(@teacher) { post copy_path(@template), headers: headers, as: :json }
        assert_response :success
        assert_equal 1, response.parsed_body.fetch("copied_count")
        assert_equal 1, response.parsed_body.fetch("skipped_count")
        lost = @copied.find { |_, destination, _| destination.include?("/student_#{@student.id}/") }.second
        assert_equal [ [ lost ] ], deletes.map { |call| call[:args] }
      end
    end
    assert_equal [ racing.id ], CohortFile.where(source_file_id: @template.id, student_id: @student.id).pluck(:id)
  end

  test "deleting a cohort removes its stored file objects after commit" do
    still_referenced = []
    with_storage do
      record_external_calls(S3Service, :delete_object, returns: ->(key) { still_referenced << key if CohortFile.where(s3_key: key).or(CohortFile.where(upload_key: key)).exists?; true }) do |deletes|
        keys = @cohort.cohort_files.flat_map { |file| [ file.upload_key, file.s3_key ] }
        @cohort.destroy!
        assert_not CohortFile.where(cohort_id: @cohort.id).exists?
        assert_equal keys.sort, deletes.map { |call| call[:args].first }.sort
        assert_empty still_referenced
      end
    end
  end

  test "stored objects a cohort deletion cannot remove are queued for retry" do
    with_storage do
      keys = @cohort.cohort_files.flat_map { |file| [ file.upload_key, file.s3_key ] }
      record_external_calls(S3Service, :delete_object, returns: false) do
        @cohort.destroy!
      end
      assert_equal keys.sort, PendingS3Deletion.where(reason: "cohort_file_destroyed").pluck(:key).sort
      record_external_calls(S3Service, :delete_object, returns: true) do |deletes|
        assert_equal keys.size, PendingS3Deletion.drain!(now: 1.hour.from_now)
        assert_equal keys.sort, deletes.map { |call| call[:args].first }.sort
      end
      assert_not PendingS3Deletion.exists?
    end
  end

  test "the database keeps one copy of a class file per student folder" do
    copy = ready_file(title: "Copy", filename: "plan.docx", student: @student, source_file: @template,
      content_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    duplicate = copy.dup
    duplicate.s3_key = "cohort_files/other-copy"
    duplicate.upload_key = "cohort_file_uploads/other-copy"
    assert_raises(ActiveRecord::RecordNotUnique) { duplicate.save!(validate: false) }
  end

  test "cross-cohort file ids are not found" do
    with_storage do
      as_user(@admin) { get "/api/v1/cohorts/#{@other_cohort.id}/files/#{@slides.id}/download", headers: headers }
      assert_response :not_found
    end
  end

  private

  def ready_file(title:, filename:, folder: "General", visibility: "students", student: nil, uploaded_by: @admin, content_type: "application/pdf", source_file: nil)
    token = SecureRandom.uuid
    owner = student ? "student_#{student.id}" : "shared"
    @cohort.cohort_files.create!(title: title, filename: filename, folder: folder, visibility: visibility, student: student,
      uploaded_by: uploaded_by, content_type: content_type, file_size: 123, source_file: source_file,
      s3_key: "cohort_files/cohort_#{@cohort.id}/#{owner}/#{token}/#{filename}", upload_key: "cohort_file_uploads/cohort_#{@cohort.id}/#{token}/#{filename}",
      upload_expires_at: 1.hour.from_now, ready: true)
  end

  def upload_params(**overrides)
    { title: "", filename: "cover-letter.pdf", content_type: "application/pdf", file_size: 123, folder: "Job Search & Career" }.merge(overrides)
  end

  def user(name, role)
    User.create!(clerk_id: "cohort_files_#{name}", email: "#{name}@cohort-files.test", first_name: name, role: role)
  end

  def headers
    { "Authorization" => "Bearer test_token" }
  end

  def files_path
    "/api/v1/cohorts/#{@cohort.id}/files"
  end

  def file_path(file)
    "#{files_path}/#{file.id}"
  end

  def download_path(file)
    "#{file_path(file)}/download"
  end

  def complete_path(file)
    "#{file_path(file)}/complete"
  end

  def copy_path(file)
    "#{file_path(file)}/copy_to_students"
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end

  def with_storage
    originals = %i[configured? generate_presigned_post object_metadata read_prefix copy_object delete_object generate_presigned_url].to_h { |name| [ name, S3Service.method(name) ] }
    signed, copied, test_instance = @signed, @copied, self
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:generate_presigned_post) { |*_args, **_kwargs| Struct.new(:url, :fields).new("https://storage.test/upload", { "key" => "fixture" }) }
    S3Service.define_singleton_method(:object_metadata) { |_key| test_instance.instance_variable_get(:@metadata) }
    S3Service.define_singleton_method(:read_prefix) do |key, bytes: 512, if_match: nil|
      test_instance.instance_variable_get(:@prefix_reads) << [ key, if_match ]
      error = test_instance.instance_variable_get(:@prefix_error)
      raise error if error

      test_instance.instance_variable_get(:@prefix)
    end
    S3Service.define_singleton_method(:copy_object) { |source, destination, etag: nil| copied << [ source, destination, etag ] }
    S3Service.define_singleton_method(:delete_object) { |_key| true }
    S3Service.define_singleton_method(:generate_presigned_url) do |key, expires_in:, response_content_disposition: nil|
      signed << [ key, expires_in, response_content_disposition ]
      "https://storage.test/download"
    end
    yield
  ensure
    originals.each { |name, implementation| S3Service.define_singleton_method(name, implementation) }
  end
end
