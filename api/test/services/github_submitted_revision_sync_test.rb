require "test_helper"
require_relative "../support/github_app_fixtures"
require_relative "../support/query_counter"

class GithubSubmittedRevisionSyncTest < ActiveSupport::TestCase
  include GithubAppFixtures
  include QueryCounter
  setup do
    build_github_app_fixture
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
  end

  %w[A B C R].each do |grade|
    test "changed #{grade} creates an ungraded attempt preserving all earlier evidence" do
      assert_equal 1, sync[:synced]
      previous = @enrollment.submissions.sole
      previous.update!(grade: grade, feedback: "Keep this feedback", graded_at: Time.current, grader: @instructor,
        github_issue_url: "https://github.com/app-learner/prework-exercises/issues/12")
      rubric = Rubric.create!(curriculum: @curriculum, title: "Revision rubric", rubric_criteria_attributes: [ { title: "Clarity", description: "Readable source", position: 0 } ])
      criterion = rubric.rubric_criteria.sole
      @block.update!(rubric: rubric)
      result = previous.submission_criterion_results.create!(rubric_criterion: criterion, rating: :meets, feedback: "Keep this rating")
      before = previous.reload.attributes
      @fake.source_text = "puts 'changed'"
      @fake.commit_sha = "b" * 40
      assert_equal({ synced: 1, errors: [] }, sync)
      current = previous.latest_attempt
      refute_equal previous.id, current.id
      assert_equal 2, current.num_submissions
      assert_nil current.grade
      assert_nil current.feedback
      assert_nil current.graded_at
      assert_nil current.graded_by_id
      assert_nil current.github_issue_url
      assert_empty current.submission_criterion_results
      assert_equal before, previous.reload.attributes
      assert_equal "Keep this rating", result.reload.feedback
      assert_equal Digest::SHA256.hexdigest(@fake.source_text), current.github_revision.fetch("content_digest")
      assert_equal @binding.id, current.github_revision.fetch("binding_id")
      assert_equal 98765, current.github_revision.fetch("repository_id")
      assert_equal [ "111.rb" ], current.github_revision.fetch("paths")
      assert_equal "main", current.branch
      assert_equal @fake.source_text, current.text
      assert_equal "b" * 40, current.commit_sha
    end
  end

  test "new repository SHA with identical source makes no writes or new attempts" do
    sync
    submission = @enrollment.submissions.sole
    submission.update!(grade: :A, feedback: "Already graded")
    before = submission.reload.attributes
    @fake.commit_sha = "b" * 40
    assert_equal({ synced: 0, errors: [] }, sync)
    assert_equal before, submission.reload.attributes
    assert_equal 1, @enrollment.submissions.count
  end

  test "immutable fields reject edits while grades feedback criteria and issue links remain writable" do
    sync
    submission = @enrollment.submissions.sole
    %w[text commit_sha branch github_code_url num_submissions github_revision].each do |field|
      row = Submission.find(submission.id)
      value = case field
      when "num_submissions" then 8
      when "github_revision" then nil
      else "changed"
      end
      refute row.update(field => value), field
      assert_match "immutable", row.errors.full_messages.join
    end
    assert submission.update(grade: :B, feedback: "Good work", github_issue_url: "https://github.com/app-learner/prework-exercises/issues/12")
  end

  test "historical rows remain unchanged without invented source history until content changes" do
    previous = @enrollment.submissions.create!(user: @student, content_block: @block, text: @fake.source_text, grade: :A,
      commit_sha: "legacy-sha", num_submissions: 7)
    before = previous.attributes
    assert_equal 0, sync[:synced]
    assert_equal before, previous.reload.attributes
    @fake.source_text = "changed"
    assert_equal 1, sync[:synced]
    assert_equal 8, previous.latest_attempt.num_submissions
    assert_nil previous.reload.github_revision
  end

  test "latest attempt tie uses id and unchanged source never creates a duplicate" do
    freeze_time do
      sync
      first = @enrollment.submissions.sole
      @fake.source_text = "second"
      sync
      latest = first.latest_attempt
      assert_equal first.created_at, latest.created_at
      assert_operator latest.id, :>, first.id
      assert_equal 0, sync[:synced]
      assert_equal latest.id, first.latest_attempt.id
    end
  end

  test "a backward clock step cannot hide newly submitted source behind an earlier grade" do
    freeze_time
    assert_equal 1, sync[:synced]
    previous = @enrollment.submissions.sole
    previous.update!(grade: :B, feedback: "Grade belongs to original source")
    before = previous.reload.attributes
    travel(-1.minute)
    @fake.source_text = "source after clock step"
    @fake.commit_sha = "b" * 40
    assert_equal 1, sync[:synced]
    current = @enrollment.submissions.order(:id).last
    assert_equal current.id, previous.latest_attempt.id
    assert_equal "b" * 40, current.commit_sha
    assert_operator current.created_at, :>=, previous.created_at
    assert_equal Time.current, Time.iso8601(current.github_revision.fetch("captured_at"))
    assert_equal before, previous.reload.attributes
  end

  test "empty source is captured and oversized source never overwrites or truncates evidence" do
    sync
    @fake.source_text = ""
    @fake.commit_sha = "b" * 40
    assert_equal 1, sync[:synced]
    assert_equal "", @enrollment.submissions.order(Submission::LATEST_FIRST).first.text
    @fake.source_text = "é" * (GithubSubmittedRevisionSync::MAX_SOURCE_BYTES / 2 + 1)
    result = sync
    assert_equal 0, result[:synced]
    assert_match "256 KiB", result[:errors].sole
    assert_equal 2, @enrollment.submissions.count
  end

  test "paused enrollment during provider IO prevents writes" do
    original = @fake.method(:files)
    enrollment = @enrollment
    @fake.define_singleton_method(:files) do |**options|
      result = original.call(**options)
      enrollment.update!(status: :paused)
      result
    end
    assert_equal 0, sync[:synced]
    assert_empty @enrollment.submissions
  end

  test "window closed during provider IO prevents writes" do
    original = @fake.method(:files)
    cohort, mod = @cohort, @mod
    @fake.define_singleton_method(:files) do |**options|
      result = original.call(**options)
      CohortModuleSubmissionWindow.create!(cohort: cohort, curriculum_module: mod, week_number: 1, submissions_close_at: 1.minute.ago)
      result
    end
    result = sync
    assert_equal 0, result[:synced]
    assert_match "closed during sync", result[:errors].sole
    assert_empty @enrollment.submissions
  end

  test "an effective learner extension permits revision capture after the cohort deadline" do
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    CohortModuleSubmissionWindow.create!(cohort: @cohort, curriculum_module: @mod, week_number: 1, submissions_close_at: 1.minute.ago)
    @enrollment.learner_extensions.create!(scope: "lesson", lesson: @lesson, submissions_close_at: 1.hour.from_now,
      reason: "Synthetic revision extension", granted_by: @instructor, granted_at: Time.current)
    assert_equal({ synced: 1, errors: [] }, sync)
    assert_equal 1, @enrollment.submissions.count
  end

  test "an extension removed during provider IO cannot capture late source" do
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    CohortModuleSubmissionWindow.create!(cohort: @cohort, curriculum_module: @mod, week_number: 1, submissions_close_at: 1.minute.ago)
    extension = @enrollment.learner_extensions.create!(scope: "lesson", lesson: @lesson, submissions_close_at: 1.hour.from_now,
      reason: "Synthetic revision extension", granted_by: @instructor, granted_at: Time.current)
    original = @fake.method(:files)
    @fake.define_singleton_method(:files) do |**options|
      result = original.call(**options)
      extension.update!(removed_at: Time.current)
      result
    end
    result = sync
    assert_equal 0, result[:synced]
    assert_match "closed during sync", result[:errors].sole
    assert_empty @enrollment.submissions
  end

  test "binding changed during file IO cannot label old source with new provenance" do
    original = @fake.method(:files)
    binding = @binding
    @fake.define_singleton_method(:files) do |**options|
      result = original.call(**options)
      binding.update!(full_name: "app-learner/replacement", verification_state: "pending")
      result
    end
    result = sync
    assert_equal 0, result[:synced]
    assert_match "changed during source sync", result[:errors].sole
    assert_empty @enrollment.submissions
  end

  test "rebind at the identical timestamp cannot inherit the old verified operation" do
    freeze_time
    original = @fake.method(:files)
    binding = @binding
    @fake.define_singleton_method(:files) do |**options|
      result = original.call(**options)
      binding.update!(full_name: "app-learner/replacement", verification_state: "pending")
      result
    end
    result = sync
    assert_equal 0, result[:synced]
    assert_match "changed during source sync", result[:errors].sole
    assert_equal "pending", @binding.reload.verification_state
    assert_empty @enrollment.submissions
  end

  test "a new module override during provider IO cannot import source from the old default" do
    original = @fake.method(:files)
    enrollment, mod, installation = @enrollment, @mod, @installation
    @fake.define_singleton_method(:files) do |**options|
      result = original.call(**options)
      enrollment.github_repository_bindings.create!(curriculum_module: mod, github_app_installation: installation, full_name: "app-learner/replacement")
      result
    end
    result = sync
    assert_equal 0, result[:synced]
    assert_match "binding changed", result[:errors].sole
    assert_empty @enrollment.submissions
  end

  test "a default binding cannot import an exercise outside the enrollment curriculum" do
    other_curriculum = Curriculum.create!(name: "Other revision curriculum")
    other_module = other_curriculum.modules.create!(name: "Other module", position: 0)
    lesson = other_module.lessons.create!(title: "Other exercise", position: 0, release_day: 0)
    lesson.content_blocks.create!(block_type: :exercise, submission_type: :prework_github_sync, filename: "111.rb", position: 0)
    result = GithubSyncService.new(github_token: nil, app_client: @fake).sync_student(user: @student, cohort: @cohort, curriculum_module: other_module)
    assert_equal 0, result[:synced]
    assert_match "exercise configuration changed", result[:errors].sole
    assert_empty @enrollment.submissions
  end

  test "exercise filename changed during source IO cannot capture the previous file as current work" do
    original = @fake.method(:files)
    block = @block
    @fake.define_singleton_method(:files) do |**options|
      result = original.call(**options)
      block.update!(filename: "222.rb")
      result
    end
    result = sync
    assert_equal 0, result[:synced]
    assert_match "exercise configuration changed", result[:errors].sole
    assert_empty @enrollment.submissions
  end

  test "GitHub sync switched Off during source IO cannot capture a revision" do
    original = @fake.method(:files)
    cohort = @cohort
    @fake.define_singleton_method(:files) do |**options|
      result = original.call(**options)
      cohort.update!(settings: { features: { github_app: true, github_sync: false } })
      result
    end
    result = sync
    assert_equal 0, result[:synced]
    assert_match "sync is disabled", result[:errors].sole
    assert_empty @enrollment.submissions
  end

  test "sync query count stays flat with one versus twenty genuine revisions" do
    sync
    first_count = count_queries { assert_equal 0, sync[:synced] }
    19.times do |number|
      @fake.source_text = "revision #{number}"
      assert_equal 1, sync[:synced]
    end
    assert_equal 20, @enrollment.submissions.count
    assert_equal first_count, count_queries { assert_equal 0, sync[:synced] }
  end

  private

  def sync
    GithubSyncService.new(github_token: nil, app_client: @fake).sync_student(user: @student.reload, cohort: @cohort.reload, curriculum_module: @mod)
  end
end
