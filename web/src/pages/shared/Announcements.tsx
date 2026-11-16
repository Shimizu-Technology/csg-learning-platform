import { RecordLink } from '../../components/shared/RecordLink'
import { brand } from '../../lib/brand'
import { UnsavedChangesGuard } from '../../components/shared/UnsavedChangesGuard'
import { NotificationInbox } from '../../components/shared/NotificationInbox'
import { UpdatesTabs } from '../../components/shared/UpdatesTabs'
import { markdownExcerpt } from '../../lib/plainText'
import { MarkdownText } from '../../components/shared/MarkdownRenderer'
import { UNREAD_CHANGED } from '../../lib/unread'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { Bell, Check, ChevronLeft, ChevronRight, Megaphone, PenLine, Pin, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { browserPushEnabled, disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported } from '../../lib/pushNotifications'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import { Badge } from '../../components/ui/Badge'
import { Button, LinkButton } from '../../components/ui/Button'
import { FilterChip, SegmentButton, SegmentedControl } from '../../components/ui/Choice'
import { formatShortDateTime } from '../../lib/format'
import { listLinkState } from '../../lib/navigationContext'
import { useBackLink } from '../../lib/recordOrigin'
import type { ReturnContext } from '../../lib/navigationContext'
import type { Announcement, CohortSummary, PaginationMeta } from '../../types/api'
import { RecordHeader } from '../../components/shared/RecordHeader'
import { useInsertedKeys } from '../../lib/motion'
import { EMPTY_UPDATE_FORM, UpdateComposer, formFromUpdate, type UpdateForm, type UpdateSaveOutcome } from './UpdateComposer'

type ManageStatus = 'published' | 'draft' | 'archived'

const STATUS_FILTERS: { value: ManageStatus; label: string }[] = [
  { value: 'published', label: 'Published' },
  { value: 'draft', label: 'Drafts' },
  { value: 'archived', label: 'Archived' },
]

/** "2 drafts", "1 published update". */
function statusCount(status: ManageStatus, count: number) {
  if (status === 'draft') return `${count} ${count === 1 ? 'draft' : 'drafts'}`
  return `${count} ${status} ${count === 1 ? 'update' : 'updates'}`
}

const formatDate = (date?: string | null) => formatShortDateTime(date, 'Not posted')

/** The audience; a cohort audience links to that cohort. */
function AudienceLabel({ announcement }: { announcement: Announcement }) {
  if (announcement.cohort_name && announcement.cohort_id) return <RecordLink record={{ type: 'cohort', id: announcement.cohort_id, tab: 'communication' }} returnLabel="Updates" variant="plain" touchTarget>{announcement.cohort_name}</RecordLink>
  if (announcement.cohort_name) return <>{announcement.cohort_name}</>
  return <>{announcement.audience === 'staff' ? 'Staff' : 'School-wide'}</>
}

/** The author: their team page for admins (L-2.9), plain text for everyone else. */
function AnnouncementAuthor({ announcement }: { announcement: Announcement }) {
  if (!announcement.author) return <>Staff</>
  return <RecordLink record={{ type: 'staff', id: announcement.author.id }} returnLabel="Updates" variant="plain" touchTarget>{announcement.author.full_name}</RecordLink>
}

/** "Edited Nov 14, 2026, 9:00 AM", with the editor in the tooltip. */
function EditedMarker({ announcement }: { announcement: Announcement }) {
  if (!announcement.edited_at) return null
  const when = formatShortDateTime(announcement.edited_at)
  return <span data-testid="edited-marker" title={announcement.edited_by ? `Edited by ${announcement.edited_by.full_name}` : undefined}>Edited <time dateTime={announcement.edited_at} className="tabular-nums">{when}</time></span>
}

/** When it went out, or for a draft when it was last saved. */
function WhenLabel({ announcement }: { announcement: Announcement }) {
  if (announcement.status === 'draft') return <>Draft · saved <span className="tabular-nums">{formatShortDateTime(announcement.updated_at, 'just now')}</span></>
  return <span className="tabular-nums">{formatDate(announcement.published_at)}</span>
}

function StatusBadges({ announcement, unread }: { announcement: Announcement; unread: boolean }) {
  return <>
    {announcement.pinned && <Badge icon={<Pin className="h-3 w-3" aria-hidden="true" />}>Pinned</Badge>}
    {unread && <Badge tone="info">Unread</Badge>}
    {announcement.status === 'draft' && <Badge tone="warning">Draft</Badge>}
    {announcement.status === 'archived' && <Badge tone="neutral">Archived</Badge>}
  </>
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

/** This page's URL without the detail-only keys, for "Back to Updates". */
function feedSearch(search: string) {
  const next = new URLSearchParams(search)
  next.delete('edit')
  next.delete('return_to')
  const query = next.toString()
  return query ? `?${query}` : ''
}

function AnnouncementFeed() {
  const { id } = useParams()
  const toast = useToast()
  const confirmAction = useConfirm()
  const selectedId = id ? Number(id) : null
  const location = useLocation()
  // The notification inbox (and older links) hand over `{ from }`; record links hand over `{ returnTo, returnLabel }` or `return_to` (L-1.5).
  const legacyFrom = typeof location.state?.from === 'string' && location.state.from.startsWith('/announcements?') ? location.state.from as string : null
  const fallback: ReturnContext = legacyFrom
    ? { returnTo: legacyFrom, returnLabel: legacyFrom.includes('tab=inbox') ? 'Notifications' : 'Updates' }
    : { returnTo: `/announcements${feedSearch(location.search)}`, returnLabel: 'Updates' }
  const back = useBackLink(fallback)
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuthContext()
  const { selectedCohortId } = useCohortContext()
  const isStaff = Boolean(user?.is_staff)
  const manageMode = isStaff && searchParams.get('scope') === 'manage'
  const editing = searchParams.get('edit') === '1'
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
  const [detailNotice, setDetailNotice] = useState('')
  const listRequest = useRef(0)
  const [removingId, setRemovingId] = useState<number | null>(null)
  const [pushMessage, setPushMessage] = useState('')
  const [pushEnabled, setPushEnabled] = useState(false)
  const [form, setForm] = useState<UpdateForm>(EMPTY_UPDATE_FORM)
  const [editForm, setEditForm] = useState<UpdateForm>(EMPTY_UPDATE_FORM)
  const [editBaseline, setEditBaseline] = useState('')

  const resetComposer = () => setForm(EMPTY_UPDATE_FORM)

  const page = Number(searchParams.get('page') || '1')
  // Readers get one feed, newest first with pinned on top, and one "Unread only" toggle (U-3.6).
  const unreadOnly = !manageMode && searchParams.get('read') === 'unread'
  const statusParam = searchParams.get('status')
  const statusFilter: ManageStatus = statusParam === 'draft' || statusParam === 'archived' ? statusParam : 'published'
  const audienceParam = searchParams.get('audience')
  const cohortParam = searchParams.get('cohort_id')
  const cohortFilter = cohortParam || (!isStaff && selectedCohortId ? String(selectedCohortId) : 'all')
  // Staff filter by who an update went to: everyone, staff, all cohorts, or one cohort.
  const audienceFilter = audienceParam === 'global' || audienceParam === 'staff' ? audienceParam
    : audienceParam === 'cohort' ? (cohortParam ? `cohort:${cohortParam}` : 'cohort')
    : 'all'

  const selected = detail?.id === selectedId ? detail : null
  const contextCohort = cohortFilter === 'all' ? null : cohorts.find((cohort) => String(cohort.id) === cohortFilter) || null

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

  const setEditing = useCallback((on: boolean) => {
    const next = new URLSearchParams(searchParams)
    if (on) next.set('edit', '1')
    else next.delete('edit')
    // Keep the router state so "Back to …" still points where the reader came from.
    setSearchParams(next, { replace: true, state: location.state })
  }, [location.state, searchParams, setSearchParams])

  const loadAnnouncements = useCallback(async ({ background = false }: { background?: boolean } = {}) => {
    const request = ++listRequest.current
    if (!background) setLoading(true)

    const manageCohort = audienceFilter.startsWith('cohort:') ? Number(audienceFilter.slice(7)) : undefined
    const res = await api.getAnnouncements({
      scope: manageMode ? 'manage' : undefined,
      page,
      per_page: 12,
      audience: manageMode && audienceFilter !== 'all' ? (audienceFilter.startsWith('cohort') ? 'cohort' : audienceFilter as 'global' | 'staff') : undefined,
      status: manageMode ? statusFilter : undefined,
      cohort_id: manageMode ? manageCohort : cohortFilter === 'all' ? undefined : Number(cohortFilter),
      read: unreadOnly ? 'unread' : undefined,
      // Drafts list the most recently saved first.
      sort: manageMode && statusFilter === 'draft' ? 'updated_desc' : undefined,
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
  }, [manageMode, page, audienceFilter, statusFilter, cohortFilter, unreadOnly, setSearchParams])
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
    setDetailNotice('')
    api.getAnnouncement(selectedId).then((res) => {
      if (!active) return
      setDetailError({ id: selectedId, message: res.error || '' })
      setDetail(res.error ? null : res.data?.announcement || null)
      void loadAnnouncementsRef.current({ background: true })
    })
    return () => { active = false }
  }, [selectedId, detailAttempt])

  // Opening the editor starts from the update as it is now.
  const editingId = editing && selected?.can_edit ? selected.id : null
  useEffect(() => {
    if (!editingId || !selected) return
    const start = formFromUpdate(selected)
    setEditForm(start)
    setEditBaseline(JSON.stringify(start))
    // Only when another update is opened for editing, not on every detail refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId])

  const handleComposerSaved = async (saved: Announcement, outcome: UpdateSaveOutcome) => {
    resetComposer()
    if (outcome === 'draft') {
      toast.success('Draft saved')
      // Show the draft where it now lives.
      if (statusFilter !== 'draft') updateQuery({ status: 'draft', page: '1' })
      else await loadAnnouncements()
      return
    }
    await loadAnnouncements()
    toast.success(saved.status === 'published' ? 'Update posted' : 'Saved')
  }

  const handleEditSaved = async (saved: Announcement, outcome: UpdateSaveOutcome) => {
    setDetail((current) => current && current.id === saved.id ? { ...current, ...saved } : current)
    setEditBaseline(JSON.stringify(formFromUpdate(saved)))
    setEditing(false)
    setDetailNotice(outcome === 'posted' ? 'Update posted.' : outcome === 'draft' ? 'Draft saved.' : 'Changes saved. Readers see “Edited”; nobody was notified again.')
    if (outcome === 'posted') toast.success('Update posted')
    void loadAnnouncements({ background: true })
  }

  const handleRemove = async (announcement: Announcement) => {
    if (!announcement.id || removingId) return
    const draft = announcement.status === 'draft'
    if (!await confirmAction(draft ? {
      title: 'Delete draft?',
      description: `“${announcement.title}” was never posted. Deleting it can’t be undone.`,
      confirmLabel: 'Delete draft',
      tone: 'danger',
    } : {
      title: 'Archive update?',
      description: `“${announcement.title}” will leave the updates feed but stay in history.`,
      confirmLabel: 'Archive update',
      tone: 'danger',
    })) return

    setRemovingId(announcement.id)
    const res = await api.archiveAnnouncement(announcement.id)
    if (res.error) {
      toast.error(res.error)
    } else {
      await loadAnnouncements({ background: true })
      toast.success(draft ? 'Draft deleted' : 'Update archived')
    }
    setRemovingId(null)
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

  const editDirty = editing && Boolean(selected?.can_edit) && JSON.stringify(editForm) !== editBaseline
  const unreadLabel = unreadCount > 0 ? `${unreadCount} unread ${unreadCount === 1 ? 'update' : 'updates'}` : 'You’re all caught up'

  return (
    <div className="app-page">
      {/* The new update survives switching between Updates and Manage; leaving the page still asks first. */}
      <UnsavedChangesGuard dirty={isStaff && Boolean(form.title.trim() || form.body.trim())} onDiscard={resetComposer} />
      <UnsavedChangesGuard dirty={editDirty} />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <p className="app-eyebrow">Communication</p>
          <h1 className="app-title mt-2">Updates</h1>
          {/* The list's count; a single update's page doesn't repeat it. */}
          {!selectedId && <p className="app-description mt-2" data-testid="updates-context">
            {manageMode ? statusCount(statusFilter, pagination.total_count) : unreadLabel}
          </p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {isStaff && (
            <SegmentedControl label="Updates view">
              <SegmentButton
                dense
                selected={!manageMode}
                onClick={() => updateQuery({ scope: null, status: null, audience: null, page: '1' })}
              >
                Updates
              </SegmentButton>
              <SegmentButton
                dense
                selected={manageMode}
                onClick={() => updateQuery({ scope: 'manage', read: null, page: '1' })}
              >
                Manage
              </SegmentButton>
            </SegmentedControl>
          )}
          {!manageMode && unreadCount > 0 && (
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
        {selected ? (editing && selected.can_edit ? <>
          <Link to={back.to} state={location.state} className="inline-flex min-h-11 items-center gap-2 font-semibold text-ink" onClick={(event) => { event.preventDefault(); setEditing(false) }}><ChevronLeft size={18} />Back to the update</Link>
          <UpdateComposer
            form={editForm}
            setForm={setEditForm}
            cohorts={cohorts}
            contextCohort={cohortParam ? cohorts.find((cohort) => String(cohort.id) === cohortParam) || null : null}
            defaultCohortId={selected.cohort_id ? String(selected.cohort_id) : null}
            editing={selected}
            onSaved={handleEditSaved}
            onCancel={() => setEditing(false)}
          />
        </> : <>
          <RecordHeader
            back={back}
            breadcrumb={[{ label: 'Updates', to: fallback.returnTo }, { label: selected.title }]}
            type={<AudienceLabel announcement={selected} />}
            title={selected.title}
            headingLevel={2}
            status={<StatusBadges announcement={selected} unread={false} />}
            context={<span className="inline-flex flex-wrap items-center gap-x-1"><AnnouncementAuthor announcement={selected} /> · <WhenLabel announcement={selected} />{selected.edited_at && <> · <EditedMarker announcement={selected} /></>}</span>}
            actions={selected.can_edit ? <Button variant="secondary" onClick={() => setEditing(true)}><PenLine className="h-4 w-4" aria-hidden="true" />{selected.status === 'draft' ? 'Edit draft' : 'Edit'}</Button> : undefined}
            copyPath={`/announcements/${selected.id}`}
          />
          {detailNotice && <p role="status" className="rounded-xl border border-success-line bg-success-soft px-3 py-2 text-sm text-success-ink">{detailNotice}</p>}
          {selected.status === 'draft' && <p className="text-sm text-ink-secondary">Only you and admins can see this draft. Nobody is notified until you post it.</p>}
          {selected.body ? <div className="leading-7 text-ink-secondary [overflow-wrap:anywhere]"><MarkdownText content={selected.body} /></div> : <p className="text-sm text-ink-muted">No text yet.</p>}
        </>) : <><Link to={back.to} className="inline-flex min-h-11 items-center gap-2 font-semibold text-ink"><ChevronLeft size={18} />{back.label}</Link>{detailError.id === selectedId && detailError.message ? <div role="alert"><p>{detailError.message}</p><Button variant="secondary" onClick={() => { setDetailError({ id: 0, message: '' }); setDetailAttempt((value) => value + 1) }}>Try again</Button></div> : <p role="status">Loading update…</p>}</>}
      </section>}
      {loadError && <div role="alert" className="app-surface p-4"><p>{loadError}</p><Button variant="secondary" onClick={() => void loadAnnouncements()}>Retry feed</Button></div>}
      {pushMessage && (
        <div role="status" className="rounded-xl border border-info-line bg-info-soft px-4 py-3 text-sm text-info-ink">
          {pushMessage}
        </div>
      )}

      {manageMode && !selectedId && (
        <UpdateComposer
          form={form}
          setForm={setForm}
          cohorts={cohorts}
          contextCohort={contextCohort}
          defaultCohortId={cohortFilter === 'all' ? null : cohortFilter}
          onSaved={handleComposerSaved}
        />
      )}

      {!selectedId && <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <h2 className="font-semibold text-ink">{manageMode ? 'Your updates' : 'Your feed'}</h2>
        {manageMode ? (
          <div className="flex flex-wrap items-center gap-2">
            <div role="group" aria-label="Status" className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((option) => (
                <FilterChip
                  key={option.value}
                  dense
                  selected={statusFilter === option.value}
                  onClick={() => updateQuery({ status: option.value === 'published' ? null : option.value, page: '1' })}
                >
                  {option.label}
                </FilterChip>
              ))}
            </div>
            <select
              value={audienceFilter}
              onChange={(event) => {
                const value = event.target.value
                if (value.startsWith('cohort:')) updateQuery({ audience: 'cohort', cohort_id: value.slice(7), page: '1' })
                else updateQuery({ audience: value, cohort_id: null, page: '1' })
              }}
              aria-label="Sent to"
              className="app-control"
            >
              <option value="all">Everyone and every cohort</option>
              <option value="global">School-wide</option>
              <option value="staff">Staff only</option>
              <option value="cohort">All cohorts</option>
              {cohorts.map((cohort) => (
                <option key={cohort.id} value={`cohort:${cohort.id}`}>{cohort.name}</option>
              ))}
            </select>
          </div>
        ) : (
          <FilterChip dense className="self-start" selected={unreadOnly} onClick={() => updateQuery({ read: unreadOnly ? null : 'unread', page: '1' })}>
            Unread only
          </FilterChip>
        )}
      </div>}

      {!selectedId && <div className="space-y-3">
        {announcements.length === 0 ? (
          <div className="app-surface">
            {manageMode ? (
              <EmptyState
                icon={Megaphone}
                title={statusFilter === 'draft' ? 'No drafts' : statusFilter === 'archived' ? 'Nothing archived' : 'No updates posted yet'}
                description={statusFilter === 'draft' ? 'Use Save draft to keep an update here until it’s ready to post.' : statusFilter === 'archived' ? 'Archived updates leave the feed and stay here.' : 'Post an update above. It appears here and in each reader’s feed.'}
              />
            ) : unreadOnly ? (
              <EmptyState icon={Megaphone} title="No unread updates" description="You’ve read every update." action={<Button variant="secondary" onClick={() => updateQuery({ read: null, page: '1' })}>Show all updates</Button>} />
            ) : (
              <EmptyState icon={Megaphone} title="No updates yet" description={`Updates from your instructors and ${brand.schoolAbbreviation} appear here.`} />
            )}
          </div>
        ) : announcements.map((announcement) => {
          const detailPath = `/announcements/${announcement.id}${location.search}`
          const isNew = announcement.id !== undefined && insertedIds.has(announcement.id)
          const unread = !manageMode && (announcement.unread ?? !announcement.read_at)
          const isRemoving = removingId === announcement.id

          return (
            <article
              key={announcement.id}
              className={`rounded-2xl border bg-surface-raised p-4 transition-colors duration-150 ${isNew ? 'motion-insert ' : ''}${unread ? 'border-line-strong shadow-raised' : 'border-line'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={detailPath} state={listLinkState(location, 'Updates')} className="inline-flex min-h-11 min-w-0 items-center gap-2 font-semibold text-ink underline-offset-4 transition-colors duration-150 [overflow-wrap:anywhere] hover:underline">
                      {unread && <span className="h-2 w-2 shrink-0 rounded-full bg-action-primary" aria-hidden="true" />}
                      <span className="min-w-0">{announcement.title}</span>
                    </Link>
                    <StatusBadges announcement={announcement} unread={unread} />
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-ink-secondary">
                    <AnnouncementAuthor announcement={announcement} /> · <AudienceLabel announcement={announcement} /> · <WhenLabel announcement={announcement} />
                    {announcement.edited_at && <> · <EditedMarker announcement={announcement} /></>}
                  </p>
                </div>
                {manageMode && (announcement.can_edit || announcement.status === 'published') && (
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {announcement.can_edit && announcement.status !== 'archived' && (
                      <LinkButton variant="secondary" size="sm" to={`/announcements/${announcement.id}${feedSearch(location.search) ? `${feedSearch(location.search)}&edit=1` : '?edit=1'}`} state={listLinkState(location, 'Updates')}>
                        <PenLine className="h-3.5 w-3.5" aria-hidden="true" />
                        Edit
                      </LinkButton>
                    )}
                    {(announcement.status === 'published' || (announcement.status === 'draft' && announcement.can_edit)) && (
                      <Button variant="danger" size="sm" onClick={() => handleRemove(announcement)} disabled={isRemoving}>
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        {announcement.status === 'draft' ? (isRemoving ? 'Deleting…' : 'Delete') : isRemoving ? 'Archiving…' : 'Archive'}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              {announcement.body && <p className="mt-2 line-clamp-2 whitespace-pre-wrap text-sm leading-6 text-ink-secondary [overflow-wrap:anywhere]">{markdownExcerpt(announcement.body)}</p>}
            </article>
          )
        })}

        {pagination.total_pages > 1 && (
          <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm tabular-nums text-ink-secondary">
              Page {pagination.page} of {pagination.total_pages} · {pagination.total_count} {pagination.total_count === 1 ? 'update' : 'updates'}
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
      </div>}
    </div>
  )
}
