import { firstCoreSegmentStart, formatVideoTimestamp, normalizeVideoSegments, segmentPlaybackStart } from '../video-segments';

describe('video segments', () => {
  const segments = normalizeVideoSegments({ video_segments: [
    { label: 'Optional intro', start_seconds: 5, end_seconds: 10, required: false },
    { label: 'Core lesson', start_seconds: 30, end_seconds: 90, required: true },
  ] });

  it('normalizes sections and finds the first core section', () => {
    expect(segments).toHaveLength(2);
    expect(firstCoreSegmentStart(segments)).toBe(30);
  });

  it('prefers saved progress and formats exact times', () => {
    expect(segmentPlaybackStart(segments, 42)).toBe(42);
    expect(segmentPlaybackStart(segments)).toBe(30);
    expect(formatVideoTimestamp(3723)).toBe('1:02:03');
  });
});
