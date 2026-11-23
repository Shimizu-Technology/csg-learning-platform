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

  test "overlapping Core ranges share credit while retaining each range's tolerance" do
    sections, source = sections_for([
      { label: "First", start_seconds: 0, end_seconds: 10 },
      { label: "Second", start_seconds: 5, end_seconds: 15 },
      { label: "Same footage", start_seconds: 5, end_seconds: 15 }
    ])
    progress = Progress.new(video_total_watched: 13)
    ranges = [ "5:15", "0:10", "5:15" ]
    2.times do
      assert_empty sections.record(progress, source: source, reported: ranges, reported_total: 13, duration: 60)
      assert_equal({ source => %w[5:15 0:10] }, sections.completed(progress))
      assert sections.core_complete?(progress, duration: 60)
    end
    progress.video_total_watched = 12
    refute sections.core_complete?(progress, duration: 60)
  end

  test "linked source identity matches the supported embed URL formats" do
    supported = %w[
      https://youtu.be/abcdef12345
      https://www.youtube.com/watch?feature=shared&v=abcdef12345
      https://www.youtube-nocookie.com/embed/abcdef12345
      https://youtube.com/live/abcdef12345
      https://vimeo.com/123456/abcd
      https://vimeo.com/123456/98765
      https://player.vimeo.com/video/123456?h=98765
      https://vimeo.com/channels/example/123456
    ]
    unsupported = %w[https://youtube.com/playlist?list=12345 https://example.invalid/youtube.com/embed/abcdef12345 https://vimeo.com/showcase http://vimeo.com/123456 http://youtu.be/abcdef12345]
    supported.each do |url|
      assert LessonVideoSections.new(ContentBlock.new(block_type: :recording, video_url: url)).sources.present?, url
    end
    unsupported.each do |url|
      assert_empty LessonVideoSections.new(ContentBlock.new(block_type: :recording, video_url: url)).sources, url
    end
  end

  private

  def sections_for(segments)
    block = ContentBlock.new(block_type: :video, metadata: { video_segments: segments }, s3_video_key: "synthetic.mp4")
    sections = LessonVideoSections.new(block)
    [ sections, sections.sources.fetch("default") ]
  end
end
