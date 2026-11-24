import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../../lib/api'
import { subscribeUnreadRefresh, unreadRefreshVersion } from '../../lib/unread'
import { LinkButton } from '../ui/Button'

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
  return <nav aria-label="Updates sections" className="flex gap-2">
    <LinkButton to={`/announcements?${feed}`} variant={selected === 'announcements' ? 'primary' : 'secondary'} aria-current={selected === 'announcements' ? 'page' : undefined}>Updates</LinkButton>
    <LinkButton to={`/announcements?${inbox}`} variant={selected === 'inbox' ? 'primary' : 'secondary'} aria-current={selected === 'inbox' ? 'page' : undefined} aria-label={unread > 0 ? `Notifications, ${unread} unread` : undefined}>
      Notifications
      {unread > 0 && <span aria-hidden="true" className={`min-w-6 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${selected === 'inbox' ? 'bg-surface-raised text-ink' : 'bg-action-primary text-on-action'}`}>{unread > 99 ? '99+' : unread}</span>}
    </LinkButton>
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
