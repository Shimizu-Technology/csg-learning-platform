require_relative "../support/model_coverage"

class FeedbackSnippetTest < ModelCoverageTestCase
  test "title derives from squished body and recommended scope prioritizes usage" do
    row = FeedbackSnippet.create!(created_by: staff, body: "  Review   the loop.  ")
    assert_equal "Review the loop.", row.title
    assert_invalid row, :body, ""
    assert_invalid row, :usage_count, -1
    assert_database_rejects row, { usage_count: -1 }, constraint: "feedback_snippets_usage_count_nonnegative"
    popular = FeedbackSnippet.create!(created_by: staff, title: "Popular", body: "Explain intent", usage_count: 2)
    assert_equal popular, FeedbackSnippet.recommended.first
    popular.update!(active: false)
    assert_not FeedbackSnippet.active.exists?(popular.id)
    staff.update_column(:role, :instructor)
    staff.destroy!
    assert_not FeedbackSnippet.exists?(row.id)
  end
end
