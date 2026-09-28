import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, UserPlus, Users, X } from 'lucide-react'
import { api } from '../../lib/api'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import type { CohortInstructorAssignment, User } from '../../types/api'

export function CohortTeachingTeam({ cohortId }: { cohortId: number }) {
  const toast = useToast()
  const confirm = useConfirm()
  const [assigned, setAssigned] = useState<CohortInstructorAssignment[]>([])
  const [available, setAvailable] = useState<User[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    const [assignments, users] = await Promise.all([api.getCohortInstructorAssignments(cohortId), api.getUsers({ role: 'instructor' })])
    if (assignments.data && !assignments.error && !assignments.fromCache) { setAssigned(assignments.data.instructors); setError(null) }
    else setError(assignments.error || 'Could not load instructor assignments.')
    if (users.data) setAvailable(users.data.users.filter((user) => !user.archived_at))
  }, [cohortId])

  useEffect(() => { void reload() }, [reload])

  async function assign() {
    const id = Number(selectedId)
    if (!id) return
    setBusy(true)
    const result = await api.createCohortInstructorAssignment(cohortId, id)
    setBusy(false)
    if (!result.data) return toast.error(result.error || 'Could not assign this instructor.')
    setSelectedId('')
    toast.success('Instructor assigned to this cohort.')
    await reload()
  }

  async function remove(instructor: CohortInstructorAssignment) {
    const approved = await confirm({ title: `Remove ${instructor.full_name}?`, description: 'They will lose teaching access to this cohort. Their work and messages remain in the class history.', confirmLabel: 'Remove assignment', tone: 'danger' })
    if (!approved) return
    setBusy(true)
    const result = await api.deleteCohortInstructorAssignment(cohortId, instructor.id)
    setBusy(false)
    if (result.error) return toast.error(result.error)
    toast.success('Instructor removed from this cohort.')
    await reload()
  }

  const assignable = available.filter((user) => !assigned.some((instructor) => instructor.id === user.id))
  return <section className="app-surface overflow-hidden"><div className="border-b border-slate-100 p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="app-eyebrow">Teaching access</p><h2 className="mt-1 text-xl font-extrabold text-slate-950">Instructors for this cohort</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">Assign instructors only to the classes they teach. They can open the class roster, grade work, answer support requests, manage sessions, and post updates for their assigned cohorts.</p></div><Link to="/admin/team" className="app-link inline-flex min-h-11 items-center gap-1 text-sm font-bold">Manage staff accounts <ArrowRight className="h-4 w-4" /></Link></div>
    {error && <p role="alert" className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="mt-5 flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1"><span className="sr-only">Choose instructor</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">Choose an instructor</option>{assignable.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email} · {user.email}</option>)}</select></label><button type="button" onClick={() => void assign()} disabled={!selectedId || busy} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white disabled:opacity-50"><UserPlus className="h-4 w-4" />Assign instructor</button></div></div>
    {assigned.length ? <div className="divide-y divide-slate-100">{assigned.map((instructor) => <div key={instructor.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 sm:px-6"><div><p className="text-sm font-extrabold text-slate-900">{instructor.full_name || instructor.email}</p><p className="text-xs text-slate-500">{instructor.email}</p></div><button type="button" onClick={() => void remove(instructor)} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-600 hover:border-red-200 hover:text-red-700 disabled:opacity-50"><X className="h-4 w-4" />Remove</button></div>)}</div> : <div className="flex items-center gap-3 px-5 py-8 text-sm text-slate-500"><Users className="h-5 w-5" />No instructors assigned yet. Admins can still manage this cohort.</div>}
  </section>
}
