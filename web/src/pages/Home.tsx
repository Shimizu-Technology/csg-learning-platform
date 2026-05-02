import { Link } from 'react-router-dom'
import { ArrowRight, BookOpenText, GraduationCap, Layers3, MessageCircle, PlayCircle, ShieldCheck } from 'lucide-react'
import { useAuthContext } from '../contexts/AuthContext'

export function HomePage() {
  const { isSignedIn, user } = useAuthContext()
  const dashboardPath = user?.is_staff ? '/admin' : '/dashboard'

  return (
    <main className="min-h-screen bg-slate-950 text-white">
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1800&q=80')] bg-cover bg-center opacity-30" />
        <div className="absolute inset-0 bg-slate-950/70" />
        <div className="relative mx-auto flex min-h-[92vh] max-w-6xl flex-col px-5 py-6">
          <header className="flex items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-2">
              <GraduationCap className="h-7 w-7 text-primary-400" />
              <span className="font-semibold tracking-tight">CSG Learning Hub</span>
            </Link>
            <div className="flex items-center gap-2">
              {isSignedIn ? (
                <Link
                  to={dashboardPath}
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-950 hover:bg-slate-100"
                >
                  Go to app
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <>
                  <Link to="/sign-in" className="rounded-lg px-3 py-2 text-sm font-medium text-white/80 hover:text-white">
                    Sign in
                  </Link>
                  <Link
                    to="/sign-up"
                    className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600"
                  >
                    Create account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </>
              )}
            </div>
          </header>

          <div className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1fr_420px]">
            <div className="max-w-3xl">
              <p className="text-sm font-semibold uppercase tracking-[0.22em] text-primary-300">Code School of Guam</p>
              <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                Your class hub for lessons, recordings, resources, and support.
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
                CSG Learning Hub keeps students and staff in one organized place: class materials, progress, recordings, resources, messages, and announcements.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  to={isSignedIn ? dashboardPath : '/sign-in'}
                  className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-100"
                >
                  {isSignedIn ? 'Open dashboard' : 'Sign in to class'}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="https://codeschoolofguam.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg border border-white/25 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Visit Code School of Guam
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-white/15 bg-white/10 p-4 shadow-2xl backdrop-blur">
              <div className="rounded-xl bg-white p-4 text-slate-950">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Today</p>
                    <p className="text-sm font-semibold">Learning workspace</p>
                  </div>
                  <ShieldCheck className="h-5 w-5 text-green-600" />
                </div>
                <div className="mt-4 grid gap-3">
                  {[
                    { icon: BookOpenText, label: 'Materials', value: 'Lessons and exercises' },
                    { icon: PlayCircle, label: 'Recordings', value: 'Replay class sessions' },
                    { icon: Layers3, label: 'Resources', value: 'Links and shortcuts' },
                    { icon: MessageCircle, label: 'Messages', value: 'Ask questions fast' },
                  ].map((item) => (
                    <div key={item.label} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <item.icon className="h-5 w-5 text-primary-500" />
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                        <p className="text-xs text-slate-500">{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
