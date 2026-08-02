require "test_helper"

class KnowledgeCheckTest < ActiveSupport::TestCase
  test "question remains immutable after student evidence exists" do
    curriculum = Curriculum.create!(name: "Foundations")
    curriculum_module = CurriculumModule.create!(curriculum: curriculum, name: "Week 1", position: 0, day_offset: 0)
    lesson = Lesson.create!(curriculum_module: curriculum_module, title: "Recall", position: 0, release_day: 0)
    block = lesson.content_blocks.create!(block_type: :checkpoint, position: 0)
    check = KnowledgeCheck.create!(content_block: block, prompt: "Which command?", options: [ "pwd", "cd" ], correct_option: 0, explanation: "pwd prints the directory.")
    user = User.create!(clerk_id: "knowledge-check-student", email: "knowledge-check@example.com", first_name: "Student", role: :student)
    check.attempts.create!(user: user, selected_option: 0, correct: true)

    assert_not check.update(prompt: "A changed question")
    assert_includes check.errors[:base], "Check cannot be changed after students have attempted it"
  end
end
