export interface VideoSegment {
  label: string
  start_seconds: number
  end_seconds: number
  required: boolean
}

const MAX_SEGMENTS = 40

export function normalizeVideoSegments(metadata: Record<string, unknown> | null | undefined): VideoSegment[] {
  const raw = metadata?.video_segments
  if (!Array.isArray(raw)) return []

  return raw.slice(0, MAX_SEGMENTS).flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const value = candidate as Record<string, unknown>
    const label = typeof value.label === 'string' ? value.label.trim() : ''
    const start = Number(value.start_seconds)
    const end = Number(value.end_seconds)
    if (!label || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return []
    return [{
      label,
      start_seconds: start,
      end_seconds: end,
      required: value.required !== false,
    }]
  }).sort((left, right) => left.start_seconds - right.start_seconds)
}

export function firstRequiredSegmentStart(segments: VideoSegment[]) {
  return (segments.find((segment) => segment.required) || segments[0])?.start_seconds || 0
}

export function formatVideoTimestamp(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(whole / 3600)
  const minutes = Math.floor((whole % 3600) / 60)
  const remaining = whole % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}

export function playbackStart(segments: VideoSegment[], savedPosition = 0, deepLinkedPosition: number | null = null) {
  if (deepLinkedPosition !== null && Number.isFinite(deepLinkedPosition) && deepLinkedPosition >= 0) return Math.floor(deepLinkedPosition)
  if (savedPosition > 0) return Math.floor(savedPosition)
  return firstRequiredSegmentStart(segments)
}
