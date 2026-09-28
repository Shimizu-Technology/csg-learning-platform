import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { formatShortDateTime } from '../../lib/format'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import type { OfficeHour } from '../../types/api'

type SessionDraft = { title: string; event_kind: 'office_hours' | 'live_class'; starts_at: string; ends_at: string; meeting_url: string; timezone: string; recurrence: 'once' | 'weekly'; description: string }
const blank: SessionDraft = { title: '', event_kind: 'office_hours', starts_at: '', ends_at: '', meeting_url: '', timezone: 'Pacific/Guam', recurrence: 'once', description: '' }

function localInput(iso: string, timezone: string) {
  const date = new Date(iso)
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date)
  const value = (kind: string) => parts.find((part) => part.type === kind)?.value || '00'
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`
}

export function CohortScheduleManager({ cohortId, canManage, canManageLearningSchedule }: { cohortId: number; canManage: boolean; canManageLearningSchedule: boolean }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [sessions, setSessions] = useState<OfficeHour[]>([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState<SessionDraft>(blank)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const result = await api.getOfficeHours(cohortId)
    if (result.data && !result.error && !result.fromCache) { setSessions(result.data.office_hours); setError(null) }
    else { setSessions([]); setError(result.error || 'Could not load this schedule.') }
    setLoading(false)
  }, [cohortId])
  useEffect(() => { void reload() }, [reload])

  function startEdit(session?: OfficeHour) {
    setEditingId(session?.id || null)
    setDraft(session ? { title: session.title, event_kind: session.event_kind, starts_at: localInput(session.starts_at, session.timezone), ends_at: localInput(session.ends_at, session.timezone), meeting_url: session.meeting_url, timezone: session.timezone, recurrence: session.recurrence, description: session.description || '' } : blank)
    setShowForm(true)
  }

  async function save(event: FormEvent) {
    event.preventDefault()
    if (draft.ends_at <= draft.starts_at) { setError('End time must be after start time.'); return }
    setSaving(true)
    const payload = { ...draft, description: draft.description || null }
    const result = editingId ? await api.updateOfficeHour(cohortId, editingId, payload) : await api.createOfficeHour(cohortId, payload)
    setSaving(false)
    if (!result.data) { setError(result.error || 'Could not save this session.'); return }
    setShowForm(false)
    setError(null)
    toast.success(editingId ? 'Session updated.' : 'Session added.')
    await reload()
  }

  async function remove(session: OfficeHour) {
    if (!await confirm({ title: `Delete ${session.title}?`, description: 'This session will disappear from the cohort schedule.', confirmLabel: 'Delete session', tone: 'danger' })) return
    const result = await api.deleteOfficeHour(cohortId, session.id)
    if (result.error) return toast.error(result.error)
    toast.success('Session deleted.')
    await reload()
  }

  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="app-eyebrow">Live schedule</p><h2 className="mt-1 text-xl font-extrabold text-slate-950">Classes and office hours</h2></div><div className="flex flex-wrap gap-2">{canManageLearningSchedule && <Link to={`/admin/cohorts/${cohortId}/settings#curriculum`} className="inline-flex min-h-11 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">Lesson releases</Link>}{canManage && <button type="button" onClick={() => startEdit()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white"><Plus className="h-4 w-4" />Add session</button>}</div></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {showForm && <form onSubmit={(event) => void save(event)} className="app-surface space-y-4 p-5"><div className="flex items-center justify-between"><h3 className="font-extrabold text-slate-950">{editingId ? 'Edit session' : 'New session'}</h3><button type="button" onClick={() => setShowForm(false)} className="min-h-11 rounded-xl px-3 text-sm font-bold text-slate-600">Cancel</button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-bold text-slate-700">Type<select value={draft.event_kind} onChange={(event) => setDraft({ ...draft, event_kind: event.target.value as SessionDraft['event_kind'] })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="office_hours">Office hours</option><option value="live_class">Live class</option></select></label><label className="text-sm font-bold text-slate-700">Repeat<select value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as SessionDraft['recurrence'] })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3"><option value="once">Once</option><option value="weekly">Weekly</option></select></label><label className="sm:col-span-2 text-sm font-bold text-slate-700">Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="text-sm font-bold text-slate-700">Starts<input required type="datetime-local" value={draft.starts_at} onChange={(event) => setDraft({ ...draft, starts_at: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="text-sm font-bold text-slate-700">Ends<input required type="datetime-local" value={draft.ends_at} onChange={(event) => setDraft({ ...draft, ends_at: event.target.value })} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label><label className="sm:col-span-2 text-sm font-bold text-slate-700">Meeting URL<input required type="url" value={draft.meeting_url} onChange={(event) => setDraft({ ...draft, meeting_url: event.target.value })} placeholder="https://…" className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3" /></label></div><p className="text-xs text-slate-500">Times are in {draft.timezone}.</p><button disabled={saving} type="submit" className="min-h-11 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add to schedule'}</button></form>}
    {loading ? <p className="text-sm text-slate-500">Loading schedule…</p> : sessions.length ? <section className="app-surface divide-y divide-slate-100">{sessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-700"><CalendarDays className="h-5 w-5" /></span><div><p className="font-extrabold text-slate-950">{session.title}</p><p className="mt-1 text-sm text-slate-500">{formatShortDateTime(session.starts_at, 'Not scheduled', session.timezone)} · {session.event_kind === 'live_class' ? 'Live class' : 'Office hours'}{session.recurrence === 'weekly' ? ' · Weekly' : ''}</p></div></div>{canManage && <div className="flex gap-1"><button type="button" aria-label={`Edit ${session.title}`} onClick={() => startEdit(session)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button><button type="button" aria-label={`Delete ${session.title}`} onClick={() => void remove(session)} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button></div>}</div>)}</section> : <div className="app-surface p-6 text-sm text-slate-500">No live sessions scheduled yet.</div>}
  </div>
}
