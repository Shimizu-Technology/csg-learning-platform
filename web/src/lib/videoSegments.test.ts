import { describe, expect, it } from 'vitest'
import { firstRequiredSegmentStart, formatVideoDuration, formatVideoTimestamp, normalizeVideoSegments, playbackStart, totalVideoSegmentSeconds, videoSegmentKey } from './videoSegments'

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

  it('summarizes viewing time without double-counting overlapping ranges', () => {
    const segments = [
      { label: 'One', start_seconds: 0, end_seconds: 90, required: true },
      { label: 'Overlap', start_seconds: 60, end_seconds: 120, required: true },
      { label: 'Optional', start_seconds: 180, end_seconds: 205, required: false },
    ]

    expect(totalVideoSegmentSeconds(segments, true)).toBe(120)
    expect(totalVideoSegmentSeconds(segments)).toBe(145)
    expect(formatVideoDuration(120)).toBe('2 min')
    expect(formatVideoDuration(3_661)).toBe('1 hr 2 min')
    expect(videoSegmentKey(segments[0])).toBe('0:90:One')
  })
})
