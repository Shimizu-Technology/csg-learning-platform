import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, PlayCircle, ExternalLink, CalendarDays, Search, ChevronDown, ChevronUp } from 'lucide-react'
import { api } from '../../lib/api'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'

interface RecordingItem {
  id: number
  title: string
  url: string
  date: string | null
  description: string | null
}

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
  } catch {
    // not a valid URL
  }
  return null
}

export function Recordings() {
  const [recordings, setRecordings] = useState<RecordingItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [playlistCollapsed, setPlaylistCollapsed] = useState(false)

  useEffect(() => {
    api.getRecordings().then((res) => {
      if (res.data?.recordings) {
        setRecordings(res.data.recordings)
        if (res.data.recordings.length > 0) {
          setSelectedId(res.data.recordings[0].id)
        }
      }
      setLoading(false)
    })
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return recordings
    return recordings.filter(
      (r) =>
        r.title.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        (r.date || '').includes(q)
    )
  }, [recordings, query])

  const selected = recordings.find((r) => r.id === selectedId) || null
  const youtubeId = selected ? extractYouTubeId(selected.url) : null

  if (loading) return <LoadingSpinner message="Loading recordings..." />

  if (recordings.length === 0) {
    return (
      <EmptyState
        icon={PlayCircle}
        title="No recordings yet"
        description="Class recordings will appear here once your instructor adds them."
      />
    )
  }

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      <div>
        <Link to="/" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 mb-2">
          <ArrowLeft className="h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">Class Recordings</h1>
        <p className="mt-1 text-sm text-slate-500">
          {recordings.length} recording{recordings.length !== 1 ? 's' : ''} available.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Player */}
        <div className="flex-1 min-w-0">
          {selected && youtubeId ? (
            <div className="space-y-4">
              <div className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-black" style={{ paddingBottom: '56.25%' }}>
                <iframe
                  key={youtubeId}
                  className="absolute inset-0 h-full w-full"
                  src={`https://www.youtube-nocookie.com/embed/${youtubeId}?rel=0&modestbranding=1`}
                  title={selected.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                />
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h2 className="text-lg font-semibold text-slate-900">{selected.title}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-500">
                  {selected.date && (
                    <span className="inline-flex items-center gap-1">
                      <CalendarDays className="h-3.5 w-3.5" />
                      {formatDate(selected.date)}
                    </span>
                  )}
                  <a
                    href={selected.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary-600 hover:text-primary-700 transition-colors"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Watch on YouTube
                  </a>
                </div>
                {selected.description && (
                  <p className="mt-3 text-sm text-slate-600 leading-relaxed">{selected.description}</p>
                )}
              </div>
            </div>
          ) : selected ? (
            <div className="space-y-4">
              <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 py-24">
                <div className="text-center">
                  <PlayCircle className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                  <p className="text-sm text-slate-500 mb-3">This recording can't be embedded.</p>
                  <a
                    href={selected.url}
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
                <h2 className="text-lg font-semibold text-slate-900">{selected.title}</h2>
                {selected.description && (
                  <p className="mt-2 text-sm text-slate-600">{selected.description}</p>
                )}
              </div>
            </div>
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
                Playlist · {recordings.length}
              </span>
              <span className="lg:hidden text-slate-400">
                {playlistCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
              </span>
            </button>

            <div className={`${playlistCollapsed ? 'hidden' : 'block'} lg:block`}>
              {recordings.length > 6 && (
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
                      const isActive = recording.id === selectedId
                      const hasYt = !!extractYouTubeId(recording.url)
                      return (
                        <button
                          key={recording.id}
                          onClick={() => setSelectedId(recording.id)}
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
                              <div className="flex items-center gap-2 mt-0.5">
                                {recording.date && (
                                  <span className="text-[11px] text-slate-400">{formatDate(recording.date)}</span>
                                )}
                                {!hasYt && (
                                  <span className="text-[10px] text-slate-400 flex items-center gap-0.5">
                                    <ExternalLink className="h-2.5 w-2.5" />
                                    External
                                  </span>
                                )}
                              </div>
                            </div>
                            {isActive && (
                              <PlayCircle className="h-4 w-4 text-primary-500 shrink-0 mt-0.5" />
                            )}
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
