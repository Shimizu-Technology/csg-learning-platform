require "test_helper"
require Rails.root.join("db/migrate/20261126140000_add_grading_scale_to_curricula").to_s

class AddGradingScaleToCurriculaTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "adds the scale with A / B / C / Redo for existing curricula, widens Pass constraints, and rolls back cleanly" do
    migration = AddGradingScaleToCurricula.new
    connection = ActiveRecord::Base.connection
    existing = Curriculum.create!(name: "Grading scale migration curriculum")

    2.times do
      migration.migrate(:down)
      clear_caches
      refute connection.column_exists?(:curricula, :grading_scale)
      refute allowed?(:github_issue_deliveries, AddGradingScaleToCurricula::DELIVERY_GRADE_CONSTRAINT, "grade" => "P")
      refute allowed?(:submission_grade_suggestions, AddGradingScaleToCurricula::OUTCOME_CONSTRAINT, "outcome" => "suggest_pass")

      migration.migrate(:up)
      migration.migrate(:up)
      clear_caches
      assert_equal "letter_abc_redo", existing.reload.grading_scale, "existing curricula keep A / B / C / Redo"
      assert connection.check_constraint_exists?(:curricula, name: AddGradingScaleToCurricula::SCALE_CONSTRAINT)
      assert allowed?(:curricula, AddGradingScaleToCurricula::SCALE_CONSTRAINT, "grading_scale" => "pass_redo")
      refute allowed?(:curricula, AddGradingScaleToCurricula::SCALE_CONSTRAINT, "grading_scale" => "percent")
      assert allowed?(:github_issue_deliveries, AddGradingScaleToCurricula::DELIVERY_GRADE_CONSTRAINT, "grade" => "P")
      assert allowed?(:submission_grade_suggestions, AddGradingScaleToCurricula::OUTCOME_CONSTRAINT, "outcome" => "suggest_pass")
      assert allowed?(:submission_grade_suggestions, AddGradingScaleToCurricula::SUGGESTED_GRADE_CONSTRAINT, "outcome" => "suggest_pass", "suggested_grade" => "P")
      assert allowed?(:submission_grade_suggestions, AddGradingScaleToCurricula::SUGGESTED_GRADE_CONSTRAINT, "outcome" => "suggest_b", "suggested_grade" => "B")
      refute allowed?(:submission_grade_suggestions, AddGradingScaleToCurricula::SUGGESTED_GRADE_CONSTRAINT, "outcome" => "suggest_pass", "suggested_grade" => "B")
      refute allowed?(:submission_grade_suggestions, AddGradingScaleToCurricula::SUGGESTED_GRADE_CONSTRAINT, "outcome" => "no_suggestion", "suggested_grade" => "P")
    end
  ensure
    migration&.migrate(:up)
    clear_caches
    existing&.destroy
  end

  test "rollback refuses while a Pass grade exists" do
    migration = AddGradingScaleToCurricula.new
    curriculum = Curriculum.create!(name: "Pass rollback curriculum", grading_scale: "pass_redo")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    lesson = Lesson.create!(curriculum_module: mod, title: "Loops", position: 0, release_day: 0)
    block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "Loop exercise", body: "Write a loop")
    student = User.create!(clerk_id: "pass_rollback_student", email: "pass-rollback@example.invalid", first_name: "Pass", last_name: "Rollback", role: :student)
    submission = Submission.create!(content_block: block, user: student, text: "done", grade: "P")

    error = assert_raises(ActiveRecord::IrreversibleMigration) { migration.migrate(:down) }
    assert_match(/Pass grades/, error.message)
    assert ActiveRecord::Base.connection.column_exists?(:curricula, :grading_scale)
  ensure
    submission&.destroy
    student&.destroy
    curriculum&.destroy
    migration&.migrate(:up)
    clear_caches
  end

  private

  # Evaluates the live constraint against one candidate row, without writing it.
  def allowed?(table, name, values)
    connection = ActiveRecord::Base.connection
    expression = connection.check_constraints(table).find { |candidate| candidate.name == name }.expression
    columns = values.map { |column, value| "#{connection.quote(value)}::varchar AS #{connection.quote_column_name(column)}" }
    defaults = { "outcome" => "no_suggestion", "suggested_grade" => nil }.except(*values.keys)
    defaults = {} unless table == :submission_grade_suggestions
    columns += defaults.map { |column, value| "#{connection.quote(value)}::varchar AS #{connection.quote_column_name(column)}" }
    connection.select_value("SELECT (#{expression}) FROM (SELECT #{columns.join(', ')}) AS candidate") == true
  end

  def clear_caches
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    Curriculum.reset_column_information
  end
end
