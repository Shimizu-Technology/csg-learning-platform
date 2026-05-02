import { useEffect, useMemo, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, PlayCircle, ExternalLink, CalendarDays, Search, ChevronDown, ChevronUp, CheckCircle2, Clock, Film, RefreshCw, WifiOff } from 'lucide-react'
import { api } from '../../lib/api'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { VideoPlayer } from '../../components/shared/VideoPlayer'
import type { RecordingEntry, RecordingItem as ApiRecordingItem, S3Recording as ApiS3Recording } from '../../types/api'

interface LegacyRecording {
  id: string
  cohort_id?: number
  title: string
  url: string
  date: string | null
  description: string | null
  source: 'youtube' | 'external'
}

interface S3Recording {
  id: number
  cohort_id?: number
  title: string
  description: string | null
  duration_seconds: number | null
  duration_display: string | null
  file_size_display: string
  recorded_date: string | null
  created_at: string
  source: 'uploaded'
  watch_progress: {
    last_position_seconds: number
    total_watched_seconds: number
    progress_percentage: number
    completed: boolean
    last_watched_at: string | null
  } | null
}

type RecordingItem = LegacyRecording | S3Recording
type RecordingTab = 'all' | 'uploaded' | 'youtube' | 'external'

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function extractYouTubeId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.toLowerCase()
    const pathParts = u.pathname.split('/').filter(Boolean)

    if (host.includes('youtu.be')) return pathParts[0] || null
    if (!host.includes('youtube.com')) return null

    if (u.searchParams.get('v')) return u.searchParams.get('v')
    if (['embed', 'shorts', 'live'].includes(pathParts[0])) return pathParts[1] || null
  } catch { /* not a valid URL */ }
  return null
}

function normalizeLegacyRecording(recording: RecordingEntry | ApiRecordingItem): LegacyRecording {
  const url = 'url' in recording ? recording.url || '' : ''
  const source = recording.source === 'youtube' || recording.source === 'external'
    ? recording.source
    : extractYouTubeId(url) ? 'youtube' : 'external'
  return {
    id: String(recording.id),
    cohort_id: recording.cohort_id,
    title: recording.title,
    url,
    date: recording.date ?? recording.recorded_date ?? null,
    description: recording.description,
    source,
  }
}

function normalizeUploadedRecording(recording: ApiS3Recording | ApiRecordingItem): S3Recording {
  return {
    id: Number(recording.id),
    cohort_id: recording.cohort_id,
    title: recording.title,
    description: recording.description,
    duration_seconds: recording.duration_seconds ?? null,
    duration_display: recording.duration_display ?? null,
    file_size_display: recording.file_size_display ?? '',
    recorded_date: recording.recorded_date ?? null,
    created_at: recording.created_at ?? '',
    source: 'uploaded',
    watch_progress: recording.watch_progress ?? null,
  }
}

