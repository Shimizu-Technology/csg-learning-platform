import { useEffect, useId, useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { Button } from '../ui/Button'
import { Modal } from '../shared/Modal'
import { formatShortDateTime } from '../../lib/format'
import type { LearnerExtension } from '../../types/api'

type Module = { id: number; name: string; lessons: { id: number; title: string; release_day: number }[] }
const guamDate = (value: string) => formatShortDateTime(value, 'Not recorded', 'Pacific/Guam')

export function StudentExtensions({ enrollmentId, modules, onSaved }: {
  enrollmentId: number; modules: Module[]; onSaved: () => void
}) {
  const formId = useId()
  const [items, setItems] = useState<LearnerExtension[]>([])
  const [personalPace, setPersonalPace] = useState(false)
  const [target, setTarget] = useState('')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState<number>()
  const [removing, setRemoving] = useState<LearnerExtension | null>(null)
  const [removalReason, setRemovalReason] = useState('')
  const [removalError, setRemovalError] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [historyReady, setHistoryReady] = useState(false)
  const writesDisabled = busy || loading || !historyReady
  const [loadVersion, setLoadVersion] = useState(0)
  const firstLesson = modules.flatMap((mod) => mod.lessons)[0]
  const defaultTarget = firstLesson ? `lesson:${firstLesson.id}` : ''

  useEffect(() => {
    let active = true
    setLoading(true); setHistoryReady(false); setError('')
    void api.getLearnerExtensions(enrollmentId).then((result) => {
      if (!active) return
      if (result.data && !result.error && !result.fromCache) {
        setHistoryReady(true)
        setItems(result.data.extensions)
        setPersonalPace(result.data.personal_pace)
        setTarget((value) => value || (result.data!.personal_pace ? 'final' : defaultTarget))
      } else setError(result.error || 'Could not load extensions.')
    }).catch(() => { if (active) setError('Could not load extensions.') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [enrollmentId, loadVersion, defaultTarget])

  function targetLabel(item: LearnerExtension) {
    if (item.scope === 'final') return 'Final project'
    if (item.scope === 'lesson') {
      return modules.flatMap((mod) => mod.lessons).find((lesson) => lesson.id === item.lesson_id)?.title
        || (item.lesson_id === null ? 'Lesson removed' : `Lesson #${item.lesson_id}`)
    }
    return `${modules.find((mod) => mod.id === item.module_id)?.name || `Module #${item.module_id}`} · Week ${item.week_number}`
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (writesDisabled) return
    setBusy(true); setError(''); setNotice('')
    const [scope, targetId, week] = target.split(':')
    try {
      const result = await api.saveLearnerExtension(enrollmentId, {
        scope: scope as 'final' | 'lesson' | 'module', lesson_id: scope === 'lesson' ? Number(targetId) : null,
        module_id: scope === 'module' ? Number(targetId) : null, week_number: scope === 'module' ? Number(week) : null,
        submissions_close_at: `${date}T23:59:59+10:00`, reason,
      }, editing)
      if (result.data && !result.error) {
        setItems(result.data.extensions); setReason(''); setEditing(undefined)
        setNotice('Extension saved. The learner sees the new deadline.'); onSaved()
      } else setError(result.error || 'Could not save extension.')
    } catch { setError('Could not save extension.') }
    finally { setBusy(false) }
  }

  async function remove(event: FormEvent) {
    event.preventDefault()
    if (writesDisabled || !removing || !removalReason.trim()) return
    setBusy(true); setRemovalError('')
    try {
      const result = await api.removeLearnerExtension(enrollmentId, removing.id, removalReason)
      if (result.data && !result.error) {
        setItems(result.data.extensions); setRemoving(null); setRemovalReason('')
        if (editing === removing.id) { setEditing(undefined); setReason(''); setDate(''); setTarget(personalPace ? 'final' : defaultTarget) }
        setNotice('Extension removed. History kept.'); onSaved()
      } else setRemovalError(result.error || 'Could not remove extension.')
    } catch { setRemovalError('Could not remove extension.') }
    finally { setBusy(false) }
  }

  function edit(item: LearnerExtension) {
    setEditing(item.id)
    setTarget(item.scope === 'final' ? 'final' : `${item.scope}:${item.scope === 'lesson' ? item.lesson_id : item.module_id}${item.scope === 'module' ? `:${item.week_number}` : ''}`)
    setDate(new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Guam' }).format(new Date(item.submissions_close_at)))
    setReason(''); setError(''); setNotice('')
  }

  return <section className="app-surface space-y-4 p-5 sm:p-6" aria-label="Deadlines and extensions">
    <h2 className="text-lg font-bold text-ink">Deadlines and extensions</h2>
    <p className="text-sm text-ink-secondary">An extension only gives more time. Open windows stay open. Every change needs a new reason and keeps its history.</p>
    {personalPace && <p className="text-sm text-ink-secondary">For learners following a personal pace, cohort weekly close times are not enforced. Weekly milestones are soft; only the final project has a firm pace deadline.</p>}
    <form onSubmit={(event) => void save(event)} className="grid gap-3">
      <label className="text-sm font-semibold text-ink">Applies to
        <select className="app-control mt-1 w-full" value={target} onChange={(event) => setTarget(event.target.value)} disabled={writesDisabled || editing !== undefined}>
          {personalPace && <option value="final">Firm final date (personal pace)</option>}
          {modules.flatMap((mod) => [
            ...Array.from(new Set(mod.lessons.map((lesson) => Math.floor(lesson.release_day / 7) + 1))).map((week) =>
              <option key={`m${mod.id}-${week}`} value={`module:${mod.id}:${week}`}>{mod.name} · Week {week}</option>),
            ...mod.lessons.map((lesson) =>
              <option key={`l${lesson.id}`} value={`lesson:${lesson.id}`}>{mod.name} · {lesson.title}</option>),
          ])}
        </select>
      </label>
      <label className="text-sm font-semibold text-ink">New deadline (Guam)
        <input type="date" required className="app-control mt-1 w-full" value={date} onChange={(event) => setDate(event.target.value)} disabled={writesDisabled} />
      </label>
      <div>
        <label htmlFor={`${formId}-reason`} className="text-sm font-semibold text-ink">Reason</label>
        <textarea id={`${formId}-reason`} required maxLength={4000} className="app-control mt-1 min-h-24 w-full" value={reason} onChange={(event) => setReason(event.target.value)} disabled={writesDisabled} />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={writesDisabled || !target}>{busy && !removing ? 'Saving…' : editing ? 'Save extension change' : 'Grant extension'}</Button>
        {editing && <Button variant="secondary" type="button" onClick={() => { setEditing(undefined); setReason('') }}>Cancel edit</Button>}
      </div>
    </form>
    {notice && <p role="status" className="text-sm text-ink-secondary">{notice}</p>}
    {error && <div><p role="alert" className="text-sm text-danger-ink">{error}</p>
      <Button variant="secondary" disabled={busy || loading} onClick={() => setLoadVersion((value) => value + 1)}>Reload extensions</Button>
    </div>}
    <ul className="space-y-3" aria-label="Extensions">{items.map((item) => <li key={item.id} className="rounded-xl border border-line p-3 text-sm text-ink">
      <p className="font-semibold">{targetLabel(item)} · {guamDate(item.submissions_close_at)}{item.removed_at ? ' · Removed' : ''}</p>
      <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.reason}</p>
      <p className="text-ink-muted">Granted by {item.granted_by_name} · {guamDate(item.granted_at)}</p>
      {!item.removed_at && <div className="mt-2 flex gap-2">
        <Button variant="secondary" disabled={writesDisabled || (item.scope === 'lesson' && item.lesson_id === null)} onClick={() => edit(item)}>Edit</Button>
        <Button variant="secondary" disabled={writesDisabled} onClick={() => { setRemoving(item); setRemovalReason(''); setRemovalError('') }}>Remove</Button>
      </div>}
      <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3">Extension history ({item.revisions.length})</summary>
        <ol className="space-y-2">{item.revisions.map((entry, index) => <li key={index} className="[overflow-wrap:anywhere]">
          {guamDate(String(entry.granted_at))} · {String(entry.reason)} · {entry.removed_at ? 'Removed' : guamDate(String(entry.submissions_close_at))}
        </li>)}</ol>
      </details>
    </li>)}</ul>
    <Modal open={removing !== null} onClose={() => { if (!busy) setRemoving(null) }} title="Remove extension?">
      {removing && <form onSubmit={(event) => void remove(event)} className="space-y-4">
        <p className="text-sm text-ink-secondary">Remove the grant for {targetLabel(removing)}? The learner’s remaining grants and base window will apply. History is kept.</p>
        <div>
          <label htmlFor={`${formId}-removal`} className="block text-sm font-semibold text-ink">Removal reason</label>
          <textarea id={`${formId}-removal`} required maxLength={4000} className="app-control mt-1 min-h-24 w-full" value={removalReason} onChange={(event) => setRemovalReason(event.target.value)} disabled={busy} />
        </div>
        {removalError && <p role="alert" className="text-sm text-danger-ink">{removalError}</p>}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={writesDisabled || !removalReason.trim()}>{busy ? 'Removing…' : 'Confirm removal'}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => setRemoving(null)}>Keep extension</Button>
        </div>
      </form>}
    </Modal>
  </section>
}
