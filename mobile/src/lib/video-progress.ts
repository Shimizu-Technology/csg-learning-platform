import type { VideoProgressInput } from './types';

export const PROGRESS_SAVE_INTERVAL_MS = 10_000;
export const STREAM_REFRESH_LEAD_MS = 10 * 60 * 1000;

export function creditedPlaybackSeconds(input: {
  previousTime: number;
  currentTime: number;
  elapsedWallSeconds: number;
  playbackRate: number;
  playing: boolean;
}) {
  if (!input.playing || input.elapsedWallSeconds <= 0) return 0;
  const mediaDelta = input.currentTime - input.previousTime;
  if (mediaDelta <= 0) return 0;
  const plausible = input.elapsedWallSeconds * Math.max(input.playbackRate, 1) + 0.75;
  return mediaDelta <= plausible ? mediaDelta : 0;
}

export function normalizedProgress(position: number, totalWatched: number, duration: number, ended = false): VideoProgressInput | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const safeDuration = Math.floor(duration);
  return {
    last_position_seconds: Math.min(safeDuration, Math.max(0, Math.floor(ended ? duration : position))),
    total_watched_seconds: Math.min(safeDuration, Math.max(0, Math.floor(ended ? Math.max(totalWatched, duration) : totalWatched))),
    duration_seconds: safeDuration,
  };
}

export function resumePosition(position: number, duration: number) {
  if (!Number.isFinite(position) || position <= 0 || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(position, Math.max(0, duration - 0.5));
}

export function streamRefreshDelay(expiresAt: string, now = Date.now()) {
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires)) return 60 * 60 * 1000;
  return Math.max(15_000, expires - now - STREAM_REFRESH_LEAD_MS);
}

export function formatVideoTime(value: number) {
  const total = Math.max(0, Math.floor(Number.isFinite(value) ? value : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
