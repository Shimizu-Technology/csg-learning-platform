import { useId } from 'react'
import { useLocation } from 'react-router-dom'
import { CalendarDays, Clock, PlayCircle } from 'lucide-react'
import { formatShortDate } from '../../lib/format'
import { listLinkState } from '../../lib/navigationContext'
import type { LessonDetail } from '../../types/api'
import { Badge } from '../ui/Badge'
import { LinkButton } from '../ui/Button'

export function LessonRecordings({ lesson }: { lesson: LessonDetail }) {
  const headingId = useId()
  const location = useLocation()
  if (!lesson.attached_recordings?.length) return null

  return (
    <section aria-labelledby={headingId} className="app-surface p-4 sm:p-5">
      <h2 id={headingId} className="mb-2 flex items-center gap-2 text-base font-semibold text-ink">
        <PlayCircle className="size-5 shrink-0 text-ink-muted" aria-hidden="true" />
        Class recordings
      </h2>
      <ul className="divide-y divide-line">
        {lesson.attached_recordings.map((recording) => {
          const started = recording.progress_percentage > 0
          const action = recording.completed ? 'Watch again' : started ? 'Resume recording' : 'Watch recording'
          return (
            <li key={recording.id} className="flex flex-col gap-3 py-3 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{recording.title}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-secondary">
                  {recording.recorded_date && <span className="inline-flex items-center gap-1">
                    <CalendarDays className="size-3.5 shrink-0" aria-hidden="true" />
                    {formatShortDate(recording.recorded_date)}
                  </span>}
                  {recording.duration_display && <Badge icon={<Clock className="size-3" aria-hidden="true" />}>{recording.duration_display}</Badge>}
                  <Badge tone={recording.completed ? 'success' : 'neutral'}>
                    {recording.completed ? 'Watched' : started ? `${Math.round(recording.progress_percentage)}% watched` : 'Unwatched'}
                  </Badge>
                </div>
              </div>
              <LinkButton to={recording.path} state={listLinkState(location, lesson.title)} variant="secondary" className="self-start sm:shrink-0 sm:self-auto" aria-label={`${action}: ${recording.title}`}>
                {action}
              </LinkButton>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
