require "test_helper"
require_relative "../../db/migrate/20261116120000_add_learner_activity_index"

class AddLearnerActivityIndexTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  NAME = AddLearnerActivityIndex::NAME

  test "the index predicate matches the events LearnerActivity counts" do
    assert_equal LearnerActivity::EXCLUDED_EVENTS.sort, AddLearnerActivityIndex::EXCLUDED_EVENTS.sort,
      "LearnerActivity changed its event filter: add a migration that rebuilds #{NAME} to match"
  end

  test "reuses the exact index and repairs a same-named wrong definition" do
    connection = ActiveRecord::Base.connection
    migration = AddLearnerActivityIndex.new
    oid = -> { connection.select_value("SELECT to_regclass('#{NAME}')::oid") }
    migration.up
    original = oid.call
    migration.up
    assert_equal original, oid.call, "valid expected index should survive a retry"

    [ "CREATE INDEX #{NAME} ON activity_events (subject_user_id, cohort_id)",
      "CREATE INDEX #{NAME} ON activity_events (subject_user_id, cohort_id, created_at)",
      "CREATE INDEX #{NAME} ON activity_events (subject_user_id, cohort_id, created_at) WHERE actor_id = subject_user_id",
      "CREATE INDEX #{NAME} ON activity_events (subject_user_id, cohort_id, created_at DESC) WHERE #{AddLearnerActivityIndex::PREDICATE}",
      "CREATE UNIQUE INDEX #{NAME} ON activity_events (subject_user_id, cohort_id, created_at, id) WHERE #{AddLearnerActivityIndex::PREDICATE}" ].each do |definition|
      connection.execute("DROP INDEX #{NAME}")
      connection.execute(definition)
      wrong = oid.call
      migration.up
      refute_equal wrong, oid.call, "should rebuild: #{definition}"
      index = connection.indexes(:activity_events).find { |candidate| candidate.name == NAME }
      assert_equal %w[subject_user_id cohort_id created_at], index.columns
      assert_not index.unique
      assert_includes index.where, "actor_id = subject_user_id"
      assert_includes index.where, "submission_graded"
    end
  ensure
    migration&.up
  end
end
