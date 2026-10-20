import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Film, CheckCircle2, PlaySquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { PageHeader } from '../../components/ui/PageHeader'
import { Avatar } from '../../components/ui/Avatar'
import { TabButton } from '../../components/ui/Choice'
import { cohortStudentPath } from '../../lib/routes'

interface RecordingInfo {
  id: number
  title: string
  duration_seconds: number | null
}

interface VideoInfo {
  id: number
  title: string
  lesson_title: string
  module_title: string
  duration_seconds: number | null
}

interface CellProgress {
  progress_percentage: number
  completed: boolean
  total_watched_seconds: number
}

interface RecordingStudent {
  user_id: number
  full_name: string
  recordings: ({ recording_id: number } & CellProgress)[]
}

interface VideoStudent {
  user_id: number
  full_name: string
  videos: ({ content_block_id: number } & CellProgress)[]
}

type TabKey = 'recordings' | 'videos'

const getProgressColor = (pct: number, completed: boolean) => {
  if (completed) return 'border-success-200 bg-success-50 text-success-700'
  if (pct >= 50) return 'border-info-200 bg-info-50 text-info-800'
  if (pct > 0) return 'border-line bg-surface-sunken text-ink-secondary'
  return 'border-transparent text-ink-muted'
}

function ProgressMatrix<T extends { id: number; title: string }>({
  columns,
  rows,
  getCell,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  columnSubtitle,
  cohortId,
}: {
  columns: T[]
  rows: { user_id: number; full_name: string; cells: ({ id: number } & CellProgress)[] }[]
  getCell: (row: { cells: ({ id: number } & CellProgress)[] }, colId: number) => CellProgress | undefined
  emptyIcon: LucideIcon
  emptyTitle: string
  emptyDescription: string
  columnSubtitle?: (col: T) => string | null
  cohortId: number
}) {
  if (columns.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="app-surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-sunken">
              <th className="text-left px-4 py-3 text-xs font-semibold text-ink-secondary sticky left-0 bg-surface-sunken z-10 min-w-[180px]">
                Student
              </th>
              {columns.map((col) => {
                const subtitle = columnSubtitle?.(col)
                return (
                  <th key={col.id} className="text-center px-2 py-3 font-semibold text-ink-secondary min-w-[96px]">
                    <div className="text-xs leading-tight truncate max-w-[120px] mx-auto" title={col.title}>
                      {col.title}
                    </div>
                    {subtitle && (
                      <div className="text-xs font-normal text-ink-muted truncate max-w-[120px] mx-auto" title={subtitle}>
                        {subtitle}
                      </div>
                    )}
                  </th>
                )
              })}
              <th className="text-center px-4 py-3 text-xs font-semibold text-ink-secondary min-w-[110px]">Overall</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const completedCount = row.cells.filter((c) => {
                const cell = getCell(row, c.id)
                return cell?.completed
              }).length
              const overallPct = columns.length > 0 ? Math.round((completedCount / columns.length) * 100) : 0

              return (
                <tr key={row.user_id} className="border-b border-line transition-colors duration-150 hover:bg-surface-sunken">
                  <td className="px-4 py-1 sticky left-0 bg-surface-raised z-10 max-w-[240px]">
                    <Link to={cohortStudentPath(cohortId, row.user_id)} className="flex min-h-11 min-w-0 items-center gap-2 font-semibold text-ink hover:text-ruby-700 hover:underline" title={row.full_name}>
                      <Avatar name={row.full_name} size="sm" />
                      <span className="truncate">{row.full_name}</span>
                    </Link>
                  </td>
                  {columns.map((col) => {
                    const cell = getCell(row, col.id)
                    const pct = cell?.progress_percentage || 0
                    const completed = cell?.completed || false
                    return (
                      <td key={col.id} className="text-center px-2 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums ${getProgressColor(pct, completed)}`}
                          title={`${Math.round(pct)}% — ${Math.round((cell?.total_watched_seconds || 0) / 60)}m watched`}
                        >
                          {completed ? (
                            <>
                              <CheckCircle2 className="h-3 w-3" />
                              Done
                            </>
                          ) : pct > 0 ? (
                            `${Math.round(pct)}%`
                          ) : (
                            '—'
                          )}
                        </span>
                      </td>
                    )
                  })}
                  <td className="text-center px-4 py-2.5">
                    <div className="flex items-center gap-2 justify-center">
                      <div className="w-16 h-1.5 bg-surface-sunken rounded-full overflow-hidden">
                        <div className="h-full bg-success-600 rounded-full" style={{ width: `${overallPct}%` }} />
                      </div>
                      <span className="text-xs text-ink-secondary tabular-nums">
                        {completedCount}/{columns.length}
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function CohortWatchProgress() {
  const { id } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab: TabKey = searchParams.get('tab') === 'videos' ? 'videos' : 'recordings'
  const [tab, setTab] = useState<TabKey>(initialTab)

  const [recordings, setRecordings] = useState<RecordingInfo[]>([])
  const [recordingStudents, setRecordingStudents] = useState<RecordingStudent[]>([])
  const [videos, setVideos] = useState<VideoInfo[]>([])
  const [videoStudents, setVideoStudents] = useState<VideoStudent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [cohortName, setCohortName] = useState('')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    setLoadError(null)
    // Without a catch, a single rejected request would leave loading=true
    // forever and the page stuck on the spinner with no diagnostic. Surface
    // any partial errors via in-band `error` fields too — fetchApi rejects
    // only on network/parse failures, but a 4xx/5xx returns { error }.
    Promise.all([
      api.getCohortWatchProgress(Number(id)),
      api.getCohortLessonVideoProgress(Number(id)),
      api.getCohort(Number(id)),
    ])
      .then(([recRes, vidRes, cohortRes]) => {
        const firstError = recRes.error || vidRes.error || cohortRes.error
        if (firstError) setLoadError(firstError)
        if (recRes.data) {
          setRecordings(recRes.data.recordings || [])
          setRecordingStudents(recRes.data.students || [])
        }
        if (vidRes.data) {
          setVideos(vidRes.data.videos || [])
          setVideoStudents(vidRes.data.students || [])
        }
        if (cohortRes.data?.cohort) {
          setCohortName(cohortRes.data.cohort.name)
        }
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : 'Failed to load watch progress')
      })
      .finally(() => setLoading(false))
  }, [id])

  const handleTabChange = (next: TabKey) => {
    setTab(next)
    const params = new URLSearchParams(searchParams)
    if (next === 'videos') params.set('tab', 'videos')
    else params.delete('tab')
    setSearchParams(params, { replace: true })
  }

  const recordingRows = useMemo(
    () =>
      recordingStudents.map((s) => ({
        user_id: s.user_id,
        full_name: s.full_name,
        cells: s.recordings.map((r) => ({ id: r.recording_id, ...r })),
      })),
    [recordingStudents]
  )

  const videoRows = useMemo(
    () =>
      videoStudents.map((s) => ({
        user_id: s.user_id,
        full_name: s.full_name,
        cells: s.videos.map((v) => ({ id: v.content_block_id, ...v })),
      })),
    [videoStudents]
  )

  if (loading) return <LoadingSpinner message="Loading watch progress..." />

  if (loadError && recordings.length === 0 && videos.length === 0) {
    return (
      <div className="app-page-wide">
        <Link
          to={`/admin/cohorts/${id}`}
          className="app-link inline-flex min-h-11 items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to cohort
        </Link>
        <div role="alert" className="rounded-2xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-700">
          {loadError}
        </div>
      </div>
    )
  }

  const activeColumns = tab === 'recordings' ? recordings : videos
  const activeRows = tab === 'recordings' ? recordingRows : videoRows
  const activeStudentCount = tab === 'recordings' ? recordingStudents.length : videoStudents.length

  return (
    <div className="app-page-wide">
      <div className="space-y-4">
        <Link
          to={`/admin/cohorts/${id}`}
          className="app-link inline-flex min-h-11 max-w-full items-center gap-1 text-sm"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          <span className="truncate" title={cohortName || undefined}>Back to {cohortName || 'Cohort'}</span>
        </Link>
        <PageHeader
          eyebrow="Cohort engagement"
          title="Watch progress"
          description={
            <>
              {cohortName} · {activeColumns.length} {tab === 'recordings' ? 'recording' : 'lesson video'}
              {activeColumns.length !== 1 ? 's' : ''} · {activeStudentCount} student{activeStudentCount !== 1 ? 's' : ''}
            </>
          }
        />
      </div>

      <div className="flex max-w-full overflow-x-auto border-b border-line" role="tablist" aria-label="Watch progress type">
        <TabButton asTab selected={tab === 'recordings'} count={recordings.length} onClick={() => handleTabChange('recordings')}>
          <Film className="h-4 w-4" />
          Class recordings
        </TabButton>
        <TabButton asTab selected={tab === 'videos'} count={videos.length} onClick={() => handleTabChange('videos')}>
          <PlaySquare className="h-4 w-4" />
          Lesson videos
        </TabButton>
      </div>

      {tab === 'recordings' ? (
        <ProgressMatrix
          columns={recordings}
          rows={activeRows}
          getCell={(row, colId) => row.cells.find((c) => c.id === colId)}
          cohortId={Number(id)}
          emptyIcon={Film}
          emptyTitle="No recordings uploaded"
          emptyDescription="Upload recordings to this cohort first to track student watch progress."
        />
      ) : (
        <ProgressMatrix
          columns={videos}
          rows={activeRows}
          getCell={(row, colId) => row.cells.find((c) => c.id === colId)}
          columnSubtitle={(col) => {
            const v = col as VideoInfo
            return v.module_title ? `${v.module_title}` : null
          }}
          cohortId={Number(id)}
          emptyIcon={PlaySquare}
          emptyTitle="No lesson videos with uploads"
          emptyDescription="Upload S3 videos to lesson or exercise content blocks to track student watch progress here."
        />
      )}
    </div>
  )
}
