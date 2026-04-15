require "test_helper"

class ModuleAssignmentTest < ActiveSupport::TestCase
  def setup
    @curriculum = Curriculum.create!(name: "Test Curriculum")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort Test", start_date: Date.new(2026, 4, 6), status: :active
    )
    @student = User.create!(
      clerk_id: "clerk_ma_test_1", email: "ma_test@example.com", role: :student
    )
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
  end

  # --- accessible? ---

  test "accessible? returns true when unlocked is true" do
    ma = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)
    assert ma.accessible?
  end

  test "accessible? returns false when unlocked is false and no override" do
    ma = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: false)
    refute ma.accessible?
  end

  test "accessible? returns true when override date is in the past" do
    ma = ModuleAssignment.create!(
      enrollment: @enrollment, curriculum_module: @mod,
      unlocked: false, unlock_date_override: Date.new(2026, 1, 1)
    )
    travel_to Date.new(2026, 4, 6) do
      assert ma.accessible?
    end
  end

  test "accessible? returns false when override date is in the future" do
    ma = ModuleAssignment.create!(
      enrollment: @enrollment, curriculum_module: @mod,
      unlocked: false, unlock_date_override: Date.new(2026, 12, 31)
    )
    travel_to Date.new(2026, 4, 6) do
      refute ma.accessible?
    end
  end

  # --- available_for? ---

  test "available_for? returns false when not accessible" do
    ma = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: false)
    refute ma.available_for?(@cohort)
  end

  test "available_for? returns true when accessible and module has no lessons" do
    empty_mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Empty", position: 1, day_offset: 0, schedule_days: "weekdays"
    )
    ma = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: empty_mod, unlocked: true)
    assert ma.available_for?(@cohort)
  end

  test "available_for? returns true when at least one lesson is available" do
    Lesson.create!(curriculum_module: @mod, title: "Available", position: 0, release_day: 0)
    Lesson.create!(curriculum_module: @mod, title: "Locked", position: 1, release_day: 999)
    ma = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)
    travel_to Date.new(2026, 4, 6) do
      assert ma.available_for?(@cohort)
    end
  end

  test "available_for? returns false when all lessons are locked" do
    Lesson.create!(curriculum_module: @mod, title: "Future 1", position: 0, release_day: 999)
    Lesson.create!(curriculum_module: @mod, title: "Future 2", position: 1, release_day: 999)
    ma = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)
    travel_to Date.new(2026, 4, 6) do
      refute ma.available_for?(@cohort)
    end
  end

  # --- next_unlock_date ---

  test "next_unlock_date returns nil for module with no lessons" do
    empty_mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Empty", position: 1, day_offset: 0, schedule_days: "weekdays"
    )
    ma = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: empty_mod, unlocked: true)
    assert_nil ma.next_unlock_date(@cohort)
  end

  test "next_unlock_date returns earliest unlock date across lessons" do
    Lesson.create!(curriculum_module: @mod, title: "Day 5", position: 0, release_day: 5)
    Lesson.create!(curriculum_module: @mod, title: "Day 2", position: 1, release_day: 2)
    Lesson.create!(curriculum_module: @mod, title: "Day 8", position: 2, release_day: 8)
    ma = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)
    assert_equal Date.new(2026, 4, 8), ma.next_unlock_date(@cohort)
  end

  # --- validations ---

  test "enforces uniqueness of module_id per enrollment" do
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)
    duplicate = ModuleAssignment.new(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)
    refute duplicate.valid?
    assert_includes duplicate.errors[:module_id], "has already been taken"
  end
end
