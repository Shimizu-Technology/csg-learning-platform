import { firstCoreSegmentStart, formatVideoDuration, formatVideoTimestamp, isVideoSegmentSeekPosition, normalizeVideoSegments, segmentPlaybackStart, totalVideoSegmentSeconds, videoSegmentKey } from '../video-segments';

describe('video segments', () => {
  const segments = normalizeVideoSegments({ video_segments: [
    { label: 'Optional intro', start_seconds: 5, end_seconds: 10, required: false },
    { label: 'Core lesson', start_seconds: 30, end_seconds: 90, required: true },
  ] });

  it('normalizes sections and finds the first core section', () => {
    expect(segments).toHaveLength(2);
    expect(firstCoreSegmentStart(segments)).toBe(30);
  });

  it('rejects fractional ranges instead of collapsing them into invalid whole-second ranges', () => {
    expect(normalizeVideoSegments({ video_segments: [
      { label: 'Too short', start_seconds: 0.1, end_seconds: 0.9, required: true },
    ] })).toEqual([]);
  });

  it('prefers saved progress and formats exact times', () => {
    expect(segmentPlaybackStart(segments, 42)).toBe(42);
    expect(segmentPlaybackStart(segments)).toBe(30);
    expect(formatVideoTimestamp(3723)).toBe('1:02:03');
  });

  it('summarizes focused viewing without double-counting overlaps', () => {
    const ranges = [
      { label: 'One', start_seconds: 0, end_seconds: 90, required: true },
      { label: 'Overlap', start_seconds: 60, end_seconds: 120, required: true },
      { label: 'Optional', start_seconds: 180, end_seconds: 205, required: false },
    ];
    expect(totalVideoSegmentSeconds(ranges, true)).toBe(120);
    expect(totalVideoSegmentSeconds(ranges)).toBe(145);
    expect(formatVideoDuration(3_661)).toBe('1 hr 2 min');
    expect(videoSegmentKey(ranges[0])).toBe('0:90:One');
  });

  it('does not arm an earlier section until its seek takes effect', () => {
    const earlier = { label: 'Earlier', start_seconds: 10, end_seconds: 70, required: true };

    expect(isVideoSegmentSeekPosition(300, earlier)).toBe(false);
    expect(isVideoSegmentSeekPosition(10, earlier)).toBe(true);
  });
});
