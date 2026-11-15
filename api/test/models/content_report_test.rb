require_relative "../support/model_coverage"

class ContentReportTest < ModelCoverageTestCase
  test "cannot report self or another authors message and open reports are unique" do
    row = ContentReport.create!(reporter: staff, reported_user: student, message: sample_message, reason: :spam)
    assert_invalid row, :reported_user, staff
    row.reported_user = person
    assert_not row.valid?
    assert row.errors[:message].any?
    row.reload
    assert_invalid row, :details, "x" * 1001
    other = ContentReport.create!(reporter: person, reported_user: student, message: sample_message, reason: :other)
    assert_database_rejects other, { reporter_id: staff.id }, ActiveRecord::RecordNotUnique
    open_report = ContentReport.create!(reporter: staff, reported_user: student, reason: :other)
    closed = ContentReport.create!(reporter: staff, reported_user: student, reason: :other, status: :dismissed)
    assert_database_rejects closed, { status: :pending }, ActiveRecord::RecordNotUnique
    open_report.update!(status: :actioned)
    closed.update!(status: :pending)
    assert closed.reload.status_pending?
  end
end
