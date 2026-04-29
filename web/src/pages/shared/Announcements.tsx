import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Bell, Check, ChevronLeft, ChevronRight, Megaphone, Pin, Send, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported } from '../../lib/pushNotifications'
import { useAuthContext } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import type { Announcement, CohortSummary, PaginationMeta } from '../../types/api'

type AnnouncementAudience = 'cohort' | 'global' | 'staff'
type AnnouncementStatus = 'draft' | 'published' | 'archived'
type AnnouncementSort = 'published_desc' | 'published_asc' | 'created_desc' | 'created_asc' | 'updated_desc' | 'updated_asc'
type AnnouncementReadFilter = 'all' | 'read' | 'unread'

function formatDate(date?: string | null) {
  if (!date) return 'Draft'
  return new Date(date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

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
  const selectedId = id ? Number(id) : null
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthContext()
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
    : manageMode ? 'published' : 'all'
  const cohortFilter = searchParams.get('cohort_id') || 'all'
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

  const loadAnnouncements = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    if (!background) setLoading(true)

    const res = await api.getAnnouncements({
      scope: manageMode ? 'manage' : undefined,
      page,
      per_page: 12,
      audience: audienceFilter === 'all' ? undefined : audienceFilter,
      status: manageMode && statusFilter !== 'all' ? statusFilter : undefined,
      cohort_id: cohortFilter === 'all' ? undefined : Number(cohortFilter),
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

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushEnabled(Boolean(subscription)))
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
    if (!window.confirm(`Archive "${announcement.title}"?`)) return

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
        setPushMessage('Class notifications are off for this device.')
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
      setPushMessage('Class notifications are on for this device.')
    } catch (error) {
      setPushMessage(error instanceof Error ? error.message : 'Could not enable notifications.')
    }
  }

  if (loading) return <LoadingSpinner message="Loading announcements..." />

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-medium text-primary-600">Communication</p>
          <h1 className="text-2xl font-semibold text-slate-900">Announcements</h1>
          <p className="mt-1 text-sm text-slate-500">
            {manageMode
              ? 'Manage published updates, authorship, and archive state.'
              : 'Class updates, pinned notices, and important CSG messages.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isStaff && (
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
              <button
                onClick={() => updateQuery({ scope: null, status: null, audience: null, cohort_id: null, page: '1' })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${!manageMode ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Inbox
              </button>
              <button
                onClick={() => updateQuery({ scope: 'manage', status: statusFilter === 'all' ? 'published' : statusFilter, page: '1' })}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${manageMode ? 'bg-primary-50 text-primary-700' : 'text-slate-600 hover:text-slate-900'}`}
              >
                Manage
              </button>
            </div>
          )}
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Check className="h-4 w-4" />
              Mark all read
            </button>
          )}
          {!manageMode && pushSupported() && (
            <button
              onClick={handleTogglePush}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              <Bell className="h-4 w-4" />
              {pushEnabled ? 'Turn off push' : 'Turn on push'}
            </button>
          )}
        </div>
      </div>

      {pushMessage && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700">
          {pushMessage}
        </div>
      )}

      {manageMode && (
        <form onSubmit={handleCreate} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary-500" />
            <h2 className="font-semibold text-slate-900">Post an announcement</h2>
          </div>
          <div className="grid gap-3 md:grid-cols-[1fr_180px_220px]">
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Title"
              required
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select
              value={form.audience}
              onChange={(event) => setForm((prev) => ({ ...prev, audience: event.target.value }))}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
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
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-400"
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
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-4 text-sm text-slate-600">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(event) => setForm((prev) => ({ ...prev, pinned: event.target.checked }))}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                Pin this
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.send_push}
                  onChange={(event) => setForm((prev) => ({ ...prev, send_push: event.target.checked }))}
                  className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                />
                Send push
              </label>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
              {saving ? 'Posting...' : 'Post announcement'}
            </button>
          </div>
        </form>
      )}

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h2 className="font-semibold text-slate-900">{manageMode ? 'Announcement history' : 'Your feed'}</h2>
            <p className="text-sm text-slate-500">
              {manageMode
                ? 'Filter by audience, cohort, status, and sort order.'
                : 'Unread updates stay highlighted here until you read them.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {manageMode ? (
              <>
                <select
                  value={audienceFilter}
                  onChange={(event) => updateQuery({ audience: event.target.value, cohort_id: event.target.value === 'cohort' ? cohortFilter : null, page: '1' })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="all">All audiences</option>
                  <option value="cohort">Cohorts</option>
                  <option value="global">Everyone</option>
                  <option value="staff">Staff only</option>
                </select>
                <select
                  value={cohortFilter}
                  onChange={(event) => updateQuery({ cohort_id: event.target.value, page: '1' })}
                  disabled={audienceFilter !== 'cohort'}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <option value="all">All cohorts</option>
                  {cohorts.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
                  ))}
                </select>
                <select
                  value={statusFilter}
                  onChange={(event) => updateQuery({ status: event.target.value, page: '1' })}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="published">Published</option>
                  <option value="draft">Drafts</option>
                  <option value="archived">Archived</option>
                  <option value="all">All statuses</option>
                </select>
              </>
            ) : (
              <select
                value={readFilter}
                onChange={(event) => updateQuery({ read: event.target.value, page: '1' })}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <option value="all">All updates</option>
                <option value="unread">Unread only</option>
                <option value="read">Read only</option>
              </select>
            )}
            <select
              value={sortFilter}
              onChange={(event) => updateQuery({ sort: event.target.value, page: '1' })}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="published_desc">Newest published</option>
              <option value="published_asc">Oldest published</option>
              <option value="created_desc">Newest created</option>
              <option value="created_asc">Oldest created</option>
              <option value="updated_desc">Recently updated</option>
              <option value="updated_asc">Least recently updated</option>
            </select>
            <button
              onClick={() => updateQuery(manageMode
                ? { audience: null, cohort_id: null, status: 'published', sort: 'published_desc', page: '1' }
                : { read: null, sort: 'published_desc', page: '1' })}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Clear filters
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {announcements.length === 0 ? (
            <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
              No announcements match these filters.
            </div>
          ) : announcements.map((announcement) => {
            const detailPath = `/announcements/${announcement.id}${location.search}`
            const isSelected = announcement.id === selectedId
            const isArchiving = archivingId === announcement.id

            return (
              <article
                key={announcement.id}
                className={`rounded-lg border bg-white p-4 transition-colors ${isSelected ? 'border-primary-300 shadow-sm' : announcement.read_at ? 'border-slate-200' : 'border-primary-200'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={detailPath} className="font-semibold text-slate-900 hover:text-primary-700">
                        {announcement.title}
                      </Link>
                      {announcement.pinned && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                          <Pin className="h-3 w-3" />
                          Pinned
                        </span>
                      )}
                      {!announcement.read_at && !manageMode && (
                        <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-medium text-white">Unread</span>
                      )}
                      {announcement.status && announcement.status !== 'published' && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium capitalize text-slate-600">
                          {announcement.status}
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {announcement.author?.full_name || 'Unknown author'} · {audienceLabel(announcement)} · {formatDate(announcement.published_at)}
                    </p>
                  </div>
                  {manageMode && announcement.status !== 'archived' && (
                    <button
                      onClick={() => handleArchive(announcement)}
                      disabled={isArchiving}
                      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {isArchiving ? 'Archiving...' : 'Archive'}
                    </button>
                  )}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{announcement.body}</p>
              </article>
            )
          })}

          {pagination.total_pages > 1 && (
            <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                Showing page {pagination.page} of {pagination.total_pages} · {pagination.total_count} total announcement{pagination.total_count === 1 ? '' : 's'}
              </p>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => updateQuery({ page: String(Math.max(1, pagination.page - 1)) })}
                  disabled={!pagination.has_prev_page}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </button>
                <button
                  onClick={() => updateQuery({ page: String(pagination.page + 1) })}
                  disabled={!pagination.has_next_page}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        <aside className="rounded-lg border border-slate-200 bg-white p-4 lg:sticky lg:top-6 lg:self-start">
          <h2 className="font-semibold text-slate-900">{selected ? selected.title : manageMode ? 'Announcement details' : 'Inbox status'}</h2>
          {selected ? (
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">From</p>
                <p className="mt-1 text-slate-900">{selected.author?.full_name || 'Unknown author'}</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Audience</p>
                <p className="mt-1 text-slate-900">{audienceLabel(selected)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Published</p>
                <p className="mt-1 text-slate-900">{formatDate(selected.published_at)}</p>
              </div>
              {selected.updated_at && selected.updated_at !== selected.created_at && (
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Updated</p>
                  <p className="mt-1 text-slate-900">{formatDate(selected.updated_at)}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{manageMode ? 'Queue' : 'Unread'}</p>
                <p className="mt-1 text-slate-900">
                  {manageMode
                    ? `${pagination.total_count} announcement${pagination.total_count === 1 ? '' : 's'} match the current filters.`
                    : unreadCount > 0
                      ? `You have ${unreadCount} unread update${unreadCount === 1 ? '' : 's'}.`
                      : 'You are caught up.'}
                </p>
              </div>
              <div className="rounded-lg bg-primary-50 px-3 py-2 text-primary-800">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4" />
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
