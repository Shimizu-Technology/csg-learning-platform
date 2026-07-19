import { Link } from 'react-router-dom'
import {
  ArrowRight,
  BookOpenText,
  Check,
  CheckCircle2,
  Clock3,
  GraduationCap,
  MapPin,
  MessageCircle,
  PlayCircle,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { useAuthContext } from '../contexts/AuthContext'

const outcomes = [
  {
    icon: BookOpenText,
    label: 'A clear learning path',
    body: 'Lessons, exercises, unlocks, deadlines, and feedback stay in the order students need them.',
  },
  {
    icon: MessageCircle,
    label: 'Class context stays together',
    body: 'Announcements, channels, direct messages, office hours, and resources live beside the coursework.',
  },
  {
    icon: Users,
    label: 'Staff can act sooner',
    body: 'Progress, submissions, recordings, and student activity give instructors one dependable operating view.',
  },
]

export function HomePage() {
  const { isSignedIn, user } = useAuthContext()
  const dashboardPath = user?.is_staff ? '/admin' : '/dashboard'

  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f4ef] text-slate-950">
      <section className="relative isolate min-h-[92svh] overflow-hidden bg-[#17191f] text-white">
        <div className="absolute inset-0 -z-20 bg-[radial-gradient(circle_at_78%_18%,rgba(239,68,68,0.18),transparent_34%),radial-gradient(circle_at_14%_82%,rgba(132,145,104,0.13),transparent_30%)]" />
        <div className="absolute inset-0 -z-10 opacity-25 [background-image:linear-gradient(rgba(255,255,255,.045)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.045)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:linear-gradient(to_bottom,black,transparent_88%)]" />

        <div className="mx-auto flex min-h-[92svh] max-w-7xl flex-col px-4 sm:px-6 lg:px-8">
          <header className="flex min-h-20 items-center justify-between gap-4 border-b border-white/10">
            <Link to="/" aria-label="CSG Learning home" className="inline-flex min-h-11 items-center gap-3 rounded-xl pr-2 transition-opacity hover:opacity-80">
              <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-600 text-white shadow-lg shadow-primary-950/30">
                <GraduationCap className="h-5 w-5" />
              </span>
              <span>
                <span className="block text-sm font-extrabold tracking-tight">CSG Learning</span>
                <span className="hidden text-[10px] font-semibold uppercase tracking-[0.18em] text-white/45 sm:block">Code School of Guam</span>
              </span>
            </Link>

            <div className="flex items-center gap-2">
              {isSignedIn ? (
                <Link to={dashboardPath} className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-bold text-slate-950 transition hover:-translate-y-0.5 hover:bg-slate-100">
                  Open the app
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ) : (
                <>
                  <Link to="/sign-in" className="inline-flex min-h-11 items-center justify-center rounded-xl px-3 text-sm font-bold text-white/75 transition hover:bg-white/10 hover:text-white sm:px-4">
                    Sign in
                  </Link>
                  <Link to="/sign-up" className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2 text-sm font-bold text-white shadow-lg shadow-primary-950/25 transition hover:-translate-y-0.5 hover:bg-primary-500">
                    Join your cohort
                    <ArrowRight className="hidden h-4 w-4 transition-transform group-hover:translate-x-0.5 sm:block" />
                  </Link>
                </>
              )}
            </div>
          </header>

          <div className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[minmax(0,0.92fr)_minmax(440px,1.08fr)] lg:gap-16 lg:py-20">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-bold uppercase tracking-[0.16em] text-white/70">
                <MapPin className="h-3.5 w-3.5 text-primary-400" />
                Built for cohorts in Guam
              </div>
              <h1 className="mt-7 text-5xl font-extrabold leading-[0.98] tracking-[-0.055em] text-white sm:text-6xl lg:text-7xl">
                One clear path
                <span className="block text-primary-400">through class.</span>
              </h1>
              <p className="mt-7 max-w-xl text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
                Everything Code School of Guam students and instructors need—from today’s lesson to the last piece of feedback—in one focused learning workspace.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to={isSignedIn ? dashboardPath : '/sign-in'} className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-slate-950 transition hover:-translate-y-0.5 hover:bg-slate-100">
                  {isSignedIn ? 'Continue learning' : 'Enter your classroom'}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <a href="https://codeschoolofguam.com" target="_blank" rel="noreferrer" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/15 px-5 py-3 text-sm font-bold text-white/80 transition hover:border-white/30 hover:bg-white/10 hover:text-white">
                  About Code School of Guam
                </a>
              </div>
              <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-white/50">
                <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-green-400" />One login</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-green-400" />Works on mobile</span>
                <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-green-400" />Built for live cohorts</span>
              </div>
            </div>

            <div className="relative mx-auto w-full max-w-[620px] lg:mr-0">
              <div className="absolute -left-10 top-20 hidden h-32 w-32 rounded-full bg-primary-500/20 blur-3xl sm:block" />
              <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-white/[0.08] p-2.5 shadow-2xl shadow-black/35 backdrop-blur-xl sm:p-3">
                <div className="overflow-hidden rounded-[1.5rem] bg-[#fbfbfc] text-slate-950">
                  <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 sm:px-5">
                    <div className="flex items-center gap-2.5">
                      <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary-600 text-white"><GraduationCap className="h-4 w-4" /></span>
                      <div>
                        <p className="text-xs font-extrabold">Your learning path</p>
                        <p className="text-[10px] font-semibold text-slate-400">Live Class · Week 4</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold text-green-700">On track</span>
                  </div>

                  <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_150px] sm:p-5">
                    <div>
                      <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-primary-600">Continue where you left off</p>
                      <div className="mt-2 rounded-2xl bg-slate-950 p-4 text-white shadow-lg shadow-slate-900/10">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="text-sm font-extrabold">Build a Rails API</p>
                            <p className="mt-1 text-xs leading-5 text-slate-400">Lesson 3 of 6 · Routes and controllers</p>
                          </div>
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-500"><ArrowRight className="h-4 w-4" /></span>
                        </div>
                        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/10"><div className="h-full w-[62%] rounded-full bg-primary-400" /></div>
                      </div>

                      <div className="relative mt-4 space-y-3 pl-7">
                        <span className="absolute bottom-3 left-[9px] top-3 w-px bg-slate-200" />
                        <div className="relative flex items-center gap-3">
                          <span className="absolute -left-7 flex h-5 w-5 items-center justify-center rounded-full bg-green-100 ring-4 ring-[#fbfbfc]"><CheckCircle2 className="h-3.5 w-3.5 text-green-600" /></span>
                          <div className="min-w-0"><p className="text-xs font-bold">HTML & CSS foundations</p><p className="text-[10px] text-slate-400">Complete</p></div>
                        </div>
                        <div className="relative flex items-center gap-3">
                          <span className="absolute -left-7 h-5 w-5 rounded-full border-[5px] border-primary-100 bg-primary-600 ring-4 ring-[#fbfbfc]" />
                          <div className="min-w-0"><p className="text-xs font-bold">Ruby on Rails</p><p className="text-[10px] text-primary-600">In progress</p></div>
                        </div>
                        <div className="relative flex items-center gap-3">
                          <span className="absolute -left-7 h-5 w-5 rounded-full border-2 border-slate-200 bg-white ring-4 ring-[#fbfbfc]" />
                          <div className="min-w-0"><p className="text-xs font-bold text-slate-500">React applications</p><p className="text-[10px] text-slate-400">Up next</p></div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-1">
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <Clock3 className="h-4 w-4 text-primary-600" />
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Office hours</p>
                        <p className="mt-0.5 text-xs font-extrabold">Today · 4:00 PM</p>
                      </div>
                      <div className="rounded-2xl border border-slate-200 bg-white p-3">
                        <PlayCircle className="h-4 w-4 text-primary-600" />
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Recordings</p>
                        <p className="mt-0.5 text-xs font-extrabold">2 new this week</p>
                      </div>
                      <div className="col-span-2 rounded-2xl border border-primary-100 bg-primary-50 p-3 sm:col-span-1">
                        <MessageCircle className="h-4 w-4 text-primary-600" />
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-primary-500">Class update</p>
                        <p className="mt-0.5 text-xs font-extrabold">Demo moved to Friday</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="absolute -bottom-5 -left-4 hidden items-center gap-2 rounded-2xl border border-white/10 bg-[#22252d] px-3 py-2 text-xs font-bold text-white shadow-xl sm:flex">
                <ShieldCheck className="h-4 w-4 text-green-400" />
                Progress saved automatically
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-20 sm:py-24 lg:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr] lg:gap-20">
            <div>
              <p className="app-eyebrow">Built around momentum</p>
              <h2 className="mt-4 max-w-lg text-4xl font-extrabold leading-tight tracking-[-0.04em] text-slate-950 sm:text-5xl">
                Less hunting. More learning and teaching.
              </h2>
              <p className="mt-6 max-w-md text-base leading-7 text-slate-600">
                Class should feel connected from the first lesson through graduation. The hub keeps the daily work visible without making students or staff rebuild the context themselves.
              </p>
              <div className="mt-8 inline-flex items-center gap-3 rounded-2xl border border-[#d8d1c4] bg-white/70 px-4 py-3 text-sm font-bold text-slate-700">
                <Sparkles className="h-4 w-4 text-primary-600" />
                Designed around real CSG cohorts
              </div>
            </div>

            <div className="divide-y divide-[#d8d1c4] border-y border-[#d8d1c4]">
              {outcomes.map((item, index) => (
                <article key={item.label} className="group grid gap-4 py-7 sm:grid-cols-[56px_0.8fr_1.2fr] sm:items-start sm:gap-6 sm:py-8">
                  <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[#d8d1c4] bg-white text-primary-600 transition duration-200 group-hover:-translate-y-1 group-hover:border-primary-200 group-hover:shadow-lg group-hover:shadow-primary-900/5">
                    <item.icon className="h-5 w-5" />
                  </span>
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-slate-400">0{index + 1}</span>
                    <h3 className="mt-1 text-lg font-extrabold tracking-tight text-slate-950">{item.label}</h3>
                  </div>
                  <p className="text-sm leading-6 text-slate-600 sm:text-base sm:leading-7">{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="border-t border-[#d8d1c4] bg-primary-700 text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-12 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8 lg:py-16">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary-200">Your cohort is already moving</p>
            <h2 className="mt-2 text-2xl font-extrabold tracking-tight sm:text-3xl">Pick up exactly where you left off.</h2>
          </div>
          <Link to={isSignedIn ? dashboardPath : '/sign-in'} className="group inline-flex min-h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-extrabold text-primary-800 transition hover:-translate-y-0.5 hover:bg-primary-50">
            {isSignedIn ? 'Open your workspace' : 'Sign in to your cohort'}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>
    </main>
  )
}
