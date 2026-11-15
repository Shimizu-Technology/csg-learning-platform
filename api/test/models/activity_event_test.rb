require_relative "../support/model_coverage"

class ActivityEventTest < ModelCoverageTestCase
  test "record helper captures actor subject evidence and paired reference" do
    row = ActivityEvent.record!(event_type: "submission_created", actor: staff, subject_user: student, cohort: course, record: submission)
    assert_equal staff, row.actor
    assert_equal student, row.subject_user
    assert_equal "Submission", row.record_type
    assert_equal submission.id, row.record_id
    assert_equal "server_record", row.evidence
    assert_invalid row, :event_type, "invented"
    assert_invalid row, :evidence, "invented"
    assert_invalid row, :record_id, -1
    assert_invalid row, :record_type, nil
    later = ActivityEvent.record!(event_type: "account_signed_in", actor: student)
    assert_equal later, ActivityEvent.newest_first.first
  end
end
