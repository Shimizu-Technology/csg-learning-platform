import { formatVideoTimestamp, type VideoSegment } from './videoSegments'

const timestampFields = ['start_seconds', 'end_seconds'] as const

export type VideoSectionDraft = Omit<VideoSegment, 'start_seconds' | 'end_seconds'> & {
  start_seconds: string | number
  end_seconds: string | number
  invalidStoredTimestamps?: (typeof timestampFields)[number][]
}

export function readVideoSectionDrafts(raw: unknown): VideoSectionDraft[] {
  if (raw == null) return []
  return (Array.isArray(raw) ? raw : [raw]).map((row) => {
    const section: Record<string, unknown> = row && typeof row === 'object' ? row : {}
    // A clock-formatted value can be valid input but is invalid in stored
    // metadata. Keep the text and ask for an explicit edit to repair it.
    const invalidStoredTimestamps = timestampFields.filter((field) => {
      const value = section[field]
      return !Array.isArray(raw) || (typeof value === 'string' && value.includes(':'))
    })
    return {
      label: typeof section.label === 'string' ? section.label : '',
      start_seconds: readTimestamp(section.start_seconds),
      end_seconds: readTimestamp(section.end_seconds),
      required: section.required !== false,
      ...(invalidStoredTimestamps.length ? { invalidStoredTimestamps } : {}),
    }
  })
}

function readTimestamp(raw: unknown): string | number {
  if (typeof raw === 'number') return raw
  if (typeof raw === 'string') return /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : raw
  return raw == null ? '' : JSON.stringify(raw)
}

export function timestampText(value: number | string) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? formatVideoTimestamp(value) : String(value)
}

export function parseSectionTimestamp(value: string | number) {
  const parts = String(value).trim().split(':')
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null
  const numbers = parts.map(Number)
  if (numbers.slice(1).some((part) => part > 59)) return null
  const seconds = numbers.reduce((total, part) => total * 60 + part, 0)
  return Number.isSafeInteger(seconds) ? seconds : null
}

export function videoSectionErrors(section: VideoSectionDraft, duration: number | null) {
  const start = parseSectionTimestamp(section.start_seconds)
  const end = parseSectionTimestamp(section.end_seconds)
  const timestampError = (field: (typeof timestampFields)[number], parsed: number | null) => {
    if (!String(section[field]).trim()) return 'Enter a timestamp.'
    if (parsed === null) return 'Use non-negative whole seconds, M:SS, or H:MM:SS.'
    if (section.invalidStoredTimestamps?.includes(field)) return 'Re-enter this timestamp to repair the saved value.'
    return undefined
  }
  return {
    label: !section.label.trim() ? 'Enter a section label.' : section.label.trim().length > 120 ? 'Use at most 120 characters.' : undefined,
    start_seconds: timestampError('start_seconds', start)
      ?? (start !== null && duration !== null && start >= duration ? `Start must be before ${formatVideoTimestamp(duration)}.` : undefined),
    end_seconds: timestampError('end_seconds', end)
      ?? (start !== null && end !== null && end <= start ? 'End must be after start.' : undefined)
      ?? (end !== null && duration !== null && end > duration ? `End must be at or before ${formatVideoTimestamp(duration)}.` : undefined),
  }
}

export function sectionPayload(drafts: VideoSectionDraft[]): VideoSegment[] {
  return drafts.map((draft) => {
    const start = parseSectionTimestamp(draft.start_seconds)
    const end = parseSectionTimestamp(draft.end_seconds)
    if (start === null || end === null || Object.values(videoSectionErrors(draft, null)).some(Boolean)) {
      throw new Error('Fix the highlighted fields in Recording sections before saving.')
    }
    return { label: draft.label.trim(), start_seconds: start, end_seconds: end, required: draft.required }
  }).sort((left, right) => left.start_seconds - right.start_seconds)
}

export function sectionDuration(block: { s3_video_key: string | null; s3_video_duration_seconds?: number | null; metadata: Record<string, unknown> }) {
  if (!block.s3_video_key) return null
  if (block.s3_video_duration_seconds && block.s3_video_duration_seconds > 0) return block.s3_video_duration_seconds
  const duration = block.metadata.video_versions_duration_seconds
  return block.s3_video_duration_seconds == null &&
    Array.isArray(block.metadata.video_versions) && block.metadata.video_versions.length > 0 &&
    typeof duration === 'number' && Number.isInteger(duration) && duration >= 1 && duration <= 28_800 ? duration : null
}
