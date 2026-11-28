import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { api } from '../../lib/api'
import { subscribeUnreadRefresh, unreadRefreshVersion } from '../../lib/unread'

/**
 * Updates and Notifications. The Notifications tab carries its own unread
 * count (the inbox's), so a sidebar badge never points at a page that looks
 * caught up. The inbox passes the count it just loaded; elsewhere it is fetched.
 */
export function UpdatesTabs({ selected, inboxUnreadCount }: { selected: 'announcements' | 'inbox'; inboxUnreadCount?: number }) {
  const location = useLocation()
  const fetched = useInboxUnreadCount(inboxUnreadCount === undefined)
  const unread = inboxUnreadCount ?? fetched
  const inbox = new URLSearchParams(location.search)
  inbox.set('tab', 'inbox')
  const feed = new URLSearchParams(location.search)
  feed.delete('tab')
  const base = 'inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap px-3 py-2 text-sm font-semibold transition-colors duration-150 lg:min-h-9'
  return <nav aria-label="Updates sections" className="flex items-center gap-1 border-b border-line">
    <Link to={`/announcements?${feed}`} aria-current={selected === 'announcements' ? 'page' : undefined} className={`${base} ${selected === 'announcements' ? 'tab-selected' : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'}`}>Updates</Link>
    <Link to={`/announcements?${inbox}`} aria-current={selected === 'inbox' ? 'page' : undefined} aria-label={unread > 0 ? `Notifications, ${unread} unread` : undefined} className={`${base} ${selected === 'inbox' ? 'tab-selected' : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'}`}>
      Notifications
      {unread > 0 && <span aria-hidden="true" className="min-w-6 rounded-full bg-action-primary px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums text-on-action">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  </nav>
}

function useInboxUnreadCount(enabled: boolean) {
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!enabled) return
    let active = true
    const refresh = (isCurrent?: () => boolean) => {
      const version = unreadRefreshVersion()
      void api.getNotifications({ per_page: 1 }).then((result) => {
        if (active && version === unreadRefreshVersion() && (!isCurrent || isCurrent()) && result.data) setCount(result.data.unread_count)
      })
    }
    refresh()
    const unsubscribe = subscribeUnreadRefresh(refresh)
    return () => { active = false; unsubscribe() }
  }, [enabled])
  return count
}
