export interface VideoSegment {
  label: string;
  start_seconds: number;
  end_seconds: number;
  required: boolean;
}

const MAX_SEGMENTS = 40;

export function normalizeVideoSegments(metadata: Record<string, unknown> | null | undefined): VideoSegment[] {
  const raw = metadata?.video_segments;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_SEGMENTS).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const value = candidate as Record<string, unknown>;
    const label = typeof value.label === 'string' ? value.label.trim() : '';
    const start = Number(value.start_seconds);
    const end = Number(value.end_seconds);
    if (!label || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return [];
    return [{ label, start_seconds: start, end_seconds: end, required: value.required !== false }];
  }).sort((left, right) => left.start_seconds - right.start_seconds);
}

export function firstCoreSegmentStart(segments: VideoSegment[]) {
  return (segments.find((segment) => segment.required) || segments[0])?.start_seconds || 0;
}

export function videoSegmentKey(segment: VideoSegment) {
  return `${segment.start_seconds}:${segment.end_seconds}:${segment.label}`;
}

export function totalVideoSegmentSeconds(segments: VideoSegment[], requiredOnly = false) {
  const ranges = segments
    .filter((segment) => !requiredOnly || segment.required)
    .map((segment) => [segment.start_seconds, segment.end_seconds] as const)
    .sort((left, right) => left[0] - right[0]);
  let total = 0;
  let currentStart: number | null = null;
  let currentEnd = 0;
  for (const [start, end] of ranges) {
    if (currentStart === null) {
      currentStart = start;
      currentEnd = end;
    } else if (start <= currentEnd) {
      currentEnd = Math.max(currentEnd, end);
    } else {
      total += currentEnd - currentStart;
      currentStart = start;
      currentEnd = end;
    }
  }
  return currentStart === null ? 0 : total + currentEnd - currentStart;
}

export function formatVideoDuration(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining ? `${hours} hr ${remaining} min` : `${hours} hr`;
}

export function segmentPlaybackStart(segments: VideoSegment[], savedPosition = 0) {
  return savedPosition > 0 ? Math.floor(savedPosition) : firstCoreSegmentStart(segments);
}

export function formatVideoTimestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remaining = whole % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`;
}
