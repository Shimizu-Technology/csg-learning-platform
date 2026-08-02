require "test_helper"

class LearningObjectiveTest < ActiveSupport::TestCase
  setup do
    @curriculum = Curriculum.create!(name: "Foundations")
  end

  test "normalizes codes and requires concrete success criteria" do
    objective = @curriculum.learning_objectives.create!(
      code: " term.1 ",
      title: "Navigate the terminal",
      success_criteria: "I can reach a requested folder and confirm my location."
    )

    assert_equal "TERM.1", objective.code
    assert_not @curriculum.learning_objectives.build(code: "TERM.2", title: "Missing criteria").valid?
  end

  test "rejects alignments outside the objective curriculum" do
    objective = @curriculum.learning_objectives.create!(
      code: "TERM.1",
      title: "Navigate the terminal",
      success_criteria: "I can reach a requested folder and confirm my location."
    )
    other_curriculum = Curriculum.create!(name: "Advanced")
    other_module = CurriculumModule.create!(curriculum: other_curriculum, name: "Week 1", position: 0, schedule_days: "daily")
    lesson = Lesson.create!(curriculum_module: other_module, title: "Other lesson", position: 0, release_day: 0)

    alignment = ObjectiveAlignment.new(learning_objective: objective, lesson: lesson)

    assert_not alignment.valid?
    assert_includes alignment.errors[:learning_objective], "must belong to the target lesson curriculum"
  end
end
