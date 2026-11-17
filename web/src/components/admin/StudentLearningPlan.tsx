import { useDraftDirty } from '../shared/UnsavedChangesGuard'
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { CalendarDays, ListPlus, Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { leavesPath, useLeaveGuard } from '../../lib/useLeaveGuard'
import { lessonCountLabel } from '../../lib/learningPlanLessons'
import { Button } from '../ui/Button'
import { Modal } from '../shared/Modal'
import { LazyMarkdownEditor } from '../shared/LazyMarkdownEditor'
import { MarkdownText } from '../shared/MarkdownRenderer'
import { RecordLink } from '../shared/RecordLink'
import { StatusBadge } from '../shared/StatusBadge'
import { LessonPicker } from './learningPlan/LessonPicker'
import type { LearningPlanEditorLesson, LearningPlanInput, LearningPlanManagement } from '../../types/api'

const editableDraft = (plan: LearningPlanManagement['learning_plan'] | undefined): LearningPlanInput => plan ? { ...plan, active: true } : blankPlan()
const blankPlan = (): LearningPlanInput => ({ active: true, title: 'My learning plan', description: '', target_date: null, next_check_in_on: null, milestones: [], lesson_overrides: [] })
const NOTE_LIMIT = 2000

type Picker = { kind: 'milestone'; index: number } | { kind: 'exceptions' } | null

/** What would stop the server saving this draft, said next to the save button rather than after a round trip. */
export function planProblems(draft: LearningPlanInput): string[] {
  const problems: string[] = []
  draft.milestones.forEach((item, index) => {
    const name = `Milestone ${index + 1}`
    if (!item.title.trim()) problems.push(`${name} needs a title.`)
    if (!item.due_on) problems.push(`${name} needs a target date.`)
    if (item.lesson_ids.length === 0) problems.push(`${name} needs at least one lesson.`)
  })
  const dates = draft.milestones.map((item) => item.due_on).filter(Boolean)
  if (dates.some((date, index) => index > 0 && date < dates[index - 1])) problems.push('List milestones in target-date order.')
  if (draft.target_date && dates.some((date) => date > draft.target_date!)) problems.push('The target finish must be on or after the last milestone.')
  draft.lesson_overrides.forEach((item) => { if (!item.reason.trim()) problems.push('Give a reason for each requirement exception.') })
  if ((draft.description || '').length > NOTE_LIMIT) problems.push(`Keep the note to ${NOTE_LIMIT.toLocaleString()} characters.`)
  return Array.from(new Set(problems))
}

export function StudentLearningPlan({ enrollmentId, cohortId, onSaved }: { enrollmentId: number; cohortId?: number; onSaved: () => void }) {
  const [data, setData] = useState<LearningPlanManagement | null>(null)
  const [draft, setDraft] = useState<LearningPlanInput>(blankPlan)
  const [editing, setEditing] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [picker, setPicker] = useState<Picker>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const noteId = useId()
  const load = useCallback(async () => {
    setError(null)
    try {
      const result = await api.getLearningPlan(enrollmentId)
      if (!result.data || result.fromCache) throw new Error(result.error || 'Reconnect to load the current learning plan.')
      setData(result.data)
      setDraft(editableDraft(result.data.learning_plan))
      setEditing(false)
      setConfirmRestore(false)
      setProblems([])
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load the learning plan.') }
  }, [enrollmentId])
  useEffect(() => { void load() }, [load])

  async function save(value: LearningPlanInput) {
    setSaving(true); setError(null); setNotice(null)
    let saved = false
    try {
      const result = await api.saveLearningPlan(enrollmentId, value)
      if (!result.data) throw new Error(result.error || 'Could not save the learning plan.')
      setData(result.data); setDraft(editableDraft(result.data.learning_plan)); setEditing(false); setConfirmRestore(false); setProblems([])
      setNotice(value.active ? 'Personal plan saved. The student now sees this plan.' : 'Regular curriculum restored. Learning history is retained.')
      saved = true
      onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the learning plan.') }
    setSaving(false)
    return saved
  }
  /** Checks the draft where the person is looking (the sticky bar) before sending it. */
  async function saveDraft() {
    const found = planProblems(draft)
    setProblems(found)
    if (found.length > 0 || (formRef.current && !formRef.current.reportValidity())) return false
    return save({ ...draft, active: true })
  }
  function submit(event: FormEvent) { event.preventDefault(); void saveDraft() }
  function updateMilestone(index: number, update: Partial<LearningPlanInput['milestones'][number]>) {
    setDraft((current) => ({ ...current, milestones: current.milestones.map((item, position) => position === index ? { ...item, ...update } : item) }))
  }
  function addLessons(ids: number[]) {
    if (!picker) return
    if (picker.kind === 'milestone') {
      const index = picker.index
      setDraft((current) => ({ ...current, milestones: current.milestones.map((item, position) => position === index ? { ...item, lesson_ids: [...item.lesson_ids, ...ids.filter((id) => !item.lesson_ids.includes(id))] } : item) }))
    } else {
      setDraft((current) => ({ ...current, lesson_overrides: [...current.lesson_overrides, ...ids.filter((id) => !current.lesson_overrides.some((item) => item.lesson_id === id)).map((id) => ({ lesson_id: id, required: !lessonsById.get(id)?.standard_required, reason: '' }))] }))
    }
    setPicker(null)
  }
  const revision = useMemo(() => ({ data, editing }), [data, editing])
  const dirty = useDraftDirty(draft, revision, editing)
  const leave = useLeaveDialog(dirty, saveDraft)
  const plan = data?.learning_plan
  const lessonsById = useMemo(() => new Map((data?.lessons || []).map((lesson) => [lesson.id, lesson])), [data])
  const lessonName = (id: number) => lessonsById.get(id)?.title || 'Lesson no longer assigned'
  const milestoneLabel = (index: number) => `Milestone ${index + 1}${draft.milestones[index]?.title.trim() ? `: ${draft.milestones[index].title.trim()}` : ''}`
  const placement = useMemo(() => {
    const where = new Map<number, number>()
    draft.milestones.forEach((item, index) => item.lesson_ids.forEach((id) => where.set(id, index)))
    return where
  }, [draft.milestones])
  const pickerProps = useMemo(() => {
    if (!picker || !data) return null
    if (picker.kind === 'milestone') {
      const current = new Set(draft.milestones[picker.index]?.lesson_ids || [])
      const elsewhere = new Map(Array.from(placement).filter(([, index]) => index !== picker.index).map(([id, index]) => [id, `Milestone ${index + 1}`]))
      return { title: `Add lessons to ${milestoneLabel(picker.index)}`, subtitle: 'Finished lessons are hidden. Each lesson can be in one milestone.', current, placedElsewhere: elsewhere }
    }
    return {
      title: 'Add requirement exceptions',
      subtitle: 'Choose lessons whose requirement differs for this student. Give each one a reason next.',
      current: new Set(draft.lesson_overrides.map((item) => item.lesson_id)),
      placedElsewhere: new Map<number, string>(),
      describe: (lesson: LearningPlanEditorLesson) => lesson.standard_required ? 'Would become optional' : 'Would become required',
    }
  // milestoneLabel reads the same draft milestones listed here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, data, draft.milestones, draft.lesson_overrides, placement])

  const plannedCount = draft.milestones.reduce((sum, item) => sum + item.lesson_ids.length, 0)
  const remainingCount = (data?.lessons || []).filter((lesson) => !lesson.completed && !placement.has(lesson.id)).length

  return <section className="app-surface space-y-5 p-5 sm:p-6" aria-label="Student learning plan">
    {leave.dialog}
    <div><p className="app-eyebrow">Learning plan</p><h2 className="mt-1 text-lg font-bold text-ink">{editing ? (plan?.active ? 'Edit personal plan' : 'Customize learning plan') : plan?.active ? plan.title : 'Regular curriculum'}</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">{editing ? (plan?.active ? 'The student keeps their saved plan until you save these changes.' : 'The student sees this plan only after you save it. Until then they see the regular curriculum and how far behind they are.') : plan?.active ? 'This student has a personal plan. Shared lessons and other students keep their existing settings.' : 'This student follows the regular curriculum. Customize only the pacing or requirements that need to differ.'}</p></div>
    {error && !editing && <div role="alert" className="space-y-2 rounded-xl border border-warning-line bg-warning-soft p-3 text-sm text-warning-ink"><p>{error}</p><Button type="button" variant="secondary" onClick={() => void load()} disabled={saving}>Reload latest plan</Button></div>}
    {notice && <p role="status" className="text-sm font-semibold text-ink-secondary">{notice}</p>}
    {!data && !error && <p className="text-sm text-ink-muted">Loading learning plan…</p>}
    {data && !editing && <>
      {plan?.active && <div className="space-y-3 text-sm text-ink-secondary">
        {plan.description && <div className="[overflow-wrap:anywhere]"><MarkdownText content={plan.description} /></div>}
        <p className="flex flex-wrap items-center gap-x-2 tabular-nums"><CalendarDays className="h-4 w-4 text-ink-muted" aria-hidden="true" />{plan.target_date ? `Target finish: ${formatShortDate(plan.target_date)}` : 'No target finish set'}{plan.next_check_in_on ? ` · Next follow-up: ${formatShortDate(plan.next_check_in_on)}` : ''}</p>
        {plan.milestones.length > 0 && <ol className="space-y-2">{plan.milestones.map((item, index) => {
          return <li key={index}><details className="group rounded-xl bg-surface-sunken"><summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2"><span className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">{item.title}</span><span className="text-xs tabular-nums text-ink-muted">{formatShortDate(item.due_on)} · {lessonCountLabel(item.lesson_ids.length)}</span></summary>
            <ul className="max-h-80 space-y-1 overflow-y-auto border-t border-line px-3 py-2">{item.lesson_ids.map((id) => {
              const lesson = lessonsById.get(id)
              return <li key={id} className="flex min-h-9 flex-wrap items-center justify-between gap-2">{lesson ? <RecordLink record={{ type: 'lesson', id, cohortId, view: 'learn' }} touchTarget variant="plain" className="min-w-0 [overflow-wrap:anywhere]">{lesson.title}</RecordLink> : <span>{lessonName(id)}</span>}{lesson && lesson.status !== 'open' && lesson.status !== 'upcoming' && <StatusBadge status={lesson.status} short />}</li>
            })}</ul>
          </details></li>
        })}</ol>}
        <p>{plan.lesson_overrides.length} individual requirement {plan.lesson_overrides.length === 1 ? 'exception' : 'exceptions'}</p>
      </div>}
      <div className="flex flex-wrap gap-2"><Button onClick={() => { setDraft(editableDraft(plan)); setEditing(true); setNotice(null); setError(null) }}>{plan?.active ? 'Edit personal plan' : 'Customize plan'}</Button>{plan?.active && <Button variant="secondary" onClick={() => setConfirmRestore(true)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Return to regular curriculum</Button>}</div>
      {confirmRestore && plan && <div className="space-y-3 rounded-xl border border-line bg-surface-sunken p-4"><p className="text-sm text-ink-secondary">Restore the regular requirements and schedule for this student? Submitted work, grades, progress, and plan history stay saved.</p><div className="flex flex-wrap gap-2"><Button disabled={saving} onClick={() => void save({ ...plan, active: false })}>{saving ? 'Restoring…' : 'Restore regular curriculum'}</Button><Button variant="secondary" disabled={saving} onClick={() => setConfirmRestore(false)}>Keep personal plan</Button></div></div>}
    </>}
    {editing && data && <form ref={formRef} onSubmit={submit} className="space-y-5">
      <fieldset disabled={saving} className="space-y-5">
        <label className="block text-sm font-semibold text-ink">Plan title<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="app-control mt-1 w-full" /></label>
        <div><label htmlFor={noteId} className="block text-sm font-semibold text-ink">Note for the student</label><LazyMarkdownEditor id={noteId} label="Note for the student" target="written" value={draft.description || ''} onChange={(value) => setDraft((current) => ({ ...current, description: value }))} className="mt-1" minHeight={88} maxHeight={280} disabled={saving} /><p className={`mt-1 text-right text-xs tabular-nums ${(draft.description || '').length > NOTE_LIMIT ? 'font-semibold text-danger-ink' : 'text-ink-muted'}`}>{(draft.description || '').length.toLocaleString()}/{NOTE_LIMIT.toLocaleString()}</p></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block min-w-0 text-sm font-semibold text-ink">Target finish<input type="date" value={draft.target_date || ''} onChange={(event) => setDraft({ ...draft, target_date: event.target.value || null })} className="app-control mt-1 w-full min-w-0" /></label><label className="block min-w-0 text-sm font-semibold text-ink">Next follow-up<input type="date" value={draft.next_check_in_on || ''} onChange={(event) => setDraft({ ...draft, next_check_in_on: event.target.value || null })} className="app-control mt-1 w-full min-w-0" /></label></div>
        <div className="space-y-4">
          <div><h3 className="font-semibold text-ink">Milestones</h3><p className="mt-1 text-sm text-ink-muted">Group the lessons still to do under target dates, in date order. Dates guide pacing; they don't lock lessons or close submissions.</p><p className="mt-1 text-sm tabular-nums text-ink-secondary">{lessonCountLabel(plannedCount)} planned · {lessonCountLabel(remainingCount)} unfinished and not in a milestone</p></div>
          {draft.milestones.length === 0 && <p className="rounded-xl border border-dashed border-line-strong p-4 text-sm text-ink-secondary">No milestones yet. Add one, give it a target date, then add the lessons to finish by then.</p>}
          {draft.milestones.map((item, index) => <fieldset key={index} className="min-w-0 space-y-3 rounded-xl border border-line p-4">
            <legend className="px-1 text-sm font-semibold text-ink">Milestone {index + 1}</legend>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]"><label className="min-w-0 text-sm font-semibold text-ink">Milestone title<input required maxLength={160} value={item.title} placeholder="For example: Catch up on JavaScript basics" onChange={(event) => updateMilestone(index, { title: event.target.value })} className="app-control mt-1 w-full" /></label><label className="min-w-0 text-sm font-semibold text-ink">Target date<input required type="date" value={item.due_on} onChange={(event) => updateMilestone(index, { due_on: event.target.value })} className="app-control mt-1 w-full min-w-0" /></label></div>
            <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold tabular-nums text-ink-secondary">{lessonCountLabel(item.lesson_ids.length)}</p><Button type="button" variant="secondary" size="sm" onClick={() => setPicker({ kind: 'milestone', index })}><ListPlus className="h-4 w-4" aria-hidden="true" />Add lessons</Button></div>
            {item.lesson_ids.length > 0 && <ul className="max-h-72 space-y-1 overflow-y-auto overscroll-contain rounded-xl bg-surface-sunken p-1" aria-label={`Lessons in milestone ${index + 1}`}>{item.lesson_ids.map((id) => <li key={id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg px-2 py-0.5 text-sm text-ink-secondary"><span className="min-w-0 [overflow-wrap:anywhere]">{lessonName(id)}{lessonsById.get(id) && <span className="ml-2 text-xs text-ink-muted">{lessonsById.get(id)!.module_name}{lessonsById.get(id)!.week ? ` · Week ${lessonsById.get(id)!.week}` : ''}</span>}</span><Button type="button" variant="quiet" size="sm" aria-label={`Remove ${lessonName(id)} from milestone ${index + 1}`} onClick={() => updateMilestone(index, { lesson_ids: item.lesson_ids.filter((value) => value !== id) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></li>)}</ul>}
            <Button type="button" variant="quiet" size="sm" onClick={() => setDraft({ ...draft, milestones: draft.milestones.filter((_, position) => position !== index) })}><Trash2 className="h-4 w-4" aria-hidden="true" />Remove milestone {index + 1}</Button>
          </fieldset>)}
          <Button type="button" variant="secondary" disabled={draft.milestones.length >= 50} onClick={() => setDraft({ ...draft, milestones: [...draft.milestones, { title: '', due_on: '', lesson_ids: [] }] })}><Plus className="h-4 w-4" aria-hidden="true" />Add milestone</Button>
        </div>
        <details className="space-y-3 rounded-xl border border-line p-4" open={draft.lesson_overrides.length > 0}><summary className="min-h-11 cursor-pointer font-semibold text-ink">Required and optional lessons ({draft.lesson_overrides.length} changes)</summary><p className="text-sm text-ink-muted">Everything follows the regular curriculum unless listed here. Optional lessons remain accessible. Explain each change so the student knows what to complete.</p>
          <div className="max-h-[32rem] space-y-3 overflow-y-auto overscroll-contain">{draft.lesson_overrides.map((item, index) => <div key={item.lesson_id} className="space-y-3 border-t border-line pt-3"><p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{lessonName(item.lesson_id)}</p><div className="grid gap-3 sm:grid-cols-[200px_minmax(0,1fr)]"><label className="block text-sm font-semibold text-ink">Requirement<select aria-label={`Requirement for ${lessonName(item.lesson_id)}`} className="app-control mt-1 w-full" value={String(item.required)} onChange={(event) => setDraft({ ...draft, lesson_overrides: draft.lesson_overrides.map((value, position) => position === index ? { ...value, required: event.target.value === 'true' } : value) })}><option value="true">Required in this plan</option><option value="false">Optional in this plan</option></select></label><label className="block text-sm font-semibold text-ink">Reason<input aria-label={`Reason for ${lessonName(item.lesson_id)}`} required maxLength={500} value={item.reason} onChange={(event) => setDraft({ ...draft, lesson_overrides: draft.lesson_overrides.map((value, position) => position === index ? { ...value, reason: event.target.value } : value) })} className="app-control mt-1 w-full" /></label></div><Button type="button" variant="quiet" size="sm" onClick={() => setDraft({ ...draft, lesson_overrides: draft.lesson_overrides.filter((value) => value.lesson_id !== item.lesson_id) })}>Use regular requirement for this lesson</Button></div>)}</div>
          <Button type="button" variant="secondary" size="sm" onClick={() => setPicker({ kind: 'exceptions' })}><ListPlus className="h-4 w-4" aria-hidden="true" />Add requirement exceptions</Button>
        </details>
      </fieldset>
      <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] z-20 -mx-2 space-y-2 rounded-2xl border border-line bg-surface-overlay p-3 shadow-overlay sm:-mx-3 lg:bottom-4" data-testid="plan-save-bar">
        {(problems.length > 0 || error) && <div role="alert" className="space-y-1 text-sm text-danger-ink">{error && <p>{error}</p>}{problems.map((problem) => <p key={problem}>{problem}</p>)}{error && <Button type="button" variant="secondary" size="sm" onClick={() => void load()} disabled={saving}>Reload latest plan</Button>}{error && <p className="text-xs">Reloading replaces this draft with the saved plan.</p>}</div>}
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-semibold text-ink-secondary" aria-live="polite">{saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'No changes yet'}</p><div className="flex flex-wrap gap-2"><Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditing(false); setError(null); setProblems([]) }}>Cancel</Button><Button type="submit" disabled={saving}><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Saving…' : 'Save personal plan'}</Button></div></div>
      </div>
    </form>}
    {data && pickerProps && <LessonPicker open lessons={data.lessons} {...pickerProps} onAdd={addLessons} onClose={() => setPicker(null)} />}
    {!!data?.revisions.length && !editing && <details className="border-t border-line pt-4"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink">Plan history</summary><ol className="space-y-3">{data.revisions.map((revision) => <li key={revision.id} className="text-sm text-ink-secondary"><p className="font-semibold">{revision.author} · {formatShortDateTime(revision.created_at)}</p><p>{revision.snapshot.active ? revision.snapshot.title : 'Returned to regular curriculum'} · {revision.snapshot.milestones.length} milestones · {revision.snapshot.lesson_overrides.length} requirement exceptions</p></li>)}</ol></details>}
  </section>
}

/**
 * Leaving with unsaved edits asks Keep editing / Discard / Save and leave
 * (design spec §5). Registered with the router-level guard, so tabs, links,
 * Back and reload all ask.
 */
function useLeaveDialog(dirty: boolean, saveDraft: () => Promise<boolean>) {
  const [asking, setAsking] = useState(false)
  const [saving, setSaving] = useState(false)
  const answer = useRef<((leave: boolean) => void) | null>(null)
  const finish = (leave: boolean) => {
    answer.current?.(leave)
    answer.current = null
    setAsking(false)
  }
  useLeaveGuard({
    dirty,
    blocks: leavesPath,
    confirm: () => new Promise<boolean>((resolve) => {
      answer.current?.(false)
      answer.current = resolve
      setAsking(true)
    }),
  })
  useEffect(() => () => answer.current?.(false), [])
  async function saveAndLeave() {
    setSaving(true)
    const saved = await saveDraft()
    setSaving(false)
    // A failed save keeps the draft and says why in the save bar.
    finish(saved)
  }
  const dialog = <Modal open={asking} onClose={() => finish(false)} title="Leave without saving?" subtitle="This plan has unsaved changes. The student keeps seeing the last saved version." footer={<div className="flex flex-wrap justify-end gap-2">
    <Button variant="secondary" disabled={saving} onClick={() => finish(false)}>Keep editing</Button>
    <Button variant="danger" disabled={saving} onClick={() => finish(true)}>Discard changes</Button>
    <Button disabled={saving} onClick={() => void saveAndLeave()}><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Saving…' : 'Save and leave'}</Button>
  </div>} />
  return { dialog }
}
