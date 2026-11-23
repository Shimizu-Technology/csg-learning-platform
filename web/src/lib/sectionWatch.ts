import type { VideoSegment } from './videoSegments'

export type PlaybackSample = (from: number, to: number, watched: number) => void

export function sectionRange(segment: VideoSegment) {
  return `${segment.start_seconds}:${segment.end_seconds}`
}

// Sampled players without seek events can have sparse updates during stalls.
// Accept normal observed movement after a stall, with a fixed ceiling on
// how much movement a single unconfirmed sample can account for.
export function observedSectionSeconds(watched: number, elapsed: number, rate: number) {
  const limit = Math.min(elapsed, 2.5) * rate + 0.2
  return elapsed > 0 && watched <= limit ? watched : 0
}

export class SectionWatch {
  private intervals: [number, number][] = []

  readonly segment: VideoSegment

  constructor(segment: VideoSegment) {
    this.segment = segment
  }

  observe(from: number, to: number, watched: number) {
    const start = Math.max(from, this.segment.start_seconds)
    const end = Math.min(to, this.segment.end_seconds)
    if (!(watched > 0 && end > start)) return

    const merged: [number, number][] = []
    let interval: [number, number] = [start, end]
    for (const next of this.intervals) {
      // Media clocks can advance slightly between a sample and a state event.
      if (next[1] + 0.025 < interval[0]) merged.push(next)
      else if (interval[1] + 0.025 < next[0]) {
        merged.push(interval)
        interval = next
      } else {
        interval = [Math.min(interval[0], next[0]), Math.max(interval[1], next[1])]
      }
    }
    merged.push(interval)
    // Keep the interval that can reach the start and the most recent spans.
    this.intervals = merged.length > 128 ? [merged[0], ...merged.slice(-127)] : merged
  }

  get finished() {
    const first = this.intervals[0]
    return Boolean(first && first[0] <= this.segment.start_seconds + 0.6 && first[1] >= this.segment.end_seconds)
  }
}

export class SectionCoverage {
  private watches = new Map<string, SectionWatch>()

  constructor(segments: VideoSegment[]) {
    this.updateSegments(segments)
  }

  updateSegments(segments: VideoSegment[]) {
    this.watches = new Map(segments.map((segment) => {
      const key = sectionRange(segment)
      return [key, this.watches.get(key) ?? new SectionWatch(segment)]
    }))
  }

  observe(from: number, to: number, watched: number) {
    const finished: string[] = []
    for (const [key, watch] of this.watches) {
      if (watch.finished) continue
      watch.observe(from, to, watched)
      if (watch.finished) finished.push(key)
    }
    return finished
  }
}

// Providers can send queued samples after a requested seek. Suppress credit
// while it settles, including the landing sample. A failed or capped seek
// expires so time updates and autosave can resume at the actual playhead.
export class SeekSettlement {
  private deadline: number | null = null

  private readonly target: number

  constructor(target: number) {
    this.target = target
  }

  sample(position: number, now: number, seeking = false): 'waiting' | 'landed' | 'expired' {
    this.deadline ??= now + 2_000
    if (!seeking && Math.abs(position - this.target) <= 0.6) return 'landed'
    return now >= this.deadline ? 'expired' : 'waiting'
  }
}
