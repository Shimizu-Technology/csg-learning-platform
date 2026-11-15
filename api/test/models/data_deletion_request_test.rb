require_relative "../support/model_coverage"

class DataDeletionRequestTest < ModelCoverageTestCase
  test "status transitions require a documented resolution and terminal states cannot reopen" do
    row = DataDeletionRequest.create!(user: student)
    assert row.status_pending?
    assert_not row.update(status: :completed, retention_note: "Deleted")
    row.reload.update!(status: :processing)
    assert_not row.update(status: :completed, retention_note: "")
    row.reload.update!(status: :completed, retention_note: "Synthetic data deleted")
    assert_not row.update(status: :pending)
    assert_equal "completed", row.reload.status
    open_row = DataDeletionRequest.create!(user: student)
    assert_database_rejects row, { status: :processing }, ActiveRecord::RecordNotUnique, constraint: "index_one_open_deletion_request_per_user"
    open_row.update!(status: :declined, retention_note: "Retain required audit")
    assert open_row.reload.status_declined?
  end
end
