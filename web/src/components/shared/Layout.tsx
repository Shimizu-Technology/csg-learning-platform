import { useState } from 'react'
import { Link, Outlet, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  User,
  Users,
  FileText,
  ClipboardCheck,
  Menu,
  X,
  GraduationCap,
  PlayCircle,
  Link2,
  Layers3,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { UserButton } from '@clerk/clerk-react'
import { useAuthContext } from '../../contexts/AuthContext'

interface LayoutProps {
  children?: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar-collapsed') === 'true' } catch { return false }
  })
  const location = useLocation()
  const { user, isClerkEnabled } = useAuthContext()
  const isStaff = user?.is_staff
  const isFullAdmin = user?.is_admin

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try { localStorage.setItem('sidebar-collapsed', String(next)) } catch {}
  }

  const adminNav = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { to: '/admin/cohorts', icon: Layers3, label: 'Cohorts' },
    { to: '/admin/content', icon: FileText, label: 'Content' },
    { to: '/admin/grading', icon: ClipboardCheck, label: 'Grading' },
    { to: '/admin/team', icon: Users, label: 'Team' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const instructorNav = [
    { to: '/admin', icon: LayoutDashboard, label: 'Dashboard', exact: true },
    { to: '/admin/cohorts', icon: Layers3, label: 'Cohorts' },
    { to: '/admin/grading', icon: ClipboardCheck, label: 'Grading' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const studentNav = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/recordings', icon: PlayCircle, label: 'Recordings' },
    { to: '/resources', icon: Link2, label: 'Resources' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const navItems = isFullAdmin ? adminNav : isStaff ? instructorNav : studentNav

  const isActive = (path: string, exact?: boolean) => {
    if (path === '/' || exact) return location.pathname === path
    return location.pathname.startsWith(path)
  }

  const sidebarWidth = collapsed ? 'w-[68px]' : 'w-64'
  const mainMargin = collapsed ? 'lg:ml-[68px]' : 'lg:ml-64'

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile header */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-slate-200 bg-white px-4 lg:hidden">
        <button onClick={() => setSidebarOpen(true)} className="text-slate-500 hover:text-slate-700">
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-primary-500" />
          <span className="font-semibold text-slate-900">CSG Learning Hub</span>
        </div>
      </header>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-slate-900/50" onClick={() => setSidebarOpen(false)} />
          <div className="fixed inset-y-0 left-0 w-72 bg-white shadow-xl">
            <div className="flex h-14 items-center justify-between px-4 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <GraduationCap className="h-6 w-6 text-primary-500" />
                <span className="font-semibold text-slate-900">CSG Learning Hub</span>
              </div>
              <button onClick={() => setSidebarOpen(false)} className="text-slate-500">
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="p-4 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setSidebarOpen(false)}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive(item.to, 'exact' in item ? (item as { exact?: boolean }).exact : undefined)
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    )}

    <div className="flex">
      {/* Desktop sidebar */}
      <aside className={`hidden lg:flex lg:flex-col ${sidebarWidth} lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white transition-all duration-200`}>
        <div className={`flex h-14 items-center ${collapsed ? 'justify-center px-2' : 'gap-2 px-6'} border-b border-slate-200`}>
          <GraduationCap className="h-6 w-6 text-primary-500 shrink-0" />
          {!collapsed && <span className="font-semibold text-slate-900">CSG Learning Hub</span>}
        </div>
        <nav className={`flex-1 ${collapsed ? 'p-2' : 'p-4'} space-y-1`}>
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              title={collapsed ? item.label : undefined}
              className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3'} rounded-lg ${collapsed ? 'px-2' : 'px-3'} py-2.5 text-sm font-medium transition-colors ${
                isActive(item.to, 'exact' in item ? (item as { exact?: boolean }).exact : undefined)
                  ? 'bg-primary-50 text-primary-700'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
                <item.icon className="h-5 w-5 shrink-0" />
                {!collapsed && item.label}
              </Link>
            ))}
          </nav>

          {/* Collapse toggle */}
          <div className={`border-t border-slate-200 ${collapsed ? 'p-2' : 'p-4'}`}>
            <button
              onClick={toggleCollapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className={`flex items-center ${collapsed ? 'justify-center w-full' : 'gap-3 w-full'} rounded-lg px-3 py-2 text-sm text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors`}
            >
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
              {!collapsed && <span>Collapse</span>}
            </button>
          </div>

          <div className={`border-t border-slate-200 ${collapsed ? 'p-2' : 'p-4'}`}>
            <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-3 px-3'} py-2`}>
              {isClerkEnabled ? (
                <UserButton
                  afterSignOutUrl="/sign-in"
                  appearance={{
                    elements: {
                      avatarBox: 'h-8 w-8',
                    }
                  }}
                />
              ) : (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-semibold shrink-0">
                  {user?.first_name?.[0] || user?.email?.[0] || '?'}
                </div>
              )}
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
        <main className={`flex-1 min-w-0 overflow-x-hidden ${mainMargin} transition-all duration-200`}>
          <div className="p-4 lg:p-8">{children ?? <Outlet />}</div>
        </main>
      </div>
    </div>
  )
}
