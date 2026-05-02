require "test_helper"
require "tempfile"

class PreworkGraderArchiveImporterTest < ActiveSupport::TestCase
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Prework",
      position: 0,
      day_offset: 0,
      schedule_days: "weekdays"
    )
    @lesson = Lesson.create!(
      curriculum_module: @mod,
      title: "Day 1",
      position: 0,
      release_day: 0,
      requires_submission: true
    )
    @block = ContentBlock.create!(
      lesson: @lesson,
      block_type: :exercise,
      position: 0,
      title: "Variables",
      filename: "111.rb"
    )
    @cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Cohort 3",
      start_date: Date.current,
      status: :active,
      repository_name: "prework-exercises"
    )
    @admin = User.create!(
      clerk_id: "admin_importer",
      email: "admin@example.com",
      first_name: "Admin",
      role: :admin
    )
    @student = User.create!(
      clerk_id: "student_importer",
      email: "student@example.com",
      first_name: "Student",
      last_name: "One",
      role: :student,
      github_username: "student-one"
    )
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
  end

  test "dry run reports creates without writing submissions" do
    path = write_archive

    importer = PreworkGraderArchiveImporter.new(
      json_path: path,
      target_cohort: @cohort.name,
      dry_run: true
    )
    report = importer.call

    assert_equal true, report[:dry_run]
    assert_equal 1, report[:students][:matched]
    assert_equal 1, report[:submissions][:created]
    assert_equal 0, Submission.count
    assert_equal 0, Progress.count
  ensure
    FileUtils.rm_f(path) if path
  end

  test "import creates prework submissions and progress from archive" do
    path = write_archive

    importer = PreworkGraderArchiveImporter.new(
      json_path: path,
      target_cohort: @cohort.id,
      dry_run: false
    )
    report = importer.call

    assert_equal 1, report[:submissions][:created]

    submission = Submission.find_by!(user: @student, content_block: @block)
    assert_equal "prework_github_sync", submission.submission_type
    assert_equal "puts 'hello'", submission.text
    assert_equal "A", submission.grade
    assert_equal "https://github.com/student-one/prework-exercises/issues/1", submission.github_issue_url
    assert_equal "https://github.com/student-one/prework-exercises/blob/abc/111.rb#L1-L1", submission.github_code_url
    assert_equal 2, submission.num_submissions
    assert_equal @admin.id, submission.graded_by_id

    progress = Progress.find_by!(user: @student, content_block: @block)
    assert progress.completed?
  ensure
    FileUtils.rm_f(path) if path
  end

  test "merge mode preserves existing nonblank text and grade but imports missing issue url" do
    existing = Submission.create!(
      user: @student,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "local newer work",
      grade: :B,
      num_submissions: 5
    )
    path = write_archive

    importer = PreworkGraderArchiveImporter.new(
      json_path: path,
      target_cohort: @cohort.id,
      dry_run: false,
      overwrite: false
    )
    report = importer.call

    assert_equal 1, report[:submissions][:updated]
    existing.reload
    assert_equal "local newer work", existing.text
    assert_equal "B", existing.grade
    assert_equal 5, existing.num_submissions
    assert_equal "https://github.com/student-one/prework-exercises/issues/1", existing.github_issue_url
  ensure
    FileUtils.rm_f(path) if path
  end

  test "merge mode reports unchanged when existing submission already matches archive" do
    Submission.create!(
      user: @student,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "puts 'hello'",
      grade: :A,
      github_issue_url: "https://github.com/student-one/prework-exercises/issues/1",
      github_code_url: "https://github.com/student-one/prework-exercises/blob/abc/111.rb#L1-L1",
      num_submissions: 2,
      graded_by_id: @admin.id,
      graded_at: 1.day.ago
    )
    path = write_archive

    importer = PreworkGraderArchiveImporter.new(
      json_path: path,
      target_cohort: @cohort.id,
      dry_run: false,
      overwrite: false
    )
    report = importer.call

    assert_equal 0, report[:submissions][:updated]
    assert_equal 1, report[:submissions][:unchanged]
    assert_equal 0, Progress.count
  ensure
    FileUtils.rm_f(path) if path
  end

  test "merge mode keeps progress consistent with retained existing grade" do
    Submission.create!(
      user: @student,
      content_block: @block,
      submission_type: :prework_github_sync,
      text: "redo version",
      grade: :R,
      num_submissions: 1
    )
    path = write_archive

    importer = PreworkGraderArchiveImporter.new(
      json_path: path,
      target_cohort: @cohort.id,
      dry_run: false,
      overwrite: false
    )
    importer.call

    progress = Progress.find_by!(user: @student, content_block: @block)
    assert progress.in_progress?
    assert_nil progress.completed_at
  ensure
    FileUtils.rm_f(path) if path
  end

  private

  def write_archive
    file = Tempfile.new([ "prework-archive", ".json" ])
    file.write(JSON.pretty_generate(archive_payload))
    file.close
    file.path
  end

  def archive_payload
    {
      metadata: {
        archive_type: "csg_prework_grader_cohort_archive",
        version: 1,
        exported_at: Time.current.iso8601
      },
      cohort: {
        id: 3,
        name: "Cohort 3",
        start_date: Date.current.iso8601,
        repository_name: "prework-exercises",
        github_organization_name: "code-school-of-guam"
      },
      students: [
        {
          id: 10,
          first_name: "Student",
          last_name: "One",
          email: "student@example.com",
          github_username: "student-one",
          active: true
        }
      ],
      exercises: [
        {
          id: 20,
          title: "Variables",
          release_day: 0,
          filename: "111.rb"
        }
      ],
      submissions: [
        {
          id: 30,
          exercise_id: 20,
          exercise_filename: "111.rb",
          exercise_title: "Variables",
          student_id: 10,
          student_email: "student@example.com",
          student_github_username: "student-one",
          text: "puts 'hello'",
          grade: "A",
          github_issue_url: "https://github.com/student-one/prework-exercises/issues/1",
          github_code_url: "https://github.com/student-one/prework-exercises/blob/abc/111.rb#L1-L1",
          num_submissions: 2,
          created_at: 2.days.ago.iso8601,
          updated_at: 1.day.ago.iso8601
        }
      ],
      email_logs: []
    }
  end
end
