import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Bell, Check, ChevronLeft, ChevronRight, Megaphone, Pin, Send, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { browserPushEnabled, disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported } from '../../lib/pushNotifications'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { FilterChip, SegmentButton, SegmentedControl } from '../../components/ui/Choice'
import { formatShortDateTime } from '../../lib/format'
import type { Announcement, CohortSummary, PaginationMeta } from '../../types/api'

type AnnouncementAudience = 'cohort' | 'global' | 'staff'
type AnnouncementStatus = 'draft' | 'published' | 'archived'
type AnnouncementSort = 'published_desc' | 'published_asc' | 'created_desc' | 'created_asc' | 'updated_desc' | 'updated_asc'
type AnnouncementReadFilter = 'all' | 'read' | 'unread'

function formatDate(date?: string | null) {
  return formatShortDateTime(date, 'Draft')
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
}

const STATUS_FILTERS: { value: AnnouncementStatus | 'all'; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All statuses' },
]

const AUDIENCE_FILTERS: { value: AnnouncementAudience | 'all'; label: string }[] = [
  { value: 'all', label: 'All audiences' },
  { value: 'cohort', label: 'Cohorts' },
  { value: 'global', label: 'Everyone' },
  { value: 'staff', label: 'Staff only' },
]

function audienceLabel(announcement: Announcement) {
  if (announcement.cohort_name) return announcement.cohort_name
  if (announcement.audience === 'staff') return 'Staff'
  return 'Everyone'
}

function emptyPagination(): PaginationMeta {
  return {
    page: 1,
    per_page: 20,
    total_count: 0,
    total_pages: 0,
    has_next_page: false,
    has_prev_page: false,
  }
}

