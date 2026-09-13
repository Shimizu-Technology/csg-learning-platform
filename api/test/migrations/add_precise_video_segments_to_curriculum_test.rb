require "test_helper"
require Rails.root.join("db/migrate/20260914010000_add_precise_video_segments_to_curriculum")

class AddPreciseVideoSegmentsToCurriculumTest < ActiveSupport::TestCase
  test "catalog maps every production recording block once with valid exact ranges" do
    catalog = JSON.parse(File.read(Rails.root.join("config", "video_segments.json")))

    assert_equal 209, catalog.length
    assert_equal catalog.length, catalog.map { |entry| entry.fetch("content_block_id") }.uniq.length
    assert catalog.all? { |entry| entry.fetch("video_segments").present? }
    catalog.each do |entry|
      assert_equal entry.fetch("video_segments"), VideoSegmentSet.normalize(entry.fetch("video_segments"))
    end
  end

  test "migration persists matching catalog sections without overwriting newer metadata" do
    lesson = create_lesson
    matching = ContentBlock.create!(lesson: lesson, block_type: :video, position: 0, title: "Matching", video_url: "https://vimeo.com/12345", metadata: { "notes" => "keep" })
    newer = ContentBlock.create!(lesson: lesson, block_type: :recording, position: 1, title: "Newer", video_url: "https://vimeo.com/67890", metadata: { "video_segments_version" => 2, "video_segments" => [ { "label" => "Newer", "start_seconds" => 1, "end_seconds" => 2, "required" => true } ] })
    migration = migration_with_catalog([
      entry_for(matching, "12345"),
      entry_for(newer, "67890")
    ])

    migration.migrate(:up)

    matching.reload
    newer.reload
    assert_equal 1, matching.metadata.fetch("video_segments_version")
    assert_equal "Core lesson", matching.metadata.fetch("video_segments").first.fetch("label")
    assert_equal "keep", matching.metadata.fetch("notes")
    assert matching.metadata.key?(AddPreciseVideoSegmentsToCurriculum::OWNERSHIP_KEY)
    assert_equal 2, newer.metadata.fetch("video_segments_version")
    assert_equal "Newer", newer.metadata.fetch("video_segments").first.fetch("label")
    refute newer.metadata.key?(AddPreciseVideoSegmentsToCurriculum::OWNERSHIP_KEY)
  end

  test "rollback restores only metadata owned by this migration" do
    lesson = create_lesson
    changed = ContentBlock.create!(lesson: lesson, block_type: :video, position: 0, title: "Changed", video_url: "https://vimeo.com/12345", metadata: { "video_segments_review_method" => "manual", "notes" => "keep" })
    existing_version = ContentBlock.create!(lesson: lesson, block_type: :video, position: 1, title: "Existing", video_url: "https://vimeo.com/67890", metadata: { "video_segments_version" => 1, "video_segments" => [ { "label" => "Existing", "start_seconds" => 2, "end_seconds" => 3, "required" => true } ] })
    migration = migration_with_catalog([
      entry_for(changed, "12345"),
      entry_for(existing_version, "67890")
    ])

    migration.migrate(:up)
    migration.migrate(:down)

    changed.reload
    existing_version.reload
    assert_equal({ "video_segments_review_method" => "manual", "notes" => "keep" }, changed.metadata)
    assert_equal 1, existing_version.metadata.fetch("video_segments_version")
    assert_equal "Existing", existing_version.metadata.fetch("video_segments").first.fetch("label")
  end

  private

  def create_lesson
    curriculum = Curriculum.create!(name: "Timestamp migration curriculum")
    curriculum_module = CurriculumModule.create!(curriculum: curriculum, name: "Recordings", position: 0, day_offset: 0, schedule_days: "weekdays")
    Lesson.create!(curriculum_module: curriculum_module, title: "Recording", position: 0, release_day: 0)
  end

  def entry_for(block, source_id)
    {
      "content_block_id" => block.id,
      "source_id" => source_id,
      "review_method" => "test_review",
      "video_segments" => [ { "label" => "Core lesson", "start_seconds" => 10, "end_seconds" => 20, "required" => true } ]
    }
  end

  def migration_with_catalog(catalog)
    AddPreciseVideoSegmentsToCurriculum.new.tap do |migration|
      migration.define_singleton_method(:catalog) { catalog }
    end
  end
end
