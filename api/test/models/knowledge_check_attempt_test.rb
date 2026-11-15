require_relative "../support/model_coverage"

class KnowledgeCheckAttemptTest < ModelCoverageTestCase
  test "option must exist and SQL rejects negative choice" do
    check_block = lesson.content_blocks.create!(block_type: :checkpoint, position: 1, title: "Check")
    check = KnowledgeCheck.create!(content_block: check_block, prompt: "Which?", explanation: "First is correct", options: [ "First", "Second" ], correct_option: 0)
    row = KnowledgeCheckAttempt.create!(knowledge_check: check, user: student, enrollment: enrollment, selected_option: 0, correct: true)
    assert_invalid row, :selected_option, 2
    assert_invalid row, :selected_option, -1
    assert_database_rejects row, { selected_option: -1 }
    row.update!(selected_option: 1)
    assert_equal 1, row.reload.selected_option
  end
end
