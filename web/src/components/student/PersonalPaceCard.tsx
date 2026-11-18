import { useId, useState, type FormEvent } from 'react'
import { ArrowRight, CalendarCheck, CheckCircle2, Clock, Flag, Lock, MessageCircle } from 'lucide-react'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { api } from '../../lib/api'
import { formatShortDate } from '../../lib/format'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { Collapse } from '../ui/Motion'
import type { PersonalPace } from '../../types/api'

/*
 * "Your pace" on Today (W9.1, AS-2). Every lesson is open from the learner's
 * own start; they choose 3, 4 or 6 weeks (whatever the course offers) and the
 * server turns it into weekly targets plus one firm final-project date. All
 * status ("on track", "behind") is the server's (LearnerProgress); this card
 * only shows it. A staff plan replaces the pace, so the card hides then and
 * Today's catch-up plan takes over.
 */

const DATE = { withYear: false, weekday: true } as const

/** The day a pace of `weeks` ends, counted from the learner's start (start + 7w - 1). */
export function paceEndDate(startsOn: string, weeks: number): string {
  const [year, month, day] = startsOn.split('-').map(Number)
  const end = new Date(Date.UTC(year, month - 1, day + weeks * 7 - 1))
  return end.toISOString().slice(0, 10)
}

export function PersonalPaceCard({ pace, totalLessons, lessonPath, contactName, onAsk, onSaved }: {
  pace: PersonalPace
  totalLessons: number | null
  lessonPath: (lessonId: number) => string
  contactName?: string
  onAsk?: () => void
  onSaved: (pace: PersonalPace) => void
}) {
  const [changing, setChanging] = useState(false)
  const chosen = pace.weeks !== null && pace.plan_source === 'learner_pace'
  if (!pace.available || pace.status === 'staff_plan') return null

  if (!chosen) {
    return (
      <section className="app-surface p-5 sm:p-6" aria-labelledby="pace-title" data-region="personal-pace" data-pace-status="not_chosen">
        <p className="text-xs font-semibold text-primary-ink">Your pace</p>
        <h2 id="pace-title" className="mt-1 text-xl font-bold text-ink">How fast do you want to go?</h2>
        <p className="mt-2 text-sm leading-6 text-ink-secondary">
          {pace.starts_on ? <>Every lesson is open from <strong className="font-semibold text-ink">{formatShortDate(pace.starts_on, '', DATE)}</strong>. </> : 'Every lesson is open. '}
          Pick a pace and we’ll give you a target for each week. Weekly targets are a guide; only the final project has a firm date.
        </p>
        {pace.can_change
          ? <PacePicker pace={pace} totalLessons={totalLessons} submitLabel="Set my pace" onSaved={onSaved} />
          : <p className="mt-3 text-sm text-ink-muted">Your instructor will set your pace.</p>}
      </section>
    )
  }

  const next = pace.next_milestone
  const done = pace.status === 'done'
  const behind = pace.status === 'behind'
  return (
    <section className="app-surface p-5 sm:p-6" aria-labelledby="pace-title" data-region="personal-pace" data-pace-status={pace.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink-muted">
          Your pace · <span className="tabular-nums">{pace.weeks} weeks</span>
          {pace.current_week !== null && pace.weeks !== null && pace.current_week <= pace.weeks && <> · <span className="tabular-nums">week {pace.current_week} of {pace.weeks}</span></>}
        </p>
        {done
          ? <Badge tone="success" icon={<CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}>All targets met</Badge>
          : behind
            ? <Badge tone="warning" icon={<Clock className="h-3.5 w-3.5" aria-hidden="true" />}>{pace.weeks_behind === 1 ? '1 week behind' : `${pace.weeks_behind} weeks behind`}</Badge>
            : <Badge tone="success" icon={<CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" />}>On track</Badge>}
      </div>
      {next ? (
        <>
          <h2 id="pace-title" className="mt-2 text-lg font-bold text-ink [overflow-wrap:anywhere]">
            {next.title}: <span className="tabular-nums">{next.completed} of {next.total}</span> done
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">
            {next.status === 'behind' ? 'Target was ' : 'Target '}<span className="font-semibold tabular-nums text-ink">{formatShortDate(next.due_on, '', DATE)}</span>
            {behind && next.status === 'behind' && '. Catch up on these first, then keep going.'}
          </p>
          {pace.adjusted_for && (
            <p className="mt-2 rounded-xl border border-info-line bg-info-soft px-3 py-2 text-sm text-info-ink" data-pace-adjusted={pace.adjusted_for}>
              {adjustedNote(pace)}
            </p>
          )}
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line" data-pace-lessons="">
            {next.lessons.map((lesson) => (
              <li key={lesson.id}>
                {lesson.available
                  ? <Link to={lessonPath(lesson.id)} className="pressable flex min-h-12 items-center gap-3 px-4 py-2 hover:bg-surface-hover"><MilestoneLesson lesson={lesson} /></Link>
                  : <div className="flex min-h-12 items-center gap-3 px-4 py-2 opacity-80"><MilestoneLesson lesson={lesson} /></div>}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <h2 id="pace-title" className="mt-2 text-lg font-bold text-ink">{done ? 'You’ve met every weekly target' : 'Your plan is ready'}</h2>
      )}
      {pace.ends_on && (
        <p className="mt-3 flex items-start gap-2 text-sm text-ink-secondary">
          <Flag className="mt-0.5 h-4 w-4 shrink-0 text-primary-ink" aria-hidden="true" />
          <span>{pace.final_project ? <>Final project due </> : <>Finish by </>}<strong className="font-semibold tabular-nums text-ink">{formatShortDate(pace.ends_on, '', DATE)}</strong> · firm date</span>
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {pace.can_change
          ? <Button variant="quiet" size="sm" aria-expanded={changing} aria-controls="pace-change" onClick={() => setChanging((value) => !value)}>{changing ? 'Keep my pace' : 'Change pace'}</Button>
          : contactName && onAsk
            ? <Button variant="quiet" size="sm" onClick={onAsk}><MessageCircle className="h-4 w-4" aria-hidden="true" />Ask {contactName} to change your pace</Button>
            : null}
      </div>
      <Collapse open={changing && pace.can_change} id="pace-change">
        <div className="mt-2 border-t border-line pt-3">
          <p className="text-sm text-ink-secondary">
            Finished targets stay as they are; the rest are spread over your new pace.{' '}
            <span className="tabular-nums">{pace.changes_left === 1 ? 'You can change your pace 1 more time.' : `You can change your pace ${pace.changes_left} more times.`}</span>
          </p>
          <PacePicker pace={pace} totalLessons={totalLessons} submitLabel="Change my pace" onSaved={(value) => { setChanging(false); onSaved(value) }} />
        </div>
      </Collapse>
    </section>
  )
}

/** Why the plan runs past the weeks chosen (the server's `adjusted_for`), in the learner's words. */
export function adjustedNote(pace: PersonalPace, audience: 'learner' | 'staff' = 'learner') {
  const weeks = `${pace.weeks} ${pace.weeks === 1 ? 'week' : 'weeks'}`
  if (pace.adjusted_for === 'lessons_open_later') {
    return audience === 'learner'
      ? `This pace was adjusted because some lessons open later than ${weeks} would end. Your targets and final date follow when they open.`
      : `Adjusted past ${weeks}: some lessons open later than this pace would end, so targets wait for them.`
  }
  if (pace.adjusted_for === 'late_start') {
    return audience === 'learner'
      ? `This pace was extended because it started after ${weeks} from your start had passed.`
      : `Extended past ${weeks}: the pace was set after those weeks had passed.`
  }
  return null
}

function MilestoneLesson({ lesson }: { lesson: NonNullable<PersonalPace['next_milestone']>['lessons'][number] }) {
  const finished = lesson.status === 'done' || lesson.status === 'awaiting_review'
  return (
    <>
      {finished
        ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success-ink" aria-label={lesson.status === 'done' ? 'Done' : 'Waiting for review'} />
        : <span className="h-4 w-4 shrink-0 rounded-full border-2 border-line-strong" aria-hidden="true" />}
      <span className={`min-w-0 flex-1 text-sm font-semibold [overflow-wrap:anywhere] ${finished ? 'text-ink-muted' : 'text-ink'}`}>{lesson.title}</span>
      {lesson.status === 'redo' && <Badge tone="warning">Redo</Badge>}
      {!lesson.available && <Lock className="h-4 w-4 shrink-0 text-ink-muted" aria-label="Not open yet" />}
      {lesson.available && !finished && <ArrowRight className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />}
    </>
  )
}

/** The pace choices as large radio cards (44px+ targets), each with what it means. */
function PacePicker({ pace, totalLessons, submitLabel, onSaved }: { pace: PersonalPace; totalLessons: number | null; submitLabel: string; onSaved: (pace: PersonalPace) => void }) {
  const name = useId()
  const [selected, setSelected] = useState<number | null>(pace.weeks ?? null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (selected === null || saving) return
    setSaving(true); setError('')
    try {
      const result = await api.savePersonalPace(pace.enrollment_id, { weeks: selected })
      if (result.data?.personal_pace && !result.error) onSaved(result.data.personal_pace)
      else setError(result.error || 'Could not save your pace. Try again.')
    } catch { setError('Could not save your pace. Try again.') }
    finally { setSaving(false) }
  }
  return (
    <form onSubmit={submit} className="mt-4">
      <fieldset disabled={saving}>
        <legend className="sr-only">Choose your pace</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {pace.options.map((weeks) => {
            const perWeek = totalLessons && totalLessons > 0 ? Math.ceil(totalLessons / weeks) : null
            const current = weeks === pace.weeks
            return (
              <label key={weeks} className={`pressable flex min-h-16 cursor-pointer flex-col justify-center rounded-xl border px-4 py-3 has-[:checked]:border-action-primary has-[:checked]:bg-surface-selected has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus ${selected === weeks ? 'border-action-primary bg-surface-selected' : 'border-line hover:border-line-strong'}`}>
                <input type="radio" name={name} value={weeks} checked={selected === weeks} onChange={() => setSelected(weeks)} className="sr-only" />
                <span className="flex items-center justify-between gap-2 font-semibold text-ink"><span className="tabular-nums">{weeks} weeks</span>{current && <span className="text-xs font-semibold text-ink-muted">Current</span>}</span>
                <span className="mt-0.5 text-xs leading-5 text-ink-muted">
                  {perWeek !== null && <>About <span className="tabular-nums">{perWeek}</span> {perWeek === 1 ? 'lesson' : 'lessons'} a week</>}
                  {perWeek !== null && pace.starts_on && ' · '}
                  {pace.starts_on && <>done by <span className="tabular-nums">{formatShortDate(paceEndDate(pace.starts_on, weeks), '', { withYear: false })}</span></>}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={selected === null || saving || selected === pace.weeks}>{saving ? 'Saving…' : submitLabel}</Button>
        {selected === null && <p className="text-sm text-ink-muted">Choose a pace to continue.</p>}
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-danger-ink">{error}</p>}
    </form>
  )
}
