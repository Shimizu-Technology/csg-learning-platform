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

  test "content block preserves its rubric after criterion feedback is recorded" do
    curriculum = Curriculum.create!(name: "Web")
    curriculum_module = CurriculumModule.create!(curriculum: curriculum, name: "Week 1", position: 0, day_offset: 0)
    lesson = Lesson.create!(curriculum_module: curriculum_module, title: "Project", position: 0, release_day: 0)
    first_rubric = Rubric.create!(curriculum: curriculum, title: "Original", rubric_criteria_attributes: [ { title: "Quality", description: "The result works." } ])
    replacement = Rubric.create!(curriculum: curriculum, title: "Replacement", rubric_criteria_attributes: [ { title: "Clarity", description: "The result is clear." } ])
    block = lesson.content_blocks.create!(block_type: :exercise, position: 0, rubric: first_rubric)
    user = User.create!(clerk_id: "rubric-history-student", email: "rubric-history@example.com", first_name: "Student", role: :student)
    submission = Submission.create!(content_block: block, user: user, text: "My work")
    SubmissionCriterionResult.create!(submission: submission, rubric_criterion: first_rubric.rubric_criteria.first, rating: :meets)

    assert_not block.update(rubric: replacement)
    assert_includes block.errors[:rubric], "cannot be changed after criterion feedback has been recorded"
    assert_equal first_rubric, block.reload.rubric
  end

  test "criterion wording is immutable after feedback is recorded" do
    curriculum = Curriculum.create!(name: "Web")
    curriculum_module = CurriculumModule.create!(curriculum: curriculum, name: "Week 1", position: 0, day_offset: 0)
    lesson = Lesson.create!(curriculum_module: curriculum_module, title: "Project", position: 0, release_day: 0)
    rubric = Rubric.create!(curriculum: curriculum, title: "Quality", rubric_criteria_attributes: [ { title: "Correctness", description: "The result works." } ])
    block = lesson.content_blocks.create!(block_type: :exercise, position: 0, rubric: rubric)
    user = User.create!(clerk_id: "rubric-criterion-student", email: "rubric-criterion@example.com", first_name: "Student", role: :student)
    submission = Submission.create!(content_block: block, user: user, text: "My work")
    criterion = rubric.rubric_criteria.first
    SubmissionCriterionResult.create!(submission: submission, rubric_criterion: criterion, rating: :meets)

    assert_not criterion.update(title: "A different standard")
    assert_includes criterion.errors[:base], "Criterion cannot be changed after feedback has been recorded"
  end
end
