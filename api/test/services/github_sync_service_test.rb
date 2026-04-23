require "test_helper"

class GithubSyncServiceTest < ActiveSupport::TestCase
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Git Basics", position: 0, release_day: 0)
    @block = ContentBlock.create!(
      lesson: @lesson,
      block_type: :exercise,
      position: 0,
      title: "Exercise 1",
      body: "Instructions",
      filename: "exercise_1.rb"
    )
    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort", start_date: Date.current, status: :active,
      repository_name: "prework-exercises"
    )
    @student = User.create!(
      clerk_id: "clerk_sync_student", email: "sync_student@example.com",
      first_name: "Student", last_name: "One", role: :student,
      github_username: "student-one"
    )
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
  end

  test "sync_student creates a submission and completes progress" do
    service = GithubSyncService.new(github_token: "test-token")
    original_fetch = service.method(:fetch_exercise_files)
    service.define_singleton_method(:fetch_exercise_files) do |_owner, _repo_name, _filenames|
      {
        files: [ { "name" => "exercise_1.rb", "text" => "puts 'hello'" } ],
        commit_hash: "abc123",
        error: nil
      }
    end

    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)

    assert_equal 1, result[:synced]
    assert_empty result[:errors]

    submission = Submission.find_by(user: @student, content_block: @block)
    assert_not_nil submission
    assert_equal "prework_github_sync", submission.submission_type
    assert_equal "puts 'hello'", submission.text

    progress = Progress.find_by(user: @student, content_block: @block)
    assert_not_nil progress
    assert progress.completed?
    assert_not_nil progress.completed_at
  ensure
    service.define_singleton_method(:fetch_exercise_files, original_fetch)
  end

  test "sync_student updates redo work and restores completed progress" do
    submission = Submission.create!(
      user: @student,
      content_block: @block,
      text: "old code",
      grade: :R,
      feedback: "redo this",
      num_submissions: 1
    )
    Progress.create!(user: @student, content_block: @block, status: :in_progress)

    service = GithubSyncService.new(github_token: "test-token")
    original_fetch = service.method(:fetch_exercise_files)
    service.define_singleton_method(:fetch_exercise_files) do |_owner, _repo_name, _filenames|
      {
        files: [ { "name" => "exercise_1.rb", "text" => "puts 'fixed'" } ],
        commit_hash: "def456",
        error: nil
      }
    end

    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)

    assert_equal 1, result[:synced]
    assert_empty result[:errors]

    submission.reload
    assert_equal "prework_github_sync", submission.submission_type
    assert_equal "puts 'fixed'", submission.text
    assert_equal 2, submission.num_submissions
    assert_nil submission.grade
    assert_nil submission.feedback
    assert_nil submission.graded_at

    progress = Progress.find_by(user: @student, content_block: @block)
    assert_not_nil progress
    assert progress.completed?
    assert_not_nil progress.completed_at
  ensure
    service.define_singleton_method(:fetch_exercise_files, original_fetch)
  end
end
