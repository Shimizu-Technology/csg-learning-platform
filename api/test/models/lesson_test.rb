require "test_helper"

class LessonTest < ActiveSupport::TestCase
  def setup
    @curriculum = Curriculum.create!(name: "Test Curriculum")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort Test", start_date: Date.new(2026, 4, 6), status: :active
    )
    @lesson = Lesson.create!(
      curriculum_module: @mod, title: "Git Basics", position: 0, release_day: 0
    )
    @student = User.create!(
      clerk_id: "clerk_lesson_test_1", email: "lesson_test@example.com", role: :student
    )
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @module_assignment = ModuleAssignment.create!(
      enrollment: @enrollment, curriculum_module: @mod, unlocked: true
    )
  end

  # --- unlock_date ---

  test "unlock_date uses cohort start_date + day_offset + release_day" do
    lesson = Lesson.create!(curriculum_module: @mod, title: "Day 3", position: 1, release_day: 3)
    assert_equal Date.new(2026, 4, 9), lesson.unlock_date(@cohort)
  end

  test "unlock_date with module_assignment override uses override as base" do
    @module_assignment.update!(unlock_date_override: Date.new(2026, 5, 1))
    lesson = Lesson.create!(curriculum_module: @mod, title: "Day 2", position: 1, release_day: 2)
    assert_equal Date.new(2026, 5, 3), lesson.unlock_date(@cohort, @module_assignment)
  end

  test "unlock_date without module_assignment uses cohort start_date" do
    lesson = Lesson.create!(curriculum_module: @mod, title: "Day 1", position: 1, release_day: 1)
    assert_equal Date.new(2026, 4, 7), lesson.unlock_date(@cohort, nil)
  end

  test "unlock_date with day_offset on module" do
    mod2 = CurriculumModule.create!(
      curriculum: @curriculum, name: "Live Class", position: 1, day_offset: 35, schedule_days: "mwf"
    )
    lesson = Lesson.create!(curriculum_module: mod2, title: "First Class", position: 0, release_day: 0)
    assert_equal Date.new(2026, 5, 11), lesson.unlock_date(@cohort)
  end

  # --- available? ---

  test "available? returns true when date has passed" do
    travel_to Date.new(2026, 4, 6) do
      assert @lesson.available?(@cohort, @module_assignment)
    end
  end

  test "available? returns false when date has not passed" do
    future_lesson = Lesson.create!(curriculum_module: @mod, title: "Future", position: 1, release_day: 30)
    travel_to Date.new(2026, 4, 6) do
      refute future_lesson.available?(@cohort, @module_assignment)
    end
  end

  test "available? returns false when module_assignment is not accessible" do
    @module_assignment.update!(unlocked: false, unlock_date_override: nil)
    travel_to Date.new(2026, 4, 6) do
      refute @lesson.available?(@cohort, @module_assignment)
    end
  end

  test "available? with lesson_assignment unlocked overrides everything" do
    future_lesson = Lesson.create!(curriculum_module: @mod, title: "Far Future", position: 1, release_day: 999)
    la = LessonAssignment.create!(enrollment: @enrollment, lesson: future_lesson, unlocked: true)
    travel_to Date.new(2026, 4, 6) do
      assert future_lesson.available?(@cohort, @module_assignment, la)
    end
  end

  test "available? with lesson_assignment unlock_date_override in past" do
    future_lesson = Lesson.create!(curriculum_module: @mod, title: "Overridden", position: 1, release_day: 999)
    la = LessonAssignment.create!(
      enrollment: @enrollment, lesson: future_lesson,
      unlocked: false, unlock_date_override: Date.new(2026, 4, 1)
    )
    travel_to Date.new(2026, 4, 6) do
      assert future_lesson.available?(@cohort, @module_assignment, la)
    end
  end

  test "available? with lesson_assignment unlock_date_override in future" do
    la = LessonAssignment.create!(
      enrollment: @enrollment, lesson: @lesson,
      unlocked: false, unlock_date_override: Date.new(2026, 12, 31)
    )
    travel_to Date.new(2026, 4, 6) do
      refute @lesson.available?(@cohort, @module_assignment, la)
    end
  end

  test "available? without module_assignment uses raw date calculation" do
    travel_to Date.new(2026, 4, 6) do
      assert @lesson.available?(@cohort)
    end
  end

  # --- validations ---

  test "requires title" do
    lesson = Lesson.new(curriculum_module: @mod, position: 0, release_day: 0)
    refute lesson.valid?
    assert_includes lesson.errors[:title], "can't be blank"
  end

  test "release_day must be non-negative integer" do
    lesson = Lesson.new(curriculum_module: @mod, title: "Bad", position: 0, release_day: -1)
    refute lesson.valid?
    assert_includes lesson.errors[:release_day], "must be greater than or equal to 0"
  end
end
