require "test_helper"

class CohortModuleSubmissionWindowTest < ActiveSupport::TestCase
  def setup
    @curriculum = Curriculum.create!(name: "Window Curriculum")
    @curriculum_module = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Two Week Module",
      position: 0,
      day_offset: 0,
      schedule_days: "weekdays"
    )
    Lesson.create!(curriculum_module: @curriculum_module, title: "Week 1", position: 0, release_day: 0)
    Lesson.create!(curriculum_module: @curriculum_module, title: "Week 2", position: 1, release_day: 7)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Window Cohort", start_date: Date.current)
  end

  test "week number must fit within the module schedule" do
    window = @cohort.cohort_module_submission_windows.new(
      curriculum_module: @curriculum_module,
      week_number: 3,
      submissions_close_at: 1.day.from_now
    )

    refute window.valid?
    assert_includes window.errors[:week_number], "must be within this module's 2 week schedule"
  end

  test "module must belong to the cohort curriculum" do
    other_curriculum = Curriculum.create!(name: "Other Curriculum")
    other_module = CurriculumModule.create!(
      curriculum: other_curriculum,
      name: "Other Module",
      position: 0,
      day_offset: 0,
      schedule_days: "weekdays"
    )
    Lesson.create!(curriculum_module: other_module, title: "Other Lesson", position: 0, release_day: 0)
    window = @cohort.cohort_module_submission_windows.new(
      curriculum_module: other_module,
      week_number: 1,
      submissions_close_at: 1.day.from_now
    )

    refute window.valid?
    assert_includes window.errors[:curriculum_module], "must belong to the cohort curriculum"
  end
end
