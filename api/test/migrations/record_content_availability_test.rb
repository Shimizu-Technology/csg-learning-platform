require "test_helper"
require Rails.root.join("db/migrate/20261114170000_record_content_availability").to_s

class RecordContentAvailabilityTest < ActiveSupport::TestCase
  test "legacy availability is backfilled once and later edits do not move it" do
    timestamp = 3.days.ago.change(usec: 0)
    curriculum = Curriculum.create!(name: "Legacy resources")
    cohort = Cohort.create!(curriculum: curriculum, name: "Legacy resources", start_date: Date.current)
    cohort.update_columns(settings: { "class_resources" => [ { "title" => "Old link", "url" => "https://example.com/old" } ] }, updated_at: timestamp)
    recording = cohort.recordings.create!(title: "Past recording", source_kind: "external", source_url: "https://example.com/video", status: :published)
    recording.update_columns(published_at: nil, updated_at: timestamp)
    resource = curriculum.curriculum_resources.create!(title: "Past ZIP", filename: "past.zip", file_size: 123,
      s3_key: "course_resources/legacy/past.zip", upload_key: "course_resource_uploads/legacy/past.zip", upload_expires_at: 1.hour.from_now, ready: true)
    resource.update_columns(ready_at: nil, updated_at: timestamp)
    migration = RecordContentAvailability.new
    migration.migrate(:down)
    migration.migrate(:up)
    [ Recording, CurriculumResource ].each(&:reset_column_information)
    assert_equal timestamp, recording.reload.published_at
    assert_equal timestamp, resource.reload.ready_at
    link_date = cohort.reload.settings.fetch("class_resources").first.fetch("available_at")
    assert_equal timestamp, Time.iso8601(link_date)
    recording.update!(title: "Renamed recording")
    resource.update!(title: "Renamed ZIP")
    cohort.update!(settings: cohort.settings.merge("other_setting" => true))
    assert_equal timestamp, recording.reload.published_at
    assert_equal timestamp, resource.reload.ready_at
    assert_equal link_date, cohort.reload.settings.fetch("class_resources").first.fetch("available_at")
  ensure
    [ Recording, CurriculumResource ].each(&:reset_column_information)
  end
end
