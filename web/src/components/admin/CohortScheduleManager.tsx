import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { CalendarDays, Pencil, Plus, Trash2 } from 'lucide-react'
import { api } from '../../lib/api'
import { formatDateTimeRange } from '../../lib/format'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { Button, IconButton, LinkButton } from '../ui/Button'
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

  return <div className="space-y-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-semibold text-ink-muted">Live schedule</p><h2 className="mt-1 text-lg font-bold text-ink">Classes & office hours</h2></div><div className="flex flex-wrap gap-2">{canManageLearningSchedule && <LinkButton to={`/admin/cohorts/${cohortId}/settings#curriculum`} variant="secondary">Lesson releases</LinkButton>}{canManage && <Button variant={showForm ? 'secondary' : 'primary'} onClick={() => startEdit()}><Plus className="h-4 w-4" />Add session</Button>}</div></div>
    {error && <p role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm text-danger-700">{error}</p>}
    {showForm && <form onSubmit={(event) => void save(event)} className="app-surface space-y-4 p-5"><div className="flex items-center justify-between"><h3 className="text-base font-semibold text-ink">{editingId ? 'Edit session' : 'New session'}</h3><Button variant="quiet" onClick={() => setShowForm(false)}>Cancel</Button></div><div className="grid gap-3 sm:grid-cols-2"><label className="text-sm font-semibold text-ink-secondary">Type<select value={draft.event_kind} onChange={(event) => setDraft({ ...draft, event_kind: event.target.value as SessionDraft['event_kind'] })} className="app-control mt-1 w-full"><option value="office_hours">Office hours</option><option value="live_class">Live class</option></select></label><label className="text-sm font-semibold text-ink-secondary">Repeat<select value={draft.recurrence} onChange={(event) => setDraft({ ...draft, recurrence: event.target.value as SessionDraft['recurrence'] })} className="app-control mt-1 w-full"><option value="once">Once</option><option value="weekly">Weekly</option></select></label><label className="sm:col-span-2 text-sm font-semibold text-ink-secondary">Title<input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="app-control mt-1 w-full" /></label><label className="text-sm font-semibold text-ink-secondary">Starts<input required type="datetime-local" value={draft.starts_at} onChange={(event) => setDraft({ ...draft, starts_at: event.target.value })} className="app-control mt-1 w-full" /></label><label className="text-sm font-semibold text-ink-secondary">Ends<input required type="datetime-local" value={draft.ends_at} onChange={(event) => setDraft({ ...draft, ends_at: event.target.value })} className="app-control mt-1 w-full" /></label><label className="sm:col-span-2 text-sm font-semibold text-ink-secondary">Meeting URL<input required type="url" value={draft.meeting_url} onChange={(event) => setDraft({ ...draft, meeting_url: event.target.value })} placeholder="https://…" className="app-control mt-1 w-full" /></label></div><p className="text-xs text-ink-muted">Times are in {draft.timezone}.</p><Button disabled={saving} type="submit">{saving ? 'Saving…' : editingId ? 'Save changes' : 'Add to schedule'}</Button></form>}
    {loading ? <p className="text-sm text-ink-muted">Loading schedule…</p> : sessions.length ? <section className="app-surface divide-y divide-line">{sessions.map((session) => <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"><div className="flex min-w-0 flex-1 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary"><CalendarDays className="h-5 w-5" /></span><div className="min-w-0"><p className="truncate font-semibold text-ink" title={session.title}>{session.title}</p><p className="mt-1 text-sm tabular-nums text-ink-muted">{formatDateTimeRange(session.starts_at, session.ends_at, 'Not scheduled', session.timezone)} · {session.event_kind === 'live_class' ? 'Live class' : 'Office hours'}{session.recurrence === 'weekly' ? ' · Weekly' : ''}</p></div></div>{canManage && <div className="flex shrink-0 gap-1"><IconButton label={`Edit ${session.title}`} onClick={() => startEdit(session)}><Pencil className="h-4 w-4" /></IconButton><IconButton label={`Delete ${session.title}`} variant="danger" onClick={() => void remove(session)}><Trash2 className="h-4 w-4" /></IconButton></div>}</div>)}</section> : <div className="app-surface p-6 text-sm text-ink-muted">No live sessions scheduled yet.</div>}
  </div>
}
