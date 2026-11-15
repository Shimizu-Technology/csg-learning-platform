/** Seek jumps earn zero. Background playback earns its observed media delta;
 * pause earns zero. Ended moves the resume point only, never watched credit.
 * The API independently bounds all reports using its own clock. */
export function creditedPlaybackSeconds(input: {
  previousTime: number;
  currentTime: number;
  elapsedWallSeconds: number;
  playbackRate: number;
  playing: boolean;
}) {
  if (![input.previousTime, input.currentTime, input.elapsedWallSeconds, input.playbackRate].every(Number.isFinite)) return 0;
  if (!input.playing || input.elapsedWallSeconds <= 0) return 0;
  const mediaDelta = input.currentTime - input.previousTime;
  if (mediaDelta <= 0) return 0;
  const plausible = input.elapsedWallSeconds * Math.max(input.playbackRate, 1) + 0.75;
  return mediaDelta <= plausible ? mediaDelta : 0;
}

export function normalizedProgress(position: number, totalWatched: number, duration: number, ended = false) {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  const safeDuration = Math.floor(duration);
  return {
    last_position_seconds: Math.min(safeDuration, Math.max(0, Math.floor(ended ? duration : position))),
    total_watched_seconds: Math.min(safeDuration, Math.max(0, Math.floor(totalWatched))),
    duration_seconds: safeDuration,
  };
}

