import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpenText,
  GraduationCap,
  Layers3,
  MessageCircle,
  PlayCircle,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useAuthContext } from '../contexts/AuthContext'

const workspaceItems = [
  { icon: BookOpenText, label: 'Materials', value: 'Lessons, exercises, and progress in order' },
  { icon: PlayCircle, label: 'Recordings', value: 'Uploaded, YouTube, and external replays together' },
  { icon: Layers3, label: 'Resources', value: 'Class links, hotkeys, and references by category' },
  { icon: MessageCircle, label: 'Messages', value: 'Class channels, DMs, threads, and read receipts' },
]

const audienceItems = [
  {
    title: 'For students',
    body: "One place to find today's work, catch up on recordings, ask for help, and keep moving even when the connection is spotty.",
  },
  {
    title: 'For instructors',
    body: 'A clean view of cohorts, progress, submissions, presence, recordings, resources, announcements, and student support.',
  },
  {
    title: 'For Code School of Guam',
    body: 'A focused learning hub built around the way live cohorts actually run, with the operational details in one reliable system.',
  },
]

export function HomePage() {
  const { isSignedIn, user } = useAuthContext()
  const dashboardPath = user?.is_staff ? '/admin' : '/dashboard'

  return (
    <main className="min-h-screen bg-white text-slate-950">
      <section className="relative overflow-hidden bg-slate-950 text-white">
        <div className="absolute inset-0 bg-[url('https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=1800&q=80')] bg-cover bg-center opacity-25" />
        <div className="absolute inset-0 bg-slate-950/75" />

        <div className="relative mx-auto flex min-h-[92svh] max-w-6xl flex-col px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
          <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Link to="/" className="inline-flex items-center gap-2 self-start rounded-lg hover:opacity-85">
              <GraduationCap className="h-7 w-7 text-primary-400" />
              <span className="font-semibold tracking-tight">CSG Learning Hub</span>
            </Link>

            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
              {isSignedIn ? (
                <Link
                  to={dashboardPath}
                  className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-slate-100 sm:flex-none"
                >
                  Go to app
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <>
                  <Link
                    to="/sign-in"
                    className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-white/20 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 sm:flex-none"
                  >
                    Sign in
                  </Link>
                  <Link
                    to="/sign-up"
                    className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-600 sm:flex-none"
                  >
                    Create account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </>
              )}
            </div>
          </header>

          <div className="grid flex-1 items-center gap-8 py-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_420px] lg:gap-12">
            <div className="max-w-3xl">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-300 sm:text-sm">Code School of Guam</p>
              <h1 className="mt-4 max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                CSG Learning Hub
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-7 text-slate-200 sm:text-lg">
                Lessons, recordings, resources, progress, announcements, and messages in one reliable class workspace.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link
                  to={isSignedIn ? dashboardPath : '/sign-in'}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-slate-100"
                >
                  {isSignedIn ? 'Open dashboard' : 'Sign in to class'}
                  <ArrowRight className="h-4 w-4" />
                </Link>
                <a
                  href="https://codeschoolofguam.com"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex min-h-12 items-center justify-center rounded-lg border border-white/25 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10"
                >
                  Visit Code School of Guam
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-white/15 bg-white/10 p-3 shadow-2xl backdrop-blur sm:p-4">
              <div className="rounded-xl bg-white p-4 text-slate-950">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Class workspace</p>
                    <p className="text-sm font-semibold">Today at a glance</p>
                  </div>
                  <ShieldCheck className="h-5 w-5 text-green-600" />
                </div>
                <div className="mt-4 grid gap-3">
                  {workspaceItems.map((item) => (
                    <div key={item.label} className="flex min-w-0 items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <item.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary-500" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">{item.label}</p>
                        <p className="mt-0.5 text-xs leading-5 text-slate-500">{item.value}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-slate-200 bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-semibold text-primary-600">Built for live cohorts</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">
              The class details stay organized, current, and easy to find.
            </h2>
          </div>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {audienceItems.map((item) => (
              <article key={item.title} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-primary-50 text-primary-600">
                  <Users className="h-5 w-5" />
                </div>
                <h3 className="text-base font-semibold text-slate-950">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-slate-50 py-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <div>
            <h2 className="text-xl font-bold text-slate-950">Already part of a cohort?</h2>
            <p className="mt-1 text-sm text-slate-600">Sign in with the account connected to your Code School of Guam class.</p>
          </div>
          <Link
            to={isSignedIn ? dashboardPath : '/sign-in'}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary-500 px-5 py-3 text-sm font-semibold text-white hover:bg-primary-600"
          >
            {isSignedIn ? 'Open dashboard' : 'Sign in'}
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </section>
    </main>
  )
}
