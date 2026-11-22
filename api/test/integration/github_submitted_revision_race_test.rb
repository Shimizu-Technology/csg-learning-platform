require "test_helper"
require "timeout"
require_relative "../support/github_app_fixtures"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"

class GithubSubmittedRevisionRaceTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  include NonTransactionalTestCleanup
  include LockWaitHelpers
  self.use_transactional_tests = false

  setup do
    @previous_features = SchoolSetting.current.features.deep_dup
    build_github_app_fixture
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
  end

  teardown do
    ActivityEvent.where(cohort_id: @cohort&.id).delete_all
    @enrollment&.submissions&.destroy_all
    Progress.where(enrollment_id: @enrollment&.id).delete_all
    @cohort&.destroy!
    @curriculum&.destroy!
    delete_test_users(@admin, @instructor, @student, @other)
    SchoolSetting.current.update!(features: @previous_features)
  end

  test "overlapping syncs cannot create duplicate attempts for the same content" do
    threads = []
    provider_ready, resume_provider = Queue.new, Queue.new
    Enrollment.transaction do
      @enrollment.lock!
      holder = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
      2.times do
        fake = FakeGithubAppClient.new
        original = fake.method(:files)
        fake.define_singleton_method(:files) do |**options|
          result = original.call(**options)
          provider_ready << true
          resume_provider.pop
          result
        end
        threads << Thread.new do
          ActiveRecord::Base.connection_pool.with_connection { sync(fake) }
        end
        Timeout.timeout(10) { provider_ready.pop }
      end
      2.times { resume_provider << true }
      wait_for_lock_waiters(holder, workers: threads)
    end
    results = threads.map { |thread| Timeout.timeout(10) { thread.value } }
    assert_equal 1, results.sum { |result| result[:synced] }
    assert_equal 1, @enrollment.submissions.count
    # A redundant verification can stale the other in-flight operation. Retry
    # is idempotent, rather than importing source with replacement provenance.
    assert_equal({ synced: 0, errors: [] }, sync(@fake))
  ensure
    2.times { resume_provider << true } if resume_provider
    finish_test_threads(threads)
  end

  test "grading while source is in flight retains the saved grade on its original revision" do
    assert_equal 1, sync(@fake)[:synced]
    previous = @enrollment.submissions.sole
    provider_ready, resume_provider = Queue.new, Queue.new
    fake = FakeGithubAppClient.new
    fake.source_text = "puts 'changed during review'"
    fake.commit_sha = "b" * 40
    original = fake.method(:files)
    fake.define_singleton_method(:files) do |**options|
      result = original.call(**options)
      provider_ready << true
      resume_provider.pop
      result
    end
    worker = Thread.new { ActiveRecord::Base.connection_pool.with_connection { sync(fake) } }
    Timeout.timeout(10) { provider_ready.pop }
    # No provider calls from grading: the source boundary is the fake above.
    stub_app_method(GithubIssueService, :handle_grade, nil) do
      as_app_user(@instructor) do
        patch "/api/v1/submissions/#{previous.id}/grade", headers: app_headers, as: :json,
          params: { grade: "B", feedback: "Grade first captured source", base_submission_updated_at: previous.updated_at.iso8601(6) }
        assert_response :success
      end
    end
    resume_provider << true
    assert_equal({ synced: 1, errors: [] }, Timeout.timeout(10) { worker.value })
    assert_equal "B", previous.reload.grade
    assert_equal "Grade first captured source", previous.feedback
    assert_equal "a" * 40, previous.commit_sha
    current = previous.latest_attempt
    assert_nil current.grade
    assert_equal "b" * 40, current.commit_sha
  ensure
    resume_provider << true if resume_provider
    finish_test_threads(worker)
  end

  private

  def sync(client)
    GithubSyncService.new(github_token: nil, app_client: client).sync_student(
      user: User.find(@student.id), cohort: Cohort.find(@cohort.id), curriculum_module: CurriculumModule.find(@mod.id))
  end
end
