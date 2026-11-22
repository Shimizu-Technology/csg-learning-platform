import { useCallback, useState } from 'react'
import { BookOpen, CheckCircle2, Clock, ExternalLink, Eye, Layers3, PencilLine, PlayCircle, Users } from 'lucide-react'
import { ReturnOrigin } from '../../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../../components/shared/RelatedPanel'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Badge } from '../../../components/ui/Badge'
import { AnchorButton, Button, LinkButton } from '../../../components/ui/Button'
import { useBackLink } from '../../../lib/recordOrigin'
import { useRecordDetail } from '../../../lib/recordDetail'
import { api } from '../../../lib/api'
import { cohortPath, cohortWatchProgressPath } from '../../../lib/routes'
import { plural } from '../../../lib/recordUsage'
import { formatShortDate, formatShortDateTime } from '../../../lib/format'
import { sanitizeUrl } from '../../../lib/sanitizeUrl'
import { TERMS } from '../../../lib/glossary'
import type { RelatedRow } from '../../../lib/recordRelated'
import type { RecordingDetail } from '../../../types/api'
import { clock, DetailGate, EmptyRow, Facts, RecordLayout, Section, useRouteId } from './RecordParts'

const SOURCES: Record<string, string> = { uploaded: 'Uploaded video', youtube: 'YouTube', vimeo: 'Vimeo', loom: 'Loom', direct: 'Video link', external: 'Link' }

/** A class recording's staff page (L-5.2). Learners keep Recordings. */
export function RecordingRecord() {
  const state = useRecordDetail('recording', useRouteId())
  return <DetailGate state={state} label="recording" icon={PlayCircle} fallback={{ returnTo: '/admin/cohorts', returnLabel: 'Cohorts' }}>{(detail) => <RecordingPage key={detail.id} detail={detail} />}</DetailGate>
}

type Watcher = RecordingDetail['watchers'][number]

/**
 * The first page of watchers comes with the record; "Show more" continues
 * after the last one shown and appends the next page. The order (when each
 * learner started watching) never changes, so nobody is skipped or repeated
 * while learners keep watching. Totals come from the server, never the rows.
 */
function useMoreWatchers(detail: RecordingDetail) {
  const [rows, setRows] = useState<Watcher[]>(detail.watchers)
  const [next, setNext] = useState<number | null>(detail.watchers_next_after)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const loadMore = useCallback(async () => {
    if (!next || loading) return
    setLoading(true)
    setError(null)
    const result = await api.getRecordDetail('recording', detail.id, { watchersAfter: next })
    const page = result.data?.detail
    if (page && page.type === 'recording' && page.id === detail.id) {
      setRows((current) => {
        const seen = new Set(current.map((row) => row.student.id))
        return [...current, ...page.watchers.filter((row) => !seen.has(row.student.id))]
      })
      setNext(page.watchers_next_after)
    } else {
      setError(result.error || "Couldn't load more. Try again.")
    }
    setLoading(false)
  }, [detail.id, next, loading])
  return { rows, next, loading, error, loadMore }
}