export function Recordings() {
  const [legacyRecordings, setLegacyRecordings] = useState<LegacyRecording[]>([])
  const [s3Recordings, setS3Recordings] = useState<S3Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showingSavedData, setShowingSavedData] = useState(false)
  const [selectedItem, setSelectedItem] = useState<RecordingItem | null>(null)
  const [query, setQuery] = useState('')
  const [playlistCollapsed, setPlaylistCollapsed] = useState(false)
  const [activeTab, setActiveTab] = useState<RecordingTab>('all')

  const loadRecordings = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    setShowingSavedData(false)

    api.getRecordings().then((res) => {
      if (res.data) {
        const normalizedItems = res.data.items || []
        const legacy: LegacyRecording[] = normalizedItems.length > 0
          ? normalizedItems
              .filter((recording) => recording.source !== 'uploaded')
              .map(normalizeLegacyRecording)
          : (res.data.recordings || []).map(normalizeLegacyRecording)
        const s3: S3Recording[] = normalizedItems.length > 0
          ? normalizedItems
              .filter((recording) => recording.source === 'uploaded')
              .map(normalizeUploadedRecording)
          : (res.data.s3_recordings || []).map(normalizeUploadedRecording)
        setLegacyRecordings(legacy)
        setS3Recordings(s3)
        const first = s3.length > 0 ? s3[0] : legacy.length > 0 ? legacy[0] : null
        setSelectedItem(first)
        setShowingSavedData(Boolean(res.fromCache))
        setLoadError(res.fromCache ? res.error : null)
      } else {
        setLoadError(res.error || 'Unable to load recordings right now.')
      }
      setLoading(false)
    }).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : 'Unable to load recordings right now.')
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    loadRecordings()
  }, [loadRecordings])

  const allRecordings = useMemo<RecordingItem[]>(() => {
    if (activeTab === 'uploaded') return s3Recordings
    if (activeTab === 'youtube') return legacyRecordings.filter((recording) => recording.source === 'youtube')
    if (activeTab === 'external') return legacyRecordings.filter((recording) => recording.source === 'external')
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

  const handleProgressUpdate = useCallback((data: Partial<NonNullable<S3Recording['watch_progress']>>) => {
    if (!selectedItem || selectedItem.source !== 'uploaded') return
    setS3Recordings(prev => prev.map(r => {
      if (r.id !== selectedItem.id) return r
      const base = r.watch_progress || { last_position_seconds: 0, total_watched_seconds: 0, progress_percentage: 0, completed: false, last_watched_at: null }
      return { ...r, watch_progress: { ...base, ...data } }
    }))
  }, [selectedItem])

  const liveSelectedItem = useMemo<RecordingItem | null>(() => {
    if (!selectedItem) return null
    if (selectedItem.source === 'uploaded') {
      return s3Recordings.find(r => r.id === selectedItem.id) || selectedItem
    }
    return selectedItem
  }, [selectedItem, s3Recordings])

  const selectedId = liveSelectedItem?.source === 'uploaded' ? liveSelectedItem.id : null
  const selectedCohortId = liveSelectedItem?.source === 'uploaded' ? liveSelectedItem.cohort_id ?? null : null

  const fetchSelectedStreamUrl = useCallback(async () => {
    if (!selectedCohortId || !selectedId) return null
    const res = await api.getRecordingStreamUrl(selectedCohortId, selectedId)
    return res.data?.stream_url || null
  }, [selectedCohortId, selectedId])

  const saveSelectedProgress = useCallback((data: import('../../components/shared/VideoPlayer').VideoProgressData) => {
    if (!selectedId) return
    api.updateWatchProgress({ recording_id: selectedId, ...data }).then(res => {
      if (res.data?.watch_progress) handleProgressUpdate(res.data.watch_progress)
    })
  }, [selectedId, handleProgressUpdate])

  if (loading) return <LoadingSpinner message="Loading recordings..." />

  const totalCount = s3Recordings.length + legacyRecordings.length
  if (loadError && totalCount === 0) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Could not load recordings"
        description={loadError}
        action={
          <button
            type="button"
            onClick={loadRecordings}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600"
          >
            <RefreshCw className="h-4 w-4" />
            Try again
          </button>
        }
      />
    )
  }

  if (totalCount === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No recordings yet"
        description="Class recordings will appear here once your instructor adds them."
      />
    )
  }

  const sourceGroupCount = [
    s3Recordings.length > 0,
    legacyRecordings.some((recording) => recording.source === 'youtube'),
    legacyRecordings.some((recording) => recording.source === 'external'),
  ].filter(Boolean).length
  const showTabs = sourceGroupCount > 1

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {showingSavedData && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Showing saved recordings while your connection catches up.
        </div>
      )}
      <div>
        <Link to="/dashboard" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
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
          {liveSelectedItem && liveSelectedItem.source === 'uploaded' && selectedCohortId ? (
            <div className="space-y-4">
              <VideoPlayer
                key={liveSelectedItem.id}
                title={liveSelectedItem.title}
                initialPosition={(selectedItem as S3Recording | null)?.watch_progress?.last_position_seconds || 0}
                initialTotalWatched={(selectedItem as S3Recording | null)?.watch_progress?.total_watched_seconds || 0}
                fetchStreamUrl={fetchSelectedStreamUrl}
                onSaveProgress={saveSelectedProgress}
              />
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-lg font-semibold text-slate-900">{liveSelectedItem.title}</h2>
                  {liveSelectedItem.watch_progress?.completed && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 shrink-0">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Watched
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  {liveSelectedItem.recorded_date && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatDate(liveSelectedItem.recorded_date)}
                    </span>
                  )}
                  {liveSelectedItem.duration_display && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5" />
                      {liveSelectedItem.duration_display}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Film className="h-3.5 w-3.5" />
                    {liveSelectedItem.file_size_display}
                  </span>
                </div>
                {liveSelectedItem.watch_progress && !liveSelectedItem.watch_progress.completed && liveSelectedItem.watch_progress.progress_percentage > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                      <span>{Math.round(liveSelectedItem.watch_progress.progress_percentage)}% watched</span>
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${liveSelectedItem.watch_progress.progress_percentage}%` }} />
                    </div>
                  </div>
                )}
                {liveSelectedItem.description && (
                  <p className="mt-3 text-sm text-slate-600 leading-relaxed">{liveSelectedItem.description}</p>
                )}
              </div>
            </div>
          ) : liveSelectedItem && (liveSelectedItem.source === 'youtube' || liveSelectedItem.source === 'external') ? (
            <LegacyPlayer recording={liveSelectedItem as LegacyRecording} />
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
                  {(['all', 'uploaded', 'youtube', 'external'] as const)
                    .filter((tab) => tab === 'all' || allRecordingsForTab(tab, s3Recordings, legacyRecordings).length > 0)
                    .map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveTab(tab)}
                      className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
                        activeTab === tab ? 'text-primary-600 border-b-2 border-primary-500' : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      {tab === 'all' ? 'All' : tab === 'uploaded' ? 'Uploaded' : tab === 'youtube' ? 'YouTube' : 'External'}
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
                      const isS3 = recording.source === 'uploaded'
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
                                    {recording.source === 'youtube' ? 'YouTube' : 'External'}
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
              {recording.source === 'youtube' ? 'Watch on YouTube' : 'Open Recording'}
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

function allRecordingsForTab(tab: RecordingTab, uploaded: S3Recording[], legacy: LegacyRecording[]): RecordingItem[] {
  if (tab === 'uploaded') return uploaded
  if (tab === 'youtube') return legacy.filter((recording) => recording.source === 'youtube')
  if (tab === 'external') return legacy.filter((recording) => recording.source === 'external')
  return [...uploaded, ...legacy]
}
