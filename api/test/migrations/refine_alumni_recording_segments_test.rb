require "test_helper"
require Rails.root.join("db/migrate/20261003030000_refine_alumni_recording_segments")

class RefineAlumniRecordingSegmentsTest < ActiveSupport::TestCase
  test "focused alumni catalog covers every published recording with optional reviewed sections" do
    focused = JSON.parse(File.read(Rails.root.join("config", "focused_alumni_recording_segments.json")))
    catalog = JSON.parse(File.read(Rails.root.join("config", "video_segments.json")))
    reviewed = catalog.select { |entry| entry.fetch("review_method") == RefineAlumniRecordingSegments::REVIEW_METHOD }

    assert_equal 75, focused.length
    assert_equal (318..392).to_a, focused.map { |entry| entry.fetch("lesson_id") }
    assert_equal 341, focused.sum { |entry| entry.fetch("video_segments").length }
    assert_equal focused.map { |entry| entry.fetch("lesson_id") }, reviewed.map { |entry| entry.fetch("lesson_id") }

    focused.each do |entry|
      match = reviewed.find { |candidate| candidate.fetch("lesson_id") == entry.fetch("lesson_id") }
      assert_equal RefineAlumniRecordingSegments::REVIEW_METHOD, entry.fetch("review_method")
      assert_equal entry.fetch("source_id"), match.fetch("source_id")
      assert_equal entry.fetch("video_segments"), match.fetch("video_segments")
      assert_equal entry.fetch("video_segments"), VideoSegmentSet.normalize(entry.fetch("video_segments"))
      assert entry.fetch("video_segments").all? { |segment| segment.fetch("required") == false }
    end
  end

  test "catalog excludes known classroom-only material from the focused path" do
    focused = JSON.parse(File.read(Rails.root.join("config", "focused_alumni_recording_segments.json")))
    labels = focused.flat_map { |entry| entry.fetch("video_segments").pluck("label") }
    excluded = /break announcement|student work period|icebreaker|casual check-in|homework assignment|practice instructions|collaborative coding|recording logistics|troubleshooting master key/i

    assert_empty labels.grep(excluded)
    assert focused.flat_map { |entry| entry.fetch("video_segments") }.all? { |segment| segment.fetch("end_seconds") - segment.fetch("start_seconds") >= 60 }
  end

  test "migration updates matching older metadata and replaces duplicate timestamp notes" do
    lesson = create_lesson
    matching = ContentBlock.create!(lesson: lesson, block_type: :recording, position: 0, title: "Matching", video_url: "https://youtube.com/watch?v=focused", metadata: { "notes" => "keep", "video_segments_version" => 1, "video_segments" => old_segments })
    instructions = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 1, title: "Practice", body: instruction_body, metadata: { "notes" => "keep" })
    wrong_source = ContentBlock.create!(lesson: lesson, block_type: :video, position: 2, title: "Wrong", video_url: "https://youtube.com/watch?v=other", metadata: { "video_segments_version" => 1, "video_segments" => old_segments })
    migration = migration_with_catalog([ entry_for(matching, "focused"), entry_for(wrong_source, "expected") ])

    migration.migrate(:up)

    assert_equal 3, matching.reload.metadata.fetch("video_segments_version")
    assert_equal "Focused alumni lesson", matching.metadata.fetch("video_segments").first.fetch("label")
    assert_equal "keep", matching.metadata.fetch("notes")
    assert_equal 1, wrong_source.reload.metadata.fetch("video_segments_version")
    assert_includes instructions.reload.body, "Focused recording path"
    assert_includes instructions.body, RefineAlumniRecordingSegments::REVIEWED_INSTRUCTION
    refute_includes instructions.body, "Old timestamp"
    assert_includes instructions.body, "What you should be able to do"
    assert_equal "keep", instructions.metadata.fetch("notes")

    migration.define_singleton_method(:alumni_catalog) { [] }
    migration.migrate(:down)

    assert_equal 1, matching.reload.metadata.fetch("video_segments_version")
    assert_equal old_segments, matching.metadata.fetch("video_segments")
    assert_equal instruction_body, instructions.reload.body
  end

  test "migration leaves unrelated recommended viewing lists unchanged" do
    lesson = create_lesson
    matching = ContentBlock.create!(lesson: lesson, block_type: :recording, position: 0, title: "Matching", video_url: "https://youtube.com/watch?v=focused", metadata: {})
    unrelated_body = "<p><strong>Class archive:</strong> <a href=\"https://youtube.com/watch?v=focused\">Recording</a></p><h2>Recommended viewing</h2><ul><li><a href=\"https://example.com/book\">Read this book</a></li></ul>"
    unrelated = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 1, title: "Reading", body: unrelated_body, metadata: {})
    migration = migration_with_catalog([ entry_for(matching, "focused") ])

    migration.migrate(:up)

    assert_equal unrelated_body, unrelated.reload.body
    refute unrelated.metadata.key?(RefineAlumniRecordingSegments::INSTRUCTION_OWNERSHIP_KEY)
  end

  test "rollback preserves staff changes made after the migration" do
    lesson = create_lesson
    matching = ContentBlock.create!(lesson: lesson, block_type: :recording, position: 0, title: "Matching", video_url: "https://youtu.be/focused", metadata: { "video_segments_version" => 1, "video_segments" => old_segments })
    instructions = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 1, title: "Practice", body: instruction_body, metadata: {})
    migration = migration_with_catalog([ entry_for(matching, "focused") ])

    migration.migrate(:up)
    matching.update_columns(metadata: matching.reload.metadata.merge("video_segments" => staff_segments, "video_segments_version" => 4))
    instructions.update_columns(body: "<h2>Focused recording path</h2><p>Staff reviewed this after release.</p>")

    migration.migrate(:down)

    assert_equal staff_segments, matching.reload.metadata.fetch("video_segments")
    assert_equal 4, matching.metadata.fetch("video_segments_version")
    refute matching.metadata.key?(RefineAlumniRecordingSegments::OWNERSHIP_KEY)
    assert_includes instructions.reload.body, "Staff reviewed this after release"
    refute instructions.metadata.key?(RefineAlumniRecordingSegments::INSTRUCTION_OWNERSHIP_KEY)
  end

  test "migration never overwrites staff-authored sections" do
    lesson = create_lesson
    staff_authored = ContentBlock.create!(
      lesson: lesson,
      block_type: :recording,
      position: 0,
      title: "Staff authored",
      video_url: "https://youtube.com/watch?v=focused",
      metadata: {
        "video_segments_version" => VideoSegmentSet::CURRENT_VERSION,
        "video_segments_review_method" => "staff_authored",
        "video_segments" => staff_segments
      }
    )
    instructions = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 1, title: "Practice", body: instruction_body, metadata: {})
    migration = migration_with_catalog([ entry_for(staff_authored, "focused") ])

    migration.migrate(:up)

    assert_equal staff_segments, staff_authored.reload.metadata.fetch("video_segments")
    assert_equal "staff_authored", staff_authored.metadata.fetch("video_segments_review_method")
    refute staff_authored.metadata.key?(RefineAlumniRecordingSegments::OWNERSHIP_KEY)
    assert_equal instruction_body, instructions.reload.body
  end

  test "source matching compares the active recording identifier exactly" do
    migration = RefineAlumniRecordingSegments.new

    assert migration.send(:source_matches?, "https://youtube.com/watch?v=focused", "focused")
    assert migration.send(:source_matches?, "https://www.youtube-nocookie.com/embed/focused?autoplay=1", "focused")
    assert migration.send(:source_matches?, "https://player.vimeo.com/video/12345?h=private", "12345")
    refute migration.send(:source_matches?, "https://youtube.com/watch?v=other&next=focused", "focused")
  end

  private

  def create_lesson
    curriculum = Curriculum.create!(name: "Focused alumni recordings")
    curriculum_module = CurriculumModule.create!(curriculum: curriculum, name: "Alumni library", position: 0, day_offset: 0, schedule_days: "weekdays")
    Lesson.create!(curriculum_module: curriculum_module, title: "Alumni recording", position: 0, release_day: 0)
  end

  def old_segments
    [ { "label" => "Old", "start_seconds" => 0, "end_seconds" => 10, "required" => false } ]
  end

  def staff_segments
    [ { "label" => "Staff edit", "start_seconds" => 30, "end_seconds" => 45, "required" => false } ]
  end

  def instruction_body
    "<p><strong>Class archive:</strong> <a href=\"https://youtube.com/watch?v=focused\">Complete recording</a></p><h2>Recommended viewing</h2><ul><li><a href=\"https://youtube.com/watch?v=focused&amp;t=10s\">0:10–0:20</a> — Old timestamp</li></ul><h2>What you should be able to do</h2><p>Keep this section.</p>"
  end

  def entry_for(block, source_id)
    {
      "lesson_id" => block.lesson_id,
      "content_block_id" => block.id,
      "source_id" => source_id,
      "review_method" => RefineAlumniRecordingSegments::REVIEW_METHOD,
      "video_segments" => [ { "label" => "Focused alumni lesson", "start_seconds" => 10, "end_seconds" => 20, "required" => false } ]
    }
  end

  def migration_with_catalog(catalog)
    RefineAlumniRecordingSegments.new.tap do |migration|
      migration.define_singleton_method(:alumni_catalog) { catalog }
    end
  end
end
