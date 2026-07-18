import { useEffect, useRef, useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  User,
  Users,
  FileText,
  BookOpenText,
  ClipboardCheck,
  Menu,
  X,
  GraduationCap,
  PlayCircle,
  Link2,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
  Bell,
  MessageCircle,
  type LucideIcon,
} from 'lucide-react'
import { UserButton } from '@clerk/clerk-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { api } from '../../lib/api'
import { refreshExistingPushSubscription, pushSupported } from '../../lib/pushNotifications'
import { subscribeToUserMessages } from '../../lib/realtime'
import { preloadPrimaryRoutes, preloadRoute } from '../../lib/routePreload'
import type { ChannelMessageEvent, ChannelSummary, DirectConversationSummary } from '../../types/api'

interface LayoutProps {
  children?: React.ReactNode
}

interface NavItem {
  to: string
  icon: LucideIcon
  label: string
  exact?: boolean
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const lastPresenceUpdateAtRef = useRef(0)
  const location = useLocation()
  const isMessagesRoute = location.pathname.startsWith('/messages')
  const { user, isLoading } = useAuthContext()
  const [unreadCount, setUnreadCount] = useState(0)
  const [messageUnreadCount, setMessageUnreadCount] = useState(0)
  const channelUnreadCountsRef = useRef(new Map<number, number>())
  const directConversationUnreadCountsRef = useRef(new Map<number, number>())
  const isStaff = user?.is_staff
  const isFullAdmin = user?.is_admin

  const syncMessageUnreadCount = () => {
    const channelUnread = Array.from(channelUnreadCountsRef.current.values()).reduce((sum, count) => sum + count, 0)
    const dmUnread = Array.from(directConversationUnreadCountsRef.current.values()).reduce((sum, count) => sum + count, 0)
    setMessageUnreadCount(channelUnread + dmUnread)
  }

  useEffect(() => {
    if (!user) return

    api.getNotifications({ per_page: 1, notification_type: 'announcement' }).then((res) => {
      if (res.data) setUnreadCount(res.data.unread_count)
    })
    Promise.all([api.getChannels(), api.getDirectConversations()]).then(([channelRes, dmRes]) => {
      channelUnreadCountsRef.current = new Map((channelRes.data?.channels || []).map((channel) => [channel.id, channel.unread_count]))
      directConversationUnreadCountsRef.current = new Map((dmRes.data?.direct_conversations || []).map((conversation) => [conversation.id, conversation.unread_count]))
      syncMessageUnreadCount()
    })
  }, [user, location.pathname])

  useEffect(() => {
    if (!user || !pushSupported() || Notification.permission !== 'granted') return

    let active = true

    api.getPushConfig().then((config) => {
      if (!active) return

      const publicKey = config.data?.public_key || import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
      if (!config.data?.configured || !publicKey || !config.data?.notifications_enabled) return

      refreshExistingPushSubscription(publicKey).catch((error) => {
        console.warn('Push subscription refresh failed:', error)
      })
    })

    return () => {
      active = false
    }
  }, [user])

