require_relative "../support/model_coverage"

class WatchProgressTest < ModelCoverageTestCase
  test "completion begins at ninety percent is sticky and percentage is capped" do
    row = WatchProgress.create!(user: student, recording: recording, duration_seconds: 100, total_watched_seconds: 89)
    assert_not row.completed?
    assert_equal 89.0, row.progress_percentage
    row.update!(total_watched_seconds: 90)
    assert row.reload.completed?
    row.update!(total_watched_seconds: 0)
    assert row.reload.completed?
    row.update!(total_watched_seconds: 200)
    assert_equal 100.0, row.progress_percentage
    row.duration_seconds = 0
    assert_equal 0, row.progress_percentage
    assert_invalid row, :last_position_seconds, -1
    assert_invalid row, :total_watched_seconds, -1
    assert_not row.dup.valid?
    other = WatchProgress.create!(user: person, recording: recording)
    assert_database_rejects other, { user_id: student.id }, ActiveRecord::RecordNotUnique
    recording.destroy!
    assert_not WatchProgress.exists?(row.id)
  end
end
