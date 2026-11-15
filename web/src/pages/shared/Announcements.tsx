import { brand } from '../../lib/brand'
import { UnsavedChangesGuard } from '../../components/shared/UnsavedChangesGuard'
import { NotificationInbox } from '../../components/shared/NotificationInbox'
import { UpdatesTabs } from '../../components/shared/UpdatesTabs'
import { markdownExcerpt } from '../../lib/plainText'
import { MarkdownText } from '../../components/shared/MarkdownRenderer'
import { LazyMarkdownEditor } from '../../components/shared/LazyMarkdownEditor'
import { UNREAD_CHANGED } from '../../lib/unread'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Bell, Check, ChevronLeft, ChevronRight, Megaphone, Pin, Send, Sparkles, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { trimBlankLines } from '../../lib/messageFormat'
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
import { RecordLink } from '../../components/shared/RecordLink'
import { RecordHeader } from '../../components/shared/RecordHeader'
import { useInsertedKeys } from '../../lib/motion'

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

/** The audience; a cohort audience links to that cohort. */
function AudienceLabel({ announcement }: { announcement: Announcement }) {
  if (announcement.cohort_name && announcement.cohort_id) return <RecordLink record={{ type: 'cohort', id: announcement.cohort_id }} variant="plain" touchTarget className="font-[inherit] text-[inherit]">{announcement.cohort_name}</RecordLink>
  if (announcement.cohort_name) return <>{announcement.cohort_name}</>
  return <>{announcement.audience === 'staff' ? 'Staff' : 'School-wide'}</>
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
  const [params] = useSearchParams()
  return params.get('tab') === 'inbox' ? <NotificationInbox /> : <AnnouncementFeed />
}

