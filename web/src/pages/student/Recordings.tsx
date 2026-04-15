import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, PlayCircle, ExternalLink, CalendarDays, Search, ChevronDown, ChevronUp, CheckCircle2, Clock, Film } from 'lucide-react'
import { api } from '../../lib/api'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { VideoPlayer } from '../../components/shared/VideoPlayer'

interface LegacyRecording {
  id: number
  title: string
  url: string
  date: string | null
  description: string | null
  source: 'youtube'
}

interface S3Recording {
  id: number
  title: string
  description: string | null
  duration_seconds: number | null
  duration_display: string | null
  file_size_display: string
  recorded_date: string | null
  created_at: string
  source: 's3'
  watch_progress: {
    last_position_seconds: number
    total_watched_seconds: number
    progress_percentage: number
    completed: boolean
    last_watched_at: string
  } | null
}

type RecordingItem = LegacyRecording | S3Recording

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.hostname.includes('youtu.be')) return u.pathname.slice(1).split('/')[0]
    if (u.hostname.includes('youtube.com')) {
      if (u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2]
      if (u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2]
      return u.searchParams.get('v')
    }
  } catch { /* not a valid URL */ }
  return null
}

export function Recordings() {
  const [legacyRecordings, setLegacyRecordings] = useState<LegacyRecording[]>([])
  const [s3Recordings, setS3Recordings] = useState<S3Recording[]>([])
  const [cohortId, setCohortId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<RecordingItem | null>(null)
  const [query, setQuery] = useState('')
  const [playlistCollapsed, setPlaylistCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<'all' | 'uploaded' | 'youtube'>('all')

  useEffect(() => {
    api.getRecordings().then((res) => {
      if (res.data) {
        const legacy = (res.data.recordings || []) as LegacyRecording[]
        const s3 = (res.data.s3_recordings || []) as S3Recording[]
        setLegacyRecordings(legacy)
        setS3Recordings(s3)
        setCohortId(res.data.cohort_id || null)
        const first = s3.length > 0 ? s3[0] : legacy.length > 0 ? legacy[0] : null
        setSelectedItem(first)
      }
      setLoading(false)
    })
  }, [])

  const allRecordings = useMemo<RecordingItem[]>(() => {
    if (activeTab === 'uploaded') return s3Recordings
    if (activeTab === 'youtube') return legacyRecordings
    return [...s3Recordings, ...legacyRecordings]
  }, [s3Recordings, legacyRecordings, activeTab])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allRecordings
    return allRecordings.filter((r) =>
      r.title.toLowerCase().includes(q) ||
      (r.description || '').toLowerCase().includes(q)
    )
  }, [allRecordings, query])

  const handleProgressUpdate = useCallback((data: { completed: boolean; progress_percentage: number }) => {
    if (!selectedItem || selectedItem.source !== 's3') return
    setS3Recordings(prev => prev.map(r =>
      r.id === selectedItem.id
        ? { ...r, watch_progress: { ...(r.watch_progress || { last_position_seconds: 0, total_watched_seconds: 0, last_watched_at: '' }), ...data } }
        : r
    ))
  }, [selectedItem])

  if (loading) return <LoadingSpinner message="Loading recordings..." />

  const totalCount = s3Recordings.length + legacyRecordings.length
  if (totalCount === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No recordings yet"
        description="Class recordings will appear here once your instructor adds them."
      />
    )
  }

  const showTabs = s3Recordings.length > 0 && legacyRecordings.length > 0

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Class Recordings</h1>
        <p className="mt-1 text-sm text-slate-500">
          {totalCount} recording{totalCount !== 1 ? 's' : ''} available
          {s3Recordings.length > 0 && ` · ${s3Recordings.filter(r => r.watch_progress?.completed).length} watched`}
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Player area */}
        <div className="flex-1 min-w-0">
          {selectedItem && selectedItem.source === 's3' && cohortId ? (
            <div className="space-y-4">
              <VideoPlayer
                key={selectedItem.id}
                cohortId={cohortId}
                recordingId={selectedItem.id}
                title={selectedItem.title}
                initialPosition={selectedItem.watch_progress?.last_position_seconds || 0}
                onProgressUpdate={handleProgressUpdate}
              />
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">{selectedItem.title}</h2>
                  {selectedItem.watch_progress?.completed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 shrink-0">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Watched
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  {selectedItem.recorded_date && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatDate(selectedItem.recorded_date)}
                    </span>
                  )}
                  {selectedItem.duration_display && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {selectedItem.duration_display}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Film className="h-3.5 w-3.5" />
                    {selectedItem.file_size_display}
                  </span>
                </div>
                {selectedItem.watch_progress && !selectedItem.watch_progress.completed && selectedItem.watch_progress.progress_percentage > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>{Math.round(selectedItem.watch_progress.progress_percentage)}% watched</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${selectedItem.watch_progress.progress_percentage}%` }} />
                    </div>
                  </div>
                )}
                {selectedItem.description && (
                  <p className="mt-3 text-sm text-slate-600 leading-relaxed">{selectedItem.description}</p>
                )}
              </div>
            </div>
          ) : selectedItem && selectedItem.source === 'youtube' ? (
            <LegacyPlayer recording={selectedItem as LegacyRecording} />
          ) : null}
        </div>

        {/* Playlist sidebar */}
        <div className="lg:w-80 xl:w-96 shrink-0">
          <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden lg:sticky lg:top-4">
            <button
              onClick={() => setPlaylistCollapsed(!playlistCollapsed)}
              className="flex w-full items-center justify-between px-4 py-3 border-b border-slate-100 lg:cursor-default"
            >
              <span className="text-sm font-semibold text-slate-900">
                Playlist · {filtered.length}
              </span>
              <span className="lg:hidden text-slate-400">
                {playlistCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </span>
            </button>

            <div className={`${playlistCollapsed ? 'hidden' : 'block'} lg:block`}>
              {showTabs && (
                <div className="flex border-b border-slate-100">
                  {(['all', 'uploaded', 'youtube'] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                        activeTab === tab ? 'text-primary-600 border-b-2 border-primary-500' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {tab === 'all' ? 'All' : tab === 'uploaded' ? 'Uploaded' : 'YouTube'}
                    </button>
                  ))}
                </div>
              )}

              {allRecordings.length > 6 && (
                <div className="px-3 pt-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search recordings..."
                      className="w-full rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    />
                  </div>
                </div>
              )}

              <div className="max-h-112 lg:max-h-[calc(100vh-14rem)] overflow-y-auto p-2">
                {filtered.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-6">No recordings match your search.</p>
                ) : (
                  <div className="space-y-1">
                    {filtered.map((recording, idx) => {
                      const isActive = selectedItem?.id === recording.id && selectedItem?.source === recording.source
                      const isS3 = recording.source === 's3'
                      const s3Rec = isS3 ? recording as S3Recording : null
                      return (
                        <button
                          key={`${recording.source}-${recording.id}`}
                          onClick={() => setSelectedItem(recording)}
                          className={`w-full text-left rounded-xl px-3 py-2.5 transition-colors ${
                            isActive
                              ? 'bg-primary-50 border border-primary-200'
                              : 'hover:bg-slate-50 border border-transparent'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="text-[11px] font-medium text-slate-400 mt-0.5 w-5 text-right shrink-0">
                              {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={`text-sm font-medium leading-snug truncate ${isActive ? 'text-primary-700' : 'text-slate-900'}`}>
                                {recording.title}
                              </p>
                              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                                {isS3 && s3Rec?.recorded_date && (
                                  <span className="text-[11px] text-slate-400">{formatDate(s3Rec.recorded_date)}</span>
                                )}
                                {!isS3 && (recording as LegacyRecording).date && (
                                  <span className="text-[11px] text-slate-400">{formatDate((recording as LegacyRecording).date)}</span>
                                )}
                                {isS3 && s3Rec?.duration_display && (
                                  <span className="text-[11px] text-slate-400">{s3Rec.duration_display}</span>
                                )}
                                {!isS3 && (
                                  <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                    <ExternalLink className="h-2.5 w-2.5" />
                                    YouTube
                                  </span>
                                )}
                              </div>
                              {isS3 && s3Rec?.watch_progress && !s3Rec.watch_progress.completed && s3Rec.watch_progress.progress_percentage > 0 && (
                                <div className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-primary-400 rounded-full" style={{ width: `${s3Rec.watch_progress.progress_percentage}%` }} />
                                </div>
                              )}
                            </div>
                            {isS3 && s3Rec?.watch_progress?.completed ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
                            ) : isActive ? (
                              <PlayCircle className="h-4 w-4 text-primary-500 shrink-0 mt-0.5" />
                            ) : null}
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function LegacyPlayer({ recording }: { recording: LegacyRecording }) {
  const youtubeId = extractYouTubeId(recording.url)
  if (youtubeId) {
    return (
      <div className="space-y-4">
        <div className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-black" style={{ paddingBottom: '56.25%' }}>
          <iframe
            key={youtubeId}
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1`}
            title={recording.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h2 className="text-lg font-semibold text-slate-900">{recording.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
            {recording.date && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5" />
                {formatDate(recording.date)}
              </span>
            )}
            <a
              href={sanitizeUrl(recording.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 transition-colors"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Watch on YouTube
            </a>
          </div>
          {recording.description && (
            <p className="mt-3 text-sm text-slate-600 leading-relaxed">{recording.description}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 py-24">
        <div className="text-center">
          <PlayCircle className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500 mb-3">This recording can't be embedded.</p>
          <a
            href={sanitizeUrl(recording.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Open Recording
          </a>
        </div>
      </div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-slate-900">{recording.title}</h2>
        {recording.description && (
          <p className="mt-2 text-sm text-slate-600">{recording.description}</p>
        )}
      </div>
    </div>
  )
}
