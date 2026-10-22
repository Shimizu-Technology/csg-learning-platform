import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, Check, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'
import { markdownExcerpt } from '../../lib/plainText'
import { UNREAD_CHANGED } from '../../lib/unread'
import { formatShortDateTime } from '../../lib/format'
import type { NotificationEntry, NotificationsResponse } from '../../types/api'
import { Button } from '../ui/Button'
import { UpdatesTabs } from './UpdatesTabs'

import { notificationDestination } from '../../lib/notificationDestination'

export function NotificationInbox() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const page = Math.max(1, Number(params.get('inbox_page')) || 1)
  const read = params.get('inbox_read') === 'unread' ? 'unread' : undefined
  const [data, setData] = useState<NotificationsResponse | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const load = useCallback(async () => {
    const request = ++generation.current
    setLoading(true)
    const result = await api.getNotifications({ page, per_page: 25, read })
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
  }, [page, read, setParams])
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
    if (open && path) navigate(path, { state: { from: `/announcements?${params}` } })
    else await load()
  }
  return <div className="app-page">
    <div><p className="app-eyebrow">Communication</p><h1 className="app-title mt-2">Updates</h1></div>
    <UpdatesTabs selected="inbox" />
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-ink-secondary">{data?.unread_count || 0} unread notifications</p>
      <div className="flex flex-wrap gap-2">
        <select aria-label="Inbox read filter" className="app-control" value={read || 'all'} onChange={(event) => change({ inbox_read: event.target.value, inbox_page: '1' })}><option value="all">All notifications</option><option value="unread">Unread only</option></select>
        <Button variant="secondary" disabled={busy || !data?.unread_count} onClick={async () => { setBusy(true); const result = await api.markAllNotificationsRead(); setBusy(false); if (result.error) setError(result.error); else await load() }}><Check size={16} />Mark all read</Button>
      </div>
    </div>
    {error && <div role="alert" className="app-surface p-4 text-danger-700">{error}<Button variant="secondary" onClick={() => void load()}>Retry</Button></div>}
    {loading && <p role="status" className="text-sm text-ink-secondary">Loading notifications…</p>}
    {!loading && !error && !data?.notifications.length && <div className="app-surface p-6"><h2 className="font-semibold text-ink">You’re all caught up</h2><p className="mt-2 text-sm text-ink-secondary">Class activity and messages will appear here.</p></div>}
    <div className="space-y-2" aria-busy={loading}>
      {!loading && data?.notifications.map((item) => {
        const destination = notificationDestination(item)
        return <article key={item.id} className="flex items-start gap-3 rounded-2xl border border-line bg-surface-raised p-3 sm:p-4">
          <Bell className="mt-3 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <button disabled={busy || !destination} onClick={() => void markRead(item, true)} className="flex min-h-11 w-full items-center gap-2 text-left font-semibold text-ink [overflow-wrap:anywhere] disabled:cursor-default">
              {!item.read_at && <span aria-label="Unread" className="h-2 w-2 shrink-0 rounded-full bg-ruby-600" />}{item.title}
            </button>
            {item.body && <p className="line-clamp-2 whitespace-pre-wrap text-sm text-ink-secondary [overflow-wrap:anywhere]">{markdownExcerpt(item.body)}</p>}
            <p className="mt-1 text-xs text-ink-muted">{formatShortDateTime(item.created_at)}</p>
            {!destination && <p className="mt-2 text-sm text-ink-secondary">This item is no longer available.</p>}
            {!item.read_at && <Button variant="quiet" size="sm" disabled={busy} onClick={() => void markRead(item, false)}>Mark read</Button>}
          </div>
        </article>
      })}
    </div>
    {data && data.meta.total_pages > 1 && <div className="flex items-center justify-between gap-2">
      <Button variant="secondary" disabled={loading || !data.meta.has_prev_page} onClick={() => change({ inbox_page: String(page - 1) })}><ChevronLeft size={16} />Previous</Button>
      <span className="text-sm text-ink-secondary">Page {page} of {data.meta.total_pages}</span>
      <Button variant="secondary" disabled={loading || !data.meta.has_next_page} onClick={() => change({ inbox_page: String(page + 1) })}>Next<ChevronRight size={16} /></Button>
    </div>}
  </div>
}
