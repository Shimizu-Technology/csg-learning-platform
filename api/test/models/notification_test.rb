require_relative "../support/model_coverage"

class NotificationTest < ModelCoverageTestCase
  test "mark read is idempotent and unread scope excludes read notifications" do
    row = Notification.create!(user: student, notifiable: sample_message, notification_type: :message, title: "Message", path: "/channels/1")
    assert_includes Notification.unread, row
    row.mark_read!
    read_at = row.read_at
    travel 1.hour
    row.mark_read!
    assert_equal read_at, row.reload.read_at
    assert row.read?
    assert_not Notification.unread.exists?(row.id)
    assert_invalid row, :title, ""
    assert_invalid row, :path, ""
    other = Notification.create!(user: person, notifiable: sample_message, notification_type: :message, title: "Message", path: "/channels/1")
    assert_database_rejects other, { user_id: student.id }, ActiveRecord::RecordNotUnique
  end

  test "legacy path removes context only for supported destinations" do
    row = Notification.new(path: "/meetings?cohort_id=10&week=1")
    assert_equal "/meetings", row.legacy_path
    row.path = "/channels/1?message_id=5"
    assert_equal row.path, row.legacy_path
  end
end
