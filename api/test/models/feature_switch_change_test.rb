require_relative "../support/model_coverage"

class FeatureSwitchChangeTest < ModelCoverageTestCase
  test "audit record requires actor but allows schoolwide changes without a cohort" do
    row = FeatureSwitchChange.create!(actor: staff, before: {}, after: {})
    assert_equal staff, row.reload.actor
    assert_nil row.cohort
    row.update!(cohort: course)
    assert_equal course, row.reload.cohort
    assert_invalid row, :actor, nil
  end
end
