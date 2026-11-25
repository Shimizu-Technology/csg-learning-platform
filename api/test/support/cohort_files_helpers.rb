# Shared cohort, people, files and storage stubs for the cohort file tests.
module CohortFilesHelpers
  extend ActiveSupport::Concern

  included do
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

  def preview_path(file)
    "#{file_path(file)}/preview"
  end

  def versions_path(file)
    "#{file_path(file)}/versions"
  end

  def complete_version_path(file, version)
    "#{versions_path(file)}/#{version.id}/complete"
  end

  def version_params(**overrides)
    { filename: "week-1-v2.pdf", content_type: "application/pdf", file_size: 123, note: "Fixed a typo" }.merge(overrides)
  end

  def link_params(**overrides)
    { kind: "link", external_url: "https://docs.google.com/document/d/abc123/edit", title: "Capstone brief", folder: "Guides & Handouts" }.merge(overrides)
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
    S3Service.define_singleton_method(:generate_presigned_url) do |key, expires_in:, response_content_disposition: nil, response_content_type: nil|
      signed << [ key, expires_in, response_content_disposition, response_content_type ]
      "https://storage.test/download"
    end
    yield
  ensure
    originals.each { |name, implementation| S3Service.define_singleton_method(name, implementation) }
  end
end
