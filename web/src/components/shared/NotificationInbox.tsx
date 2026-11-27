import { useStudentExperience } from '../../lib/studentExperience'
import { useInsertedKeys } from '../../lib/motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, Check, ChevronLeft, ChevronRight, FileCheck2, FolderOpen, Megaphone, MessageCircle } from 'lucide-react'
import { api } from '../../lib/api'
import { markdownExcerpt } from '../../lib/plainText'
import { UNREAD_CHANGED } from '../../lib/unread'
import { formatShortDateTime } from '../../lib/format'
import type { NotificationEntry, NotificationsResponse } from '../../types/api'
import { Button } from '../ui/Button'
import { UpdatesTabs } from './UpdatesTabs'

import { notificationDestination } from '../../lib/notificationDestination'

type InboxCategory = 'all' | 'messages' | 'files' | 'updates'

const CATEGORY_FILTERS: { value: InboxCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'messages', label: 'Messages' },
  { value: 'files', label: 'Files & reviews' },
  { value: 'updates', label: 'Updates' },
]

function notificationCategory(item: NotificationEntry): Exclude<InboxCategory, 'all'> | 'other' {
  if (item.notifiable?.type === 'Message' || item.notification_type?.includes('message') || item.notification_type?.includes('mention')) return 'messages'
  if (item.notifiable?.type === 'CohortFile' || item.notifiable?.type === 'Submission' || item.notification_type?.includes('file') || item.notification_type?.includes('submission') || item.notification_type?.includes('review')) return 'files'
  if (item.notification_type === 'announcement' || item.notifiable?.type === 'Announcement') return 'updates'
  return 'other'
}

function dateBucket(iso: string): 'Today' | 'This week' | 'Earlier' {
  const time = Date.parse(iso)
  if (!Number.isFinite(time)) return 'Earlier'
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (time >= startOfToday) return 'Today'
  if (time >= startOfToday - 6 * 86_400_000) return 'This week'
  return 'Earlier'
}

function NotificationIcon({ item }: { item: NotificationEntry }) {
  const category = notificationCategory(item)
  if (item.notifiable?.type === 'CohortFile') return <FolderOpen className="h-4 w-4" aria-hidden="true" />
  if (category === 'files') return <FileCheck2 className="h-4 w-4" aria-hidden="true" />
  if (category === 'messages') return <MessageCircle className="h-4 w-4" aria-hidden="true" />
  if (category === 'updates') return <Megaphone className="h-4 w-4" aria-hidden="true" />
  return <Bell className="h-4 w-4" aria-hidden="true" />
}

