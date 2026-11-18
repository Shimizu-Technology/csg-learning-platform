require "test_helper"
require Rails.root.join("db/migrate/20261119010000_add_personal_pace").to_s

class AddPersonalPaceTest < ActiveSupport::TestCase
  test "additive personal pace columns leave existing cohorts, enrollments and plans off and can run twice" do
    migration = AddPersonalPace.new
    curriculum = Curriculum.create!(name: "Migration pace curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Running cohort", start_date: Date.new(2026, 10, 5))
    student = User.create!(clerk_id: "migration_pace", email: "migration-pace@example.com", first_name: "Migration", last_name: "Synthetic", role: :student)
    enrollment = Enrollment.create!(user: student, cohort: cohort, status: :active)
    migration.migrate(:down)
    reset_models
    assert_not Cohort.column_names.include?("learner_pace_weeks")
    assert_not Enrollment.column_names.include?("starts_on")
    assert_not LearningPlan.column_names.include?("source")
    plan_id = LearningPlan.insert!({ enrollment_id: enrollment.id, title: "Existing plan", active: true, milestones: [], lesson_overrides: [], created_at: Time.current, updated_at: Time.current }).first.fetch("id")

    migration.migrate(:up)
    migration.migrate(:up)
    reset_models
    assert_nil cohort.reload.learner_pace_weeks
    assert_not cohort.personal_pace?
    assert_nil enrollment.reload.starts_on
    plan = LearningPlan.find(plan_id)
    assert_equal [ "staff", nil, 0 ], [ plan.source, plan.pace_weeks, plan.pace_changes_count ]
    assert_raises(ActiveRecord::StatementInvalid) { LearningPlan.where(id: plan_id).update_all(source: "guess") }
  ensure
    reset_models
  end

  private

  def reset_models
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ Cohort, Enrollment, LearningPlan ].each(&:reset_column_information)
  end
end
