require "test_helper"

class CohortModuleScheduleTest < ActiveSupport::TestCase
  def setup
    @curriculum = Curriculum.create!(name: "Test Curriculum")
    @mwf_module = CurriculumModule.create!(
      curriculum: @curriculum, name: "Live Class", position: 0, day_offset: 0, schedule_days: "mwf"
    )
    @tth_module = CurriculumModule.create!(
      curriculum: @curriculum, name: "Support Lab", position: 1, day_offset: 0, schedule_days: "tth"
    )
    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort", start_date: Date.new(2026, 4, 6), status: :active
    )
  end

  test "start_date must align with the module's first scheduled weekday" do
    schedule = CohortModuleSchedule.new(
      cohort: @cohort,
      curriculum_module: @mwf_module,
      start_date: Date.new(2026, 4, 7)
    )

    refute schedule.valid?
    assert_includes schedule.errors[:start_date], "must fall on Monday for this module schedule"
  end

  test "start_date accepts the module's expected first weekday" do
    schedule = CohortModuleSchedule.new(
      cohort: @cohort,
      curriculum_module: @tth_module,
      start_date: Date.new(2026, 4, 7)
    )

    assert schedule.valid?
  end
end
