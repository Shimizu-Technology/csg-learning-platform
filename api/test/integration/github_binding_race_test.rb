require "test_helper"
require "timeout"
require_relative "../support/github_app_fixtures"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"

class GithubBindingRaceTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  include NonTransactionalTestCleanup
  self.use_transactional_tests = false

  include LockWaitHelpers

  test "concurrent binding saves serialize with one row per scope" do
    previous_features = SchoolSetting.current.features.deep_dup
    build_github_app_fixture
    @binding.destroy!
    [ nil, @mod.id ].each do |module_id|
      threads = []
      Enrollment.transaction do
        @enrollment.lock!
        holder = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        2.times do
          threads << Thread.new do
            ActiveRecord::Base.connection_pool.with_connection do
              session = ActionDispatch::Integration::Session.new(Rails.application)
              session.post(bindings_path, headers: { "Authorization" => "Bearer test_token_#{@student.id}" }, params: { full_name: "app-learner/prework-exercises", github_app_installation_id: @installation.id, curriculum_module_id: module_id }, as: :json)
              session.response.status
            end
          end
        end
        wait_for_lock_waiters(holder, workers: threads)
      end
      assert_equal [ 200, 200 ], threads.map { |thread| Timeout.timeout(10) { thread.value } }
      assert_equal 1, @enrollment.github_repository_bindings.where(curriculum_module_id: module_id).count
    ensure
      finish_test_threads(threads)
    end
  ensure
    @cohort&.destroy!
    @curriculum&.destroy!
    delete_test_users(@admin, @instructor, @student, @other)
    SchoolSetting.current.update!(features: previous_features) if previous_features
  end
end
