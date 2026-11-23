require "test_helper"

class LessonVideoSectionCreditTest < ActiveSupport::TestCase
  test "invalid metadata earns no ranges" do
    sections, source = sections_for([ { label: "Invalid", start_seconds: 10, end_seconds: 8 } ])
    progress = Progress.new(video_total_watched: 20)
    sections.record(progress, source: source, reported: [ "8:10" ], reported_total: progress.video_total_watched, duration: 20)
    refute sections.core?
    assert_empty sections.completed(progress)
  end

  test "a range ending beyond the stored duration will not earn credit" do
    sections, source = sections_for([ { label: "Too long", start_seconds: 3, end_seconds: 22, required: true } ])
    progress = Progress.new(video_total_watched: 20)
    sections.record(progress, source: source, reported: [ "3:22" ], reported_total: progress.video_total_watched, duration: 20)
    assert sections.core?
    assert_empty sections.completed(progress)
    refute sections.core_complete?(progress, duration: 20)
  end

  test "the same timestamp range can serve a Core and Optional label" do
    segments = [
      { label: "Core", start_seconds: 5, end_seconds: 15, required: true },
      { label: "Context", start_seconds: 5, end_seconds: 15, required: false }
    ]
    sections, source = sections_for(segments)
    progress = Progress.new(video_total_watched: 10)
    sections.record(progress, source: source, reported: [ "5:15", "5:15" ], reported_total: progress.video_total_watched, duration: 60)
    assert_equal({ source => [ "5:15" ] }, sections.completed(progress))
    assert sections.core_complete?(progress, duration: 60)
  end

  private

  def sections_for(segments)
    block = ContentBlock.new(block_type: :video, metadata: { video_segments: segments }, s3_video_key: "synthetic.mp4")
    sections = LessonVideoSections.new(block)
    [ sections, sections.sources.fetch("default") ]
  end
end
