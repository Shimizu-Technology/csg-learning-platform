import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  User,
  Shield,
  Users,
  FileText,
  ClipboardCheck,
  Menu,
  X,
  GraduationCap,
} from 'lucide-react'
import { UserButton } from '@clerk/clerk-react'
import { useAuthContext } from '../../contexts/AuthContext'

interface LayoutProps {
  children: React.ReactNode
}

export function Layout({ children }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const { user, isClerkEnabled } = useAuthContext()
  const isAdmin = user?.is_staff

  const studentNav = [
    { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
    { to: '/profile', icon: User, label: 'Profile' },
  ]

  const adminNav = [
    { to: '/admin', icon: Shield, label: 'Admin Dashboard' },
    { to: '/admin/students', icon: Users, label: 'Students' },
    { to: '/admin/content', icon: FileText, label: 'Content' },
    { to: '/admin/grading', icon: ClipboardCheck, label: 'Grading' },
  ]

  const navItems = isAdmin ? [...studentNav, ...adminNav] : studentNav

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Mobile header */}
      <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b border-slate-200 bg-white px-4 lg:hidden">
        <button onClick={() => setSidebarOpen(true)} className="text-slate-500 hover:text-slate-700">
          <Menu className="h-6 w-6" />
        </button>
        <div className="flex items-center gap-2">
          <GraduationCap className="h-6 w-6 text-primary-500" />
          <span className="font-semibold text-slate-900">CSG Learn</span>
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
                <span className="font-semibold text-slate-900">CSG Learn</span>
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
                    isActive(item.to)
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
        <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 border-r border-slate-200 bg-white">
          <div className="flex h-14 items-center gap-2 px-6 border-b border-slate-200">
            <GraduationCap className="h-6 w-6 text-primary-500" />
            <span className="font-semibold text-slate-900">CSG Learn</span>
          </div>
          <nav className="flex-1 p-4 space-y-1">
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive(item.to)
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <item.icon className="h-5 w-5" />
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="border-t border-slate-200 p-4">
            <div className="flex items-center gap-3 px-3 py-2">
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
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-semibold">
                  {user?.first_name?.[0] || user?.email?.[0] || '?'}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">{user?.full_name || user?.email}</p>
                <p className="text-xs text-slate-500 truncate capitalize">{user?.role}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 lg:ml-64">
          <div className="p-4 lg:p-8">{children}</div>
        </main>
      </div>
    </div>
  )
}
