import type { VideoSegment } from './video-segments'

export type PlaybackSample = (from: number, to: number, watched: number) => void

export function sectionRange(segment: VideoSegment) {
  return `${segment.start_seconds}:${segment.end_seconds}`
}

// Embedded/native players do not always emit a seek event. Constrain their
// sampled playback to the media time that could have passed between reports.
export function observedSectionSeconds(watched: number, elapsed: number, rate: number) {
  return elapsed <= 1 && watched <= elapsed * rate + 0.15 ? watched : 0
}

// The playhead can cross the end on a seek. Only consecutive playback
// samples can advance the covered edge of the selected range.
export class SectionWatch {
  private covered: number
  readonly segment: VideoSegment

  constructor(segment: VideoSegment) {
    this.segment = segment
    this.covered = segment.start_seconds
  }

  observe(from: number, to: number, watched: number) {
    if (watched > 0 && from <= this.covered + 0.05) this.covered = Math.max(this.covered, to)
  }

  get finished() {
    return this.covered >= this.segment.end_seconds
  }
}
