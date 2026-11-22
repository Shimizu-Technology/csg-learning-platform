require "test_helper"
require Rails.root.join("db/migrate/20261122100000_create_github_reconciliation_states").to_s
require_relative "../support/non_transactional_test_cleanup"

class CreateGithubReconciliationStatesTest < ActiveSupport::TestCase
  include NonTransactionalTestCleanup
  self.use_transactional_tests = false

  test "additive migration rolls back, reapplies idempotently, enforces SQL constraints and cascades on binding delete" do
    migration = CreateGithubReconciliationStates.new
    before = Cohort.pluck(:id, :settings)

    migration.migrate(:down)
    connection = ActiveRecord::Base.connection
    refute connection.table_exists?(:github_reconciliation_states)

    migration.migrate(:up)
    # Re-running up is idempotent.
    migration.migrate(:up)

    assert connection.table_exists?(:github_reconciliation_states)
    refute connection.columns(:github_reconciliation_states).any? { |column| column.name.match?(/private_key|secret/) }

    indexes = connection.indexes(:github_reconciliation_states)
    assert indexes.any? { |index| index.unique && index.columns == [ "github_repository_binding_id" ] }
    assert indexes.any? { |index| index.columns == [ "next_reconcile_at" ] }

    checks = connection.check_constraints(:github_reconciliation_states).map(&:name)
    assert_includes checks, "github_reconciliation_states_consecutive_failures_nonnegative"
    assert_includes checks, "github_reconciliation_states_last_status_valid"
    assert_includes checks, "github_reconciliation_states_claim_lease_consistent"

    curriculum = Curriculum.create!(name: "Migration reconciliation curriculum")
    cohort = Cohort.create!(name: "Migration reconciliation cohort", curriculum: curriculum, start_date: Date.current, status: :active)
    student = User.create!(clerk_id: "mig-recon-student", email: "mig-recon-student@example.invalid", role: :student)
    enrollment = Enrollment.create!(cohort: cohort, user: student, status: :active)
    installation = cohort.github_app_installations.create!(
      app_id: 12345, installation_id: 99123, account_id: 99456, account_login: "mig-recon",
      account_type: "User", repository_selection: "selected", connected_at: Time.current, checked_at: Time.current
    )
    binding = enrollment.github_repository_bindings.create!(
      github_app_installation: installation,
      full_name: "mig-recon/exercises"
    )
    now = Time.current

    # Exercise PostgreSQL CHECK constraints directly, bypassing ActiveRecord validations.
    bad_failures = assert_raises(ActiveRecord::StatementInvalid) do
      GithubReconciliationState.insert_all!([ {
        github_repository_binding_id: binding.id,
        activated_at: now,
        consecutive_failures: -1,
        last_status: "idle",
        created_at: now,
        updated_at: now
      } ])
    end
    assert_match(/github_reconciliation_states_consecutive_failures_nonnegative/, bad_failures.message)

    bad_status = assert_raises(ActiveRecord::StatementInvalid) do
      GithubReconciliationState.insert_all!([ {
        github_repository_binding_id: binding.id,
        activated_at: now,
        consecutive_failures: 0,
        last_status: "bogus",
        created_at: now,
        updated_at: now
      } ])
    end
    assert_match(/github_reconciliation_states_last_status_valid/, bad_status.message)

    bad_token_only = assert_raises(ActiveRecord::StatementInvalid) do
      GithubReconciliationState.insert_all!([ {
        github_repository_binding_id: binding.id,
        activated_at: now,
        consecutive_failures: 0,
        last_status: "idle",
        claim_token: "orphan-token",
        claimed_until: nil,
        created_at: now,
        updated_at: now
      } ])
    end
    assert_match(/github_reconciliation_states_claim_lease_consistent/, bad_token_only.message)

    bad_until_only = assert_raises(ActiveRecord::StatementInvalid) do
      GithubReconciliationState.insert_all!([ {
        github_repository_binding_id: binding.id,
        activated_at: now,
        consecutive_failures: 0,
        last_status: "idle",
        claim_token: nil,
        claimed_until: now + 5.minutes,
        created_at: now,
        updated_at: now
      } ])
    end
    assert_match(/github_reconciliation_states_claim_lease_consistent/, bad_until_only.message)

    # Unique 1-to-1 binding FK and ON DELETE CASCADE.
    state = GithubReconciliationState.create!(
      github_repository_binding: binding,
      activated_at: now,
      last_status: "idle"
    )
    assert_raises(ActiveRecord::RecordNotUnique) do
      GithubReconciliationState.insert_all!([ {
        github_repository_binding_id: binding.id,
        activated_at: now,
        consecutive_failures: 0,
        last_status: "idle",
        created_at: now,
        updated_at: now
      } ])
    end

    binding.delete
    refute GithubReconciliationState.exists?(state.id)
    assert_equal before, Cohort.where(id: before.map(&:first)).pluck(:id, :settings)
  ensure
    GithubReconciliationState.where(github_repository_binding_id: binding&.id).delete_all if defined?(binding) && binding
    cohort&.destroy if defined?(cohort) && cohort
    curriculum&.destroy if defined?(curriculum) && curriculum
    delete_test_users(student) if defined?(student) && student
    begin
      migration&.migrate(:up) unless ActiveRecord::Base.connection.table_exists?(:github_reconciliation_states)
    ensure
      ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
      [ GithubReconciliationState, GithubRepositoryBinding ].each(&:reset_column_information)
    end
  end
end