function RecordingPage({ detail }: { detail: RecordingDetail }) {
  const { cohort } = detail
  const watchers = useMoreWatchers(detail)
  const back = useBackLink({ returnTo: cohortPath(cohort.id, 'recordings'), returnLabel: `${cohort.name} · ${TERMS.recordings}` })
  const editPath = `${cohortPath(cohort.id, 'recordings')}&edit_recording=${detail.id}`
  const rows: RelatedRow[] = [
    { key: 'cohort', icon: Layers3, label: TERMS.cohort, value: cohort.name, to: cohortPath(cohort.id) },
    { key: 'lessons', icon: BookOpen, label: 'Used in lessons', count: detail.lessons.length, onSelect: () => scrollToSection('lessons') },
    { key: 'watchers', icon: Users, label: 'Started watching', count: detail.watchers_count, onSelect: () => scrollToSection('watchers') },
    { key: 'completed', icon: CheckCircle2, label: 'Finished', count: detail.completed_count, onSelect: () => scrollToSection('watchers') },
    { key: 'progress', icon: Eye, label: 'Watch progress for the cohort', to: `${cohortWatchProgressPath(cohort.id)}?recording_id=${detail.id}` },
  ]

  return <ReturnOrigin label={`Recording · ${detail.title}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: cohort.name, to: cohortPath(cohort.id) }, { label: TERMS.recordings, to: cohortPath(cohort.id, 'recordings') }, { label: detail.title }]}
      type={<span>Recording{detail.week ? ` · Week ${detail.week}` : ''}</span>}
      title={detail.title}
      titleText={detail.title}
      status={detail.status === 'published' ? <Badge tone="success">Published</Badge> : <Badge>Draft</Badge>}
      context={<>
        <RecordLink record={{ type: 'cohort', id: cohort.id }} variant="plain" touchTarget>{cohort.name}</RecordLink>
        {detail.recorded_date && <><span aria-hidden="true">·</span><span className="tabular-nums">Recorded {formatShortDate(detail.recorded_date, '', { weekday: true })}</span></>}
        {detail.duration_display && <Badge icon={<Clock className="size-3" aria-hidden="true" />}>{detail.duration_display}</Badge>}
      </>}
      actions={<>
        {detail.url && <AnchorButton href={sanitizeUrl(detail.url)} target="_blank" rel="noopener noreferrer" size="sm"><ExternalLink className="h-4 w-4" aria-hidden="true" />Open video</AnchorButton>}
        {detail.can_edit && <LinkButton to={editPath} size="sm" variant="secondary"><PencilLine className="h-4 w-4" aria-hidden="true" />Edit</LinkButton>}
      </>}
    />

    <RecordLayout related={<RelatedPanel rows={rows} returnLabel={`Recording · ${detail.title}`} />}>
      <Section id="overview" title="About this recording">
        <Facts items={[
          { label: 'Source', value: SOURCES[detail.source] || 'Video' },
          { label: 'Week', value: detail.week ? `Week ${detail.week}` : cohort.course_delivery === 'self_paced' ? 'Self-paced (no weeks)' : 'Not dated' },
          { label: 'Added by', value: detail.uploaded_by?.name || 'Unknown' },
          { label: 'Published', value: detail.published_at ? formatShortDateTime(detail.published_at) : 'Not published' },
          detail.description ? { label: 'Description', value: <span className="whitespace-pre-wrap">{detail.description}</span> } : null,
        ]} />
      </Section>

      <Section id="lessons" title="Lessons using this recording" count={plural(detail.lessons.length, 'lesson')}>
        {detail.lessons.length ? <ul className="divide-y divide-line">
          {detail.lessons.map((row) => (
            <li key={row.block ? `block-${row.block.id}` : `lesson-${row.lesson.id}`} className="space-y-2 px-4 py-3 sm:px-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <RecordLink record={{ type: 'lesson', id: row.lesson.id, cohortId: cohort.id }} variant="plain" touchTarget className="font-semibold">{row.lesson.title}</RecordLink>
                {row.lesson.archived && <Badge>Archived</Badge>}
                <span className="text-xs text-ink-muted">
                  <RecordLink record={{ type: 'module', id: row.module.id, cohortId: cohort.id }} variant="plain" className="font-normal text-ink-muted">{row.module.name}</RecordLink>
                  {row.block?.title ? ` · ${row.block.title}` : ''}
                </span>
              </div>
              {row.sections.length ? <ol className="grid gap-1 sm:grid-cols-2" aria-label={`Sections in ${row.lesson.title}`}>
                {row.sections.map((section) => (
                  <li key={`${section.start_seconds}-${section.label}`} className="flex min-w-0 items-center gap-2 rounded-xl bg-surface-sunken px-3 py-2 text-sm">
                    <span className="shrink-0 font-mono text-xs tabular-nums text-ink-muted">{clock(section.start_seconds)}–{clock(section.end_seconds)}</span>
                    <span className="min-w-0 flex-1 truncate text-ink" title={section.label}>{section.label}</span>
                    {!section.required && <Badge>Optional</Badge>}
                  </li>
                ))}
              </ol> : row.block ? <p className="text-xs text-ink-muted">Plays the whole recording; no sections yet.</p> : <Badge>Attached recording</Badge>}
            </li>
          ))}
        </ul> : <EmptyRow>This recording has no lesson attachments or matching video blocks.</EmptyRow>}
      </Section>

      <Section id="watchers" title="Who watched" count={`${detail.watchers_count} of ${plural(detail.students_count, 'learner')}`}>
        <p className="border-b border-line px-4 py-2 text-xs text-ink-muted sm:px-5">Only staff see this, in the order learners started watching. Watch time comes from the player and doesn't show attention.</p>
        {watchers.rows.length ? <ul className="divide-y divide-line">
          {watchers.rows.map((row) => (
            <li key={row.student.id} className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 sm:px-5">
              <RecordLink record={{ type: 'student', id: row.student.id, cohortId: cohort.id, tab: 'learning' }} variant="plain" touchTarget className="min-w-0 flex-1 font-semibold">{row.student.name}</RecordLink>
              <span className="text-xs tabular-nums text-ink-muted">{row.last_watched_at ? `Last watched ${formatShortDateTime(row.last_watched_at)}` : ''}</span>
              {row.completed ? <Badge tone="success">Finished</Badge> : <Badge tone="pending">{Math.round(row.progress_percentage)}%</Badge>}
            </li>
          ))}
        </ul> : <EmptyRow>No one in <RecordLink record={{ type: 'cohort', id: cohort.id, tab: 'students' }} variant="inline">{cohort.name}</RecordLink> has started it yet.</EmptyRow>}
        {(detail.watchers_next_after || watchers.error) && watchers.rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
            <p role="status" aria-live="polite" className="text-xs tabular-nums text-ink-muted">{watchers.error || `Showing ${watchers.rows.length} of ${detail.watchers_count}`}</p>
            {watchers.next && <Button variant="secondary" size="sm" onClick={() => void watchers.loadMore()} disabled={watchers.loading} data-show-more-watchers="">{watchers.loading ? 'Loading…' : watchers.error ? 'Try again' : 'Show more'}</Button>}
          </div>
        )}
      </Section>
    </RecordLayout>
  </div></ReturnOrigin>
}

