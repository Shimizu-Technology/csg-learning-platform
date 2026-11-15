export const PROGRESS_SAVE_INTERVAL_MS = 10_000;
export const STREAM_REFRESH_LEAD_MS = 10 * 60 * 1000;

export { creditedPlaybackSeconds, normalizedProgress } from './playback-credit';

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
