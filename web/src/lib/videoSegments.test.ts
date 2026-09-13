import { describe, expect, it } from 'vitest'
import { firstRequiredSegmentStart, formatVideoTimestamp, normalizeVideoSegments, playbackStart } from './videoSegments'

describe('video segments', () => {
  const metadata = {
    video_segments: [
      { label: 'Optional context', start_seconds: 10, end_seconds: 20, required: false },
      { label: 'Required lesson', start_seconds: 30, end_seconds: 75, required: true },
      { label: '', start_seconds: 80, end_seconds: 70 },
    ],
  }

  it('normalizes valid authored ranges and ignores malformed entries', () => {
    expect(normalizeVideoSegments(metadata)).toEqual([
      { label: 'Optional context', start_seconds: 10, end_seconds: 20, required: false },
      { label: 'Required lesson', start_seconds: 30, end_seconds: 75, required: true },
    ])
  })

  it('starts with the first required segment', () => {
    expect(firstRequiredSegmentStart(normalizeVideoSegments(metadata))).toBe(30)
  })

  it('rejects fractional ranges instead of collapsing them into invalid whole-second ranges', () => {
    expect(normalizeVideoSegments({ video_segments: [
      { label: 'Too short', start_seconds: 0.1, end_seconds: 0.9, required: true },
    ] })).toEqual([])
  })

  it('prefers an explicit deep link, then saved progress, then the authored start', () => {
    const segments = normalizeVideoSegments(metadata)
    expect(playbackStart(segments, 44, 62)).toBe(62)
    expect(playbackStart(segments, 44)).toBe(44)
    expect(playbackStart(segments)).toBe(30)
    expect(playbackStart(segments, 44, 0)).toBe(0)
  })

  it('formats short and long timestamps consistently', () => {
    expect(formatVideoTimestamp(75)).toBe('1:15')
    expect(formatVideoTimestamp(3675)).toBe('1:01:15')
  })
})
