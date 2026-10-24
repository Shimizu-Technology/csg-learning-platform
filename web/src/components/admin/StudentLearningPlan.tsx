import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Plus, RotateCcw, Save, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { Button } from '../ui/Button'
import type { LearningPlanInput, LearningPlanManagement } from '../../types/api'

const blankPlan = (): LearningPlanInput => ({ active: true, title: 'My learning plan', description: '', target_date: null, next_check_in_on: null, milestones: [], lesson_overrides: [] })

export function StudentLearningPlan({ enrollmentId, onSaved }: { enrollmentId: number; onSaved: () => void }) {
  const [data, setData] = useState<LearningPlanManagement | null>(null)
  const [draft, setDraft] = useState<LearningPlanInput>(blankPlan)
  const [editing, setEditing] = useState(false)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const load = useCallback(async () => {
    setError(null)
    try {
      const result = await api.getLearningPlan(enrollmentId)
      if (!result.data || result.fromCache) throw new Error(result.error || 'Reconnect to load the current learning plan.')
      setData(result.data)
      setDraft(result.data.learning_plan || blankPlan())
      setEditing(false)
      setConfirmRestore(false)
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load the learning plan.') }
  }, [enrollmentId])
  useEffect(() => { void load() }, [load])

  async function save(value: LearningPlanInput) {
    setSaving(true); setError(null); setNotice(null)
    try {
      const result = await api.saveLearningPlan(enrollmentId, value)
      if (!result.data) throw new Error(result.error || 'Could not save the learning plan.')
      setData(result.data); setDraft(result.data.learning_plan || blankPlan()); setEditing(false); setConfirmRestore(false)
      setNotice(value.active ? 'Personal plan saved for this student.' : 'Regular curriculum restored. Learning history is retained.')
      onSaved()
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save the learning plan.') }
    setSaving(false)
  }
  function submit(event: FormEvent) { event.preventDefault(); void save({ ...draft, active: true }) }
  function updateMilestone(index: number, update: Partial<LearningPlanInput['milestones'][number]>) {
    setDraft((current) => ({ ...current, milestones: current.milestones.map((item, position) => position === index ? { ...item, ...update } : item) }))
  }
  const plan = data?.learning_plan
  const lessonName = (id: number) => data?.lessons.find((lesson) => lesson.id === id)?.title || 'Lesson no longer assigned'
  return <section className="app-surface space-y-5 p-5 sm:p-6" aria-label="Student learning plan">
    <div><p className="app-eyebrow">Learning plan</p><h2 className="mt-1 text-lg font-bold text-ink">{editing ? 'Customize learning plan' : plan?.active ? plan.title : 'Regular curriculum'}</h2><p className="mt-2 text-sm leading-6 text-ink-secondary">{plan?.active ? 'This student has a personal plan. Shared lessons and other students keep their existing settings.' : 'This student follows the regular curriculum. Customize only the pacing or requirements that need to differ.'}</p></div>
    {error && <div role="alert" className="space-y-2 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800"><p>{error}</p><Button type="button" variant="secondary" onClick={() => void load()} disabled={saving}>Reload latest plan</Button>{editing && <p>Reloading replaces this draft with the saved plan.</p>}</div>}
    {notice && <p role="status" className="text-sm font-semibold text-ink-secondary">{notice}</p>}
    {!data && !error && <p className="text-sm text-ink-muted">Loading learning plan…</p>}
    {data && !editing && <>
      {plan?.active && <div className="space-y-3 text-sm text-ink-secondary">{plan.description && <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{plan.description}</p>}<p>{plan.target_date ? `Target finish: ${formatShortDate(plan.target_date)}` : 'No target finish set'}{plan.next_check_in_on ? ` · Check-in: ${formatShortDate(plan.next_check_in_on)}` : ''}</p><ol className="space-y-2">{plan.milestones.map((item, index) => <li key={index} className="rounded-xl bg-surface-sunken p-3 [overflow-wrap:anywhere]"><p className="font-semibold text-ink">{item.title} · {formatShortDate(item.due_on)}</p><p>{item.lesson_ids.map(lessonName).join(' · ')}</p></li>)}</ol><p>{plan.lesson_overrides.length} individual requirement {plan.lesson_overrides.length === 1 ? 'exception' : 'exceptions'}</p></div>}
      <div className="flex flex-wrap gap-2"><Button onClick={() => { setDraft(plan ? { ...plan, active: true } : blankPlan()); setEditing(true); setNotice(null) }}>{plan?.active ? 'Edit personal plan' : 'Customize plan'}</Button>{plan?.active && <Button variant="secondary" onClick={() => setConfirmRestore(true)}><RotateCcw className="h-4 w-4" aria-hidden="true" />Return to regular curriculum</Button>}</div>
      {confirmRestore && plan && <div className="space-y-3 rounded-xl border border-line bg-surface-sunken p-4"><p className="text-sm text-ink-secondary">Restore the regular requirements and schedule for this student? Submitted work, grades, progress, and plan history stay saved.</p><div className="flex flex-wrap gap-2"><Button disabled={saving} onClick={() => void save({ ...plan, active: false })}>{saving ? 'Restoring…' : 'Restore regular curriculum'}</Button><Button variant="secondary" disabled={saving} onClick={() => setConfirmRestore(false)}>Keep personal plan</Button></div></div>}
    </>}
    {editing && data && <form onSubmit={submit} className="space-y-5">
      <fieldset disabled={saving} className="space-y-5">
        <label className="block text-sm font-semibold text-ink">Plan title<input required maxLength={160} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="app-control mt-1 w-full" /></label>
        <label className="block text-sm font-semibold text-ink">Note for the student<textarea aria-label="Note for the student" maxLength={2000} rows={3} value={draft.description || ''} onChange={(event) => setDraft({ ...draft, description: event.target.value })} className="app-control mt-1 w-full font-normal" /></label>
        <div className="grid gap-4 sm:grid-cols-2"><label className="block min-w-0 text-sm font-semibold text-ink">Target finish<input type="date" value={draft.target_date || ''} onChange={(event) => setDraft({ ...draft, target_date: event.target.value || null })} className="app-control mt-1 w-full min-w-0" /></label><label className="block min-w-0 text-sm font-semibold text-ink">Next check-in<input type="date" value={draft.next_check_in_on || ''} onChange={(event) => setDraft({ ...draft, next_check_in_on: event.target.value || null })} className="app-control mt-1 w-full min-w-0" /></label></div>
        <div className="space-y-4"><h3 className="font-semibold text-ink">Milestones</h3><p className="text-sm text-ink-muted">Choose existing lessons and list milestones in target-date order. These dates guide pacing; they do not lock lessons or close submissions.</p>
          {draft.milestones.map((item, index) => <fieldset key={index} className="min-w-0 space-y-3 rounded-xl border border-line p-4"><legend className="px-1 text-sm font-semibold text-ink">Milestone {index + 1}</legend><div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]"><label className="min-w-0 text-sm font-semibold text-ink">Milestone title<input required maxLength={160} value={item.title} onChange={(event) => updateMilestone(index, { title: event.target.value })} className="app-control mt-1 w-full" /></label><label className="min-w-0 text-sm font-semibold text-ink">Target date<input required type="date" value={item.due_on} onChange={(event) => updateMilestone(index, { due_on: event.target.value })} className="app-control mt-1 w-full min-w-0" /></label></div>
            <ul className="space-y-1">{item.lesson_ids.map((id) => <li key={id} className="flex min-w-0 items-center justify-between gap-2 rounded-lg bg-surface-sunken px-3 py-1 text-sm text-ink-secondary"><span className="min-w-0 [overflow-wrap:anywhere]">{lessonName(id)}</span><Button type="button" variant="quiet" aria-label={`Remove ${lessonName(id)} from milestone ${index + 1}`} onClick={() => updateMilestone(index, { lesson_ids: item.lesson_ids.filter((value) => value !== id) })}><Trash2 className="h-4 w-4" aria-hidden="true" /></Button></li>)}</ul>
            <label className="block text-sm font-semibold text-ink">Add lesson to milestone {index + 1}<select aria-label={`Add lesson to milestone ${index + 1}`} value="" onChange={(event) => updateMilestone(index, { lesson_ids: [...item.lesson_ids, Number(event.target.value)] })} className="app-control mt-1 w-full"><option value="" disabled>Choose a lesson</option>{data.lessons.filter((lesson) => !draft.milestones.some((milestone) => milestone.lesson_ids.includes(lesson.id))).map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.module_name} · {lesson.title}</option>)}</select></label>
            <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, milestones: draft.milestones.filter((_, position) => position !== index) })}>Remove milestone {index + 1}</Button>
          </fieldset>)}
          <Button type="button" variant="secondary" disabled={draft.milestones.length >= 50} onClick={() => setDraft({ ...draft, milestones: [...draft.milestones, { title: '', due_on: '', lesson_ids: [] }] })}><Plus className="h-4 w-4" aria-hidden="true" />Add milestone</Button>
        </div>
        <details className="space-y-3 rounded-xl border border-line p-4" open={draft.lesson_overrides.length > 0}><summary className="min-h-11 cursor-pointer font-semibold text-ink">Required and optional lessons ({draft.lesson_overrides.length} changes)</summary><p className="text-sm text-ink-muted">Everything follows the regular curriculum unless listed here. Optional lessons remain accessible. Explain each change so the student knows what to complete.</p>
          {draft.lesson_overrides.map((item, index) => <div key={item.lesson_id} className="space-y-3 border-t border-line pt-3"><p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{lessonName(item.lesson_id)}</p><label className="block text-sm font-semibold text-ink">Requirement for {lessonName(item.lesson_id)}<select aria-label={`Requirement for ${lessonName(item.lesson_id)}`} className="app-control mt-1 w-full" value={String(item.required)} onChange={(event) => setDraft({ ...draft, lesson_overrides: draft.lesson_overrides.map((value, position) => position === index ? { ...value, required: event.target.value === 'true' } : value) })}><option value="true">Required in this plan</option><option value="false">Optional in this plan</option></select></label><label className="block text-sm font-semibold text-ink">Reason for {lessonName(item.lesson_id)}<input required maxLength={500} value={item.reason} onChange={(event) => setDraft({ ...draft, lesson_overrides: draft.lesson_overrides.map((value, position) => position === index ? { ...value, reason: event.target.value } : value) })} className="app-control mt-1 w-full" /></label><Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, lesson_overrides: draft.lesson_overrides.filter((value) => value.lesson_id !== item.lesson_id) })}>Use regular requirement for this lesson</Button></div>)}
          <label className="block text-sm font-semibold text-ink">Add a requirement exception<select aria-label="Add a requirement exception" value="" className="app-control mt-1 w-full" onChange={(event) => { const lesson = data.lessons.find((value) => value.id === Number(event.target.value)); if (lesson) setDraft({ ...draft, lesson_overrides: [...draft.lesson_overrides, { lesson_id: lesson.id, required: !lesson.standard_required, reason: '' }] }) }}><option value="" disabled>Choose a lesson</option>{data.lessons.filter((lesson) => !draft.lesson_overrides.some((item) => item.lesson_id === lesson.id)).map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.module_name} · {lesson.title} ({lesson.standard_required ? 'required' : 'optional'})</option>)}</select></label>
        </details>
      </fieldset>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={saving}><Save className="h-4 w-4" aria-hidden="true" />{saving ? 'Saving…' : 'Save personal plan'}</Button><Button type="button" variant="secondary" disabled={saving} onClick={() => { setEditing(false); setError(null) }}>Cancel</Button></div>
    </form>}
    {!!data?.revisions.length && <details className="border-t border-line pt-4"><summary className="min-h-11 cursor-pointer text-sm font-semibold text-ink">Plan history</summary><ol className="space-y-3">{data.revisions.map((revision) => <li key={revision.id} className="text-sm text-ink-secondary"><p className="font-semibold">{revision.author} · {formatShortDateTime(revision.created_at)}</p><p>{revision.snapshot.active ? revision.snapshot.title : 'Returned to regular curriculum'} · {revision.snapshot.milestones.length} milestones · {revision.snapshot.lesson_overrides.length} requirement exceptions</p></li>)}</ol></details>}
  </section>
}
