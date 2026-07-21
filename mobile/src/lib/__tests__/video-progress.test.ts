import { creditedPlaybackSeconds, formatVideoTime, normalizedProgress, resumePosition, streamRefreshDelay } from '../video-progress';

describe('video progress', () => {
  test('credits real playback at the active speed and rejects seeks', () => {
    expect(creditedPlaybackSeconds({ previousTime: 5, currentTime: 6.5, elapsedWallSeconds: 1, playbackRate: 1.5, playing: true })).toBe(1.5);
    expect(creditedPlaybackSeconds({ previousTime: 5, currentTime: 50, elapsedWallSeconds: 1, playbackRate: 1, playing: true })).toBe(0);
    expect(creditedPlaybackSeconds({ previousTime: 5, currentTime: 6, elapsedWallSeconds: 1, playbackRate: 1, playing: false })).toBe(0);
  });

  test('normalizes progress and completes a played-to-end session', () => {
    expect(normalizedProgress(150, 95.8, 100)).toEqual({ last_position_seconds: 100, total_watched_seconds: 95, duration_seconds: 100 });
    expect(normalizedProgress(99, 89, 100, true)).toEqual({ last_position_seconds: 100, total_watched_seconds: 100, duration_seconds: 100 });
    expect(normalizedProgress(0, 0, 0)).toBeNull();
  });

  test('keeps resume inside the media timeline', () => {
    expect(resumePosition(25, 100)).toBe(25);
    expect(resumePosition(100, 100)).toBe(99.5);
    expect(resumePosition(-1, 100)).toBe(0);
  });

  test('refreshes signed URLs before expiry with a safe lower bound', () => {
    const now = Date.parse('2026-07-21T00:00:00Z');
    expect(streamRefreshDelay('2026-07-21T02:00:00Z', now)).toBe(110 * 60 * 1000);
    expect(streamRefreshDelay('2026-07-21T00:05:00Z', now)).toBe(15_000);
  });

  test('formats short and long durations', () => {
    expect(formatVideoTime(65)).toBe('1:05');
    expect(formatVideoTime(3665)).toBe('1:01:05');
  });
});
