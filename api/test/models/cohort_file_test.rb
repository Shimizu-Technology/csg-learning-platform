require_relative "../support/model_coverage"

class CohortFileTest < ModelCoverageTestCase
  test "file names and types follow a strict allowlist" do
    assert_equal "My_Resume__v2_.pdf", CohortFile.sanitize_filename("My Resume (v2).pdf")
    assert_equal "passwd", CohortFile.sanitize_filename("../../etc/passwd")
    [ "..", ".env", "___", "", nil ].each { |name| assert_nil CohortFile.sanitize_filename(name), name.inspect }
    assert_equal 180, CohortFile.sanitize_filename("#{'a' * 300}.pdf").length
    assert CohortFile.sanitize_filename("#{'a' * 300}.pdf").end_with?(".pdf")

    assert_equal "application/pdf", CohortFile.normalized_content_type("guide.PDF", "application/pdf")
    assert_equal "text/markdown", CohortFile.normalized_content_type("notes.md", "")
    assert_equal "application/zip", CohortFile.normalized_content_type("kit.zip", "application/x-zip-compressed")
    assert_equal "text/csv", CohortFile.normalized_content_type("grades.csv", "application/vnd.ms-excel")
    assert_equal "audio/mp4", CohortFile.normalized_content_type("intro.m4a", "audio/x-m4a; codecs=aac")
    [ %w[page.html text/html], %w[logo.svg image/svg+xml], %w[run.sh application/x-sh], %w[setup.exe application/octet-stream],
      %w[guide.pdf text/html], %w[app.mjs text/javascript], %w[photo.png image/jpeg], %w[archive.rar application/x-rar] ].each do |filename, type|
      assert_nil CohortFile.normalized_content_type(filename, type), filename
    end
  end

  test "student folder files stay in the student's own cohort and students cannot stage" do
    enrollment
    file = CohortFile.new(cohort: course, student: student, uploaded_by: student, title: " Resume ", folder: "  ",
      filename: "resume.pdf", content_type: "application/pdf", file_size: 10, s3_key: "k", upload_key: "u", upload_expires_at: 1.hour.from_now)
    assert file.valid?, file.errors.full_messages.inspect
    assert_equal "Resume", file.title
    assert_equal "General", file.folder
    file.visibility = "staff_only"
    assert_not file.valid?
    file.visibility = "students"
    file.student = person
    assert_not file.valid?
    assert_includes file.errors[:student], "is not enrolled in this cohort"
    file.student = student
    file.content_type = "text/html"
    assert_not file.valid?
    file.content_type = "application/pdf"
    file.file_size = CohortFile::MAX_FILE_SIZE + 1
    assert_not file.valid?
  end

  test "ready date is recorded once and cohorts remove their files" do
    file = CohortFile.create!(cohort: course, uploaded_by: staff, title: "Slides", filename: "slides.pdf", content_type: "application/pdf",
      file_size: 10, s3_key: "k", upload_key: "u", upload_expires_at: 1.hour.from_now)
    assert_nil file.ready_at
    assert file.class_file?
    file.update!(ready: true)
    at = file.ready_at
    travel 1.hour
    file.update!(title: "Renamed")
    assert_equal at, file.reload.ready_at
    assert enrollment.file_available_for_read?(file)
    assert_equal "staff", file.file_json[:uploaded_by_role]
    course.destroy!
    assert_not CohortFile.exists?(file.id)
  end

  test "uploaded bytes must match the format the extension claims" do
    {
      "guide.pdf" => "%PDF-1.7", "plan.docx" => "PK\x03\x04rest", "grades.xlsx" => "PK\x05\x06", "deck.pptx" => "PK\x03\x04",
      "kit.zip" => "PK\x03\x04", "old.doc" => "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1", "old.xls" => "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1",
      "logo.png" => "\x89PNG\r\n\x1A\n", "photo.jpg" => "\xFF\xD8\xFF\xE0", "photo.webp" => "RIFF\x00\x00\x00\x00WEBPVP8 ",
      "clip.mp4" => "\x00\x00\x00\x18ftypmp42", "talk.m4a" => "\x00\x00\x00\x20ftypM4A ", "song.mp3" => "ID3\x04", "frame.mp3" => "\xFF\xFB\x90",
      "notes.md" => "# Week 1\n\nUse `puts` to print.", "grades.csv" => "name,score\nAda,98", "readme.txt" => "Plain notes"
    }.each { |filename, bytes| assert CohortFile.content_matches?(filename, bytes.b), filename }

    {
      "fake.pdf" => "<!DOCTYPE html><html>", "fake.docx" => "%PDF-1.7", "logo.png" => "<svg xmlns='http://www.w3.org/2000/svg'>",
      "photo.jpg" => "GIF89a", "clip.mp4" => "RIFF0000WEBP", "song.mp3" => "<script>", "page.txt" => "<html><body>hi</body></html>",
      "notes.md" => "Intro\n<SCRIPT src=x></SCRIPT>", "data.csv" => "a,b\x00c", "icon.txt" => "<svg onload=alert(1)>", "empty.pdf" => ""
    }.each { |filename, bytes| assert_not CohortFile.content_matches?(filename, bytes.b), filename }
    assert_not CohortFile.content_matches?("guide.pdf", nil)
  end

  test "students can see a file from when it is shared, and staging clears that" do
    file = CohortFile.create!(cohort: course, uploaded_by: staff, title: "Notes", filename: "notes.pdf", content_type: "application/pdf",
      file_size: 10, s3_key: "k2", upload_key: "u2", upload_expires_at: 1.hour.from_now, visibility: "staff_only")
    file.update!(ready: true)
    assert_nil file.shared_at
    assert_not enrollment.file_available_for_read?(file)
    travel 1.day
    file.update!(visibility: "students")
    assert_equal Time.current, file.shared_at
    assert enrollment.file_available_for_read?(file)
    travel 1.hour
    file.update!(title: "Renamed")
    assert_equal 1.hour.ago, file.reload.shared_at
    file.update!(visibility: "staff_only")
    assert_nil file.shared_at
  end

  test "expired pending uploads are purged and published files are kept" do
    expired = CohortFile.create!(cohort: course, uploaded_by: staff, title: "Lost", filename: "lost.pdf", content_type: "application/pdf",
      file_size: 10, s3_key: "k3", upload_key: "u3", upload_expires_at: 1.minute.ago)
    fresh = CohortFile.create!(cohort: course, uploaded_by: staff, title: "Uploading", filename: "up.pdf", content_type: "application/pdf",
      file_size: 10, s3_key: "k4", upload_key: "u4", upload_expires_at: 1.hour.from_now)
    published = CohortFile.create!(cohort: course, uploaded_by: staff, title: "Done", filename: "done.pdf", content_type: "application/pdf",
      file_size: 10, s3_key: "k5", upload_key: "u5", upload_expires_at: 1.minute.ago, ready: true)
    CohortFile.purge_expired_pending!(course.cohort_files)
    assert_not CohortFile.exists?(expired.id)
    assert CohortFile.exists?(fresh.id)
    assert CohortFile.exists?(published.id)
  end
end
