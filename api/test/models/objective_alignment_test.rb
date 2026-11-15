require_relative "../support/model_coverage"

class ObjectiveAlignmentTest < ModelCoverageTestCase
  test "alignment rejects cross curriculum and wrong lesson blocks and enforces both unique indexes" do
    objective = LearningObjective.create!(curriculum: curriculum, code: "OBJ", title: "Objective", success_criteria: "Demonstrate it", position: 0)
    row = ObjectiveAlignment.create!(learning_objective: objective, lesson: lesson, position: 0)
    assert_not row.dup.valid?
    assert_database_rejects row, { position: -1 }
    with_block = ObjectiveAlignment.create!(learning_objective: objective, lesson: lesson, content_block: block)
    other_lesson = Lesson.create!(curriculum_module: mod, title: "Other", position: 1, release_day: 1)
    other = ObjectiveAlignment.create!(learning_objective: objective, lesson: other_lesson)
    assert_database_rejects other, { lesson_id: lesson.id }, ActiveRecord::RecordNotUnique
    with_block.lesson = other_lesson
    assert_not with_block.valid?
    assert with_block.errors[:content_block].any?
    with_block.reload
    other_curriculum = Curriculum.create!(name: "Other curriculum")
    other_objective = LearningObjective.create!(curriculum: other_curriculum, code: "OTHER", title: "Other", success_criteria: "Demonstrate it", position: 0)
    assert_invalid row, :learning_objective, other_objective
  end
end
