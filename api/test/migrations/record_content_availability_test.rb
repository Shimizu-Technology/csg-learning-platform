require "test_helper"
require Rails.root.join("db/migrate/20261114170000_record_content_availability").to_s

class RecordContentAvailabilityTest < ActiveSupport::TestCase
  test "legacy availability is backfilled once and later edits do not move it" do
    timestamp = 3.days.ago.change(usec: 0)
    curriculum = Curriculum.create!(name: "Legacy resources")
    cohort = Cohort.create!(curriculum: curriculum, name: "Legacy resources", start_date: Date.current)
    mod = curriculum.modules.create!(name: "Legacy assignment", position: 0)
    lesson = mod.lessons.create!(title: "Assigned before pause", position: 0, release_day: 0)
    user = User.create!(clerk_id: "legacy_assignment", email: "legacy-assignment@example.com", role: :student)
    enrollment = Enrollment.create!(cohort: cohort, user: user, status: :paused)
    module_assignment = enrollment.module_assignments.create!(curriculum_module: mod)
    module_assignment.update_columns(availability_changed_at: nil, updated_at: timestamp)
    active_user = User.create!(clerk_id: "active_assignment", email: "active-assignment@example.com", role: :student)
    active_enrollment = Enrollment.create!(cohort: cohort, user: active_user)
    active_assignment = active_enrollment.lesson_assignments.create!(lesson: lesson)
    assignment = enrollment.lesson_assignments.create!(lesson: lesson, unlocked: true)
    assignment.update_columns(availability_changed_at: nil, updated_at: timestamp)
    cohort.update_columns(settings: { "class_resources" => [ { "title" => "Old link", "url" => "https://example.com/old" }, { "title" => "Second link", "url" => "https://example.com/second", "available_at" => timestamp.iso8601 } ], "recordings" => [ { "title" => "Legacy replay", "url" => "https://example.com/replay", "date" => "2026-01-01" }, { "title" => "Second replay", "url" => "https://example.com/second-replay", "date" => "2026-01-02" } ] }, updated_at: timestamp)
    recording = cohort.recordings.create!(title: "Past recording", source_kind: "external", source_url: "https://example.com/video", status: :published)
    recording.update_columns(published_at: nil, updated_at: timestamp)
    resource = curriculum.curriculum_resources.create!(title: "Past ZIP", filename: "past.zip", file_size: 123,
      s3_key: "course_resources/legacy/past.zip", upload_key: "course_resource_uploads/legacy/past.zip", upload_expires_at: 1.hour.from_now, ready: true)
    resource.update_columns(ready_at: nil, updated_at: timestamp)
    migration = RecordContentAvailability.new
    migration.migrate(:down)
    migration.migrate(:up)
    [ Recording, CurriculumResource, LessonAssignment, ModuleAssignment ].each(&:reset_column_information)
    assert_equal timestamp, module_assignment.reload.availability_changed_at
    assert_nil active_assignment.reload.availability_changed_at
    assert_equal timestamp, assignment.reload.availability_changed_at
    assert_equal timestamp, recording.reload.published_at
    assert_equal timestamp, resource.reload.ready_at
    assert_equal [ "Old link", "Second link" ], cohort.reload.settings.fetch("class_resources").map { |item| item["title"] }
    assert_equal [ "Legacy replay", "Second replay" ], cohort.settings.fetch("recordings").map { |item| item["title"] }
    link_date = cohort.reload.settings.fetch("class_resources").first.fetch("available_at")
    assert_equal timestamp, Time.iso8601(link_date)
    assert_equal timestamp, Time.iso8601(cohort.settings.fetch("recordings").first.fetch("available_at"))
    # Down/up preserves JSON order and existing availability metadata on repeat runs.
    links = cohort.settings.slice("class_resources", "recordings")
    migration.migrate(:down)
    migration.migrate(:up)
    [ Recording, CurriculumResource, LessonAssignment, ModuleAssignment ].each(&:reset_column_information)
    assert_equal links, cohort.reload.settings.slice("class_resources", "recordings")
    module_assignment.touch
    assert_equal timestamp, module_assignment.reload.availability_changed_at
    assignment.touch
    assert_equal timestamp, assignment.reload.availability_changed_at
    recording.update!(title: "Renamed recording")
    resource.update!(title: "Renamed ZIP")
    cohort.update!(settings: cohort.settings.merge("other_setting" => true))
    assert_equal timestamp, recording.reload.published_at
    assert_equal timestamp, resource.reload.ready_at
    assert_equal link_date, cohort.reload.settings.fetch("class_resources").first.fetch("available_at")
  ensure
    [ Recording, CurriculumResource, LessonAssignment, ModuleAssignment ].each(&:reset_column_information)
  end
end
