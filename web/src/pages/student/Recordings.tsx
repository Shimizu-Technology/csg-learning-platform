import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { ArrowLeft, PlayCircle, ExternalLink, CalendarDays, Search, ChevronDown, ChevronUp, CheckCircle2, Clock, Film, RefreshCw, WifiOff } from 'lucide-react'
import { api } from '../../lib/api'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { isAlumniOnlyEnrollment } from '../../lib/enrollments'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { VideoPlayer } from '../../components/shared/VideoPlayer'
import { ContextualHelp } from '../../components/student/ContextualHelp'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { Badge } from '../../components/ui/Badge'
import { AnchorButton, Button } from '../../components/ui/Button'
import { useMediaQuery } from '../../lib/useMediaQuery'
import type { RecordingEntry, RecordingItem as ApiRecordingItem, S3Recording as ApiS3Recording } from '../../types/api'
import { formatShortDate } from '../../lib/format'

interface LegacyRecording {
  legacy_item_key?: string | null;
  id: number | string
  cohort_id?: number
  title: string
  url: string
  date: string | null
  description: string | null
  source: 'youtube' | 'vimeo' | 'loom' | 'direct' | 'external'
  watch_progress: S3Recording['watch_progress']
}

interface S3Recording {
  legacy_item_key?: string | null;
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
  return formatShortDate(dateStr)
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
  const source = recording.source && recording.source !== 'uploaded'
    ? recording.source
    : extractYouTubeId(url) ? 'youtube' : 'external'
  return {
    id: typeof recording.id === 'number' ? recording.id : String(recording.id),
    legacy_item_key: recording.legacy_item_key,
    cohort_id: recording.cohort_id,
    title: recording.title,
    url,
    date: recording.date ?? recording.recorded_date ?? null,
    description: recording.description,
    source,
    watch_progress: 'watch_progress' in recording ? recording.watch_progress ?? null : null,
  }
}

