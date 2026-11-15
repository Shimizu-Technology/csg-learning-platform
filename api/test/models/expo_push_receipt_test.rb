require_relative "../support/model_coverage"

class ExpoPushReceiptTest < ModelCoverageTestCase
  test "due receipts exclude future or leased work and order by availability and id" do
    device = MobilePushToken.create!(user: student, token: "ExponentPushToken[synthetic]", platform: "ios", last_seen_at: Time.current)
    row = ExpoPushReceipt.create!(mobile_push_token: device, receipt_id: "receipt_synthetic", available_at: Time.current)
    future = ExpoPushReceipt.create!(mobile_push_token: device, receipt_id: "future", available_at: 1.second.from_now)
    assert_equal [ row.id ], ExpoPushReceipt.due.ids
    row.update!(processing_at: Time.current)
    assert_empty ExpoPushReceipt.due
    assert_database_rejects future, { receipt_id: row.receipt_id }, ActiveRecord::RecordNotUnique, constraint: "index_expo_push_receipts_on_receipt_id"
    assert_not row.dup.valid?
    device.destroy!
    assert_not ExpoPushReceipt.exists?(row.id)
  end
end