export function NotificationInbox() {
  const { v2 } = useStudentExperience()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('inbox_page')) || 1)
  const read = params.get('inbox_read') === 'unread' ? 'unread' : undefined
  const rawCategory = params.get('inbox_category')
  const category: InboxCategory = rawCategory === 'messages' || rawCategory === 'files' || rawCategory === 'updates' ? rawCategory : 'all'
  const [data, setData] = useState<NotificationsResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const load = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    const result = await api.getNotifications({ page, per_page: 25, read, category: category === 'all' ? undefined : category })
    if (request !== generation.current) return
    setError(result.error || '')
    if (result.data && !result.error && page > Math.max(1, result.data.meta.total_pages)) {
      setParams((current) => {
        const next = new URLSearchParams(current)
        next.set('inbox_page', String(Math.max(1, result.data!.meta.total_pages)))
        return next
      }, { replace: true })
      return
    }
    if (result.data) setData(result.data)
    setLoading(false)
  }, [category, page, read, setParams])
  useEffect(() => {
    void load()
    window.addEventListener(UNREAD_CHANGED, load)
    return () => { generation.current++; window.removeEventListener(UNREAD_CHANGED, load) }
  }, [load])
  const change = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    Object.entries(patch).forEach(([key, value]) => next.set(key, value))
    setParams(next)
  }
  const markRead = async (item: NotificationEntry, open: boolean) => {
    setBusy(true)
    if (!item.read_at) {
      const result = await api.markNotificationRead(item.id)
      if (result.error) { setError(result.error); setBusy(false); return }
    }
    setBusy(false)
    const path = notificationDestination(item)
    if (open && path) navigate(path, { state: v2 ? { returnTo: `/announcements?${params}`, returnLabel: 'Notifications' } : { from: `/announcements?${params}` } })
    else await load()
  }
  const visibleNotifications = useMemo(() => data?.notifications || [], [data?.notifications])

  // A notification that arrives while the inbox is open slides in; loads and page changes don't.
  const insertedIds = useInsertedKeys(visibleNotifications.map((item) => item.id), { ready: !loading })
  return <div className="app-page">
    <div><p className="app-eyebrow">Communication</p><h1 className="app-title mt-2">Updates</h1></div>
    <UpdatesTabs selected="inbox" inboxUnreadCount={data?.unread_count ?? 0} />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p role="status" className="text-sm text-ink-secondary">{data && `${data.unread_count} unread ${data.unread_count === 1 ? 'notification' : 'notifications'}`}</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Inbox read filter" className="app-control" value={read || 'all'} onChange={(event) => change({ inbox_read: event.target.value, inbox_page: '1' })}><option value="all">All notifications</option><option value="unread">Unread only</option></select>
        <Button variant="secondary" disabled={busy || !data?.unread_count} onClick={async () => { setBusy(true); const result = await api.markAllNotificationsRead(); setBusy(false); if (result.error) setError(result.error); else await load() }}><Check size={16} />Mark all read</Button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter notifications by type">
      {CATEGORY_FILTERS.map((option) => {
        const active = category === option.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => change({ inbox_category: option.value, inbox_page: '1' })}
            className={`inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-semibold transition-colors lg:min-h-9 ${active ? 'border-primary-soft-line bg-primary-soft text-primary-ink' : 'border-line bg-surface-raised text-ink-secondary hover:border-line-strong hover:text-ink'}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
    {error && <div role="alert" className="app-surface p-4 text-danger-ink">{error}<Button variant="secondary" onClick={() => void load()}>Retry</Button></div>}
    {loading && (
      <div role="status" aria-live="polite" className="space-y-2">
        <span className="sr-only">Loading notifications…</span>
        {[0, 1, 2].map((item) => (
          <div key={item} aria-hidden="true" className="flex items-start gap-3 rounded-2xl border border-line bg-surface-raised p-3 sm:p-4">
            <div className="mt-1.5 h-9 w-9 shrink-0 animate-pulse rounded-xl bg-surface-sunken motion-reduce:animate-none" />
            <div className="min-w-0 flex-1 space-y-2 py-1">
              <div className="h-4 w-48 max-w-full animate-pulse rounded-full bg-line motion-reduce:animate-none" />
              <div className="h-3.5 w-full max-w-md animate-pulse rounded-full bg-surface-sunken motion-reduce:animate-none" />
              <div className="h-3 w-24 animate-pulse rounded-full bg-surface-sunken motion-reduce:animate-none" />
            </div>
          </div>
        ))}
      </div>
    )}
    {!loading && !error && !visibleNotifications.length && <div className="app-surface p-6"><h2 className="font-semibold text-ink">{category === 'all' ? 'You’re all caught up' : 'No matching notifications'}</h2><p className="mt-2 text-sm text-ink-secondary">{category === 'all' ? 'Class activity and messages will appear here.' : 'Switch back to All to see every notification.'}</p></div>}
    <div className="space-y-2" aria-busy={loading}>
      {!loading && visibleNotifications.map((item, index) => {
        const destination = notificationDestination(item)
        const bucket = dateBucket(item.created_at)
        const showBucket = index === 0 || dateBucket(visibleNotifications[index - 1].created_at) !== bucket
        return <div key={item.id} className="space-y-2">
          {showBucket && <p className="pt-2 text-xs font-semibold uppercase tracking-wider text-ink-muted">{bucket}</p>}
          <article className={`flex items-start gap-3 rounded-2xl border p-3 sm:p-4 ${item.read_at ? 'border-line bg-surface-raised' : 'border-line-strong bg-surface-sunken/70'} ${insertedIds.has(item.id) ? 'motion-insert' : ''}`}>
            <span className={`mt-1.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${item.read_at ? 'border-line bg-surface-sunken text-ink-muted' : 'border-primary-soft-line bg-primary-soft text-primary-ink'}`}>
              <NotificationIcon item={item} />
            </span>
            <div className="min-w-0 flex-1">
              <button disabled={busy || !destination} onClick={() => void markRead(item, true)} className="flex min-h-11 w-full items-center gap-2 text-left font-semibold text-ink [overflow-wrap:anywhere] disabled:cursor-default">
                {!item.read_at && <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-action-primary" />}{item.title}
              </button>
              {item.body && <p className="line-clamp-2 whitespace-pre-wrap text-sm text-ink-secondary [overflow-wrap:anywhere]">{markdownExcerpt(item.body)}</p>}
              <p className="mt-1 text-xs text-ink-muted">{formatShortDateTime(item.created_at)}</p>
              {!destination && <p className="mt-2 text-sm text-ink-secondary">This item is no longer available.</p>}
              {!item.read_at && <Button variant="quiet" size="sm" disabled={busy} onClick={() => void markRead(item, false)}>Mark read</Button>}
            </div>
          </article>
        </div>
      })}
    </div>
    {data && data.meta.total_pages > 1 && <div className="flex items-center justify-between gap-2">
      <Button variant="secondary" disabled={loading || !data.meta.has_prev_page} onClick={() => change({ inbox_page: String(page - 1) })}><ChevronLeft size={16} />Previous</Button>
      <span className="text-sm text-ink-secondary">Page {page} of {data.meta.total_pages}</span>
      <Button variant="secondary" disabled={loading || !data.meta.has_next_page} onClick={() => change({ inbox_page: String(page + 1) })}>Next<ChevronRight size={16} /></Button>
    </div>}
  </div>
}
