import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ExternalLink, Link2, Search, Video, MessageSquare, Github, FileText, Globe, RefreshCw, WifiOff, Keyboard, Copy, Check } from 'lucide-react'
import { api } from '../../lib/api'
import { useCohortContext } from '../../contexts/CohortContext'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Button, IconButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import type { ResourceEntry } from '../../types/api'
import { downloadCourseResource } from '../../lib/downloadCourseResource'

type ResourceItem = ResourceEntry

const categoryConfig: Record<string, { label: string; icon: typeof Globe }> = {
  meeting: { label: 'Meeting', icon: Video },
  github: { label: 'GitHub', icon: Github },
  communication: { label: 'Communication', icon: MessageSquare },
  documentation: { label: 'Docs', icon: FileText },
  hotkeys: { label: 'Hotkeys', icon: Keyboard },
  shortcuts: { label: 'Hotkeys', icon: Keyboard },
  general: { label: 'General', icon: Globe },
}

export function Resources() {
  const { selectedCohortId } = useCohortContext()
  const [resources, setResources] = useState<ResourceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showingSavedData, setShowingSavedData] = useState(false)
  const [query, setQuery] = useState('')
  const [copiedResourceId, setCopiedResourceId] = useState<number | string | null>(null)
  const resourcesRequest = useRef(0)

  const loadResources = useCallback(() => {
    const request = ++resourcesRequest.current
    setLoading(true)
    setResources([])
    setLoadError(null)
    setShowingSavedData(false)

    api.getResources(selectedCohortId ?? undefined)
      .then((res) => {
        if (request !== resourcesRequest.current) return
        if (res.data?.resources) {
          setResources(res.data.resources)
          setShowingSavedData(Boolean(res.fromCache))
          setLoadError(res.fromCache ? res.error : null)
          return
        }

        setLoadError(res.error || 'Unable to load resources right now.')
      })
      .catch((error: unknown) => {
        if (request !== resourcesRequest.current) return
        setLoadError(error instanceof Error ? error.message : 'Unable to load resources right now.')
      })
      .finally(() => { if (request === resourcesRequest.current) setLoading(false) })
  }, [selectedCohortId])

  useEffect(() => {
    loadResources()
  }, [loadResources])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return resources
    return resources.filter((resource) =>
      resource.title.toLowerCase().includes(q) ||
      resource.url.toLowerCase().includes(q) ||
      resource.category.toLowerCase().includes(q) ||
      (resource.description || '').toLowerCase().includes(q)
    )
  }, [resources, query])

  const grouped = useMemo(() => {
    const hotkeys = filtered.filter((resource) => ['hotkeys', 'shortcuts'].includes(resource.category))
    const regular = filtered.filter((resource) => !['hotkeys', 'shortcuts'].includes(resource.category))
    return { hotkeys, regular }
  }, [filtered])

  const copyResource = useCallback((resource: ResourceItem) => {
    if (!navigator.clipboard) return

    void navigator.clipboard.writeText(resource.url).then(() => {
      setCopiedResourceId(resource.id)
      window.setTimeout(() => setCopiedResourceId((current) => current === resource.id ? null : current), 1800)
    })
  }, [])

  if (loading) return <LoadingSpinner message="Loading resources..." />

  if (loadError && resources.length === 0) {
    return (
      <div className="app-page max-w-5xl"><EmptyState
        icon={WifiOff}
        title="Could not load resources"
        description={loadError}
        action={
          <Button onClick={loadResources}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        }
      /></div>
    )
  }

  if (resources.length === 0) {
    return (
      <div className="app-page max-w-5xl"><EmptyState
        icon={Link2}
        title="No resources yet"
        description="Class resources will appear here once your instructor adds them."
        action={<Link to="/dashboard" className="app-link inline-flex min-h-11 items-center gap-1"><ArrowLeft className="h-4 w-4" aria-hidden="true" />Back to Dashboard</Link>}
      /></div>
    )
  }

  return (
    <div className="app-page max-w-5xl">
      {showingSavedData && (
        <div className="rounded-2xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-800">
          Showing saved resources while your connection catches up.
        </div>
      )}
      <header>
        <Link to="/dashboard" className="mb-2 inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink active:bg-slate-200/70">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Dashboard
        </Link>
        <p className="app-eyebrow">Your class library</p>
        <h1 className="app-title mt-2">Resources</h1>
        <p className="app-description mt-2">Important links, references, and shortcuts collected for your cohort.</p>
      </header>

      {resources.length > 4 && (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search resources..."
            aria-label="Search resources"
            className="app-control w-full pl-10"
          />
        </div>
      )}

      {grouped.hotkeys.length > 0 && (
        <section className="rounded-2xl border border-line bg-surface-sunken p-4">
          <div className="mb-3 flex items-center gap-2">
            <Keyboard className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <h2 className="text-sm font-semibold text-ink">Hotkeys and shortcuts</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {grouped.hotkeys.map((resource) => (
              <HotkeyCard
                key={resource.id}
                resource={resource}
                copied={copiedResourceId === resource.id}
                onCopy={() => copyResource(resource)}
              />
            ))}
          </div>
        </section>
      )}

      <div className="space-y-3">
        {grouped.regular.map((resource) => (
          <ResourceCard key={resource.id} resource={resource} />
        ))}
      </div>
    </div>
  )
}

