require_relative "../support/model_coverage"

class InterventionNoteTest < ModelCoverageTestCase
  test "notes require staff authors nonempty bounded body and intervention" do
    row = InterventionNote.create!(intervention: intervention, author: staff, body: "Synthetic note")
    assert_invalid row, :body, ""
    assert_invalid row, :body, "x" * 4001
    assert_invalid row, :author, student
    assert_invalid row, :intervention, nil
  end
end
