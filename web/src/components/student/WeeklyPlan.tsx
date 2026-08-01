import { useEffect, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, CalendarClock, Check, CircleAlert, Clock3, Film, LockKeyhole, RotateCcw, Sparkles } from 'lucide-react'

import { captureProductEvent } from '../../lib/analytics'
import { formatShortDateTime } from '../../lib/format'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import type { WeeklyPlan, WeeklyPlanLessonItem } from '../../types/api'

export function WeeklyPlanCard({ plan }: { plan: WeeklyPlan }) {
  const capturedKey = useRef<string | null>(null)
  const summary = plan.summary
  const required = plan.required || []
  const optional = plan.optional || []
  const key = `${plan.cohort?.id}:${plan.week_number}`

  useEffect(() => {
    if (!plan.enrolled || !plan.cohort || !plan.week_number || !summary || capturedKey.current === key) return
    capturedKey.current = key
    captureProductEvent('weekly_plan_viewed', {
      cohort_id: plan.cohort.id,
      week_number: plan.week_number,
      role: 'student',
      required_count: summary.required_count,
    })
  }, [key, plan.cohort, plan.enrolled, plan.week_number, summary])

  if (!plan.enrolled || !summary) return null
  const completion = summary.required_count ? Math.round((summary.required_completed_count / summary.required_count) * 100) : 100

  return (
    <section aria-labelledby="this-week-title" className="overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.05)]">
      <div className="border-b border-slate-200 bg-slate-950 px-5 py-5 text-white sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-primary-300">Week {plan.week_number}</p>
            <h2 id="this-week-title" className="mt-1 text-2xl font-extrabold tracking-tight">This Week</h2>
            <p className="mt-1 text-sm text-slate-400">{weekRange(plan.starts_on, plan.ends_on)} · Required work stays clear even when you work ahead.</p>
          </div>
          <div className="min-w-52">
            <div className="flex items-center justify-between text-xs font-bold text-slate-300"><span>{summary.required_completed_count} of {summary.required_count} required done</span><span>{completion}%</span></div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-700"><div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${completion}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="grid gap-0 lg:grid-cols-[1.45fr_0.85fr]">
        <div className="p-5 sm:p-6 lg:border-r lg:border-slate-200">
          {(plan.redos || []).length > 0 && <PlanSection title="Redo first" icon={RotateCcw} tone="amber">
            {(plan.redos || []).map((redo) => <Link key={redo.id} to={`/lessons/${redo.lesson_id}`} className="group flex min-h-14 items-start gap-3 border-b border-amber-200 py-3 last:border-0">
              <span className="mt-0.5 rounded-lg bg-amber-100 p-2"><RotateCcw className="h-4 w-4 text-amber-700" /></span><span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-slate-950">{redo.title}</span><span className="mt-0.5 block text-xs text-slate-600">{redo.lesson_title}{redo.state === 'closed' ? ' · submission window closed' : ''}</span>{redo.feedback && <span className="mt-1.5 line-clamp-2 block text-xs leading-5 text-slate-600">{redo.feedback}</span>}</span><ArrowRight className="mt-2 h-4 w-4 shrink-0 text-amber-600 transition-transform group-hover:translate-x-1" />
            </Link>)}
          </PlanSection>}

          <PlanSection title="Required work" icon={CircleAlert}>
            {required.length ? <LessonGroups items={required} /> : <EmptyLine icon={Check} text="No required work is open for this week." />}
          </PlanSection>

          {optional.length > 0 && <PlanSection title="Optional stretch" icon={Sparkles} subtle>
            <p className="mb-1 text-xs leading-5 text-slate-500">Useful if you finish early; this does not count against your required week.</p>
            <LessonGroups items={optional} />
          </PlanSection>}
        </div>

        <aside className="bg-slate-50/70 p-5 sm:p-6">
          {(plan.events || []).length > 0 && <SideSection title="Live schedule" icon={CalendarClock}>{(plan.events || []).map((event) => <a key={event.id} href={sanitizeUrl(event.meeting_url)} target="_blank" rel="noopener noreferrer" className="block border-b border-slate-200 py-3 first:pt-1 last:border-0"><span className="text-[10px] font-extrabold uppercase tracking-wider text-primary-700">{event.kind === 'live_class' ? 'Live class' : 'Office hours'}</span><span className="mt-1 block text-sm font-bold text-slate-950">{event.title}</span><span className="mt-0.5 block text-xs leading-5 text-slate-500">{formatShortDateTime(event.starts_at, 'Time pending', event.timezone)}</span></a>)}</SideSection>}
          {(plan.recording_catch_up || []).length > 0 && <SideSection title="Recording catch-up" icon={Film}>{(plan.recording_catch_up || []).map((recording) => <Link key={recording.id} to="/recordings" className="flex items-center gap-3 border-b border-slate-200 py-3 first:pt-1 last:border-0"><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-950">{recording.title}</span><span className="mt-0.5 block text-xs text-slate-500">{Math.round(recording.progress_percentage)}% watched</span></span><ArrowRight className="h-4 w-4 text-slate-400" /></Link>)}</SideSection>}
          {(plan.upcoming_unlocks || []).length > 0 && <SideSection title="Unlocking next" icon={LockKeyhole}>{(plan.upcoming_unlocks || []).slice(0, 3).map((unlock) => <div key={unlock.id} className="border-b border-slate-200 py-3 first:pt-1 last:border-0"><p className="text-sm font-bold text-slate-950">{unlock.title}</p><p className="mt-0.5 text-xs text-slate-500">{unlock.module_title} · {dateLabel(unlock.unlocks_on)}</p></div>)}</SideSection>}
          {!(plan.events || []).length && !(plan.recording_catch_up || []).length && !(plan.upcoming_unlocks || []).length && <EmptyLine icon={Check} text="Nothing else is scheduled right now." />}
        </aside>
      </div>
    </section>
  )
}

function LessonGroups({ items }: { items: WeeklyPlanLessonItem[] }) {
  return <div>{groupLessons(items).map(([label, lessons]) => <div key={label} className="pt-3 first:pt-1"><p className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-slate-500">{label}</p>{lessons.map((item) => <LessonRow key={item.id} item={item} />)}</div>)}</div>
}

function LessonRow({ item }: { item: WeeklyPlanLessonItem }) {
  const closed = item.state === 'closed'
  return <Link to={`/lessons/${item.lesson_id}`} className="group flex min-h-14 items-center gap-3 border-b border-slate-200 py-3 last:border-0"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${item.state === 'completed' ? 'bg-green-100 text-green-700' : item.state === 'upcoming' ? 'bg-slate-100 text-slate-500' : closed ? 'bg-red-50 text-red-700' : 'bg-primary-50 text-primary-700'}`}>{item.state === 'completed' ? <Check className="h-4 w-4" /> : item.state === 'upcoming' ? <Clock3 className="h-4 w-4" /> : closed ? <LockKeyhole className="h-4 w-4" /> : <CircleAlert className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-slate-950">{item.title}</span><span className="mt-0.5 block text-xs text-slate-500">{item.module_title} · {item.carried_forward ? 'Open from earlier' : dateLabel(item.scheduled_for)}{item.submission_close_at ? ` · closes ${formatShortDateTime(item.submission_close_at)}` : ''}</span></span><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-600">{item.state}</span><ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-1" /></Link>
}

function PlanSection({ title, icon: Icon, children, tone, subtle }: { title: string; icon: typeof CircleAlert; children: ReactNode; tone?: 'amber'; subtle?: boolean }) { return <div className={`mb-6 last:mb-0 ${tone === 'amber' ? 'rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3' : subtle ? 'rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3' : ''}`}><h3 className={`mb-2 flex items-center gap-2 text-sm font-extrabold ${tone === 'amber' ? 'text-amber-900' : 'text-slate-950'}`}><Icon className={`h-4 w-4 ${tone === 'amber' ? 'text-amber-700' : 'text-primary-600'}`} />{title}</h3>{children}</div> }
function SideSection({ title, icon: Icon, children }: { title: string; icon: typeof Film; children: ReactNode }) { return <div className="mb-6 last:mb-0"><h3 className="mb-2 flex items-center gap-2 text-xs font-extrabold uppercase tracking-[0.12em] text-slate-600"><Icon className="h-4 w-4 text-primary-600" />{title}</h3>{children}</div> }
function EmptyLine({ icon: Icon, text }: { icon: typeof Check; text: string }) { return <div className="flex items-center gap-2 py-3 text-sm text-slate-500"><Icon className="h-4 w-4 text-green-600" />{text}</div> }
function dateLabel(value: string) { return new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Pacific/Guam' }).format(new Date(`${value}T00:00:00+10:00`)) }
function weekRange(start?: string, end?: string) { return start && end ? `${dateLabel(start)} – ${dateLabel(end)}` : 'Current learning week' }
function groupLessons(items: WeeklyPlanLessonItem[]) {
  const groups = new Map<string, WeeklyPlanLessonItem[]>()
  items.forEach((item) => {
    const label = item.carried_forward ? 'Open from earlier' : dateLabel(item.scheduled_for)
    groups.set(label, [...(groups.get(label) || []), item])
  })
  return [...groups.entries()]
}
