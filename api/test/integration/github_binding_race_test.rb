require "test_helper"
require "timeout"
require_relative "../support/github_app_fixtures"
require_relative "../support/non_transactional_test_cleanup"

class GithubBindingRaceTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  include NonTransactionalTestCleanup
  self.use_transactional_tests = false

  test "concurrent enrollment and module inserts return success and conflict with one saved binding" do
    previous_features = SchoolSetting.current.features.deep_dup
    build_github_app_fixture
    @binding.destroy!
    [ nil, @mod.id ].each do |module_id|
      arrived, release = Queue.new, Queue.new
      enrollment_id = @enrollment.id
      callback = proc do |row|
        if row.enrollment_id == enrollment_id
          arrived << true
          release.pop
        end
      end
      GithubRepositoryBinding.set_callback(:create, :before, callback)
      threads = []
      as_app_user(@student) do
        2.times do
          threads << Thread.new do
            ActiveRecord::Base.connection_pool.with_connection do
              session = ActionDispatch::Integration::Session.new(Rails.application)
              session.post(bindings_path, headers: app_headers, params: { full_name: "app-learner/prework-exercises", github_app_installation_id: @installation.id, curriculum_module_id: module_id }, as: :json)
              session.response.status
            end
          end
        end
        Timeout.timeout(10) { 2.times { arrived.pop } }
        2.times { release << true }
        assert_equal [ 200, 409 ], threads.map(&:value).sort
      end
      assert_equal 1, @enrollment.github_repository_bindings.where(curriculum_module_id: module_id).count
      GithubRepositoryBinding.skip_callback(:create, :before, callback)
    ensure
      2.times { release << true } if release
      finish_test_threads(threads)
      GithubRepositoryBinding.skip_callback(:create, :before, callback, raise: false) if callback
    end
  ensure
    @cohort&.destroy!
    @curriculum&.destroy!
    delete_test_users(@admin, @instructor, @student, @other)
    SchoolSetting.current.update!(features: previous_features) if previous_features
  end
end
