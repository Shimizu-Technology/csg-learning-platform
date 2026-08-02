require "test_helper"

class RubricTest < ActiveSupport::TestCase
  test "requires at least one criterion" do
    rubric = Rubric.new(curriculum: Curriculum.create!(name: "Web"), title: "Project quality")

    assert_not rubric.valid?
    assert rubric.errors[:rubric_criteria].present?
  end

  test "criterion objective must belong to the rubric curriculum" do
    curriculum = Curriculum.create!(name: "Web")
    other = Curriculum.create!(name: "Other")
    objective = LearningObjective.create!(curriculum: other, code: "OTHER.1", title: "Other", success_criteria: "I can do another task.")
    rubric = Rubric.new(curriculum: curriculum, title: "Project quality")
    rubric.rubric_criteria.build(title: "Correctness", description: "The result works.", learning_objective: objective)

    assert_not rubric.valid?
    assert_includes rubric.rubric_criteria.first.errors[:learning_objective], "must belong to the rubric curriculum"
  end

  test "content block rejects a rubric from another curriculum" do
    first = Curriculum.create!(name: "First")
    second = Curriculum.create!(name: "Second")
    curriculum_module = CurriculumModule.create!(curriculum: first, name: "Week", position: 0)
    lesson = Lesson.create!(curriculum_module: curriculum_module, title: "Lesson", position: 0, release_day: 0)
    rubric = Rubric.create!(curriculum: second, title: "Other rubric", rubric_criteria_attributes: [ { title: "Quality", description: "The result is polished." } ])
    block = lesson.content_blocks.new(block_type: :exercise, position: 0, rubric: rubric)

    assert_not block.valid?
    assert_includes block.errors[:rubric], "must belong to the lesson curriculum"
  end
end