  useEffect(() => {
    if (!user) return

    let active = true
    let unsubscribe: (() => void) | null = null

    const updateChannelUnread = (channel: ChannelSummary) => {
      channelUnreadCountsRef.current.set(channel.id, channel.unread_count)
      syncMessageUnreadCount()
    }

    const updateDirectConversationUnread = (conversation: DirectConversationSummary) => {
      directConversationUnreadCountsRef.current.set(conversation.id, conversation.unread_count)
      syncMessageUnreadCount()
    }

    subscribeToUserMessages((payload) => {
      if (!active) return

      const event = payload as ChannelMessageEvent
      if (event.channel) updateChannelUnread(event.channel)
      if (event.direct_conversation) updateDirectConversationUnread(event.direct_conversation)
    }).then((cleanup) => {
      if (active) unsubscribe = cleanup
      else cleanup()
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [user])

  useEffect(() => {
    if (!user) return

    const updatePresence = () => {
      const now = Date.now()
      if (now - lastPresenceUpdateAtRef.current < 5_000) return

      lastPresenceUpdateAtRef.current = now
      void api.updatePresence()
    }

    updatePresence()
    const intervalId = globalThis.setInterval(() => {
      updatePresence()
    }, 60_000)

    const updatePresenceWhenVisible = () => {
      if (document.visibilityState === 'visible') updatePresence()
    }

    window.addEventListener('focus', updatePresence)
    document.addEventListener('visibilitychange', updatePresenceWhenVisible)

    return () => {
      globalThis.clearInterval(intervalId)
      window.removeEventListener('focus', updatePresence)
      document.removeEventListener('visibilitychange', updatePresenceWhenVisible)
    }
  }, [user])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem('sidebar-collapsed', String(next))
    } catch {
      // Ignore unavailable storage in private browsing or locked-down WebViews.
    }
  }

  const adminNav: NavItem[] = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { to: '/admin/cohorts', icon: Layers3, label: 'Cohorts' },
    { to: '/admin/content', icon: FileText, label: 'Content' },
    { to: '/admin/grading', icon: ClipboardCheck, label: 'Grading' },
    { to: '/messages', icon: MessageCircle, label: 'Messages' },
    { to: '/announcements', icon: Bell, label: 'Announcements' },
    { to: '/admin/team', icon: Users, label: 'Team' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const instructorNav: NavItem[] = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { to: '/admin/cohorts', icon: Layers3, label: 'Cohorts' },
    { to: '/admin/grading', icon: ClipboardCheck, label: 'Grading' },
    { to: '/messages', icon: MessageCircle, label: 'Messages' },
    { to: '/announcements', icon: Bell, label: 'Announcements' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const studentNav: NavItem[] = [
    { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/materials', icon: BookOpenText, label: 'Materials' },
    { to: '/recordings', icon: PlayCircle, label: 'Recordings' },
    { to: '/resources', icon: Link2, label: 'Resources' },
    { to: '/messages', icon: MessageCircle, label: 'Messages' },
    { to: '/announcements', icon: Bell, label: 'Announcements' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const navItems = isLoading ? [] : isFullAdmin ? adminNav : isStaff ? instructorNav : studentNav

  useEffect(() => {
    if (navItems.length === 0 || typeof window === 'undefined') return

    const paths = Array.from(new Set(navItems.map((item) => item.to)))
    const preload = () => preloadPrimaryRoutes(paths)
    const win = window as Window & typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number
      cancelIdleCallback?: (handle: number) => void
    }

    if (typeof win.requestIdleCallback === 'function' && typeof win.cancelIdleCallback === 'function') {
      const handle = win.requestIdleCallback(preload, { timeout: 1200 })
      return () => win.cancelIdleCallback?.(handle)
    }

    const timeoutId = globalThis.setTimeout(preload, 200)
    return () => globalThis.clearTimeout(timeoutId)
  }, [navItems])

  const isActive = (path: string, exact?: boolean) => {
    if (path === '/dashboard' || exact) return location.pathname === path
    return location.pathname.startsWith(path)
  }

  const getNavUnreadCount = (path: string) => {
    if (path === '/announcements') return unreadCount
    if (path === '/messages') return messageUnreadCount
    return 0
  }

  const getNavLabel = (item: NavItem) => {
    const count = getNavUnreadCount(item.to)
    return count > 0 ? `${item.label}, ${count} unread` : item.label
  }

  const sidebarWidth = collapsed ? 'w-[68px]' : 'w-64'
  const mainMargin = collapsed ? 'lg:ml-[68px]' : 'lg:ml-64'
  const collapsedTooltipClassName = 'pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-slate-950 px-3 py-2 text-xs font-semibold text-white opacity-0 shadow-lg shadow-slate-900/20 ring-1 ring-white/10 transition duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 lg:block'
  const getLinkHandlers = (path: string) => ({
    onMouseEnter: () => preloadRoute(path),
    onFocus: () => preloadRoute(path),
    onTouchStart: () => preloadRoute(path),
  })

  return (
    <div className={isMessagesRoute ? 'h-dvh overflow-hidden bg-slate-50' : 'min-h-screen bg-slate-50'}>
      {/* Mobile header */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-slate-200 bg-white px-4 lg:hidden">
        <button onClick={() => setSidebarOpen(true)} className="text-slate-500 hover:text-slate-700">
          <Menu className="h-6 w-6" />
        </button>
        <Link to="/" className="flex min-w-0 items-center gap-2 rounded-lg hover:opacity-80" aria-label="Go to homepage">
          <GraduationCap className="h-6 w-6 text-primary-500" />
          <span className="truncate font-semibold text-slate-900">CSG Learning Hub</span>
        </Link>
      </header>

      {/* Mobile sidebar overlay */}
      <div className={`fixed inset-0 z-50 lg:hidden transition-opacity duration-300 ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}>
        <div className="fixed inset-0 bg-slate-900/50 transition-opacity duration-300" onClick={() => setSidebarOpen(false)} />
        <div className={`fixed inset-y-0 left-0 flex w-72 flex-col bg-white shadow-xl transition-transform duration-300 ease-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="flex h-14 items-center justify-between border-b border-slate-200 px-4">
            <Link to="/" onClick={() => setSidebarOpen(false)} className="flex min-w-0 items-center gap-2 rounded-lg hover:opacity-80" aria-label="Go to homepage">
              <GraduationCap className="h-6 w-6 text-primary-500" />
              <span className="truncate font-semibold text-slate-900">CSG Learning Hub</span>
            </Link>
            <button onClick={() => setSidebarOpen(false)} className="text-slate-500">
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="flex-1 space-y-1 p-4">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setSidebarOpen(false)}
                aria-current={isActive(item.to, item.exact) ? 'page' : undefined}
                {...getLinkHandlers(item.to)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive(item.to, item.exact)
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className="relative">
                  <item.icon className="h-5 w-5" />
                  {item.to === '/announcements' && unreadCount > 0 && (
                    <span className="absolute -right-2 -top-2 h-2.5 w-2.5 rounded-full bg-primary-500 ring-2 ring-white" />
                  )}
                  {item.to === '/messages' && messageUnreadCount > 0 && (
                    <span className="absolute -right-2 -top-2 h-2.5 w-2.5 rounded-full bg-primary-500 ring-2 ring-white" />
                  )}
                </span>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-slate-200 p-4">
            <div className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-3">
              <UserButton
                afterSignOutUrl="/sign-in"
                appearance={{
                  elements: {
                    avatarBox: 'h-9 w-9',
                  }
                }}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900">{user?.full_name || user?.email}</p>
                <p className="truncate text-xs capitalize text-slate-500">{user?.role}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

    <div className="flex">
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex lg:flex-col ${sidebarWidth} lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white transition-all duration-200`}>
        <div className={`flex h-14 items-center ${collapsed ? 'justify-center px-2' : 'px-6'} border-b border-slate-200`}>
          <Link
            to="/"
            title="Go to homepage"
            className={`flex min-w-0 items-center rounded-lg text-slate-900 hover:opacity-80 ${collapsed ? 'justify-center' : 'gap-2'}`}
            aria-label="Go to homepage"
          >
            <GraduationCap className="h-6 w-6 text-primary-500 shrink-0" />
            {!collapsed && <span className="truncate font-semibold text-slate-900">CSG Learning Hub</span>}
          </Link>
        </div>
        <nav className={`flex-1 ${collapsed ? 'p-2' : 'p-4'} space-y-1`}>
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-label={collapsed ? getNavLabel(item) : undefined}
              aria-current={isActive(item.to, item.exact) ? 'page' : undefined}
              {...getLinkHandlers(item.to)}
              className={`group relative flex items-center ${collapsed ? 'justify-center' : 'gap-3'} rounded-lg ${collapsed ? 'px-2' : 'px-3'} py-2.5 text-sm font-medium transition-colors ${
                isActive(item.to, item.exact)
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="relative shrink-0">
                <item.icon className="h-5 w-5" />
                {item.to === '/announcements' && unreadCount > 0 && (
                  <span className="absolute -right-2 -top-2 h-2.5 w-2.5 rounded-full bg-primary-500 ring-2 ring-white" />
                )}
                {item.to === '/messages' && messageUnreadCount > 0 && (
                  <span className="absolute -right-2 -top-2 h-2.5 w-2.5 rounded-full bg-primary-500 ring-2 ring-white" />
                )}
              </span>
              {!collapsed && item.label}
              {!collapsed && item.to === '/announcements' && unreadCount > 0 && (
                <span className="ml-auto rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">
                  {unreadCount}
                </span>
              )}
              {!collapsed && item.to === '/messages' && messageUnreadCount > 0 && (
                <span className="ml-auto rounded-full bg-primary-100 px-2 py-0.5 text-xs font-semibold text-primary-700">
                  {messageUnreadCount}
                </span>
              )}
              {collapsed && (
                <span
                  className={collapsedTooltipClassName}
                >
                  {getNavLabel(item)}
                  <span className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-slate-950" />
                </span>
              )}
            </Link>
            ))}
          </nav>

          {/* Collapse toggle */}
          <div className={`border-t border-slate-200 ${collapsed ? 'p-2' : 'p-4'}`}>
            <button
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`group relative flex items-center ${collapsed ? 'justify-center w-full' : 'gap-3 w-full'} rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors`}
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
              {!collapsed && <span>Collapse</span>}
              {collapsed && (
                <span
                  className={collapsedTooltipClassName}
                >
                  Expand sidebar
                  <span className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-slate-950" />
                </span>
              )}
            </button>
          </div>

          <div className={`border-t border-slate-200 ${collapsed ? 'p-2' : 'p-4'}`}>
            <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3 px-3'} py-2`}>
              <UserButton
                afterSignOutUrl="/sign-in"
                appearance={{
                  elements: {
                    avatarBox: 'h-8 w-8',
                  }
                }}
              />
              {!collapsed && (
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{user?.full_name || user?.email}</p>
                  <p className="text-xs text-slate-500 truncate capitalize">{user?.role}</p>
                </div>
              )}
            </div>
          </div>
          {!collapsed && (
            <div className="px-4 pb-3 text-center">
              <a
                href="https://shimizu-technology.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors duration-200"
              >
                Built by <span className="font-medium">Shimizu Technology</span>
              </a>
            </div>
          )}
        </aside>

        {/* Main content */}
        <main className={`flex-1 min-w-0 overflow-x-hidden ${mainMargin} transition-all duration-200 ${isMessagesRoute ? 'h-[calc(100dvh-3.5rem)] overflow-hidden lg:h-dvh' : ''}`}>
          <div className={isMessagesRoute ? 'h-full p-0 lg:p-4' : 'p-4 lg:p-8'}>{children ?? <Outlet />}</div>
        </main>
      </div>
    </div>
  )
}
