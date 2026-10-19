import { Check, Clock3, Play } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { formatVideoDuration, formatVideoTimestamp, totalVideoSegmentSeconds, type VideoSegment, videoSegmentKey } from '../../lib/videoSegments'

interface VideoSegmentControlsProps {
  segments: VideoSegment[]
  onSelect: (segment: VideoSegment) => void
  activeSegment?: VideoSegment | null
  completedSegment?: VideoSegment | null
}

export function VideoSegmentControls({ segments, onSelect, activeSegment = null, completedSegment = null }: VideoSegmentControlsProps) {
  if (!segments.length) return null

  const requiredSeconds = totalVideoSegmentSeconds(segments, true)
  const totalSeconds = totalVideoSegmentSeconds(segments)
  const activeKey = activeSegment ? videoSegmentKey(activeSegment) : null
  const completedKey = completedSegment ? videoSegmentKey(completedSegment) : null

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-line bg-surface-sunken" aria-label="Recording sections">
      <div className="flex items-start gap-3 border-b border-line px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-raised text-ink-secondary">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-bold text-ink">Watch the parts that matter</h3>
          <p className="mt-0.5 text-xs leading-5 text-ink-secondary">Choose a section to jump there. Playback pauses at its reviewed end time, while the full recording remains available.</p>
          <p className="mt-1 text-xs font-semibold tabular-nums text-ink">{requiredSeconds > 0 ? `${formatVideoDuration(requiredSeconds)} core viewing` : `${formatVideoDuration(totalSeconds)} optional viewing`}</p>
        </div>
      </div>
      {completedSegment && <p className="sr-only" role="status" aria-live="polite">Finished {completedSegment.label}</p>}
      <ol className="divide-y divide-line">
        {segments.map((segment, index) => {
          const key = videoSegmentKey(segment)
          const isActive = key === activeKey
          const isCompleted = key === completedKey
          return <li key={`${key}-${index}`}>
            <button
              type="button"
              onClick={() => onSelect(segment)}
              className={`pressable group flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${isActive ? 'nav-selected bg-surface-raised' : 'hover:bg-surface-raised'}`}
              aria-label={`Play ${segment.label}, ${formatVideoTimestamp(segment.start_seconds)} to ${formatVideoTimestamp(segment.end_seconds)}${isCompleted ? ', section finished' : isActive ? ', playing this section' : ''}`}
              aria-pressed={isActive}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white ${isCompleted ? 'bg-success-700' : 'bg-ink'}`}>
                {isCompleted ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : <Play className="h-4 w-4 translate-x-px" fill="currentColor" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-5 text-ink [overflow-wrap:anywhere]">{segment.label}</span>
                <span className="mt-0.5 block font-mono text-xs font-semibold tabular-nums text-ink-secondary">
                  Start {formatVideoTimestamp(segment.start_seconds)} · stop {formatVideoTimestamp(segment.end_seconds)}
                </span>
                {(isActive || isCompleted) && <span className={`mt-1 block text-xs font-semibold ${isCompleted ? 'text-success-700' : 'text-ink'}`}>{isCompleted ? 'Section finished' : 'Playing this section'}</span>}
              </span>
              <Badge tone={segment.required ? 'info' : 'neutral'}>
                {segment.required ? 'Core' : 'Optional'}
              </Badge>
            </button>
          </li>
        })}
      </ol>
    </section>
  )
}