function normalizeUploadedRecording(recording: ApiS3Recording | ApiRecordingItem): S3Recording {
  return {
    id: Number(recording.id),
    legacy_item_key: recording.legacy_item_key,
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
  const location = useLocation()
  const requestedRecording = new URLSearchParams(location.search).get('recording')
  const requestGeneration = useRef(0)
  const { user, enrollments } = useAuthContext()
  const { selectedCohortId } = useCohortContext()
  const isStaff = Boolean(user?.is_staff)
  const isAlumniLibrary = !isStaff && isAlumniOnlyEnrollment(enrollments)
  const [legacyRecordings, setLegacyRecordings] = useState<LegacyRecording[]>([])
  const [s3Recordings, setS3Recordings] = useState<S3Recording[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showingSavedData, setShowingSavedData] = useState(false)
  const [selectedItem, setSelectedItem] = useState<RecordingItem | null>(null)
  const [query, setQuery] = useState('')
  const [playlistCollapsed, setPlaylistCollapsed] = useState(false)
  // The playlist only collapses on phones and tablets; on desktop it is always shown.
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const [activeTab, setActiveTab] = useState<RecordingTab>('all')

  const loadRecordings = useCallback(() => {
    const generation = ++requestGeneration.current
    setLoading(true)
    setLegacyRecordings([])
    setS3Recordings([])
    setSelectedItem(null)
    setLoadError(null)
    setShowingSavedData(false)

    api.getRecordings(selectedCohortId ?? undefined).then((res) => {
      if (generation !== requestGeneration.current) return
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
        setSelectedItem(requestedRecording ? [...s3, ...legacy].find((item) => (String(item.id) === requestedRecording || item.legacy_item_key === requestedRecording)) ?? null : first)
        setShowingSavedData(Boolean(res.fromCache))
        setLoadError(res.fromCache ? res.error : null)
      } else {
        setLoadError(res.error || 'Unable to load recordings right now.')
      }
      setLoading(false)
    }).catch((error: unknown) => {
      if (generation !== requestGeneration.current) return
      setLoadError(error instanceof Error ? error.message : 'Unable to load recordings right now.')
      setLoading(false)
    })
  }, [selectedCohortId, requestedRecording])

  useEffect(() => {
    if (isAlumniLibrary && !requestedRecording) return
    loadRecordings()
    return () => { requestGeneration.current += 1 }
  }, [isAlumniLibrary, requestedRecording, loadRecordings])

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
    if (!selectedItem || typeof selectedItem.id !== 'number') return
    const update = <T extends RecordingItem>(r: T): T => {
      if (r.id !== selectedItem.id) return r
      const base = r.watch_progress || { last_position_seconds: 0, total_watched_seconds: 0, progress_percentage: 0, completed: false, last_watched_at: null }
      return { ...r, watch_progress: { ...base, ...data } }
    }
    if (selectedItem.source === 'uploaded') setS3Recordings(prev => prev.map(update) as S3Recording[])
    else setLegacyRecordings(prev => prev.map(update) as LegacyRecording[])
  }, [selectedItem])

  const liveSelectedItem = useMemo<RecordingItem | null>(() => {
    if (!selectedItem) return null
    if (selectedItem.source === 'uploaded') {
      return s3Recordings.find(r => r.id === selectedItem.id) || selectedItem
    }
    return legacyRecordings.find(r => r.id === selectedItem.id) || selectedItem
  }, [legacyRecordings, selectedItem, s3Recordings])

  const selectedId = typeof liveSelectedItem?.id === 'number' ? liveSelectedItem.id : null
  const recordingCohortId = liveSelectedItem?.cohort_id ?? null
  const selectedHelpContext = useMemo(() => {
    if (!liveSelectedItem || !recordingCohortId) return null
    if (typeof liveSelectedItem.id === 'number') return { source: 'primary' as const, id: liveSelectedItem.id }
    const ordinal = Number(String(liveSelectedItem.id).split('-').at(-1))
    if (!Number.isInteger(ordinal) || ordinal < 1) return null
    return { source: 'legacy' as const, id: ordinal - 1 }
  }, [liveSelectedItem, recordingCohortId])

  const fetchSelectedStreamUrl = useCallback(async () => {
    if (!recordingCohortId || !selectedId) return null
    const res = await api.getRecordingStreamUrl(recordingCohortId, selectedId)
    return res.data?.stream_url || null
  }, [recordingCohortId, selectedId])

  const saveSelectedProgress = useCallback((data: import('../../components/shared/VideoPlayer').VideoProgressData) => {
    if (!selectedId) return
    api.updateWatchProgress({ recording_id: selectedId, ...data }).then(res => {
      if (res.data?.watch_progress) handleProgressUpdate(res.data.watch_progress)
    })
  }, [selectedId, handleProgressUpdate])

  if (isAlumniLibrary && !requestedRecording) return <Navigate to="/materials" replace />
  if (loading) return <LoadingSpinner message="Loading recordings..." />

  if (requestedRecording && !selectedItem && !loadError) return <EmptyState icon={Film} title="Recording unavailable" description="This recording is no longer available in the cohort named in this link." />

  const totalCount = s3Recordings.length + legacyRecordings.length
  if (loadError && totalCount === 0) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Could not load recordings"
        description={loadError}
        action={
          <Button onClick={loadRecordings}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
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
    <div className="app-page">
      {showingSavedData && (
        <div className="rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
          Showing saved recordings while your connection catches up.
        </div>
      )}
      <header>
        <Link to="/dashboard" className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink active:bg-slate-200/70">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Dashboard
        </Link>
        <p className="app-eyebrow">Replay and review</p>
        <h1 className="app-title mt-2">Class recordings</h1>
        <p className="app-description mt-2 tabular-nums">
          {totalCount} recording{totalCount !== 1 ? 's' : ''} available
          {` · ${[...s3Recordings, ...legacyRecordings].filter(r => r.watch_progress?.completed).length} watched`}
        </p>
      </header>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Player area */}
        <div className="flex-1 min-w-0">
          {liveSelectedItem && liveSelectedItem.source === 'uploaded' && recordingCohortId ? (
            <div className="space-y-4">
              <VideoPlayer
                key={liveSelectedItem.id}
                title={liveSelectedItem.title}
                initialPosition={(selectedItem as S3Recording | null)?.watch_progress?.last_position_seconds || 0}
                initialTotalWatched={(selectedItem as S3Recording | null)?.watch_progress?.total_watched_seconds || 0}
                fetchStreamUrl={fetchSelectedStreamUrl}
                onSaveProgress={saveSelectedProgress}
                trackProgress={!isStaff}
              />
              <div className="app-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-lg font-semibold text-ink [overflow-wrap:anywhere]">{liveSelectedItem.title}</h2>
                  {liveSelectedItem.watch_progress?.completed && (
                    <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>Watched</Badge>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm tabular-nums text-ink-secondary">
                  {liveSelectedItem.recorded_date && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {formatDate(liveSelectedItem.recorded_date)}
                    </span>
                  )}
                  {liveSelectedItem.duration_display && (
                    <span className="inline-flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {liveSelectedItem.duration_display}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Film className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    {liveSelectedItem.file_size_display}
                  </span>
                </div>
                {liveSelectedItem.watch_progress && !liveSelectedItem.watch_progress.completed && liveSelectedItem.watch_progress.progress_percentage > 0 && (
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs tabular-nums text-ink-secondary">
                      <span>{Math.round(liveSelectedItem.watch_progress.progress_percentage)}% watched</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-slate-700 transition-[width] duration-200" style={{ width: `${liveSelectedItem.watch_progress.progress_percentage}%` }} />
                    </div>
                  </div>
                )}
                {liveSelectedItem.description && (
                  <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{liveSelectedItem.description}</p>
                )}
              </div>
            </div>
          ) : liveSelectedItem && (liveSelectedItem.source === 'youtube' || liveSelectedItem.source === 'external') ? (
            <LegacyPlayer recording={liveSelectedItem as LegacyRecording} />
          ) : null}
          {liveSelectedItem && recordingCohortId && selectedHelpContext && (
            <div className="mt-3 flex justify-end">
              <ContextualHelp
                key={`${liveSelectedItem.source}-${liveSelectedItem.id}`}
                cohortId={recordingCohortId}
                contextType="recording"
                contextSource={selectedHelpContext.source}
                contextId={selectedHelpContext.id}
                contextLabel={liveSelectedItem.title}
              />
            </div>
          )}
        </div>

        {/* Playlist sidebar */}
        <div className="lg:w-80 xl:w-96 shrink-0">
          <div className="app-surface overflow-hidden lg:sticky lg:top-4">
            {isDesktop ? (
              <h2 className="flex min-h-11 items-center border-b border-line px-4 py-3 text-sm font-semibold tabular-nums text-ink">
                Playlist · {filtered.length}
              </h2>
            ) : (
              <h2>
                <button
                  type="button"
                  aria-expanded={!playlistCollapsed}
                  onClick={() => setPlaylistCollapsed(!playlistCollapsed)}
                  className="flex min-h-11 w-full items-center justify-between border-b border-line px-4 py-3 transition-colors duration-150 active:bg-surface-sunken"
                >
                  <span className="text-sm font-semibold tabular-nums text-ink">
                    Playlist · {filtered.length}
                  </span>
                  <span className="text-ink-muted" aria-hidden="true">
                    {playlistCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
                  </span>
                </button>
              </h2>
            )}

            <div className={`${playlistCollapsed ? 'hidden' : 'block'} lg:block`}>
              {showTabs && (
                <div className="flex border-b border-line" role="group" aria-label="Recording source">
                  {(['all', 'uploaded', 'youtube', 'external'] as const)
                    .filter((tab) => tab === 'all' || allRecordingsForTab(tab, s3Recordings, legacyRecordings).length > 0)
                    .map(tab => (
                    <button
                      key={tab}
                      type="button"
                      aria-pressed={activeTab === tab}
                      onClick={() => setActiveTab(tab)}
                      className={`min-h-11 flex-1 px-3 py-2 text-xs font-semibold transition-colors duration-150 active:bg-surface-sunken ${
                        activeTab === tab ? 'tab-selected' : 'text-ink-secondary hover:text-ink'
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
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search recordings..."
                      aria-label="Search recordings"
                      className="app-control w-full pl-9"
                    />
                  </div>
                </div>
              )}

              <div className="max-h-112 lg:max-h-[calc(100vh-14rem)] overflow-y-auto p-2">
                {filtered.length === 0 ? (
                  <div className="py-6 text-center"><p className="text-sm text-ink-secondary">No recordings match your search.</p>{query && <Button variant="quiet" size="sm" className="mt-2" onClick={() => setQuery('')}>Clear search</Button>}</div>
                ) : (
                  <div className="space-y-1">
                    {filtered.map((recording, idx) => {
                      const isActive = selectedItem?.id === recording.id && selectedItem?.source === recording.source
                      const isS3 = recording.source === 'uploaded'
                      const s3Rec = isS3 ? recording as S3Recording : null
                      const progress = recording.watch_progress
                      return (
                        <button
                          key={`${recording.source}-${recording.id}`}
                          type="button"
                          aria-current={isActive ? 'true' : undefined}
                          onClick={() => setSelectedItem(recording)}
                          className={`pressable min-h-11 w-full rounded-xl px-3 py-2.5 text-left ${
                            isActive
                              ? 'nav-selected'
                              : 'hover:bg-surface-sunken'
                          }`}
                        >
                          <div className="flex items-start gap-2.5">
                            <span className="mt-0.5 w-5 shrink-0 text-right text-xs font-medium tabular-nums text-ink-muted">
                              {idx + 1}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className={`truncate text-sm leading-snug text-ink ${isActive ? 'font-semibold' : 'font-medium'}`}>
                                {recording.title}
                              </p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 tabular-nums">
                                {isS3 && s3Rec?.recorded_date && (
                                  <span className="text-xs text-ink-muted">{formatDate(s3Rec.recorded_date)}</span>
                                )}
                                {!isS3 && (recording as LegacyRecording).date && (
                                  <span className="text-xs text-ink-muted">{formatDate((recording as LegacyRecording).date)}</span>
                                )}
                                {isS3 && s3Rec?.duration_display && (
                                  <span className="text-xs text-ink-muted">{s3Rec.duration_display}</span>
                                )}
                                {!isS3 && (
                                  <span className="flex items-center gap-0.5 text-xs text-ink-muted">
                                    <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                                    {recording.source === 'youtube' ? 'YouTube' : recording.source === 'direct' ? 'Direct video' : recording.source === 'external' ? 'External' : recording.source[0].toUpperCase() + recording.source.slice(1)}
                                  </span>
                                )}
                              </div>
                              {progress && !progress.completed && progress.progress_percentage > 0 && (
                                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-slate-200">
                                  <div className="h-full rounded-full bg-slate-600" style={{ width: `${progress.progress_percentage}%` }} />
                                </div>
                              )}
                            </div>
                            {progress?.completed ? (
                              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-700" aria-label="Watched" />
                            ) : isActive ? (
                              <PlayCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-secondary" aria-hidden="true" />
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
        <div className="relative w-full overflow-hidden rounded-2xl border border-line bg-black" style={{ paddingBottom: '56.25%' }}>
          <iframe
            key={youtubeId}
            className="absolute inset-0 h-full w-full"
            src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1`}
            title={recording.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        <div className="app-surface p-5">
          <h2 className="min-w-0 text-lg font-semibold text-ink [overflow-wrap:anywhere]">{recording.title}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm tabular-nums text-ink-secondary">
            {recording.date && (
              <span className="inline-flex items-center gap-1">
                <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {formatDate(recording.date)}
              </span>
            )}
            <a
              href={sanitizeUrl(recording.url)}
              target="_blank"
              rel="noopener noreferrer"
              className="app-link inline-flex min-h-11 items-center gap-1 lg:min-h-0"
            >
              <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {recording.source === 'youtube' ? 'Watch on YouTube' : 'Open Recording'}
            </a>
          </div>
          {recording.description && (
            <p className="mt-3 text-sm leading-relaxed text-ink-secondary">{recording.description}</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-center rounded-2xl border border-line bg-surface-sunken py-24">
        <div className="text-center">
          <PlayCircle className="mx-auto mb-3 h-12 w-12 text-ink-disabled" aria-hidden="true" />
          <p className="mb-3 text-sm text-ink-secondary">This recording can't be embedded.</p>
          <AnchorButton
            variant="primary"
            href={sanitizeUrl(recording.url)}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
            Open Recording
          </AnchorButton>
        </div>
      </div>
      <div className="app-surface p-5">
        <h2 className="min-w-0 text-lg font-semibold text-ink [overflow-wrap:anywhere]">{recording.title}</h2>
        {recording.description && (
          <p className="mt-2 text-sm text-ink-secondary">{recording.description}</p>
        )}
      </div>
    </div>
  )
}

function allRecordingsForTab(tab: RecordingTab, uploaded: S3Recording[], legacy: LegacyRecording[]): RecordingItem[] {
  if (tab === 'uploaded') return uploaded
  if (tab === 'youtube') return legacy.filter((recording) => recording.source === 'youtube')
  if (tab === 'external') return legacy.filter((recording) => recording.source !== 'youtube')
  return [...uploaded, ...legacy]
}
