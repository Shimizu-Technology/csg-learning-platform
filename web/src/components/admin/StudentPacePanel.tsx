import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { CalendarCheck, CheckCircle2, Clock, Flag } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { adjustedNote } from '../student/PersonalPaceCard'
import type { PersonalPace } from '../../types/api'

/*
 * Staff view of one learner's personal start and chosen pace (W9.1). Reads and
 * writes GET/PUT /api/v1/enrollments/:id/pace; every status is the server's
 * (LearnerProgress). Renders nothing for a course without learner-chosen pace.
 * Staff can set any pace from 1 to 26 weeks (it doesn't use up the learner's
 * changes) and move the learner's start; a pace plan follows the new start.
 */

const PACE_WEEKS = Array.from({ length: 26 }, (_, index) => index + 1)

const STATUS: Record<PersonalPace['status'], { label: string; tone: 'success' | 'warning' | 'neutral' | 'info' }> = {
  not_chosen: { label: 'Pace not chosen', tone: 'neutral' },
  on_track: { label: 'On track', tone: 'success' },
  behind: { label: 'Behind', tone: 'warning' },
  done: { label: 'All targets met', tone: 'success' },
  staff_plan: { label: 'Staff plan', tone: 'info' },
}

export function StudentPacePanel({ enrollmentId, onSaved, outsideChange = 0 }: { enrollmentId: number; onSaved: () => void; outsideChange?: number }) {
  const [pace, setPace] = useState<PersonalPace | null | undefined>(undefined)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [saving, setSaving] = useState(false)
  const [weeks, setWeeks] = useState('')
  const [startsOn, setStartsOn] = useState('')
  const draftDirty = useRef(false)
  const paceId = useId()
  const startId = useId()

  const apply = useCallback((value: PersonalPace | null, preserveDraft = false) => {
    setPace(value)
    if (preserveDraft && draftDirty.current) { setNotice("Pace refreshed. Your unsaved choices are kept."); return }
    draftDirty.current = false
    setWeeks(value?.weeks ? String(value.weeks) : String(value?.options[0] ?? ''))
    setStartsOn(value?.start_set_by_staff && value.starts_on ? value.starts_on : '')
  }, [])
  const load = useCallback(async () => {
    setError('')
    try {
      const result = await api.getPersonalPace(enrollmentId)
      if (result.data && !result.fromCache) apply(result.data.personal_pace, true)
      else setError(result.error || 'Could not load this learner’s pace.')
    } catch { setError('Could not load this learner’s pace.') }
  }, [apply, enrollmentId])
  useEffect(() => { void load() }, [load, outsideChange])

  async function save(body: { weeks?: number; starts_on?: string | null }, message: string) {
    setSaving(true); setError(''); setNotice('')
    try {
      const result = await api.savePersonalPace(enrollmentId, body)
      if (result.data && !result.error) {
        apply(result.data.personal_pace)
        setNotice(message)
        onSaved()
      } else setError(result.error || 'Could not save. Try again.')
    } catch { setError('Could not save. Try again.') }
    finally { setSaving(false) }
  }
  function submitPace(event: FormEvent) {
    event.preventDefault()
    const value = Number(weeks)
    if (value) void save({ weeks: value }, `Pace set to ${value} ${value === 1 ? 'week' : 'weeks'}. The learner sees the new targets now.`)
  }
  function submitStart(event: FormEvent) {
    event.preventDefault()
    void save({ starts_on: startsOn || null }, startsOn ? `Start moved to ${formatShortDate(startsOn)}.` : 'Start reset to the learner’s own first open.')
  }

  if (pace === null) return null
  if (pace === undefined) {
    return error
      ? <section className="app-surface p-5" aria-label="Pace"><p role="alert" className="text-sm text-warning-ink">{error}</p><Button className="mt-2" variant="secondary" size="sm" onClick={() => void load()}>Try again</Button></section>
      : null
  }

  const chosen = pace.plan_source === 'learner_pace' && pace.weeks !== null
  const status = STATUS[pace.status]
  const next = pace.next_milestone
  return (
    <section className="app-surface space-y-4 p-5 sm:p-6" aria-labelledby={`${paceId}-title`} data-region="staff-pace" data-pace-status={pace.status}>
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="app-eyebrow">Pace and start</p>
          <Badge tone={status.tone} icon={pace.status === 'behind' ? <Clock className="h-3.5 w-3.5" aria-hidden="true" /> : pace.status === 'on_track' ? <CalendarCheck className="h-3.5 w-3.5" aria-hidden="true" /> : pace.status === 'done' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : undefined}>
            {pace.status === 'behind' ? `${pace.weeks_behind} ${pace.weeks_behind === 1 ? 'week' : 'weeks'} behind` : status.label}
          </Badge>
        </div>
        <h2 id={`${paceId}-title`} className="mt-1 text-lg font-bold text-ink">
          {chosen ? <span className="tabular-nums">{pace.weeks} {pace.weeks === 1 ? 'week' : 'weeks'}</span> : pace.status === 'staff_plan' ? 'A staff plan replaces the chosen pace' : 'No pace chosen yet'}
        </h2>
        <p className="mt-1 text-sm leading-6 text-ink-secondary">
          {chosen && pace.chosen_by && <>Set by {pace.chosen_by.full_name}{pace.chosen_at ? ` on ${formatShortDateTime(pace.chosen_at)}` : ''}. </>}
          {pace.status !== 'staff_plan' && <><span className="tabular-nums">{pace.changes_left}</span> learner {pace.changes_left === 1 ? 'change' : 'changes'} left. </>}
          {pace.status === 'staff_plan' ? 'Edit it in the learning plan below. The learner can’t change it.' : `The learner chooses from ${pace.options.join(', ')} weeks.`}
        </p>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-ink-muted">Personal start</dt><dd className="font-semibold tabular-nums text-ink">{pace.starts_on ? formatShortDate(pace.starts_on) : 'Not set'}<span className="block text-xs font-normal text-ink-muted">{pace.start_set_by_staff ? 'Set by staff' : 'Cohort start or first open'}</span></dd></div>
        <div className="min-w-0"><dt className="text-ink-muted">Next target</dt><dd className="font-semibold text-ink [overflow-wrap:anywhere]">{next ? <>{next.title} · <span className="tabular-nums">{next.completed} of {next.total}</span><span className="block text-xs font-normal tabular-nums text-ink-muted">by {formatShortDate(next.due_on)}</span></> : '—'}</dd></div>
        <div className="min-w-0"><dt className="text-ink-muted">Firm final date</dt><dd className="flex items-center gap-1 font-semibold tabular-nums text-ink">{pace.ends_on ? <><Flag className="h-4 w-4 text-primary-ink" aria-hidden="true" />{formatShortDate(pace.ends_on)}</> : '—'}</dd></div>
      </dl>
      {pace.adjusted_for && <p className="rounded-xl border border-info-line bg-info-soft px-3 py-2 text-sm text-info-ink" data-pace-adjusted={pace.adjusted_for}>{adjustedNote(pace, 'staff')}</p>}

      {pace.milestones.length > 0 && (
        <ol className="flex flex-wrap gap-2" aria-label="Weekly targets">
          {pace.milestones.map((milestone, index) => (
            <li key={`${milestone.title}-${index}`}>
              <Badge tone={milestone.status === 'done' ? 'success' : milestone.status === 'behind' ? 'warning' : milestone.status === 'current' ? 'info' : 'neutral'}>
                {milestone.title} · <span className="tabular-nums">{milestone.completed}/{milestone.total}</span>
              </Badge>
            </li>
          ))}
        </ol>
      )}

      <div className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
        <form onSubmit={submitPace} className="min-w-0">
          <label htmlFor={`${paceId}-weeks`} className="block text-sm font-semibold text-ink">Set this learner’s pace</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <select id={`${paceId}-weeks`} className="app-control min-w-0 flex-1" value={weeks} disabled={saving || !pace.available} onChange={(event) => { draftDirty.current = true; setWeeks(event.target.value) }}>
              {PACE_WEEKS.map((value) => <option key={value} value={value}>{value} {value === 1 ? 'week' : 'weeks'}{pace.options.includes(value) ? ' (offered)' : ''}</option>)}
            </select>
            <Button type="submit" variant="secondary" disabled={saving || !pace.available || pace.status === 'staff_plan' || (chosen && Number(weeks) === pace.weeks)}>{chosen ? 'Change pace' : 'Set pace'}</Button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">{!pace.available ? 'Turn on learning plans for this course to set a pace.' : pace.status === 'staff_plan' ? 'Return to the regular curriculum below first; a pace replaces the staff plan.' : 'Doesn’t use up the learner’s changes. Finished targets stay; the rest are respread.'}</p>
        </form>
        <form onSubmit={submitStart} className="min-w-0">
          <label htmlFor={startId} className="block text-sm font-semibold text-ink">Personal start date</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input id={startId} type="date" className="app-control min-w-0 flex-1" value={startsOn} disabled={saving} onChange={(event) => { draftDirty.current = true; setStartsOn(event.target.value) }} />
            <Button type="submit" variant="secondary" disabled={saving || startsOn === (pace.start_set_by_staff ? pace.starts_on ?? '' : '')}>Save start</Button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Leave empty to use the cohort start or the learner’s first open. Lessons open on this date; a chosen pace moves with it.</p>
        </form>
      </div>
      {notice && <p role="status" className="text-sm font-semibold text-ink-secondary">{notice}</p>}
      {error && <p role="alert" className="text-sm text-danger-ink">{error}</p>}
    </section>
  )
}
