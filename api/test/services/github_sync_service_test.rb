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
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
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
    assert_equal "abc123", submission.commit_sha

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
      enrollment: @enrollment,
      content_block: @block,
      text: "old code",
      grade: :R,
      feedback: "redo this",
      num_submissions: 1
    )
    Progress.create!(user: @student, enrollment: @enrollment, content_block: @block, status: :in_progress)

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
    assert_equal "def456", submission.commit_sha
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

  test "sync_student rejects writes that began before an enrollment restart" do
    @student.enrollments.find_by!(cohort: @cohort).update!(learning_state_reset_at: 1.minute.from_now)
    service = GithubSyncService.new(github_token: "test-token")
    original_fetch = service.method(:fetch_exercise_files)
    service.define_singleton_method(:fetch_exercise_files) do |_owner, _repo_name, _filenames|
      {
        files: [ { "name" => "exercise_1.rb", "text" => "puts 'stale'" } ],
        commit_hash: "stale123",
        error: nil
      }
    end

    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)

    assert_equal 0, result[:synced]
    assert_match "restarted", result[:errors].sole
    assert_not Submission.exists?(user: @student, content_block: @block)
    assert_not Progress.exists?(user: @student, content_block: @block)
  ensure
    service.define_singleton_method(:fetch_exercise_files, original_fetch)
  end

  test "sync_student via verified GitHub App binding stores numeric github_repository_id" do
    require_relative "../support/fake_github_app_client"

    SchoolSetting.current.update!(features: { "github_app" => true })
    @cohort.update!(settings: { "features" => { "github_app" => true } })
    @student.update!(github_username: "app-learner")
    @student.record_verified_github_identity!(id: "24680", login: "app-learner")
    @block.update!(filename: "111.rb", submission_type: :prework_github_sync)
    installation = @cohort.github_app_installations.create!(
      app_id: 12345, installation_id: 123, account_id: 24680, account_login: "app-learner",
      account_type: "User", repository_selection: "selected", connected_at: Time.current, checked_at: Time.current
    )
    binding = @enrollment.github_repository_bindings.create!(
      github_app_installation: installation,
      full_name: "app-learner/prework-exercises"
    )
    fake = FakeGithubAppClient.new
    GithubRepositoryAccess.new(binding, client: fake).verify!

    service = GithubSyncService.new(github_token: nil, app_client: fake)
    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)

    assert_equal 1, result[:synced]
    assert_empty result[:errors]
    submission = Submission.find_by!(user: @student, enrollment: @enrollment, content_block: @block)
    assert_equal 98765, submission.github_repository_id
  end
end
