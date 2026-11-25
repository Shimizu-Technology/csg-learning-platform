require "test_helper"
require "zip"
require_relative "../support/after_commit_helpers"
require_relative "../support/cohort_files_helpers"

# "Download ZIP": who may export what, what a paused learner gets, how
# items become archive entries, and the limits.
class CohortFileExportTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers
  include CohortFilesHelpers

  setup do
    ApiRateLimits::STORE.clear
    @plan = @cohort.cohort_files.create!(kind: "doc", title: "Job Search Plan", folder: "Job Search & Career", student: @student, doc_content: "- [x] Resume",
      doc_updated_at: 2.days.ago, ready: true, uploaded_by: @admin)
    @figma = @cohort.cohort_files.create!(kind: "link", title: "Portfolio [draft]", folder: "Resumes & Portfolio", student: @student,
      external_url: "https://www.figma.com/design/demo-(wireframe)", ready: true, uploaded_by: @student)
    @stored_bytes[@mine.s3_key] = "%PDF-1.7 resume"
    @stored_bytes[@from_staff.s3_key] = "%PDF-1.7 coaching"
  end

  test "learners download only their own folder, without staff-only items or anyone else's files" do
    with_storage do
      as_user(@student) { get export_path(scope: "my_files"), headers: headers }
      assert_response :success
      assert_equal "application/zip", response.media_type
      assert_equal "private, no-store", response.headers["Cache-Control"]
      assert_equal "nosniff", response.headers["X-Content-Type-Options"]
      assert_match(/\Aattachment; filename="cohort-files-my-files\.zip"\z/, response.headers["Content-Disposition"])
      entries = zip_entries(response.body)
      assert_equal [ "Job Search & Career/Job Search Plan.md", "Job Search & Career/coaching.pdf", "Resumes & Portfolio/Links.md", "Resumes & Portfolio/resume.pdf" ], entries.keys.sort
      assert_equal "# Job Search Plan\n\n- [x] Resume\n", entries.fetch("Job Search & Career/Job Search Plan.md")
      assert_equal "# Links\n\n- [Portfolio \\[draft\\]](https://www.figma.com/design/demo-%28wireframe%29)\n", entries.fetch("Resumes & Portfolio/Links.md")
      assert_equal "%PDF-1.7 resume", entries.fetch("Resumes & Portfolio/resume.pdf")
      assert @streamed.all? { |_key, open| open.zero? }, "storage downloads run with no transaction open"
      assert_not_includes @streamed.map(&:first), @staff_only_private.s3_key

      %w[class student].each do |scope|
        as_user(@student) { get export_path(scope: scope, student_id: @classmate.id), headers: headers }
        assert_response :forbidden, scope
      end
      as_user(@outsider) { get export_path(scope: "my_files"), headers: headers }
      assert_response :forbidden
    end
  end

  test "a paused learner gets the doc and file versions from before the pause" do
    @plan.update_columns(created_at: 3.days.ago, ready_at: 3.days.ago, shared_at: 3.days.ago)
    @plan.doc_revisions.create!(revision_number: 1, title: "Job Search Plan", content: "Before pause", created_at: 2.days.ago)
    @enrollment.update!(status: :paused)
    @enrollment.update_columns(paused_at: 1.day.ago)
    @plan.update_columns(doc_content: "After pause", doc_updated_at: Time.current)
    with_storage do
      as_user(@student) { get export_path(scope: "my_files"), headers: headers }
      assert_response :success
      entries = zip_entries(response.body)
      assert_equal "# Job Search Plan\n\nBefore pause\n", entries.fetch("Job Search & Career/Job Search Plan.md")
      assert_not entries.key?("Resumes & Portfolio/Links.md"), "a link added after the pause is left out"
    end
  end

  test "staff download class files or an enrolled student's folder, narrowed by folder" do
    with_storage do
      @stored_bytes[@slides.s3_key] = "%PDF-1.7 slides"
      @stored_bytes[@staged.s3_key] = "%PDF-1.7 notes"
      @stored_bytes[@template.s3_key] = "PK\x03\x04"
      as_user(@teacher) { get export_path(scope: "class", folder: "Slides"), headers: headers }
      assert_response :success
      assert_equal [ "Slides/notes.pdf", "Slides/week-1.pdf" ], zip_entries(response.body).keys.sort
      assert_match(/filename="cohort-files-class-files-slides\.zip"/, response.headers["Content-Disposition"])

      as_user(@teacher) { get export_path(scope: "student", student_id: @student.id), headers: headers }
      assert_response :success
      assert_includes zip_entries(response.body).keys, "General/private.pdf"

      as_user(@teacher) { get export_path(scope: "student", student_id: @outsider.id), headers: headers }
      assert_response :unprocessable_entity
      as_user(@teacher) { get export_path(scope: "my_files"), headers: headers }
      assert_response :unprocessable_entity
      as_user(@teacher) { get export_path(scope: "everything"), headers: headers }
      assert_response :unprocessable_entity
      as_user(@outside_teacher) { get export_path(scope: "class"), headers: headers }
      assert_response :forbidden
    end
  end

  test "names are cleaned against path tricks and duplicates are numbered" do
    [ "../../etc/passwd", "..", ".hidden", "\u200bWeek\t1", "Résumé — v2", "a/b\\c" ].each_with_index do |title, index|
      @cohort.cohort_files.create!(kind: "doc", title: title, folder: index.even? ? "../Up" : "Notes", doc_content: "x", ready: true)
    end
    @cohort.cohort_files.create!(kind: "doc", title: "Notes", folder: "Notes", doc_content: "one", ready: true)
    @cohort.cohort_files.create!(kind: "doc", title: "notes", folder: "Notes", doc_content: "two", ready: true)
    as_user(@teacher) { get export_path(scope: "class"), headers: headers }
    assert_response :success
    names = zip_entries(response.body).keys
    names.each do |name|
      assert_no_match(%r{\A/|(\A|/)\.\.?(/|\z)|\\|[\x00-\x1f]|(\A|/)\.}, name)
      assert name.ascii_only?, name
    end
    assert_includes names, "Up/etc-passwd.md"
    assert_equal 1, (names & [ "Notes/Notes.md", "Notes/notes.md" ]).size
    assert_equal 1, names.grep(%r{\ANotes/[Nn]otes \(2\)\.md\z}).size
    assert_includes names, "Up/Resume - v2.md"
    assert_includes names, "Notes/Untitled.md"
    assert_includes names, "Notes/Week 1.md"
    assert_includes names, "README.txt", "uploads left out without storage are noted"
  end

  test "without storage, docs and links still export and uploads-only exports are unavailable" do
    assert_not S3Service.configured?
    as_user(@student) { get export_path(scope: "my_files"), headers: headers }
    assert_response :success
    entries = zip_entries(response.body)
    assert_match(/2 uploaded files were left out/, entries.fetch("README.txt"))
    as_user(@student) { get export_path(scope: "my_files", folder: "Resumes & Portfolio"), headers: headers }
    assert_response :success
    as_user(@teacher) { get export_path(scope: "class", folder: "Slides"), headers: headers }
    assert_response :service_unavailable
  end

  test "empty, too many and too large exports are refused, before and while downloading" do
    as_user(@student) { get export_path(scope: "my_files", folder: "Nope"), headers: headers }
    assert_response :unprocessable_entity

    with_storage do
      @mine.update_columns(file_size: CohortFileExport::MAX_BYTES + 1)
      as_user(@student) { get export_path(scope: "my_files"), headers: headers }
      assert_response :unprocessable_entity
      assert_empty @streamed, "nothing downloads once the stored sizes are too large"

      @mine.update_columns(file_size: 10)
      original = CohortFileExport::MAX_BYTES
      CohortFileExport.send(:remove_const, :MAX_BYTES)
      CohortFileExport.const_set(:MAX_BYTES, 100)
      @stored_bytes[@mine.s3_key] = "x" * 200
      as_user(@student) { get export_path(scope: "my_files"), headers: headers }
      assert_response :unprocessable_entity
      assert_match(/larger than/, response.parsed_body.fetch("error"))
    ensure
      if original
        CohortFileExport.send(:remove_const, :MAX_BYTES)
        CohortFileExport.const_set(:MAX_BYTES, original)
      end
    end

    101.times { |index| @cohort.cohort_files.create!(kind: "doc", title: "Doc #{index}", folder: "Many", doc_content: "x", ready: true) }
    as_user(@teacher) { get export_path(scope: "class", folder: "Many"), headers: headers }
    assert_response :unprocessable_entity
    assert_match(/more than 100/, response.parsed_body.fetch("error"))
  end

  test "exports have their own rate limit" do
    assert ApiRateLimits.applies?(:exports, "api/v1/cohort_files", "export_zip")
    assert_not ApiRateLimits.applies?(:exports, "api/v1/cohort_files", "index")
    ApiRateLimits::AUTHENTICATED.fetch(:exports).fetch(:to).times do
      as_user(@student) { get export_path(scope: "my_files", folder: "Resumes & Portfolio"), headers: headers }
    end
    as_user(@student) { get export_path(scope: "my_files", folder: "Resumes & Portfolio"), headers: headers }
    assert_response :too_many_requests
  end

  test "archive temp files are removed after the response and when building fails" do
    created = []
    original = Tempfile.method(:new)
    Tempfile.define_singleton_method(:new) { |*args, **kwargs| original.call(*args, **kwargs).tap { |file| created << file.path } }
    as_user(@student) { get export_path(scope: "my_files", folder: "Resumes & Portfolio"), headers: headers }
    assert_response :success
    with_storage do
      @stored_bytes.delete(@mine.s3_key)
      S3Service.define_singleton_method(:stream_object) { |*_args, &_block| raise Aws::S3::Errors::ServiceError.new(nil, "down") }
      as_user(@student) { get export_path(scope: "my_files"), headers: headers }
      assert_response :bad_gateway
    end
    assert_equal 2, created.size
    created.each { |path| assert_not File.exist?(path), path }
  ensure
    Tempfile.define_singleton_method(:new, original)
  end

  private

  def export_path(**query)
    "#{files_path}/export_zip?#{query.to_query}"
  end

  def zip_entries(body)
    entries = {}
    Zip::InputStream.open(StringIO.new(body)) do |zip|
      while (entry = zip.get_next_entry)
        entries[entry.name] = zip.read.to_s.dup.force_encoding(Encoding::UTF_8)
      end
    end
    entries
  end
end
