require_relative "../support/model_coverage"

class MessageAttachmentTest < ModelCoverageTestCase
  test "image detection required metadata positive size and unique object keys" do
    item = MessageAttachment.create!(message: sample_message, uploaded_by: staff, s3_key: "synthetic", filename: "photo.png", content_type: "image/png", byte_size: 10)
    assert item.image?
    item.content_type = "application/pdf"
    assert_not item.image?
    assert_invalid item, :byte_size, 0
    assert_invalid item, :filename, ""
    assert_invalid item.dup, :s3_key, item.s3_key
    other = item.dup
    other.s3_key = "other"
    other.save!
    assert_database_rejects other, { s3_key: item.s3_key }, ActiveRecord::RecordNotUnique, constraint: "index_message_attachments_on_s3_key"
    staff.update_column(:role, :instructor)
    error = assert_raises(ActiveRecord::DeleteRestrictionError) { staff.destroy }
    assert_equal "Cannot delete record because of dependent message_attachments", error.message
  end
end
