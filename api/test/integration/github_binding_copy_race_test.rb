require "test_helper"
require "timeout"
require_relative "../support/github_app_fixtures"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"

class GithubBindingCopyRaceTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  include NonTransactionalTestCleanup
  include LockWaitHelpers
  self.use_transactional_tests = false

  setup do
    @previous_features = SchoolSetting.current.features.deep_dup
    build_github_app_fixture
    @curriculum.update!(status: :active)
    @shared_cohort = Cohort.create!(name: "Other shared App cohort", curriculum: @curriculum, start_date: Date.current, status: :active)
    @threads = []
  end
  teardown do
    CurriculumCopyForCohort.stage_hook = nil
    finish_test_threads(@threads)
    copy_id = @cohort.reload.curriculum_id
    CurriculumCopy.where(cohort_id: @cohort.id).delete_all
    ContentRedirect.where(cohort_id: @cohort.id).delete_all
    ActivityEvent.where(cohort_id: @cohort.id).delete_all
    @cohort.destroy!
    @shared_cohort.destroy!
    Curriculum.find(copy_id).destroy! if copy_id != @curriculum.id
    @curriculum.destroy!
    delete_test_users(@admin, @instructor, @student, @other)
    SchoolSetting.current.update!(features: @previous_features)
  end

  def save_binding(module_id)
    session = ActionDispatch::Integration::Session.new(Rails.application)
    session.post(bindings_path, headers: { "Authorization" => "Bearer test_token_#{@student.id}" }, params: { full_name: "app-learner/prework-exercises", github_app_installation_id: @installation.id, curriculum_module_id: module_id }, as: :json)
    [ session.response.status, session.response.parsed_body ]
  end
  def copy!
    CurriculumCopyForCohort.new(cohort: Cohort.find(@cohort.id), user: @admin, source_curriculum_id: @curriculum.id).copy!
  end

  test "binding save waits for a copy then returns content_moved and retries on the copied module" do
    @binding.destroy!
    locked, release = Queue.new, Queue.new
    CurriculumCopyForCohort.stage_hook = ->(stage) do
      if stage == :learner_data
        locked << ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        release.pop
      end
    end
    @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { copy! } }
    holder = Timeout.timeout(10) { locked.pop }
    @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { save_binding(@mod.id) } }
    wait_for_lock_waiters(holder, workers: [ @threads.last ])
    release << true
    Timeout.timeout(10) { @threads.first.value }
    status, body = Timeout.timeout(10) { @threads.last.value }
    assert_equal 409, status
    assert_equal "content_moved", body.fetch("code")
    refute GithubRepositoryBinding.where(enrollment_id: @enrollment.id).exists?
    copied = @cohort.reload.curriculum.modules.sole
    assert_equal 404, save_binding(@mod.id).first
    assert_equal 200, save_binding(copied.id).first
    assert_equal copied.id, @enrollment.reload.github_repository_bindings.sole.curriculum_module_id
  ensure
    release << true if release
  end

  test "binding created before copy remapping follows the copied module" do
    assert_equal 200, save_binding(@mod.id).first
    copy!
    copied = @cohort.reload.curriculum.modules.sole
    assert_equal copied.id, @enrollment.github_repository_bindings.find_by!(curriculum_module_id: copied.id).curriculum_module_id
    assert_not @enrollment.github_repository_bindings.exists?(curriculum_module_id: @mod.id)
  end
end
