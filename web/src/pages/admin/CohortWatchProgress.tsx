import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Film, CheckCircle2, Eye, PlaySquare } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

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
  if (completed) return 'bg-green-500 text-white'
  if (pct >= 50) return 'bg-amber-100 text-amber-700'
  if (pct > 0) return 'bg-slate-100 text-slate-600'
  return 'bg-slate-50 text-slate-400'
}

function ProgressMatrix<T extends { id: number; title: string }>({
  columns,
  rows,
  getCell,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  columnSubtitle,
}: {
  columns: T[]
  rows: { user_id: number; full_name: string; cells: ({ id: number } & CellProgress)[] }[]
  getCell: (row: { cells: ({ id: number } & CellProgress)[] }, colId: number) => CellProgress | undefined
  emptyIcon: LucideIcon
  emptyTitle: string
  emptyDescription: string
  columnSubtitle?: (col: T) => string | null
}) {
  if (columns.length === 0) {
    return <EmptyState icon={emptyIcon} title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50">
              <th className="text-left px-4 py-3 font-medium text-slate-700 sticky left-0 bg-slate-50/50 z-10 min-w-[180px]">
                Student
              </th>
              {columns.map((col) => {
                const subtitle = columnSubtitle?.(col)
                return (
                  <th key={col.id} className="text-center px-2 py-3 font-medium text-slate-700 min-w-[96px]">
                    <div className="text-xs leading-tight truncate max-w-[120px] mx-auto" title={col.title}>
                      {col.title}
                    </div>
                    {subtitle && (
                      <div className="text-[10px] font-normal text-slate-400 truncate max-w-[120px] mx-auto" title={subtitle}>
                        {subtitle}
                      </div>
                    )}
                  </th>
                )
              })}
              <th className="text-center px-4 py-3 font-medium text-slate-700 min-w-[110px]">Overall</th>
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
                <tr key={row.user_id} className="border-b border-slate-100 hover:bg-slate-50/50">
                  <td className="px-4 py-2.5 font-medium text-slate-900 sticky left-0 bg-white z-10">
                    {row.full_name}
                  </td>
                  {columns.map((col) => {
                    const cell = getCell(row, col.id)
                    const pct = cell?.progress_percentage || 0
                    const completed = cell?.completed || false
                    return (
                      <td key={col.id} className="text-center px-2 py-2.5">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${getProgressColor(pct, completed)}`}
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
                      <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-green-500 rounded-full" style={{ width: `${overallPct}%` }} />
                      </div>
                      <span className="text-xs text-slate-600 tabular-nums">
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
  const [cohortName, setCohortName] = useState('')

  useEffect(() => {
    if (!id) return
    Promise.all([
      api.getCohortWatchProgress(Number(id)),
      api.getCohortLessonVideoProgress(Number(id)),
      api.getCohort(Number(id)),
    ]).then(([recRes, vidRes, cohortRes]) => {
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
      setLoading(false)
    })
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

  const activeColumns = tab === 'recordings' ? recordings : videos
  const activeRows = tab === 'recordings' ? recordingRows : videoRows
  const activeStudentCount = tab === 'recordings' ? recordingStudents.length : videoStudents.length

  return (
    <div className="max-w-full mx-auto space-y-5">
      <div>
        <Link
          to={`/admin/cohorts/${id}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {cohortName || 'Cohort'}
        </Link>
        <div className="flex items-center gap-3">
          <Eye className="h-6 w-6 text-primary-500" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Watch Progress</h1>
            <p className="text-sm text-slate-500">
              {cohortName} · {activeColumns.length} {tab === 'recordings' ? 'recording' : 'lesson video'}
              {activeColumns.length !== 1 ? 's' : ''} · {activeStudentCount} student{activeStudentCount !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
      </div>

      <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
        <button
          type="button"
          onClick={() => handleTabChange('recordings')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'recordings'
              ? 'bg-slate-100 text-slate-800'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          <Film className="h-4 w-4" />
          Class Recordings
          <span className="ml-1 text-xs text-slate-400 tabular-nums">{recordings.length}</span>
        </button>
        <button
          type="button"
          onClick={() => handleTabChange('videos')}
          className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium transition-colors ${
            tab === 'videos'
              ? 'bg-slate-100 text-slate-800'
              : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
          }`}
        >
          <PlaySquare className="h-4 w-4" />
          Lesson Videos
          <span className="ml-1 text-xs text-slate-400 tabular-nums">{videos.length}</span>
        </button>
      </div>

      {tab === 'recordings' ? (
        <ProgressMatrix
          columns={recordings}
          rows={activeRows}
          getCell={(row, colId) => row.cells.find((c) => c.id === colId)}
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
          emptyIcon={PlaySquare}
          emptyTitle="No lesson videos with uploads"
          emptyDescription="Upload S3 videos to lesson or exercise content blocks to track student watch progress here."
        />
      )}
    </div>
  )
}
