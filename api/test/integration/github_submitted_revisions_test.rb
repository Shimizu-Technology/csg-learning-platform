require "test_helper"
require_relative "../support/github_app_fixtures"
require_relative "../support/query_counter"

class GithubSubmittedRevisionsTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  include QueryCounter

  setup do
    build_github_app_fixture
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
  end

  test "staff read exact revision and previous grades while students receive the existing contract" do
    assert_equal 1, sync[:synced]
    previous = @enrollment.submissions.sole
    previous.update!(grade: :B, feedback: "Graded first source", graded_at: Time.current, grader: @instructor)
    @fake.source_text = "changed"
    @fake.commit_sha = "b" * 40
    assert_equal 1, sync[:synced]
    current = previous.latest_attempt
    assert_equal 2, @enrollment.submissions.count
    as_app_user(@instructor) do
      get "/api/v1/submissions/#{current.id}", headers: app_headers
      assert_response :success
      assert_equal "b" * 40, response.parsed_body.dig("submission", "commit_sha"),
        @enrollment.submissions.order(:id).pluck(:id, :commit_sha, :created_at).inspect
      assert_equal current.github_revision, response.parsed_body.dig("submission", "github_revision")
      get "/api/v1/submissions", params: { cohort_id: @cohort.id, user_id: @student.id }, headers: app_headers
      assert_response :success
      assert_equal [ current.id, previous.id ].sort, response.parsed_body.fetch("submissions").map { |row| row.fetch("id") }.sort
      historical = response.parsed_body.fetch("submissions").find { |row| row["id"] == previous.id }
      assert_equal "B", historical.fetch("grade")
      assert_equal "Graded first source", historical.fetch("feedback")
      assert_equal previous.github_revision, historical.fetch("github_revision")
    end
    as_app_user(@student) do
      get "/api/v1/submissions/#{current.id}", headers: app_headers
      assert_response :success
      refute response.parsed_body.fetch("submission").key?("github_revision")
    end
    as_app_user(@other) do
      get "/api/v1/submissions/#{current.id}", headers: app_headers
      assert_response :forbidden
    end
  end

  test "grading superseded captured source returns 409 and preserves original evidence" do
    sync
    previous = @enrollment.submissions.sole
    before = previous.attributes
    @fake.source_text = "changed"
    sync
    as_app_user(@instructor) do
      patch "/api/v1/submissions/#{previous.id}/grade", headers: app_headers, as: :json,
        params: { grade: "B", feedback: "stale draft", base_submission_updated_at: previous.updated_at.iso8601(6) }
      assert_response :conflict
      assert_equal "superseded_submission", response.parsed_body.fetch("code")
      assert_equal previous.latest_attempt.id, response.parsed_body.fetch("latest_submission_id")
    end
    assert_equal before, previous.reload.attributes
  end

  test "curriculum copy remaps attempts and bindings without altering captured provenance" do
    Cohort.create!(name: "Other shared curriculum cohort", curriculum: @curriculum, start_date: Date.current, status: :active)
    @binding.update!(curriculum_module: @mod)
    sync
    previous = @enrollment.submissions.sole
    previous.update!(grade: :A, feedback: "Keep through copy")
    captured = previous.github_revision.deep_dup
    result = CurriculumCopyForCohort.new(cohort: @cohort, user: @admin, source_curriculum_id: @curriculum.id).copy!
    assert result
    refute_equal @block.id, previous.reload.content_block_id
    assert_equal captured, previous.github_revision
    assert_equal "A", previous.grade
    assert_equal "Keep through copy", previous.feedback
    refute_equal @mod.id, @binding.reload.curriculum_module_id if @binding.curriculum_module_id
    @cohort.reload
    @enrollment.reload
    @mod = previous.content_block.lesson.curriculum_module
    assert_equal 0, sync[:synced]
    @fake.source_text = "after copy"
    assert_equal 1, sync[:synced]
    assert_equal 2, previous.latest_attempt.num_submissions
    assert_equal previous.content_block_id, previous.latest_attempt.content_block_id
  end

  test "grading history and queue queries stay flat as genuine captured attempts grow" do
    sync
    as_app_user(@instructor) do
      # Warm framework/auth metadata; QueryCounter clears the data query cache.
      get "/api/v1/submissions", headers: app_headers
      before = history_query_count
      queue_before = queue_query_count
      19.times do |number|
        @fake.source_text = "history #{number}"
        assert_equal 1, sync[:synced]
      end
      assert_equal 20, @enrollment.submissions.count
      assert_equal before, history_query_count
      assert_equal 20, response.parsed_body.fetch("submissions").size
      assert_equal queue_before, queue_query_count
      assert_equal 1, response.parsed_body.fetch("submissions").size
      assert_equal 1, response.parsed_body.dig("counts", "ungraded")
    end
  end

  test "Off legacy sync keeps grades and row identity and emits no revision or App queries" do
    @cohort.update!(settings: { "features" => { "github_app" => false } })
    @fake.calls.clear
    service = GithubSyncService.new(github_token: "synthetic", app_client: @fake)
    source, sha = "old", "a" * 40
    service.define_singleton_method(:fetch_exercise_files) { |*| { files: [ { "name" => "111.rb", "text" => source } ], commit_hash: sha, error: nil } }
    assert_equal({ synced: 1, errors: [] }, service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod))
    legacy = @enrollment.submissions.sole
    legacy.update!(grade: :B, feedback: "Retained legacy grade")
    source, sha = "changed", "b" * 40
    queries = capture_queries do
      assert_equal({ synced: 1, errors: [] }, service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod))
    end
    assert_equal 1, @enrollment.submissions.count
    assert_equal "B", legacy.reload.grade
    assert_equal "Retained legacy grade", legacy.feedback
    assert_nil legacy.github_revision
    assert_equal 2, legacy.num_submissions
    assert_empty @fake.calls
    # Measured against origin/main 7b576d2a with the same existing progress row:
    # 20 logical queries before and after this slice, including cache hits.
    assert_equal 20, queries.size
    refute queries.any? { |sql| sql.match?(/github_repository_bindings|github_app_installations|github_revision/) }
    as_app_user(@instructor) do
      get "/api/v1/submissions/#{legacy.id}", headers: app_headers
      assert_response :success
      refute response.parsed_body.fetch("submission").key?("github_revision")
    end
  end

  private

  def sync
    result = GithubSyncService.new(github_token: nil, app_client: @fake).sync_student(user: @student.reload, cohort: @cohort.reload, curriculum_module: @mod)
    assert_empty result[:errors]
    result
  end

  def history_query_count
    count_queries do
      get "/api/v1/submissions", params: { cohort_id: @cohort.id, user_id: @student.id }, headers: app_headers
      assert_response :success
    end
  end

  def queue_query_count
    count_queries do
      get "/api/v1/grading_queue", params: { cohort_id: @cohort.id }, headers: app_headers
      assert_response :success
    end
  end
end
