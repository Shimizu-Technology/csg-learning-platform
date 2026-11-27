export interface VoiceDraftReview {
  rawText: string
  suggestedText: string
  prefix: string
  suffix: string
}

export const PREFERRED_AUDIO_MIME_TYPES = [
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/ogg',
] as const

export function pickSupportedAudioMimeType(
  isTypeSupported?: (mimeType: string) => boolean,
): string {
  const check =
    isTypeSupported ??
    (typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
      ? (mimeType: string) => MediaRecorder.isTypeSupported(mimeType)
      : undefined)
  if (!check) return ''

  for (const mimeType of PREFERRED_AUDIO_MIME_TYPES) {
    try {
      if (check(mimeType)) return mimeType
    } catch {
      // Ignore browser-specific errors from probing MIME types.
    }
  }
  return ''
}

export function voiceRecordingFilename(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() || ''
  if (base === 'audio/mp4' || base === 'audio/m4a' || base === 'audio/x-m4a') return 'voice-draft.m4a'
  if (base === 'audio/ogg') return 'voice-draft.ogg'
  return 'voice-draft.webm'
}

export function formatVoiceDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, '0')}`
}

export function insertVoiceDraft(draft: string, selection: { start: number; end: number }, text: string) {
  const start = Math.max(0, Math.min(selection.start, draft.length))
  const end = Math.max(start, Math.min(selection.end, draft.length))
  const prefix = draft.slice(0, start)
  const suffix = draft.slice(end)
  const multiline = text.includes('\n')
  const leading = prefix ? (multiline ? (/\n\n$/.test(prefix) ? '' : '\n\n') : (/\s$/.test(prefix) ? '' : ' ')) : ''
  const trailing = suffix ? (multiline ? (/^\n\n/.test(suffix) ? '' : '\n\n') : (/^\s/.test(suffix) ? '' : ' ')) : ''
  const inserted = `${leading}${text}${trailing}`
  return {
    value: `${prefix}${inserted}${suffix}`,
    selection: { start: prefix.length + inserted.length, end: prefix.length + inserted.length },
    prefix: `${prefix}${leading}`,
    suffix: `${trailing}${suffix}`,
  }
}

export function voiceDraftSegment(draft: string, review: VoiceDraftReview) {
  if (!draft.startsWith(review.prefix) || !draft.endsWith(review.suffix)) return null
  return draft.slice(review.prefix.length, draft.length - review.suffix.length || undefined)
}

export function restoreRawVoiceDraft(draft: string, review: VoiceDraftReview) {
  const current = voiceDraftSegment(draft, review)
  if (current === null) return null
  const value = `${review.prefix}${review.rawText}${review.suffix}`
  const cursor = review.prefix.length + review.rawText.length
  return { value, selection: { start: cursor, end: cursor } }
}

export function voiceDraftWithinLimit(value: string, maximum?: number) {
  return maximum === undefined || Array.from(value).length <= maximum
}

export function voiceEditDistanceBucket(review: VoiceDraftReview, draft: string): 'none' | 'light' | 'substantial' {
  const current = voiceDraftSegment(draft, review)
  if (current === null) return 'substantial'
  const original = normalize(review.suggestedText)
  const edited = normalize(current)
  if (original === edited) return 'none'
  if (!original || !edited) return 'substantial'
  const originalWords = original.split(' ')
  const editedWords = edited.split(' ')
  const shared = originalWords.filter((word) => editedWords.includes(word)).length
  const ratio = shared / Math.max(originalWords.length, editedWords.length)
  return ratio >= 0.75 ? 'light' : 'substantial'
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}
