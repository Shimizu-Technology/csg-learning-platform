import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, PlayCircle, ExternalLink, CalendarDays, BookOpen } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

interface RecordingGroup {
  module_id: number
  module_name: string
  lesson_id: number
  lesson_title: string
  lesson_type: string
  release_day: number
  unlock_date: string | null
  recordings: Array<{
    id: number
    title: string
    block_type: string
    video_url: string
    position: number
  }>
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return 'Available now'
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function Recordings() {
  const [recordings, setRecordings] = useState<RecordingGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getRecordings().then((res) => {
      if (res.data?.recordings) setRecordings(res.data.recordings)
      setLoading(false)
    })
  }, [])

  if (loading) return <LoadingSpinner message="Loading recordings..." />

  if (recordings.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No recordings yet"
        description="Once recordings are added to your unlocked lessons, they’ll show up here."
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Recordings</h1>
        <p className="mt-1 text-sm text-slate-500">All unlocked lesson recordings in one place.</p>
      </div>

      <div className="space-y-4">
        {recordings.map((group) => (
          <div key={`${group.lesson_id}-${group.recordings[0]?.id || 'none'}`} className="rounded-2xl border border-slate-200 bg-white p-5">
            <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-lg font-semibold text-slate-900">{group.lesson_title}</h2>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    {group.lesson_type.replace('_', ' ')}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <BookOpen className="h-4 w-4" />
                    {group.module_name}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarDays className="h-4 w-4" />
                    {formatDate(group.unlock_date)}
                  </span>
                </div>
              </div>
              <Link
                to={`/lessons/${group.lesson_id}`}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
              >
                Open lesson
              </Link>
            </div>

            <div className="mt-4 grid gap-3">
              {group.recordings.map((recording) => (
                <a
                  key={recording.id}
                  href={recording.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 hover:border-primary-200 hover:bg-primary-50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <PlayCircle className="h-5 w-5 text-primary-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{recording.title}</p>
                      <p className="text-xs text-slate-500 capitalize">{recording.block_type}</p>
                    </div>
                  </div>
                  <ExternalLink className="h-4 w-4 text-slate-400 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
