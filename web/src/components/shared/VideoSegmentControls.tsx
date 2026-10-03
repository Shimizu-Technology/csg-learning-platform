import { Check, Clock3, Play } from 'lucide-react'
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
    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/80" aria-label="Recording sections">
      <div className="flex items-start gap-3 border-b border-slate-200 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-primary-700 shadow-sm">
          <Clock3 className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-extrabold text-slate-950">Watch the parts that matter</h3>
          <p className="mt-0.5 text-xs leading-5 text-slate-500">Choose a section to jump there. Playback pauses at its reviewed end time, while the full recording remains available.</p>
          <p className="mt-1 text-xs font-bold text-primary-700">{requiredSeconds > 0 ? `${formatVideoDuration(requiredSeconds)} core viewing` : `${formatVideoDuration(totalSeconds)} optional viewing`}</p>
        </div>
      </div>
      {completedSegment && <p className="sr-only" role="status" aria-live="polite">Finished {completedSegment.label}</p>}
      <ol className="divide-y divide-slate-200">
        {segments.map((segment, index) => {
          const key = videoSegmentKey(segment)
          const isActive = key === activeKey
          const isCompleted = key === completedKey
          return <li key={`${key}-${index}`}>
            <button
              type="button"
              onClick={() => onSelect(segment)}
              className={`group flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 ${isActive ? 'bg-white ring-1 ring-inset ring-primary-200' : 'hover:bg-white'}`}
              aria-label={`Play ${segment.label}, ${formatVideoTimestamp(segment.start_seconds)} to ${formatVideoTimestamp(segment.end_seconds)}${isCompleted ? ', section finished' : isActive ? ', playing this section' : ''}`}
              aria-pressed={isActive}
            >
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-transform duration-150 group-hover:scale-105 ${isCompleted ? 'bg-success-600' : 'bg-primary-600'}`}>
                {isCompleted ? <Check className="h-4 w-4" strokeWidth={3} aria-hidden="true" /> : <Play className="h-4 w-4 translate-x-px" fill="currentColor" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold leading-5 text-slate-900">{segment.label}</span>
                <span className="mt-0.5 block font-mono text-xs font-semibold tabular-nums text-slate-500">
                  Start {formatVideoTimestamp(segment.start_seconds)} · stop {formatVideoTimestamp(segment.end_seconds)}
                </span>
                {(isActive || isCompleted) && <span className={`mt-1 block text-xs font-bold ${isCompleted ? 'text-success-700' : 'text-primary-700'}`}>{isCompleted ? 'Section finished' : 'Playing this section'}</span>}
              </span>
              <span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide ${segment.required ? 'bg-primary-50 text-primary-700' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>
                {segment.required ? 'Core' : 'Optional'}
              </span>
            </button>
          </li>
        })}
      </ol>
    </section>
  )
}