function AnnouncementFeed() {
  const { id } = useParams()
  const toast = useToast()
  const confirmAction = useConfirm()
  const selectedId = id ? Number(id) : null
  const location = useLocation()
  const returnPath = typeof location.state?.from === 'string' && location.state.from.startsWith('/announcements?') ? location.state.from : `/announcements${location.search}`
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
  // A new update (posted here or arriving live) slides in; the first load and filter changes don't.
  const insertedIds = useInsertedKeys(announcements.map((announcement) => announcement.id ?? 0), { ready: !loading, scope: location.search })
  const [loadError, setLoadError] = useState('')
  const [detail, setDetail] = useState<Announcement | null>(null)
  const [detailError, setDetailError] = useState({ id: 0, message: '' })
  const [detailAttempt, setDetailAttempt] = useState(0)
  const listRequest = useRef(0)
  const [saving, setSaving] = useState(false)
  const [archivingId, setArchivingId] = useState<number | null>(null)
  const [pushMessage, setPushMessage] = useState('')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState({
    title: '',
    body: '',
    audience: 'cohort',
    // null follows the page/sidebar cohort until the poster picks one explicitly.
    cohort_id: null as string | null,
    pinned: false,
    send_push: true,
  })

  const resetComposer = () => setForm({ title: '', body: '', audience: 'cohort', cohort_id: null, pinned: false, send_push: true })

  const page = Number(searchParams.get('page') || '1')
  const readFilter: AnnouncementReadFilter = searchParams.get('read') === 'read' ? 'read' : searchParams.get('read') === 'unread' ? 'unread' : 'all'
  const audienceFilter: AnnouncementAudience | 'all' = searchParams.get('audience') === 'cohort' || searchParams.get('audience') === 'global' || searchParams.get('audience') === 'staff'
    ? searchParams.get('audience') as AnnouncementAudience
    : 'all'
  const statusFilter: AnnouncementStatus | 'all' = searchParams.get('status') === 'draft' || searchParams.get('status') === 'published' || searchParams.get('status') === 'archived'
    ? searchParams.get('status') as AnnouncementStatus
    // Manage mode opens on published; "any" in the URL keeps "All statuses" selected.
    : manageMode && searchParams.get('status') !== 'any' ? 'published' : 'all'
  const cohortFilter = searchParams.get('cohort_id') || (!isStaff && selectedCohortId ? String(selectedCohortId) : 'all')
  const sortFilter: AnnouncementSort = (() => {
    const value = searchParams.get('sort')
    if (value === 'published_asc' || value === 'created_desc' || value === 'created_asc' || value === 'updated_desc' || value === 'updated_asc') {
      return value as AnnouncementSort
    }
    return 'published_desc'
  })()

  const selected = detail?.id === selectedId ? detail : null
  const contextCohort = cohortFilter === 'all' ? null : cohorts.find((cohort) => String(cohort.id) === cohortFilter) || null
  const audienceCohort = cohorts.find((cohort) => String(cohort.id) === (form.cohort_id ?? cohortFilter)) || null

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
    const request = ++listRequest.current
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

    if (request !== listRequest.current) return
    setLoadError(res.error || '')
    if (res.data && !res.error && page > Math.max(1, res.data.meta.total_pages)) {
      setSearchParams((current) => {
        const next = new URLSearchParams(current)
        next.set('page', String(Math.max(1, res.data!.meta.total_pages)))
        return next
      }, { replace: true })
      return
    }
    if (res.data) {
      setAnnouncements(res.data.announcements)
      setUnreadCount(res.data.unread_count)
      setPagination(res.data.meta)
    }

    setLoading(false)
  }, [manageMode, page, audienceFilter, statusFilter, cohortFilter, readFilter, sortFilter, setSearchParams])
  const loadAnnouncementsRef = useRef(loadAnnouncements)

  useEffect(() => {
    void loadAnnouncements()
    const refresh = () => void loadAnnouncements({ background: true })
    window.addEventListener(UNREAD_CHANGED, refresh)
    return () => { listRequest.current++; window.removeEventListener(UNREAD_CHANGED, refresh) }
  }, [loadAnnouncements])

  useEffect(() => {
    loadAnnouncementsRef.current = loadAnnouncements
  }, [loadAnnouncements])

  useEffect(() => {
    if (!isStaff) return

    api.getCohorts().then((res) => {
      if (!res.data) return
      setCohorts(res.data.cohorts)
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
    let active = true
    if (!selectedId) return
    api.getAnnouncement(selectedId).then((res) => {
      if (!active) return
      setDetailError({ id: selectedId, message: res.error || '' })
      setDetail(res.error ? null : res.data?.announcement || null)
      void loadAnnouncementsRef.current({ background: true })
    })
    return () => { active = false }
  }, [selectedId, detailAttempt])

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    const audience = form.audience
    if (audience === 'cohort' && !audienceCohort) {
      setFormError('Choose which cohort this update is for.')
      return
    }
    if (!form.body.trim()) {
      setFormError('Write the update before posting it.')
      return
    }
    setFormError('')
    const countLabel = audienceCohort ? `${audienceCohort.enrolled_count} ${audienceCohort.enrolled_count === 1 ? 'student' : 'students'}` : ''
    const fromContext = audience === 'cohort' && audienceCohort?.id === contextCohort?.id
    if (!fromContext) {
      const accepted = await confirmAction(audience === 'global' ? {
        title: 'Post to everyone?',
        description: 'This update goes to every student and staff member in the school, not just one cohort.',
        confirmLabel: 'Post to everyone',
      } : audience === 'staff' ? {
        title: 'Post to staff only?',
        description: 'Students will not see this update.',
        confirmLabel: 'Post to staff',
      } : {
        title: `Post to ${audienceCohort!.name}?`,
        description: `${contextCohort ? `You are viewing ${contextCohort.name}, but this` : 'This'} will go to ${audienceCohort!.name} (${countLabel}).`,
        confirmLabel: `Post to ${audienceCohort!.name}`,
      })
      if (!accepted) return
    }
    setSaving(true)

    const res = await api.createAnnouncement({
      title: form.title.trim(),
      body: trimBlankLines(form.body),
      audience,
      cohort_id: audience === 'cohort' ? audienceCohort!.id : null,
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
      toast.success('Update posted')
    }
    setSaving(false)
  }

  const handleArchive = async (announcement: Announcement) => {
    if (!announcement.id || archivingId) return
    if (!await confirmAction({
      title: 'Archive update?',
      description: `“${announcement.title}” will leave the updates feed but stay in history.`,
      confirmLabel: 'Archive update',
      tone: 'danger',
    })) return

    setArchivingId(announcement.id)
    const res = await api.archiveAnnouncement(announcement.id)
    if (res.error) {
      setFormError(res.error)
      toast.error(res.error)
    } else {
      await loadAnnouncements({ background: true })
      toast.success('Update archived')
    }
    setArchivingId(null)
  }

  const handleMarkAllRead = async () => {
    const res = await api.markAllNotificationsRead('announcement')
    if (res.error) toast.error(res.error)
    else await loadAnnouncements({ background: true })
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

  if (loading && !selectedId) return <LoadingSpinner message="Loading updates…" />

  const clearFilters = () => updateQuery(manageMode
    ? { audience: null, cohort_id: null, status: 'published', sort: 'published_desc', page: '1' }
    : { read: null, sort: 'published_desc', page: '1' })

  return (
    <div className="app-page">
      {/* The draft survives switching between Updates and Manage; leaving the page still asks first. */}
      <UnsavedChangesGuard dirty={isStaff && Boolean(form.title.trim() || form.body.trim())} onDiscard={resetComposer} />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="app-eyebrow">Communication</p>
          <h1 className="app-title mt-2">Updates</h1>
          <p className="app-description mt-2">
            {manageMode
              ? 'Manage published updates, authorship, and archive state.'
              : `Pinned and recent updates from your cohort and ${brand.schoolAbbreviation}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isStaff && (
            <SegmentedControl label="Updates view">
              <SegmentButton
                dense
                selected={!manageMode}
                onClick={() => updateQuery({ scope: null, status: null, audience: null, cohort_id: null, page: '1' })}
              >
                Updates
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

      {!manageMode && <UpdatesTabs selected="announcements" />}
      {selectedId && <section className="app-surface space-y-4 p-5 sm:p-6" aria-label="Update">
        {selected ? <>
          <RecordHeader
            back={{ to: returnPath, label: returnPath.includes('tab=inbox') ? 'Back to notifications' : 'Back to updates', fallback: false }}
            breadcrumb={[{ label: 'Updates', to: returnPath }, { label: selected.title }]}
            type={<AudienceLabel announcement={selected} />}
            title={selected.title}
            headingLevel={2}
            context={<span className="tabular-nums">{formatDate(selected.published_at)}</span>}
            copyPath={`/announcements/${selected.id}`}
          />
          <div className="leading-7 text-ink-secondary [overflow-wrap:anywhere]"><MarkdownText content={selected.body} /></div>
        </> : <><Link to={returnPath} className="inline-flex min-h-11 items-center gap-2 font-semibold text-ink"><ChevronLeft size={18} />{returnPath.includes('tab=inbox') ? 'Back to notifications' : 'Back to updates'}</Link>{detailError.id === selectedId && detailError.message ? <div role="alert"><p>{detailError.message}</p><Button variant="secondary" onClick={() => { setDetailError({ id: 0, message: '' }); setDetailAttempt((value) => value + 1) }}>Try again</Button></div> : <p role="status">Loading update…</p>}</>}
      </section>}
      {loadError && <div role="alert" className="app-surface p-4"><p>{loadError}</p><Button variant="secondary" onClick={() => void loadAnnouncements()}>Retry feed</Button></div>}
      {pushMessage && (
        <div role="status" className="rounded-xl border border-info-line bg-info-soft px-4 py-3 text-sm text-info-ink">
          {pushMessage}
        </div>
      )}

      {manageMode && (
        <form onSubmit={handleCreate} className="app-surface space-y-4 p-5 sm:p-6">
          <div className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
            <h2 className="text-lg font-bold text-ink">Post an update</h2>
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
              aria-label="Audience"
              className="app-control"
            >
              <option value="cohort">Cohort</option>
              <option value="global">Everyone</option>
              <option value="staff">Staff only</option>
            </select>
            <select
              value={audienceCohort ? String(audienceCohort.id) : ''}
              onChange={(event) => setForm((prev) => ({ ...prev, cohort_id: event.target.value }))}
              disabled={form.audience !== 'cohort'}
              required={form.audience === 'cohort'}
              aria-label="Cohort for this update"
              className="app-control"
            >
              <option value="" disabled>Choose a cohort…</option>
              {cohorts.map((cohort) => (
                <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
              ))}
            </select>
          </div>
          <LazyMarkdownEditor
            label="Update"
            value={form.body}
            onChange={(body) => setForm((prev) => ({ ...prev, body }))}
            placeholder="What should students know?"
            minHeight={120}
            maxHeight={420}
          />
          {formError && (
            <div role="alert" className="rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-ink">
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
                  className="h-4 w-4 rounded border-line-strong accent-action-primary"
                />
                Pin this
              </label>
              <label className="flex min-h-11 items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.send_push}
                  onChange={(event) => setForm((prev) => ({ ...prev, send_push: event.target.checked }))}
                  className="h-4 w-4 rounded border-line-strong accent-action-primary"
                />
                Send push
              </label>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
              <p role="status" data-testid="announcement-audience" className={`text-sm ${form.audience === 'cohort' && !audienceCohort ? 'font-semibold text-danger-ink' : 'text-ink-secondary'}`}>
                {form.audience === 'global' ? <>Posting to: <strong className="text-ink">Everyone</strong> · all students and staff</>
                  : form.audience === 'staff' ? <>Posting to: <strong className="text-ink">Staff only</strong></>
                  : audienceCohort ? <>Posting to: <strong className="text-ink">{audienceCohort.name}</strong> · {audienceCohort.enrolled_count} {audienceCohort.enrolled_count === 1 ? 'student' : 'students'}</>
                  : 'Choose a cohort to post to'}
              </p>
              <Button type="submit" disabled={saving}>
                <Send className="h-4 w-4" aria-hidden="true" />
                {saving ? 'Posting…' : 'Post update'}
              </Button>
            </div>
          </div>
        </form>
      )}

      {!selectedId && <div className="app-surface p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <h2 className="font-semibold text-ink">{manageMode ? 'Update history' : 'Your feed'}</h2>
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
            ) : (<>
              {cohortFilter !== 'all' && <select aria-label="Update audience" className="app-control" value={audienceFilter === 'cohort' ? 'cohort' : 'all'} onChange={(event) => updateQuery({ audience: event.target.value, page: '1' })}>
                <option value="all">Cohort + school-wide</option><option value="cohort">Only this cohort</option>
              </select>}
              <select
                value={readFilter}
                onChange={(event) => updateQuery({ read: event.target.value, page: '1' })}
                className="app-control"
              >
                <option value="all">All updates</option>
                <option value="unread">Unread only</option>
                <option value="read">Read only</option>
              </select></>
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
      </div>}

      {!selectedId && <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          {announcements.length === 0 ? (
            <div className="app-surface">
              <EmptyState icon={Megaphone} title="You’re all caught up" action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>} />
            </div>
          ) : announcements.map((announcement) => {
            const detailPath = `/announcements/${announcement.id}${location.search}`
            const isNew = announcement.id !== undefined && insertedIds.has(announcement.id)
            const isSelected = announcement.id === selectedId
            const isArchiving = archivingId === announcement.id

            return (
              <article
                key={announcement.id}
                className={`rounded-2xl border bg-surface-raised p-4 transition-colors duration-150 ${isNew ? 'motion-insert ' : ''}${isSelected ? 'border-line-control shadow-raised' : !(announcement.unread ?? !announcement.read_at) ? 'border-line' : 'border-line-strong shadow-raised'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={detailPath} className="inline-flex min-h-11 min-w-0 items-center font-semibold text-ink underline-offset-4 transition-colors duration-150 [overflow-wrap:anywhere] hover:underline">
                        {announcement.title}
                      </Link>
                      {announcement.pinned && (
                        <Badge icon={<Pin className="h-3 w-3" aria-hidden="true" />}>Pinned</Badge>
                      )}
                      {(announcement.unread ?? !announcement.read_at) && !manageMode && (
                        <Badge tone="info">Unread</Badge>
                      )}
                      {manageMode && announcement.status ? (
                        <Badge tone={announcement.status === 'published' ? 'success' : 'neutral'}>{STATUS_LABELS[announcement.status] || announcement.status}</Badge>
                      ) : announcement.status && announcement.status !== 'published' && (
                        <Badge tone="neutral">{STATUS_LABELS[announcement.status] || announcement.status}</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs tabular-nums text-ink-secondary">
                      {announcement.author?.full_name || 'Unknown author'} · <AudienceLabel announcement={announcement} /> · {formatDate(announcement.published_at)}
                    </p>
                  </div>
                  {manageMode && announcement.status !== 'archived' && (
                    <Button variant="danger" size="sm" className="shrink-0" onClick={() => handleArchive(announcement)} disabled={isArchiving}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {isArchiving ? 'Archiving...' : 'Archive'}
                    </Button>
                  )}
                </div>
                <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{markdownExcerpt(announcement.body)}</p>
              </article>
            )
          })}

          {pagination.total_pages > 1 && (
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm tabular-nums text-ink-secondary">
                Showing page {pagination.page} of {pagination.total_pages} · {pagination.total_count} total update{pagination.total_count === 1 ? '' : 's'}
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
          <h2 className="font-semibold text-ink [overflow-wrap:anywhere]">{selected ? selected.title : manageMode ? 'Update details' : 'Update status'}</h2>
          {selected ? (
            <div className="mt-3 space-y-3 text-sm text-ink-secondary">
              <div className="rounded-xl bg-surface-sunken px-3 py-2">
                <p className="text-xs font-semibold text-ink-muted">From</p>
                <p className="mt-1 tabular-nums text-ink [overflow-wrap:anywhere]">{selected.author?.full_name || 'Unknown author'}</p>
              </div>
              <div className="rounded-xl bg-surface-sunken px-3 py-2">
                <p className="text-xs font-semibold text-ink-muted">Audience</p>
                <p className="mt-1 tabular-nums text-ink [overflow-wrap:anywhere]"><AudienceLabel announcement={selected} /></p>
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
                    ? `${pagination.total_count} update${pagination.total_count === 1 ? '' : 's'} match the current filters.`
                    : unreadCount > 0
                      ? `You have ${unreadCount} unread update${unreadCount === 1 ? '' : 's'}.`
                      : 'You are caught up.'}
                </p>
              </div>
              <div className="rounded-xl border border-info-line bg-info-soft px-3 py-2 text-info-ink">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <p className="font-medium">{manageMode ? 'Management tip' : 'On Today'}</p>
                </div>
                <p className="mt-2 text-sm leading-6">
                  {manageMode
                    ? 'Archive older updates to keep the feed focused, then use filters to revisit history when needed.'
                    : 'Pinned updates stay on Today. Other updates leave Today once you’ve read them.'}
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>}
    </div>
  )
}
