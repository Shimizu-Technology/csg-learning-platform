require "test_helper"
require Rails.root.join("db/migrate/20261022010000_add_content_defaults_to_cohorts")

class AddContentDefaultsToCohortsTest < ActiveSupport::TestCase
  def setup
    @curriculum = Curriculum.create!(name: "Defaults migration")
    @first = @curriculum.modules.create!(name: "Selected", position: 0)
    @second = @curriculum.modules.create!(name: "Excluded", position: 1)
    @cohort = Cohort.create!(name: "Legacy cohort", curriculum: @curriculum, start_date: Date.new(2030, 7, 8))
    @student = User.create!(clerk_id: "defaults_migration", email: "defaults-migration@example.com")
  end

  test "no schedules or active assignments preserves legacy all curriculum access" do
    backfill
    assert @cohort.content_defaults.values.all? { |entry| entry["assigned"] && !entry["unlocked"] }
    assert_equal [ @first.id.to_s, @second.id.to_s ].sort, @cohort.content_defaults.keys.sort
  end

  test "selection and unanimous overrides survive without modifying existing learner records" do
    enrollment = @cohort.enrollments.create!(user: @student)
    assignment = enrollment.module_assignments.create!(curriculum_module: @first, unlocked: true, unlock_date_override: Date.new(2030, 7, 15))
    original = assignment.attributes
    backfill
    assert_equal({ "assigned" => true, "unlocked" => true, "unlock_date_override" => "2030-07-15" }, @cohort.content_defaults.fetch(@first.id.to_s))
    refute @cohort.content_defaults.fetch(@second.id.to_s).fetch("assigned")
    assert_equal original, assignment.reload.attributes
  end

  test "mixed individual overrides never become cohort wide unlocks or dates" do
    first_enrollment = @cohort.enrollments.create!(user: @student)
    other_student = User.create!(clerk_id: "defaults_other", email: "defaults-other@example.com")
    second_enrollment = @cohort.enrollments.create!(user: other_student)
    first_enrollment.module_assignments.create!(curriculum_module: @first, unlocked: true, unlock_date_override: Date.new(2030, 7, 15))
    second_enrollment.module_assignments.create!(curriculum_module: @first, unlocked: false)
    backfill
    entry = @cohort.content_defaults.fetch(@first.id.to_s)
    assert entry["assigned"]
    refute entry["unlocked"]
    assert_nil entry["unlock_date_override"]
  end

  test "schedule selection works without learners and expired assignments do not reopen removed content" do
    @cohort.cohort_module_schedules.create!(curriculum_module: @first, start_date: Date.new(2030, 7, 8))
    enrollment = @cohort.enrollments.create!(user: @student, access_expires_at: 1.day.ago)
    enrollment.module_assignments.create!(curriculum_module: @second, unlocked: true)
    backfill
    assert @cohort.content_defaults.fetch(@first.id.to_s).fetch("assigned")
    refute @cohort.content_defaults.fetch(@second.id.to_s).fetch("assigned")
  end

  private

  def backfill
    AddContentDefaultsToCohorts.new.backfill_content_defaults
    @cohort.reload
  end
end