export function Announcements() {
  const { id } = useParams()
  const toast = useToast()
  const confirmAction = useConfirm()
  const selectedId = id ? Number(id) : null
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthContext()
  const { selectedCohortId, setSelectedCohort } = useCohortContext()
  const isStaff = Boolean(user?.is_staff)
  const manageMode = isStaff && searchParams.get('scope') === 'manage'
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [cohorts, setCohorts] = useState<CohortSummary[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [pagination, setPagination] = useState<PaginationMeta>(emptyPagination())
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [archivingId, setArchivingId] = useState<number | null>(null)
  const [pushMessage, setPushMessage] = useState('')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    title: '',
    body: '',
    audience: 'cohort',
    cohort_id: '',
    pinned: false,
    send_push: true,
  })

  const page = Number(searchParams.get('page') || '1')
  const readFilter: AnnouncementReadFilter = searchParams.get('read') === 'read' ? 'read' : searchParams.get('read') === 'unread' ? 'unread' : 'all'
  const audienceFilter: AnnouncementAudience | 'all' = searchParams.get('audience') === 'cohort' || searchParams.get('audience') === 'global' || searchParams.get('audience') === 'staff'
    ? searchParams.get('audience') as AnnouncementAudience
    : 'all'
  const statusFilter: AnnouncementStatus | 'all' = searchParams.get('status') === 'draft' || searchParams.get('status') === 'published' || searchParams.get('status') === 'archived'
    ? searchParams.get('status') as AnnouncementStatus
    // Manage mode opens on published; "any" in the URL keeps "All statuses" selected.
    : manageMode && searchParams.get('status') !== 'any' ? 'published' : 'all'
  const cohortFilter = searchParams.get('cohort_id') || (selectedCohortId ? String(selectedCohortId) : 'all')
  const sortFilter: AnnouncementSort = (() => {
    const value = searchParams.get('sort')
    if (value === 'published_asc' || value === 'created_desc' || value === 'created_asc' || value === 'updated_desc' || value === 'updated_asc') {
      return value as AnnouncementSort
    }
    return 'published_desc'
  })()

  const selected = useMemo(
    () => announcements.find((announcement) => announcement.id === selectedId) || null,
    [announcements, selectedId],
  )

  const updateQuery = useCallback((patch: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(searchParams)
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined || value === null || value === '' || value === 'all') {
        next.delete(key)
      } else {
        next.set(key, value)
      }
    })
    setSearchParams(next)
  }, [searchParams, setSearchParams])

  const updateCohortFilter = useCallback((value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'all') next.delete('cohort_id')
    else next.set('cohort_id', value)
    next.set('page', '1')
    setSelectedCohort(value === 'all' ? null : Number(value), { searchParams: next })
  }, [searchParams, setSelectedCohort])

  const loadAnnouncements = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) setLoading(true)

    const res = await api.getAnnouncements({
      scope: manageMode ? 'manage' : undefined,
      page,
      per_page: 12,
      audience: audienceFilter === 'all' ? undefined : audienceFilter,
      status: manageMode && statusFilter !== 'all' ? statusFilter : undefined,
      cohort_id: cohortFilter === 'all' || (manageMode && audienceFilter !== 'cohort') ? undefined : Number(cohortFilter),
      read: !manageMode && readFilter !== 'all' ? readFilter : undefined,
      sort: sortFilter,
    })

    if (res.data) {
      setAnnouncements(res.data.announcements)
      setUnreadCount(res.data.unread_count)
      setPagination(res.data.meta)
    }

    if (!background) setLoading(false)
  }, [manageMode, page, audienceFilter, statusFilter, cohortFilter, readFilter, sortFilter])
  const loadAnnouncementsRef = useRef(loadAnnouncements)

  useEffect(() => {
    loadAnnouncements()
  }, [loadAnnouncements])

  useEffect(() => {
    loadAnnouncementsRef.current = loadAnnouncements
  }, [loadAnnouncements])

  useEffect(() => {
    if (!isStaff) return

    api.getCohorts().then((res) => {
      if (!res.data) return
      const nextCohorts = res.data.cohorts
      setCohorts(nextCohorts)
      setForm((prev) => ({ ...prev, cohort_id: prev.cohort_id || String(nextCohorts[0]?.id || '') }))
    })
  }, [isStaff])

  useEffect(() => {
    if (!pushSupported()) return

    Promise.all([
      api.getPushConfig(),
      navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()),
    ])
      .then(([config, subscription]) => setPushEnabled(browserPushEnabled(config.data, subscription)))
      .catch(() => setPushEnabled(false))
  }, [])

  useEffect(() => {
    if (!selectedId) return

    api.getAnnouncement(selectedId).then(async (res) => {
      if (!res.data) return
      setAnnouncements((prev) => {
        const exists = prev.some((announcement) => announcement.id === res.data!.announcement.id)
        if (exists) {
          return prev.map((announcement) => announcement.id === res.data!.announcement.id ? res.data!.announcement : announcement)
        }
        return [res.data!.announcement, ...prev]
      })
      await loadAnnouncementsRef.current({ background: true })
    })
  }, [selectedId])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setFormError('')

    const audience = form.audience
    const res = await api.createAnnouncement({
      title: form.title.trim(),
      body: form.body.trim(),
      audience,
      cohort_id: audience === 'cohort' ? Number(form.cohort_id) : null,
      status: 'published',
      pinned: form.pinned,
      send_push: form.send_push,
    })

    if (res.error) {
      setFormError(res.error)
      toast.error(res.error)
    } else if (res.data) {
      setForm((prev) => ({ ...prev, title: '', body: '', pinned: false }))
      await loadAnnouncements()
      toast.success('Announcement published')
    }
    setSaving(false)
  }

  const handleArchive = async (announcement: Announcement) => {
    if (!announcement.id || archivingId) return
    if (!await confirmAction({
      title: 'Archive announcement?',
      description: `“${announcement.title}” will leave the active announcement feed but remain in history.`,
      confirmLabel: 'Archive announcement',
      tone: 'danger',
    })) return

    setArchivingId(announcement.id)
    const res = await api.archiveAnnouncement(announcement.id)
    if (res.error) {
      setFormError(res.error)
      toast.error(res.error)
    } else {
      await loadAnnouncements({ background: true })
      toast.success('Announcement archived')
    }
    setArchivingId(null)
  }

  const handleMarkAllRead = async () => {
    const res = await api.markAllNotificationsRead('announcement')
    if (res.data) {
      setUnreadCount(res.data.unread_count)
      await loadAnnouncements({ background: true })
    }
  }

  const handleTogglePush = async () => {
    setPushMessage('')
    if (pushEnabled) {
      try {
        await disablePushNotifications()
        setPushEnabled(false)
        setPushMessage('Browser alerts are off on your account. Message emails are unchanged.')
      } catch (error) {
        setPushMessage(error instanceof Error ? error.message : 'Could not turn off notifications.')
      }
      return
    }

    const config = await api.getPushConfig()
    if (config.error) {
      setPushMessage(config.error)
      return
    }

    const configured = Boolean(config.data?.configured)
    const publicKey = config.data?.public_key || import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
    if (!configured || !publicKey) {
      setPushMessage(pushConfigurationHint({
        configured,
        missing: config.data?.missing || [],
        publicKey,
      }))
      return
    }

    try {
      await enablePushNotifications(publicKey)
      setPushEnabled(true)
      setPushMessage('Browser alerts are on for this browser. Message emails are unchanged.')
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : 'Could not enable notifications.')
    }
  }

  if (loading) return <LoadingSpinner message="Loading announcements..." />

  const clearFilters = () => updateQuery(manageMode
    ? { audience: null, cohort_id: null, status: 'published', sort: 'published_desc', page: '1' }
    : { read: null, sort: 'published_desc', page: '1' })

  return (
    <div className="app-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="app-eyebrow">Communication</p>
          <h1 className="app-title mt-2">{manageMode ? 'Announcement studio' : 'Updates'}</h1>
          <p className="app-description mt-2">
            {manageMode
              ? 'Manage published updates, authorship, and archive state.'
              : 'Class updates, pinned notices, and important CSG messages.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isStaff && (
            <SegmentedControl label="Announcements view">
              <SegmentButton
                dense
                selected={!manageMode}
                onClick={() => updateQuery({ scope: null, status: null, audience: null, cohort_id: null, page: '1' })}
              >
                Inbox
              </SegmentButton>
              <SegmentButton
                dense
                selected={manageMode}
                onClick={() => updateQuery({ scope: 'manage', status: statusFilter === 'all' ? 'published' : statusFilter, page: '1' })}
              >
                Manage
              </SegmentButton>
            </SegmentedControl>
          )}
          {unreadCount > 0 && (
            <Button variant="secondary" onClick={handleMarkAllRead}>
              <Check className="h-4 w-4" aria-hidden="true" />
              Mark all read
            </Button>
          )}
          {!manageMode && pushSupported() && (
            <Button variant="secondary" onClick={handleTogglePush}>
              <Bell className="h-4 w-4" aria-hidden="true" />
              {pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts'}
            </Button>
          )}
        </div>
      </div>

      {pushMessage && (
        <div role="status" className="rounded-xl border border-info-200 bg-info-50 px-4 py-3 text-sm text-info-800">
          {pushMessage}
        </div>
      )}

      {manageMode && (
        <form onSubmit={handleCreate} className="app-surface space-y-4 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
            <h2 className="text-lg font-bold text-ink">Post an announcement</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_220px]">
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Title"
              required
              className="app-control"
            />
            <select
              value={form.audience}
              onChange={(event) => setForm((prev) => ({ ...prev, audience: event.target.value }))}
              className="app-control"
            >
              <option value="cohort">Cohort</option>
              <option value="global">Everyone</option>
              <option value="staff">Staff only</option>
            </select>
            <select
              value={form.cohort_id}
              onChange={(event) => setForm((prev) => ({ ...prev, cohort_id: event.target.value }))}
              disabled={form.audience !== 'cohort'}
              required={form.audience === 'cohort'}
              className="app-control"
            >
              {cohorts.map((cohort) => (
                <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
              ))}
            </select>
          </div>
          <textarea
            value={form.body}
            onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
            placeholder="What should students know?"
            required
            rows={4}
            className="app-control w-full"
          />
          {formError && (
            <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700">
              {formError}
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-4 text-sm text-ink-secondary">
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(event) => setForm((prev) => ({ ...prev, pinned: event.target.checked }))}
                  className="h-4 w-4 rounded border-line-strong accent-slate-900"
                />
                Pin this
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.send_push}
                  onChange={(event) => setForm((prev) => ({ ...prev, send_push: event.target.checked }))}
                  className="h-4 w-4 rounded border-line-strong accent-slate-900"
                />
                Send push
              </label>
            </div>
            <Button type="submit" disabled={saving}>
              <Send className="h-4 w-4" aria-hidden="true" />
              {saving ? 'Posting...' : 'Post announcement'}
            </Button>
          </div>
        </form>
      )}

      <div className="app-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h2 className="font-semibold text-ink">{manageMode ? 'Announcement history' : 'Your feed'}</h2>
            <p className="text-sm text-ink-secondary">
              {manageMode
                ? 'Filter by audience, cohort, status, and sort order.'
                : 'Unread updates stay highlighted here until you read them.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {manageMode ? (
              <>
                <div role="group" aria-label="Status" className="flex w-full flex-wrap gap-2">
                  {STATUS_FILTERS.map((option) => (
                    <FilterChip
                      key={option.value}
                      dense
                      selected={statusFilter === option.value}
                      onClick={() => updateQuery({ status: option.value === 'all' ? 'any' : option.value, page: '1' })}
                    >
                      {option.label}
                    </FilterChip>
                  ))}
                </div>
                <div role="group" aria-label="Audience" className="flex w-full flex-wrap gap-2">
                  {AUDIENCE_FILTERS.map((option) => (
                    <FilterChip
                      key={option.value}
                      dense
                      selected={audienceFilter === option.value}
                      onClick={() => updateQuery({ audience: option.value, cohort_id: option.value === 'cohort' ? cohortFilter : null, page: '1' })}
                    >
                      {option.label}
                    </FilterChip>
                  ))}
                </div>
                <select
                  value={cohortFilter}
                  onChange={(event) => updateCohortFilter(event.target.value)}
                  disabled={audienceFilter !== 'cohort'}
                  aria-label="Cohort"
                  className="app-control"
                >
                  <option value="all">All cohorts</option>
                  {cohorts.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
                  ))}
                </select>
              </>
            ) : (
              <select
                value={readFilter}
                onChange={(event) => updateQuery({ read: event.target.value, page: '1' })}
                className="app-control"
              >
                <option value="all">All updates</option>
                <option value="unread">Unread only</option>
                <option value="read">Read only</option>
              </select>
            )}
            <select
              value={sortFilter}
              onChange={(event) => updateQuery({ sort: event.target.value, page: '1' })}
              className="app-control"
            >
              <option value="published_desc">Newest published</option>
              <option value="published_asc">Oldest published</option>
              <option value="created_desc">Newest created</option>
              <option value="created_asc">Oldest created</option>
              <option value="updated_desc">Recently updated</option>
              <option value="updated_asc">Least recently updated</option>
            </select>
            <Button variant="quiet" onClick={clearFilters}>
              Clear filters
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {announcements.length === 0 ? (
            <div className="app-surface">
              <EmptyState icon={Megaphone} title="No announcements match these filters." action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
            </div>
          ) : announcements.map((announcement) => {
            const detailPath = `/announcements/${announcement.id}${location.search}`
            const isSelected = announcement.id === selectedId
            const isArchiving = archivingId === announcement.id

            return (
              <article
                key={announcement.id}
                className={`rounded-2xl border bg-surface-raised p-4 transition-colors duration-150 ${isSelected ? 'border-slate-400 shadow-raised' : announcement.read_at ? 'border-line' : 'border-line-strong shadow-raised'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={detailPath} className="min-w-0 font-semibold text-ink underline-offset-4 transition-colors duration-150 [overflow-wrap:anywhere] hover:underline">
                        {announcement.title}
                      </Link>
                      {announcement.pinned && (
                        <Badge icon={<Pin className="h-3 w-3" aria-hidden="true" />}>Pinned</Badge>
                      )}
                      {!announcement.read_at && !manageMode && (
                        <Badge tone="info">Unread</Badge>
                      )}
                      {manageMode && announcement.status ? (
                        <Badge tone={announcement.status === 'published' ? 'success' : 'neutral'}>{STATUS_LABELS[announcement.status] || announcement.status}</Badge>
                      ) : announcement.status && announcement.status !== 'published' && (
                        <Badge tone="neutral">{STATUS_LABELS[announcement.status] || announcement.status}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-ink-secondary">
                      {announcement.author?.full_name || 'Unknown author'} · {audienceLabel(announcement)} · {formatDate(announcement.published_at)}
                    </p>
                  </div>
                  {manageMode && announcement.status !== 'archived' && (
                    <Button variant="danger" size="sm" className="shrink-0" onClick={() => handleArchive(announcement)} disabled={isArchiving}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {isArchiving ? 'Archiving...' : 'Archive'}
                    </Button>
                  )}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{announcement.body}</p>
              </article>
            )
          })}

          {pagination.total_pages > 1 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm tabular-nums text-ink-secondary">
                Showing page {pagination.page} of {pagination.total_pages} · {pagination.total_count} total announcement{pagination.total_count === 1 ? '' : 's'}
              </p>
              <div className="flex items-center gap-2">
                <Button variant="secondary" size="sm" onClick={() => updateQuery({ page: String(Math.max(1, pagination.page - 1)) })} disabled={!pagination.has_prev_page}>
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  Previous
                </Button>
                <Button variant="secondary" size="sm" onClick={() => updateQuery({ page: String(pagination.page + 1) })} disabled={!pagination.has_next_page}>
                  Next
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </div>

        <aside className="app-surface p-4 lg:sticky lg:top-6 lg:self-start">
          <h2 className="font-semibold text-ink [overflow-wrap:anywhere]">{selected ? selected.title : manageMode ? 'Announcement details' : 'Inbox status'}</h2>
          {selected ? (
            <div className="mt-3 space-y-3 text-sm text-ink-secondary">
              <div className="rounded-xl bg-surface-sunken px-3 py-2">
                <p className="text-xs font-semibold text-ink-muted">From</p>
                <p className="mt-1 tabular-nums text-ink [overflow-wrap:anywhere]">{selected.author?.full_name || 'Unknown author'}</p>
              </div>
              <div className="rounded-xl bg-surface-sunken px-3 py-2">
                <p className="text-xs font-semibold text-ink-muted">Audience</p>
                <p className="mt-1 tabular-nums text-ink [overflow-wrap:anywhere]">{audienceLabel(selected)}</p>
              </div>
              <div className="rounded-xl bg-surface-sunken px-3 py-2">
                <p className="text-xs font-semibold text-ink-muted">Published</p>
                <p className="mt-1 tabular-nums text-ink [overflow-wrap:anywhere]">{formatDate(selected.published_at)}</p>
              </div>
              {selected.updated_at && selected.updated_at !== selected.created_at && (
                <div className="rounded-xl bg-surface-sunken px-3 py-2">
                  <p className="text-xs font-semibold text-ink-muted">Updated</p>
                  <p className="mt-1 tabular-nums text-ink [overflow-wrap:anywhere]">{formatDate(selected.updated_at)}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3 text-sm text-ink-secondary">
              <div className="rounded-xl bg-surface-sunken px-3 py-2">
                <p className="text-xs font-semibold text-ink-muted">{manageMode ? 'Queue' : 'Unread'}</p>
                <p className="mt-1 tabular-nums text-ink [overflow-wrap:anywhere]">
                  {manageMode
                    ? `${pagination.total_count} announcement${pagination.total_count === 1 ? '' : 's'} match the current filters.`
                    : unreadCount > 0
                      ? `You have ${unreadCount} unread update${unreadCount === 1 ? '' : 's'}.`
                      : 'You are caught up.'}
                </p>
              </div>
              <div className="rounded-xl border border-info-200 bg-info-50 px-3 py-2 text-info-800">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <p className="font-medium">{manageMode ? 'Management tip' : 'Dashboard behavior'}</p>
                </div>
                <p className="mt-2 text-sm leading-6">
                  {manageMode
                    ? 'Archive older updates to keep the feed focused, then use filters to revisit history when needed.'
                    : 'Pinned notices stay on the dashboard. Regular notices disappear from the dashboard once they are read.'}
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
