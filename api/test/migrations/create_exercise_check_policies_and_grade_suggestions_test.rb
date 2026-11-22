require "test_helper"
require Rails.root.join("db/migrate/20261122090000_create_exercise_check_policies_and_grade_suggestions").to_s

class CreateExerciseCheckPoliciesAndGradeSuggestionsTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "additive migration rolls back, reapplies idempotently, and enforces DB check and unique constraints" do
    migration = CreateExerciseCheckPoliciesAndGradeSuggestions.new
    before = Cohort.pluck(:id, :settings)

    migration.migrate(:down)
    connection = ActiveRecord::Base.connection
    refute connection.table_exists?(:submission_grade_suggestions)
    refute connection.table_exists?(:exercise_check_policies)
    refute connection.column_exists?(:github_check_runs, :check_suite_id)

    migration.migrate(:up)
    # Idempotent re-run
    migration.migrate(:up)

    assert connection.column_exists?(:github_check_runs, :check_suite_id)
    assert connection.table_exists?(:exercise_check_policies)
    assert connection.table_exists?(:submission_grade_suggestions)

    policy_columns = connection.columns(:exercise_check_policies).map(&:name)
    suggestion_columns = connection.columns(:submission_grade_suggestions).map(&:name)
    refute (policy_columns + suggestion_columns).any? { |name| name.match?(/private_key|secret/) }

    policy_indexes = connection.indexes(:exercise_check_policies)
    assert policy_indexes.any? { |idx| idx.unique && idx.columns == %w[content_block_id version] }
    assert policy_indexes.any? { |idx| idx.unique && idx.columns == [ "content_block_id" ] && idx.where.to_s.include?("active") }

    suggestion_indexes = connection.indexes(:submission_grade_suggestions)
    assert suggestion_indexes.any? { |idx| idx.unique && idx.columns == [ "submission_id" ] }
    assert suggestion_indexes.any? { |idx| idx.columns == %w[enrollment_id content_block_id] }
    assert suggestion_indexes.any? { |idx| idx.columns == [ "outcome" ] }

    policy_fks = connection.foreign_keys(:exercise_check_policies).index_by(&:column)
    assert_equal :cascade, policy_fks.fetch("content_block_id").on_delete
    assert_equal :nullify, policy_fks.fetch("created_by_id").on_delete

    suggestion_fks = connection.foreign_keys(:submission_grade_suggestions).index_by(&:column)
    assert_equal :cascade, suggestion_fks.fetch("submission_id").on_delete
    assert_equal :cascade, suggestion_fks.fetch("enrollment_id").on_delete
    assert_equal :cascade, suggestion_fks.fetch("content_block_id").on_delete
    assert_equal :nullify, suggestion_fks.fetch("exercise_check_policy_id").on_delete
    assert_equal :nullify, suggestion_fks.fetch("decided_by_id").on_delete

    # Verify DB-level CHECK constraints directly via raw SQL.
    curriculum = Curriculum.create!(name: "Migration constraint check curriculum")
    mod = curriculum.modules.create!(name: "Prework", position: 0)
    lesson = mod.lessons.create!(title: "Lesson 1", position: 0, release_day: 0)
    block = lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Ex 1", filename: "111.rb")
    cohort = Cohort.create!(curriculum: curriculum, name: "Constraint Cohort", start_date: Date.current, status: :active)
    student = User.create!(clerk_id: "mig_const_student", email: "mig-const@example.invalid", first_name: "Mig", last_name: "Student", role: :student)
    enrollment = Enrollment.create!(user: student, cohort: cohort, status: :active)
    submission = Submission.create!(user: student, enrollment: enrollment, content_block: block, text: "puts 1")

    now = Time.current.utc.iso8601(6)

    assert_raises(ActiveRecord::StatementInvalid) do
      connection.execute(<<~SQL)
        INSERT INTO exercise_check_policies (content_block_id, version, active, required_checks, allowed_app_slugs, created_at, updated_at)
        VALUES (#{block.id}, 0, true, '["prework/111.rb"]'::jsonb, '["github-actions"]'::jsonb, '#{now}', '#{now}')
      SQL
    end

    assert_raises(ActiveRecord::StatementInvalid) do
      connection.execute(<<~SQL)
        INSERT INTO exercise_check_policies (content_block_id, version, active, required_checks, allowed_app_slugs, created_at, updated_at)
        VALUES (#{block.id}, 1, true, '{}'::jsonb, '["github-actions"]'::jsonb, '#{now}', '#{now}')
      SQL
    end

    assert_raises(ActiveRecord::StatementInvalid) do
      connection.execute(<<~SQL)
        INSERT INTO exercise_check_policies (content_block_id, version, active, required_checks, allowed_app_slugs, created_at, updated_at)
        VALUES (#{block.id}, 1, true, '["prework/111.rb"]'::jsonb, '{}'::jsonb, '#{now}', '#{now}')
      SQL
    end

    # Valid active v1 succeeds, but a second active v2 on the same block violates partial unique index.
    connection.execute(<<~SQL)
      INSERT INTO exercise_check_policies (content_block_id, version, active, required_checks, allowed_app_slugs, created_at, updated_at)
      VALUES (#{block.id}, 1, true, '["prework/111.rb"]'::jsonb, '["github-actions"]'::jsonb, '#{now}', '#{now}')
    SQL

    assert_raises(ActiveRecord::RecordNotUnique) do
      connection.execute(<<~SQL)
        INSERT INTO exercise_check_policies (content_block_id, version, active, required_checks, allowed_app_slugs, created_at, updated_at)
        VALUES (#{block.id}, 2, true, '["prework/111.rb"]'::jsonb, '["github-actions"]'::jsonb, '#{now}', '#{now}')
      SQL
    end

    # submission_grade_suggestions CHECK constraints: invalid outcome, suggested_grade, decision, policy_version, evidence.
    assert_raises(ActiveRecord::StatementInvalid) do
      connection.execute(<<~SQL)
        INSERT INTO submission_grade_suggestions (submission_id, enrollment_id, content_block_id, outcome, reason_code, reason_summary, evidence, evaluated_at, created_at, updated_at)
        VALUES (#{submission.id}, #{enrollment.id}, #{block.id}, 'auto_pass', 'all_required_checks_passed', 'bad', '{}'::jsonb, '#{now}', '#{now}', '#{now}')
      SQL
    end

    assert_raises(ActiveRecord::StatementInvalid) do
      connection.execute(<<~SQL)
        INSERT INTO submission_grade_suggestions (submission_id, enrollment_id, content_block_id, outcome, suggested_grade, reason_code, reason_summary, evidence, evaluated_at, created_at, updated_at)
        VALUES (#{submission.id}, #{enrollment.id}, #{block.id}, 'suggest_b', 'A', 'all_required_checks_passed', 'bad grade', '{}'::jsonb, '#{now}', '#{now}', '#{now}')
      SQL
    end

    assert_raises(ActiveRecord::StatementInvalid) do
      connection.execute(<<~SQL)
        INSERT INTO submission_grade_suggestions (submission_id, enrollment_id, content_block_id, outcome, decision, reason_code, reason_summary, evidence, evaluated_at, created_at, updated_at)
        VALUES (#{submission.id}, #{enrollment.id}, #{block.id}, 'no_suggestion', 'auto_graded', 'missing_policy', 'bad decision', '{}'::jsonb, '#{now}', '#{now}', '#{now}')
      SQL
    end

    assert_raises(ActiveRecord::StatementInvalid) do
      connection.execute(<<~SQL)
        INSERT INTO submission_grade_suggestions (submission_id, enrollment_id, content_block_id, policy_version, outcome, reason_code, reason_summary, evidence, evaluated_at, created_at, updated_at)
        VALUES (#{submission.id}, #{enrollment.id}, #{block.id}, 0, 'no_suggestion', 'missing_policy', 'bad version', '{}'::jsonb, '#{now}', '#{now}', '#{now}')
      SQL
    end

    assert_raises(ActiveRecord::StatementInvalid) do
      connection.execute(<<~SQL)
        INSERT INTO submission_grade_suggestions (submission_id, enrollment_id, content_block_id, outcome, reason_code, reason_summary, evidence, evaluated_at, created_at, updated_at)
        VALUES (#{submission.id}, #{enrollment.id}, #{block.id}, 'no_suggestion', 'missing_policy', 'bad evidence', '[]'::jsonb, '#{now}', '#{now}', '#{now}')
      SQL
    end

    # Valid row succeeds, duplicate submission_id fails.
    connection.execute(<<~SQL)
      INSERT INTO submission_grade_suggestions (submission_id, enrollment_id, content_block_id, outcome, suggested_grade, reason_code, reason_summary, evidence, evaluated_at, created_at, updated_at)
      VALUES (#{submission.id}, #{enrollment.id}, #{block.id}, 'suggest_b', 'B', 'all_required_checks_passed', 'ok', '{}'::jsonb, '#{now}', '#{now}', '#{now}')
    SQL

    assert_raises(ActiveRecord::RecordNotUnique) do
      connection.execute(<<~SQL)
        INSERT INTO submission_grade_suggestions (submission_id, enrollment_id, content_block_id, outcome, reason_code, reason_summary, evidence, evaluated_at, created_at, updated_at)
        VALUES (#{submission.id}, #{enrollment.id}, #{block.id}, 'no_suggestion', 'missing_policy', 'dup', '{}'::jsonb, '#{now}', '#{now}', '#{now}')
      SQL
    end

    # Clean up test records we inserted outside transactional tests.
    submission.destroy!
    enrollment.destroy!
    cohort.destroy!
    student.destroy!
    curriculum.destroy!

    assert_equal before, Cohort.pluck(:id, :settings)
    assert_equal 0, ExerciseCheckPolicy.count
    assert_equal 0, SubmissionGradeSuggestion.count
  ensure
    begin
      migration&.migrate(:up) unless ActiveRecord::Base.connection.table_exists?(:submission_grade_suggestions) && ActiveRecord::Base.connection.table_exists?(:exercise_check_policies)
    ensure
      ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
      ExerciseCheckPolicy.reset_column_information
      SubmissionGradeSuggestion.reset_column_information
      GithubCheckRun.reset_column_information
    end
  end
end
