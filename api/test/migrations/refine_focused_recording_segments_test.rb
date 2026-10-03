require "test_helper"
require Rails.root.join("db/migrate/20261003010000_refine_focused_recording_segments")

class RefineFocusedRecordingSegmentsTest < ActiveSupport::TestCase
  test "focused catalog covers every reviewed lesson with matching production sources" do
    focused = JSON.parse(File.read(Rails.root.join("config", "focused_recording_segments.json")))
    catalog = JSON.parse(File.read(Rails.root.join("config", "video_segments.json")))
    reviewed = catalog.select { |entry| entry.fetch("review_method") == RefineFocusedRecordingSegments::REVIEW_METHOD }

    assert_equal 33, focused.length
    assert_equal focused.map { |entry| entry.fetch("lesson_id") }.sort, reviewed.map { |entry| entry.fetch("lesson_id") }.sort
    assert_equal focused.map { |entry| entry.fetch("lesson_id") }.uniq.length, focused.length
    focused.each do |entry|
      match = reviewed.find { |candidate| candidate.fetch("lesson_id") == entry.fetch("lesson_id") }
      assert_equal entry.fetch("source_id"), match.fetch("source_id")
      assert_equal entry.fetch("video_segments"), match.fetch("video_segments")
      assert_equal entry.fetch("video_segments"), VideoSegmentSet.normalize(entry.fetch("video_segments"))
    end
  end

  test "migration updates only matching older metadata and restores it on rollback" do
    lesson = create_lesson
    matching = ContentBlock.create!(lesson: lesson, block_type: :recording, position: 0, title: "Matching", video_url: "https://youtube.com/watch?v=focused", metadata: { "notes" => "keep", "video_segments_version" => 1, "video_segments" => old_segments })
    wrong_source = ContentBlock.create!(lesson: lesson, block_type: :recording, position: 1, title: "Wrong", video_url: "https://youtube.com/watch?v=other", metadata: { "video_segments_version" => 1, "video_segments" => old_segments })
    newer = ContentBlock.create!(lesson: lesson, block_type: :video, position: 2, title: "Newer", video_url: "https://youtube.com/watch?v=newer", metadata: { "video_segments_version" => 3, "video_segments" => old_segments })
    instructions = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 3, title: "Practice", body: "**Goal:** Learn it.\n\n**Watch:** 39:03–50:00 and 1:56:00–2:40:15. Keep this explanation.\n\n**Exercise:** Build it.", metadata: { "notes" => "keep" })
    migration = migration_with_catalog([
      entry_for(matching, "focused"),
      entry_for(wrong_source, "expected"),
      entry_for(newer, "newer")
    ])

    migration.migrate(:up)

    assert_equal 2, matching.reload.metadata.fetch("video_segments_version")
    assert_equal "Focused lesson", matching.metadata.fetch("video_segments").first.fetch("label")
    assert_equal "keep", matching.metadata.fetch("notes")
    assert_equal 1, wrong_source.reload.metadata.fetch("video_segments_version")
    assert_equal 3, newer.reload.metadata.fetch("video_segments_version")
    assert_includes instructions.reload.body, RefineFocusedRecordingSegments::REVIEWED_INSTRUCTION
    refute_includes instructions.body, "2:40:15"
    assert_includes instructions.body, "Keep this explanation."
    assert_equal "keep", instructions.metadata.fetch("notes")
    assert instructions.metadata.key?(RefineFocusedRecordingSegments::INSTRUCTION_OWNERSHIP_KEY)

    migration.migrate(:down)

    assert_equal 1, matching.reload.metadata.fetch("video_segments_version")
    assert_equal old_segments, matching.metadata.fetch("video_segments")
    assert_equal "keep", matching.metadata.fetch("notes")
    assert_includes instructions.reload.body, "39:03–50:00 and 1:56:00–2:40:15. Keep this explanation."
    refute instructions.metadata.key?(RefineFocusedRecordingSegments::INSTRUCTION_OWNERSHIP_KEY)
  end

  private

  def create_lesson
    curriculum = Curriculum.create!(name: "Focused recording migration curriculum")
    curriculum_module = CurriculumModule.create!(curriculum: curriculum, name: "Recordings", position: 0, day_offset: 0, schedule_days: "weekdays")
    Lesson.create!(curriculum_module: curriculum_module, title: "Recording", position: 0, release_day: 0)
  end

  def old_segments
    [ { "label" => "Old", "start_seconds" => 0, "end_seconds" => 10, "required" => true } ]
  end

  def entry_for(block, source_id)
    {
      "content_block_id" => block.id,
      "source_id" => source_id,
      "review_method" => RefineFocusedRecordingSegments::REVIEW_METHOD,
      "video_segments" => [ { "label" => "Focused lesson", "start_seconds" => 10, "end_seconds" => 20, "required" => true } ]
    }
  end

  def migration_with_catalog(catalog)
    instruction_lesson_id = ContentBlock.find(catalog.first.fetch("content_block_id")).lesson_id
    RefineFocusedRecordingSegments.new.tap do |migration|
      migration.define_singleton_method(:focused_catalog) { catalog }
      migration.define_singleton_method(:instruction_ranges) { { instruction_lesson_id => "39:03–50:00 and 1:56:00–2:40:15" } }
    end
  end
end
