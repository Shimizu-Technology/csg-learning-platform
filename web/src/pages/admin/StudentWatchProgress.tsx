import { useEffect, useMemo, useState } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Film,
  PlaySquare,
  CheckCircle2,
  Circle,
  Eye,
  Clock,
  Search,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

interface RecordingRow {
  recording_id: number
  recording_title: string
  cohort_id: number
  cohort_name: string
  duration_seconds: number | null
  total_watched_seconds: number
  last_position_seconds: number
  progress_percentage: number
  completed: boolean
  last_watched_at: string | null
}

interface LessonVideoRow {
  content_block_id: number
  title: string
  lesson_title: string
  module_title: string
  cohort_id: number
  cohort_name: string
  duration_seconds: number | null
  total_watched_seconds: number
  last_position_seconds: number
  progress_percentage: number
  completed: boolean
  completed_at: string | null
}

type TabKey = 'recordings' | 'videos'
type FilterKey = 'all' | 'completed' | 'in_progress' | 'not_started'

const formatDuration = (seconds: number | null | undefined) => {
  if (!seconds || seconds <= 0) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

const formatRelative = (iso: string | null | undefined) => {
  if (!iso) return 'Never'
  const date = new Date(iso)
  const diffMs = Date.now() - date.getTime()
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const statusFor = (row: { completed: boolean; total_watched_seconds: number }): FilterKey => {
  if (row.completed) return 'completed'
  if (row.total_watched_seconds > 0) return 'in_progress'
  return 'not_started'
}

interface ProgressRowProps {
  title: string
  subtitle?: string
  durationSeconds: number | null
  totalWatchedSeconds: number
  progressPercentage: number
  completed: boolean
  lastWatchedAt: string | null
}

function ProgressRow({
  title,
  subtitle,
  durationSeconds,
  totalWatchedSeconds,
  progressPercentage,
  completed,
  lastWatchedAt,
}: ProgressRowProps) {
  const pct = Math.round(progressPercentage)
  const watchedDisplay = formatDuration(totalWatchedSeconds)
  const totalDisplay = formatDuration(durationSeconds)

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4 px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50/50 transition-colors">
      <div className="shrink-0 mt-0.5 sm:mt-0">
        {completed ? (
          <CheckCircle2 className="h-5 w-5 text-success-500" />
        ) : pct > 0 ? (
          <div className="relative h-5 w-5">
            <Circle className="h-5 w-5 text-slate-200 absolute inset-0" />
            <div
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(rgb(245 158 11) ${pct * 3.6}deg, transparent 0)`,
                mask: 'radial-gradient(circle, transparent 5px, black 6px)',
                WebkitMask: 'radial-gradient(circle, transparent 5px, black 6px)',
              }}
            />
          </div>
        ) : (
          <Circle className="h-5 w-5 text-slate-200" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <p className="text-sm font-medium text-slate-900 truncate">{title}</p>
          {subtitle && <p className="text-xs text-slate-400 truncate">{subtitle}</p>}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="flex-1 max-w-xs h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${completed ? 'bg-success-500' : 'bg-amber-400'}`}
              style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
            />
          </div>
          <span className="text-xs text-slate-500 tabular-nums shrink-0">{pct}%</span>
        </div>
      </div>

      <div className="grid grid-cols-3 sm:flex sm:items-center gap-3 sm:gap-6 text-xs text-slate-500 shrink-0 sm:text-right">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Watched</div>
          <div className="tabular-nums">
            {watchedDisplay} <span className="text-slate-300">/ {totalDisplay}</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Last Active</div>
          <div className="tabular-nums">{formatRelative(lastWatchedAt)}</div>
        </div>
        <div className="text-right sm:text-left">
          <div className="text-[10px] uppercase tracking-wide text-slate-400">Status</div>
          <div className={`font-medium ${completed ? 'text-success-600' : pct > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
            {completed ? 'Done' : pct > 0 ? 'In Progress' : 'Not Started'}
          </div>
        </div>
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: LucideIcon
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-center gap-2 text-slate-500">
        <Icon className="h-4 w-4" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-semibold text-slate-900 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-slate-400 mt-0.5">{hint}</p>}
    </div>
  )
}

export function StudentWatchProgress() {
  const { id } = useParams<{ id: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab: TabKey = searchParams.get('tab') === 'videos' ? 'videos' : 'recordings'
  const [tab, setTab] = useState<TabKey>(initialTab)
  const [filter, setFilter] = useState<FilterKey>('all')
  const [search, setSearch] = useState('')

  const [recordings, setRecordings] = useState<RecordingRow[]>([])
  const [videos, setVideos] = useState<LessonVideoRow[]>([])
  const [studentName, setStudentName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    Promise.all([
      api.getStudentWatchProgress(Number(id)),
      api.getStudentLessonVideoProgress(Number(id)),
      api.getStudentProgress(Number(id)),
    ]).then(([recRes, vidRes, profRes]) => {
      if (recRes.error) setError(recRes.error)
      if (recRes.data?.watch_progresses) setRecordings(recRes.data.watch_progresses)
      if (vidRes.data?.lesson_videos) setVideos(vidRes.data.lesson_videos)
      if (profRes.data?.user?.full_name) setStudentName(profRes.data.user.full_name)
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

  const recordingStats = useMemo(() => {
    const total = recordings.length
    const completed = recordings.filter((r) => r.completed).length
    const inProgress = recordings.filter((r) => !r.completed && r.total_watched_seconds > 0).length
    const totalWatched = recordings.reduce((sum, r) => sum + r.total_watched_seconds, 0)
    return { total, completed, inProgress, totalWatched }
  }, [recordings])

  const videoStats = useMemo(() => {
    const total = videos.length
    const completed = videos.filter((v) => v.completed).length
    const inProgress = videos.filter((v) => !v.completed && v.total_watched_seconds > 0).length
    const totalWatched = videos.reduce((sum, v) => sum + v.total_watched_seconds, 0)
    return { total, completed, inProgress, totalWatched }
  }, [videos])

  const filteredRecordings = useMemo(() => {
    const term = search.trim().toLowerCase()
    return recordings.filter((r) => {
      if (filter !== 'all' && statusFor(r) !== filter) return false
      if (term && !r.recording_title.toLowerCase().includes(term) && !r.cohort_name.toLowerCase().includes(term)) return false
      return true
    })
  }, [recordings, filter, search])

  const filteredVideos = useMemo(() => {
    const term = search.trim().toLowerCase()
    return videos.filter((v) => {
      if (filter !== 'all' && statusFor(v) !== filter) return false
      if (term) {
        const haystack = `${v.title} ${v.lesson_title} ${v.module_title} ${v.cohort_name}`.toLowerCase()
        if (!haystack.includes(term)) return false
      }
      return true
    })
  }, [videos, filter, search])

  if (loading) return <LoadingSpinner message="Loading watch progress..." />

  const activeStats = tab === 'recordings' ? recordingStats : videoStats
  const completionPct = activeStats.total > 0 ? Math.round((activeStats.completed / activeStats.total) * 100) : 0

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <Link
          to={`/admin/students/${id}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to {studentName || 'Student'}
        </Link>
        <div className="flex items-center gap-3">
          <Eye className="h-6 w-6 text-primary-500" />
          <div>
            <h1 className="text-xl font-bold text-slate-900">Watch Progress</h1>
            <p className="text-sm text-slate-500">{studentName}</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          icon={CheckCircle2}
          label="Completed"
          value={`${activeStats.completed} / ${activeStats.total}`}
          hint={`${completionPct}% done`}
        />
        <SummaryCard icon={PlaySquare} label="In Progress" value={String(activeStats.inProgress)} />
        <SummaryCard icon={Circle} label="Not Started" value={String(activeStats.total - activeStats.completed - activeStats.inProgress)} />
        <SummaryCard icon={Clock} label="Total Watched" value={formatDuration(activeStats.totalWatched)} />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="flex rounded-lg border border-slate-200 overflow-hidden w-fit">
          {([
            { key: 'all', label: 'All' },
            { key: 'completed', label: 'Completed' },
            { key: 'in_progress', label: 'In Progress' },
            { key: 'not_started', label: 'Not Started' },
          ] as { key: FilterKey; label: string }[]).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setFilter(opt.key)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                filter === opt.key
                  ? 'bg-slate-100 text-slate-800'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tab === 'recordings' ? 'Search recordings...' : 'Search lesson videos...'}
            className="w-full sm:w-72 rounded-lg border border-slate-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
        {tab === 'recordings' ? (
          filteredRecordings.length === 0 ? (
            <EmptyState
              icon={Film}
              title={recordings.length === 0 ? 'No recordings yet' : 'No matches'}
              description={
                recordings.length === 0
                  ? "This student isn't enrolled in any cohorts with uploaded recordings."
                  : 'Try a different filter or clear the search.'
              }
            />
          ) : (
            filteredRecordings.map((r) => (
              <ProgressRow
                key={r.recording_id}
                title={r.recording_title}
                subtitle={r.cohort_name}
                durationSeconds={r.duration_seconds}
                totalWatchedSeconds={r.total_watched_seconds}
                progressPercentage={r.progress_percentage}
                completed={r.completed}
                lastWatchedAt={r.last_watched_at}
              />
            ))
          )
        ) : filteredVideos.length === 0 ? (
          <EmptyState
            icon={PlaySquare}
            title={videos.length === 0 ? 'No lesson videos yet' : 'No matches'}
            description={
              videos.length === 0
                ? "This student isn't enrolled in any curricula with uploaded lesson videos."
                : 'Try a different filter or clear the search.'
            }
          />
        ) : (
          filteredVideos.map((v) => (
            <ProgressRow
              key={v.content_block_id}
              title={v.title}
              subtitle={`${v.module_title} · ${v.lesson_title}`}
              durationSeconds={v.duration_seconds}
              totalWatchedSeconds={v.total_watched_seconds}
              progressPercentage={v.progress_percentage}
              completed={v.completed}
              lastWatchedAt={v.completed_at}
            />
          ))
        )}
      </div>
    </div>
  )
}
