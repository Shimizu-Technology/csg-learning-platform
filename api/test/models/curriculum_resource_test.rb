require_relative "../support/model_coverage"

class CurriculumResourceTest < ModelCoverageTestCase
  test "ZIP metadata limits and publication timestamp remain stable across unrelated edits" do
    row = CurriculumResource.create!(curriculum: curriculum, title: "Starter", filename: "starter.zip", file_size: 100,
      s3_key: "synthetic-key", upload_key: "synthetic-upload", upload_expires_at: 1.hour.from_now)
    assert_nil row.ready_at
    assert_invalid row, :filename, "../starter.zip"
    assert_invalid row, :file_size, 0
    assert_invalid row, :file_size, CurriculumResource::MAX_FILE_SIZE + 1
    row.update!(ready: true)
    at = row.ready_at
    assert_equal Time.current, at
    travel 1.hour
    row.update!(title: "Renamed")
    assert_equal at, row.reload.ready_at
    assert_includes CurriculumResource.ready, row
    assert_equal "file-#{row.id}", row.resource_json[:id]
    assert_not curriculum.destroy
    other = row.dup
    other.s3_key = "other-key"
    other.upload_key = "other-upload"
    other.save!
    %i[s3_key upload_key].each { |field| assert_database_rejects other, { field => row.public_send(field) }, ActiveRecord::RecordNotUnique }
  end
end
