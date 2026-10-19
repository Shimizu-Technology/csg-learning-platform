import { useCallback, useEffect, useRef, useState } from 'react'
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
  Home,
  LifeBuoy,
  ShieldAlert,
  CalendarDays,
  Search,
  type LucideIcon,
} from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { api } from '../../lib/api'
import { refreshExistingPushSubscription, pushSupported, webPushPreferenceEnabled } from '../../lib/pushNotifications'
import { subscribeToUserMessages } from '../../lib/realtime'
import { isVisiblePage } from '../../lib/backgroundActivity'
import { isAlumniOnlyEnrollment } from '../../lib/enrollments'
import { preloadPrimaryRoutes, preloadRoute } from '../../lib/routePreload'
import type { ChannelMessageEvent, ChannelSummary, DirectConversationSummary } from '../../types/api'
import { CommandPalette } from './CommandPalette'
import { CohortSwitcher } from './CohortSwitcher'
import { AccountMenu } from './AccountMenu'
import { IconButton } from '../ui/Button'

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
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const restoreMenuButtonFocusRef = useRef(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const lastPresenceUpdateAtRef = useRef(0)
  const location = useLocation()
  const isMessagesRoute = location.pathname.startsWith('/messages')
  const { user, enrollments, isLoading } = useAuthContext()
  const { selectedCohort } = useCohortContext()
  const [unreadCount, setUnreadCount] = useState(0)
  const [messageUnreadCount, setMessageUnreadCount] = useState(0)
  const channelUnreadCountsRef = useRef(new Map<number, number>())
  const directConversationUnreadCountsRef = useRef(new Map<number, number>())
  const isStaff = user?.is_staff
  const isFullAdmin = user?.is_admin
  const closeCommandPalette = useCallback(() => setCommandPaletteOpen(false), [])

  useEffect(() => {
    const openSearch = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setCommandPaletteOpen(true) }
    }
    window.addEventListener('keydown', openSearch)
    return () => window.removeEventListener('keydown', openSearch)
  }, [])

  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  const closeMobileSidebar = useCallback((restoreFocus = true) => {
    restoreMenuButtonFocusRef.current = restoreFocus
    setSidebarOpen(false)
  }, [])

  useEffect(() => {
    if (!sidebarOpen) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      closeMobileSidebar()
    }

    document.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleEscape)
    }
  }, [closeMobileSidebar, sidebarOpen])

  useEffect(() => {
    if (sidebarOpen || !restoreMenuButtonFocusRef.current) return

    const focusFrame = requestAnimationFrame(() => {
      restoreMenuButtonFocusRef.current = false
      menuButtonRef.current?.focus()
    })

    return () => cancelAnimationFrame(focusFrame)
  }, [sidebarOpen])

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
      if (!config.data?.configured || !publicKey || !webPushPreferenceEnabled(config.data)) return

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

    if (isVisiblePage(document.visibilityState)) updatePresence()
    const intervalId = globalThis.setInterval(() => {
      if (isVisiblePage(document.visibilityState)) updatePresence()
    }, 60_000)

    const updatePresenceWhenVisible = () => {
      if (isVisiblePage(document.visibilityState)) updatePresence()
    }

    window.addEventListener('focus', updatePresenceWhenVisible)
    document.addEventListener('visibilitychange', updatePresenceWhenVisible)

    return () => {
      globalThis.clearInterval(intervalId)
      window.removeEventListener('focus', updatePresenceWhenVisible)
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
    { to: '/admin', icon: LayoutDashboard, label: 'Staff home', exact: true },
    { to: '/admin/cohorts', icon: Layers3, label: 'Cohorts' },
    { to: '/admin/meetings', icon: CalendarDays, label: 'Private meetings' },
    { to: '/admin/content', icon: FileText, label: 'Content' },
    { to: '/admin/grading', icon: ClipboardCheck, label: 'Grading' },
    { to: '/admin/support', icon: LifeBuoy, label: 'Student support' },
    { to: '/admin/moderation', icon: ShieldAlert, label: 'Safety queue' },
    { to: '/messages', icon: MessageCircle, label: 'Messages' },
    { to: '/announcements', icon: Bell, label: 'Updates' },
    { to: '/admin/team', icon: Users, label: 'Team' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const instructorNav: NavItem[] = [
    { to: '/admin', icon: LayoutDashboard, label: 'Staff home', exact: true },
    { to: '/admin/cohorts', icon: Layers3, label: 'Cohorts' },
    { to: '/admin/meetings', icon: CalendarDays, label: 'Private meetings' },
    { to: '/admin/content', icon: FileText, label: 'Content' },
    { to: '/admin/grading', icon: ClipboardCheck, label: 'Grading' },
    { to: '/admin/support', icon: LifeBuoy, label: 'Student support' },
    { to: '/admin/moderation', icon: ShieldAlert, label: 'Safety queue' },
    { to: '/messages', icon: MessageCircle, label: 'Messages' },
    { to: '/announcements', icon: Bell, label: 'Updates' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const isAlumniOnly = isAlumniOnlyEnrollment(enrollments)
  const hasMeetingCourse = enrollments.some((entry) => entry.status === 'active' && entry.cohort.course_delivery !== 'self_paced')
  const studentNav: NavItem[] = [
    { to: '/dashboard', icon: Home, label: 'Today' },
    ...(selectedCohort ? [{ to: `/cohorts/${selectedCohort.id}`, icon: Layers3, label: 'My cohort' }] : []),
    { to: '/materials', icon: BookOpenText, label: 'Learn' },
    ...(hasMeetingCourse ? [{ to: '/meetings', icon: CalendarDays, label: 'My meetings' }] : []),
    ...(!isAlumniOnly ? [{ to: '/recordings', icon: PlayCircle, label: 'Recordings' }] : []),
    { to: '/resources', icon: Link2, label: 'Resources' },
    { to: '/messages', icon: MessageCircle, label: 'Messages' },
    { to: '/announcements', icon: Bell, label: 'Updates' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const baseNavItems = isLoading ? [] : isFullAdmin ? adminNav : isStaff ? instructorNav : studentNav
  const navItems = baseNavItems.map((item) => {
    if (!selectedCohort) return item
    if (item.to === '/admin/cohorts') return { ...item, to: `/admin/cohorts/${selectedCohort.id}`, label: 'This cohort' }
    if (item.to === '/admin/grading' || item.to === '/admin/support' || item.to === '/announcements') return { ...item, to: `${item.to}?cohort_id=${selectedCohort.id}` }
    if (item.to === '/messages' && selectedCohort.workspace_id) return { ...item, to: `/messages?workspace_id=${selectedCohort.workspace_id}` }
    return item
  })

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
    const pathname = path.split('?')[0]
    if (pathname === '/dashboard' || exact) return location.pathname === pathname
    return location.pathname.startsWith(pathname)
  }

  const getNavUnreadCount = (path: string) => {
    if (path.startsWith('/announcements')) return unreadCount
    if (path.startsWith('/messages')) return messageUnreadCount
    return 0
  }

  const getNavLabel = (item: NavItem) => {
    const count = getNavUnreadCount(item.to)
    return count > 0 ? `${item.label}, ${count} unread` : item.label
  }

  const sidebarWidth = collapsed ? 'w-[68px]' : 'w-64'
  const mainMargin = collapsed ? 'lg:ml-[68px]' : 'lg:ml-64'
  const collapsedTooltipClassName = 'pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-y-1/2 whitespace-nowrap rounded-lg bg-surface-inverse px-3 py-2 text-xs font-semibold text-white opacity-0 shadow-overlay transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100 lg:block'
  const getLinkHandlers = (path: string) => ({
    onMouseEnter: () => preloadRoute(path),
    onFocus: () => preloadRoute(path),
    onTouchStart: () => preloadRoute(path),
  })
  const studentBottomNav = navItems.filter((item) => ['/dashboard', '/materials', '/messages', '/announcements'].includes(item.to.split('?')[0]))
  const pageContentClassName = isMessagesRoute
    ? 'h-full p-0 lg:p-4'
    : isStaff
      ? 'p-4 sm:p-6 lg:p-8'
      : 'p-4 pb-24 sm:p-6 sm:pb-24 lg:p-8'

  return (
    <div className={isMessagesRoute ? 'h-dvh overflow-hidden bg-surface-page' : 'min-h-dvh bg-surface-page'}>
      <a href="#main-content" aria-hidden={sidebarOpen || undefined} inert={sidebarOpen} className="sr-only z-[100] rounded-xl bg-surface-raised px-4 py-3 font-semibold text-ink shadow-overlay focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to main content
      </a>
      {/* Mobile header */}
      <header aria-hidden={sidebarOpen || undefined} inert={sidebarOpen} className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-line bg-surface-raised px-2 lg:hidden">
        <IconButton
          ref={menuButtonRef}
          label="Open navigation"
          onClick={() => {
            restoreMenuButtonFocusRef.current = false
            setSidebarOpen(true)
          }}
          aria-expanded={sidebarOpen}
        >
          <Menu className="h-6 w-6" aria-hidden="true" />
        </IconButton>
        <Link to={isStaff ? '/admin' : '/dashboard'} className="pressable flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-1" aria-label="Go to your home">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-ruby-600 text-white">
            <GraduationCap className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <span className="hidden truncate font-bold tracking-tight text-ink sm:inline">CSG Learning</span>
        </Link>
        <CohortSwitcher compact />
        <IconButton label="Search and go" onClick={() => setCommandPaletteOpen(true)} className="ml-auto"><Search className="h-5 w-5" aria-hidden="true" /></IconButton>
      </header>

      {/* Mobile sidebar overlay */}
      <div aria-hidden={!sidebarOpen} className={`fixed inset-0 z-50 lg:hidden transition-opacity duration-[240ms] ease-out ${sidebarOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'}`}>
        <div className="fixed inset-0 bg-slate-950/50" onClick={() => closeMobileSidebar()} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Site navigation"
          aria-hidden={!sidebarOpen}
          inert={!sidebarOpen}
          className={`fixed inset-y-0 left-0 flex w-[min(88vw,320px)] flex-col overflow-y-auto overscroll-contain bg-surface-raised pb-[env(safe-area-inset-bottom,0px)] shadow-overlay transition-transform duration-[240ms] ease-drawer ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-line pl-4 pr-2">
            <Link to="/" onClick={() => closeMobileSidebar(false)} className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg" aria-label="Go to homepage">
              <GraduationCap className="h-6 w-6 shrink-0 text-ruby-600" aria-hidden="true" />
              <span className="truncate font-semibold text-ink">CSG Learning Hub</span>
            </Link>
            <IconButton ref={closeButtonRef} label="Close navigation" onClick={() => closeMobileSidebar()}>
              <X className="h-5 w-5" aria-hidden="true" />
            </IconButton>
          </div>
          <nav className="flex-1 space-y-1 p-3">
            <button type="button" onClick={() => { closeMobileSidebar(false); setCommandPaletteOpen(true) }} className="pressable mb-2 flex min-h-11 w-full items-center gap-3 rounded-xl border border-line-strong px-3 text-sm font-medium text-ink-muted hover:bg-surface-sunken"><Search className="h-5 w-5" aria-hidden="true" />Search and go</button>
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => closeMobileSidebar(false)}
                aria-current={isActive(item.to, item.exact) ? 'page' : undefined}
                {...getLinkHandlers(item.to)}
                className={`pressable flex min-h-11 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${
                  isActive(item.to, item.exact)
                    ? 'nav-selected font-semibold'
                    : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
                }`}
              >
                <span className="relative">
                  <item.icon className="h-5 w-5" />
                  {item.to.startsWith('/announcements') && unreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-ruby-600 ring-2 ring-white" />
                  )}
                  {item.to.startsWith('/messages') && messageUnreadCount > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-ruby-600 ring-2 ring-white" />
                  )}
                </span>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-line p-3">
            <AccountMenu name={user?.full_name || user?.email || 'Your account'} role={user?.role} avatarUrl={user?.avatar_url} onNavigate={() => closeMobileSidebar(false)} />
          </div>
        </div>
      </div>

    <div aria-hidden={sidebarOpen || undefined} inert={sidebarOpen} className="flex">
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex lg:flex-col ${sidebarWidth} lg:fixed lg:inset-y-0 border-r border-line bg-surface-raised`}>
        <div className={`flex h-14 items-center ${collapsed ? 'justify-center px-2' : 'px-6'} border-b border-line`}>
          <Link
            to="/"
            title="Go to homepage"
            className={`flex min-h-11 min-w-0 items-center rounded-lg text-ink ${collapsed ? 'justify-center' : 'gap-2'}`}
            aria-label="Go to homepage"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-ruby-600 text-white">
              <GraduationCap className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            {!collapsed && <span className="truncate font-bold tracking-tight text-ink">CSG Learning</span>}
          </Link>
        </div>
        <div className={`border-b border-line ${collapsed ? 'px-2 py-3' : 'px-4 py-3'}`}><CohortSwitcher iconOnly={collapsed} /></div>
        <nav className={`flex-1 ${collapsed ? 'p-2' : 'p-4'} space-y-1`}>
          <button type="button" onClick={() => setCommandPaletteOpen(true)} aria-label="Search and go" className={`pressable group relative mb-2 flex min-h-11 w-full items-center rounded-xl border border-line-strong text-sm font-medium text-ink-muted hover:bg-surface-sunken hover:text-ink ${collapsed ? 'justify-center px-2' : 'gap-3 px-3'}`}><Search className="h-5 w-5" aria-hidden="true" />{!collapsed && <><span>Search</span><kbd className="ml-auto rounded-md bg-surface-sunken px-1.5 py-0.5 font-sans text-xs text-ink-muted">⌘K</kbd></>}</button>
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              aria-label={collapsed ? getNavLabel(item) : undefined}
              aria-current={isActive(item.to, item.exact) ? 'page' : undefined}
              {...getLinkHandlers(item.to)}
              className={`pressable group relative flex min-h-11 items-center ${collapsed ? 'justify-center' : 'gap-3'} rounded-lg ${collapsed ? 'px-2' : 'px-3'} py-2.5 text-sm font-medium ${
                isActive(item.to, item.exact)
                  ? 'nav-selected font-semibold'
                  : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
              }`}
            >
              <span className="relative shrink-0">
                <item.icon className="h-5 w-5" />
                {item.to.startsWith('/announcements') && unreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-ruby-600 ring-2 ring-white" />
                )}
                {item.to.startsWith('/messages') && messageUnreadCount > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-ruby-600 ring-2 ring-white" />
                )}
              </span>
              {!collapsed && item.label}
              {!collapsed && item.to.startsWith('/announcements') && unreadCount > 0 && (
                <span className="ml-auto min-w-6 rounded-full bg-ruby-600 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-white">
                  {unreadCount}
                </span>
              )}
              {!collapsed && item.to.startsWith('/messages') && messageUnreadCount > 0 && (
                <span className="ml-auto min-w-6 rounded-full bg-ruby-600 px-2 py-0.5 text-center text-xs font-semibold tabular-nums text-white">
                  {messageUnreadCount}
                </span>
              )}
              {collapsed && (
                <span
                  className={collapsedTooltipClassName}
                >
                  {getNavLabel(item)}
                  <span className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-surface-inverse" />
                </span>
              )}
            </Link>
            ))}
          </nav>

          {/* Collapse toggle */}
          <div className={`border-t border-line ${collapsed ? 'p-2' : 'p-3'}`}>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`pressable group relative flex min-h-11 items-center ${collapsed ? 'justify-center w-full' : 'gap-3 w-full'} rounded-lg px-3 py-2 text-sm text-ink-muted hover:bg-surface-sunken hover:text-ink`}
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" aria-hidden="true" /> : <PanelLeftClose className="h-5 w-5" aria-hidden="true" />}
              {!collapsed && <span>Collapse</span>}
              {collapsed && (
                <span
                  className={collapsedTooltipClassName}
                >
                  Expand sidebar
                  <span className="absolute left-0 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-surface-inverse" />
                </span>
              )}
            </button>
          </div>

          <div className={`border-t border-line ${collapsed ? 'p-2' : 'p-3'}`}>
            <AccountMenu name={user?.full_name || user?.email || 'Your account'} role={user?.role} avatarUrl={user?.avatar_url} compact={collapsed} />
          </div>
          {!collapsed && (
            <div className="px-4 pb-3 text-center">
              <a
                href="https://shimizu-technology.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block py-2 text-xs text-ink-muted transition-colors hover:text-ink"
              >
                Built by <span className="font-medium">Shimizu Technology</span>
              </a>
            </div>
          )}
        </aside>

        {/* Main content */}
        <main id="main-content" tabIndex={-1} className={`flex-1 min-w-0 overflow-x-hidden ${mainMargin} ${isMessagesRoute ? `${isStaff ? 'h-[calc(100dvh-3.5rem)]' : 'h-[calc(100dvh-7.75rem)]'} overflow-hidden lg:h-dvh` : ''}`}>
          <div className={pageContentClassName}>{children ?? <Outlet />}</div>
        </main>
      </div>

      {!isStaff && (
        <nav aria-label="Primary navigation" aria-hidden={sidebarOpen || undefined} inert={sidebarOpen} className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface-raised px-1 pb-[env(safe-area-inset-bottom,0px)] lg:hidden">
          {studentBottomNav.map((item) => {
            const active = isActive(item.to, item.exact)
            const count = getNavUnreadCount(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                aria-label={getNavLabel(item)}
                {...getLinkHandlers(item.to)}
                className={`pressable relative flex h-[4.25rem] min-w-0 flex-col items-center justify-center gap-1 rounded-xl text-xs ${active ? 'font-semibold text-ink' : 'font-medium text-ink-muted hover:text-ink'}`}
              >
                {active && <span aria-hidden="true" className="absolute inset-x-0 top-0 mx-auto h-[3px] w-8 rounded-b-full bg-ruby-600" />}
                <span className={`relative flex h-7 w-12 items-center justify-center rounded-full transition-colors duration-[180ms] ${active ? 'bg-slate-100' : ''}`}>
                  <item.icon className="h-5 w-5" aria-hidden="true" />
                  {count > 0 && <span className="absolute -right-0.5 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full bg-ruby-600 px-1 text-xs font-semibold tabular-nums leading-none text-white ring-2 ring-white">{count > 9 ? '9+' : count}</span>}
                </span>
                <span className="max-w-full truncate px-0.5">{item.label}</span>
              </Link>
            )
          })}
        </nav>
      )}
      <CommandPalette open={commandPaletteOpen} isStaff={Boolean(isStaff)} onClose={closeCommandPalette} />
    </div>
  )
}
