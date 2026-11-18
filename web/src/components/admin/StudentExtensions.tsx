import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../../lib/api'
import { Button } from '../ui/Button'
import { formatShortDateTime } from '../../lib/format'
import type { LearnerExtension } from '../../types/api'

type Module = { id: number; name: string; lessons: { id: number; title: string; release_day: number }[] }
export function StudentExtensions({ enrollmentId, modules, onSaved }: { enrollmentId: number; modules: Module[]; onSaved: () => void }) {
  const [items, setItems] = useState<LearnerExtension[]>([])
  const [target, setTarget] = useState('final')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState<number>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadVersion, setLoadVersion] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void api.getLearnerExtensions(enrollmentId).then((result) => {
      if (active) { if (result.data) setItems(result.data.extensions); else setError(result.error || 'Could not load extensions.') }
    }).catch(() => { if (active) setError('Could not load extensions.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [enrollmentId, loadVersion])
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    const [scope, targetId, week] = target.split(':')
    try {
      const result = await api.saveLearnerExtension(enrollmentId, {
        scope: scope as 'final' | 'lesson' | 'module', lesson_id: scope === 'lesson' ? Number(targetId) : null,
        module_id: scope === 'module' ? Number(targetId) : null, week_number: scope === 'module' ? Number(week) : null,
        submissions_close_at: `${date}T23:59:59+10:00`, reason,
      }, editing)
      if (result.data && !result.error) { setItems(result.data.extensions); setReason(''); setEditing(undefined); setNotice('Extension saved. The learner sees the new deadline.'); onSaved() }
      else setError(result.error || 'Could not save extension.')
    } catch { setError('Could not save extension.') }
    finally { setBusy(false) }
  }
  async function remove(item: LearnerExtension) {
    if (!reason.trim()) { setError('Enter a reason before removing an extension.'); return }
    setBusy(true); setError('')
    try {
      const result = await api.removeLearnerExtension(enrollmentId, item.id, reason)
      if (result.data && !result.error) { setItems(result.data.extensions); setReason(''); setNotice('Extension removed. History kept.'); onSaved() }
      else setError(result.error || 'Could not remove extension.')
    } catch { setError('Could not remove extension.') }
    finally { setBusy(false) }
  }
  return <section className="app-surface space-y-4 p-5 sm:p-6" aria-label="Deadlines and extensions">
    <h2 className="text-lg font-bold text-ink">Deadlines and extensions</h2>
    <p className="text-sm text-ink-secondary">Weekly targets are soft. Extend the firm final date or a specific submission window. Every change needs a reason and keeps its history.</p>
    <form onSubmit={(event) => void save(event)} className="grid gap-3">
      <label className="text-sm font-semibold text-ink">Applies to<select className="app-control mt-1 w-full" value={target} onChange={(event) => setTarget(event.target.value)} disabled={busy || loading || editing !== undefined}>
        <option value="final">Firm final date (personal pace)</option>
        {modules.flatMap((mod) => [
          ...Array.from(new Set(mod.lessons.map((lesson) => Math.floor(lesson.release_day / 7) + 1))).map((week) => <option key={`m${mod.id}-${week}`} value={`module:${mod.id}:${week}`}>{mod.name} · Week {week}</option>),
          ...mod.lessons.map((lesson) => <option key={`l${lesson.id}`} value={`lesson:${lesson.id}`}>{mod.name} · {lesson.title}</option>),
        ])}
      </select></label>
      <label className="text-sm font-semibold text-ink">New deadline (Guam)<input type="date" required className="app-control mt-1 w-full" value={date} onChange={(event) => setDate(event.target.value)} disabled={busy || loading} /></label>
      <label className="text-sm font-semibold text-ink">Reason<textarea required maxLength={4000} className="app-control mt-1 min-h-24 w-full" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy || loading} /></label>
      <div className="flex gap-2"><Button type="submit" disabled={busy || loading}>{editing ? 'Save extension change' : 'Grant extension'}</Button>{editing && <Button variant="secondary" type="button" onClick={() => setEditing(undefined)}>Cancel edit</Button>}</div>
    </form>
    {notice && <p role="status" className="text-sm text-ink-secondary">{notice}</p>}
    {error && <div><p role="alert" className="text-sm text-danger-ink">{error}</p><Button variant="secondary" disabled={busy || loading} onClick={() => setLoadVersion((value) => value + 1)}>Reload extensions</Button></div>}
    <ul className="space-y-3" aria-label="Extensions">{items.map((item) => <li key={item.id} className="rounded-xl border border-line p-3 text-sm text-ink">
      <p className="font-semibold">{item.scope} · {formatShortDateTime(item.submissions_close_at)}{item.removed_at ? ' · Removed' : ''}</p>
      <p className="mt-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{item.reason}</p>
      <p className="text-ink-muted">Granted by staff #{item.granted_by_id} · {formatShortDateTime(item.granted_at)}</p>
      {!item.removed_at && <div className="mt-2 flex gap-2"><Button variant="secondary" disabled={busy || loading} onClick={() => { setEditing(item.id); setTarget(item.scope === 'final' ? 'final' : `${item.scope}:${item.scope === 'lesson' ? item.lesson_id : item.module_id}${item.scope === 'module' ? `:${item.week_number}` : ''}`); setDate(item.submissions_close_at.slice(0, 10)); setReason(item.reason) }}>Edit</Button><Button variant="secondary" disabled={busy || loading} onClick={() => void remove(item)}>Remove</Button></div>}
      <details className="mt-2"><summary className="min-h-11 cursor-pointer py-3">Extension history ({item.revisions.length})</summary><ol className="space-y-2">{item.revisions.map((entry, index) => <li key={index} className="[overflow-wrap:anywhere]">{String(entry.granted_at)} · {String(entry.reason)} · {entry.removed_at ? 'Removed' : String(entry.submissions_close_at)}</li>)}</ol></details>
    </li>)}</ul>
  </section>
}