function HotkeyCard({
  resource,
  copied,
  onCopy,
}: {
  resource: ResourceItem
  copied: boolean
  onCopy: () => void
}) {
  return (
    <div className="app-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Keyboard className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <h2 className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{resource.title}</h2>
          </div>
          {resource.description && (
            <p className="mt-2 text-sm leading-6 text-ink-secondary">{resource.description}</p>
          )}
          <p className="mt-2 break-all text-xs text-ink-muted">{resource.url}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <IconButton label="Copy shortcut link" onClick={onCopy}>
            {copied ? <Check className="h-4 w-4 text-success-700" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
          </IconButton>
          <a
            href={sanitizeUrl(resource.url)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink active:bg-slate-200/70"
            aria-label="Open shortcut resource"
            title="Open shortcut resource"
          >
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      </div>
    </div>
  )
}

function ResourceCard({ resource, compact = false }: { resource: ResourceItem; compact?: boolean }) {
          const [downloading, setDownloading] = useState(false)
          const [error, setError] = useState('')
          const download = async () => {
            if (!resource.download_id || !resource.curriculum_id || downloading) return
            setDownloading(true); setError('')
            try {
              await downloadCourseResource(resource.curriculum_id, resource.download_id, resource.filename || 'course-resources.zip')
            } catch (cause) { setError(cause instanceof Error ? cause.message : 'Download failed.') }
            finally { setDownloading(false) }
          }
          if (resource.download_id) return <div className="app-surface p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><h2 className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{resource.title}</h2><p className="mt-1 break-all text-sm text-ink-secondary">{resource.filename}</p></div>
              <Button variant="secondary" disabled={downloading} onClick={() => void download()}>{downloading ? 'Preparing download…' : 'Download ZIP'}</Button></div>
            {error && <p role="alert" className="mt-2 text-sm text-danger-700">{error}</p>}
          </div>
          const cat = categoryConfig[resource.category] || categoryConfig.general
          const Icon = cat.icon
          return (
            <a
              href={sanitizeUrl(resource.url)}
              target="_blank"
              rel="noopener noreferrer"
      className={`pressable block rounded-2xl border border-line bg-surface-raised shadow-raised ${compact ? 'p-4' : 'p-5'} hover:border-line-strong hover:bg-surface-sunken`}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <Icon className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="min-w-0 text-sm font-semibold text-ink [overflow-wrap:anywhere]">{resource.title}</h2>
                      <Badge>{cat.label}</Badge>
                    </div>
                    {resource.description && (
                      <p className="mt-1 text-sm text-ink-secondary">{resource.description}</p>
                    )}
                    <p className="mt-1 break-all text-xs text-ink-muted">{resource.url}</p>
                  </div>
                </div>
                <ExternalLink className="mt-1 h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </div>
            </a>
          )
}
