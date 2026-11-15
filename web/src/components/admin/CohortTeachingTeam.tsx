import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, PencilLine, UserPlus, Users, X } from 'lucide-react'
import { api } from '../../lib/api'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { Avatar } from '../ui/Avatar'
import { Button } from '../ui/Button'
import type { CohortInstructorAssignment, UserListItem as User } from '../../types/api'
import { grantLine } from '../../lib/lessonEditing'

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
    const approved = await confirm({ title: `Remove ${instructor.full_name}?`, description: instructor.can_edit_lessons ? 'They will lose teaching access and lesson editing access for this cohort. Their work and messages remain in the class history.' : 'They will lose teaching access to this cohort. Their work and messages remain in the class history.', confirmLabel: 'Remove assignment', tone: 'danger' })
    if (!approved) return
    setBusy(true)
    const result = await api.deleteCohortInstructorAssignment(cohortId, instructor.id)
    setBusy(false)
    if (result.error) return toast.error(result.error)
    toast.success('Instructor removed from this cohort.')
    await reload()
  }

  async function setLessonEditing(instructor: CohortInstructorAssignment, enabled: boolean) {
    const name = instructor.full_name || instructor.email
    if (enabled) {
      const approved = await confirm({ title: `Let ${name} edit lessons?`, description: "They can edit a curriculum's lessons only when they have editing access for every cohort that uses it. If this cohort shares its curriculum, they need this access on each of those cohorts too, and their edits then change the lessons for all of them. Until then they see the lessons read only. Students' progress and work stay attached to the lessons they edit.", confirmLabel: 'Give editing access' })
      if (!approved) return
    }
    setBusy(true)
    const result = await api.setCohortInstructorLessonEditing(cohortId, instructor.id, enabled)
    setBusy(false)
    if (!result.data) return toast.error(result.error || 'Could not change lesson editing access.')
    setAssigned((current) => current.map((row) => row.id === instructor.id ? result.data!.instructor : row))
    toast.success(enabled ? `${name} can now edit this cohort's lessons.` : `${name} can no longer edit lessons for this cohort.`)
  }

  const assignable = available.filter((user) => !assigned.some((instructor) => instructor.id === user.id))
  return <section className="app-surface overflow-hidden"><div className="border-b border-line p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold text-ink-muted">Teaching access</p><h2 className="mt-1 text-lg font-bold text-ink">Instructors for this cohort</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-ink-secondary">Assign instructors only to the classes they teach. They can open the class roster, grade work, answer support requests, manage sessions, and post updates for their assigned cohorts. Lesson editing is off unless you turn it on for someone.</p></div><Link to="/admin/team" className="app-link inline-flex min-h-11 items-center gap-1 text-sm">Manage staff accounts <ArrowRight className="h-4 w-4" /></Link></div>
    {error && <p role="alert" className="mt-4 rounded-xl border border-danger-line bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}
    <div className="mt-5 flex flex-col gap-2 sm:flex-row"><label className="min-w-0 flex-1"><span className="sr-only">Choose instructor</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)} className="app-control w-full"><option value="">Choose an instructor</option>{assignable.map((user) => <option key={user.id} value={user.id}>{user.full_name || user.email} · {user.email}</option>)}</select></label><Button onClick={() => void assign()} disabled={!selectedId || busy}><UserPlus className="h-4 w-4" />Assign instructor</Button></div></div>
    {assigned.length ? <div className="divide-y divide-line">{assigned.map((instructor) => <div key={instructor.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><div className="flex min-w-0 items-center gap-3"><Avatar name={instructor.full_name || instructor.email} size="sm" /><div className="min-w-0"><p className="truncate text-sm font-semibold text-ink" title={instructor.full_name || instructor.email}>{instructor.full_name || instructor.email}</p><p className="truncate text-xs text-ink-muted" title={instructor.email}>{instructor.email}</p></div></div><div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end"><LessonEditingSwitch instructor={instructor} disabled={busy} onChange={(enabled) => void setLessonEditing(instructor, enabled)} /><Button variant="danger" size="sm" className="shrink-0" onClick={() => void remove(instructor)} disabled={busy}><X className="h-4 w-4" />Remove</Button></div></div>)}</div> : <div className="flex items-center gap-3 px-5 py-8 text-sm text-ink-muted"><Users className="h-5 w-5" />No instructors assigned yet. Admins can still manage this cohort.</div>}
  </section>
}

/** Per-cohort lesson editing access for one instructor (decision 1, W5 PR 5.3 part 2). */
function LessonEditingSwitch({ instructor, disabled, onChange }: { instructor: CohortInstructorAssignment; disabled: boolean; onChange: (enabled: boolean) => void }) {
  const on = instructor.can_edit_lessons
  const name = instructor.full_name || instructor.email
  const detail = on ? grantLine({ granted_by: instructor.edit_granted_by, granted_at: instructor.edit_granted_at }, 'them') : 'Lessons read only'
  return <button type="button" role="switch" aria-checked={on} aria-label={`Lesson editing for ${name}`} aria-describedby={`lesson-editing-${instructor.id}`} disabled={disabled} onClick={() => onChange(!on)} className="pressable flex min-h-11 items-center gap-2.5 rounded-xl px-2 text-left disabled:opacity-60">
    <span aria-hidden="true" className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-150 ${on ? 'bg-action-primary' : 'bg-line-control'}`}><span className={`inline-block h-5 w-5 rounded-full bg-surface-raised shadow-sm transition-transform duration-150 ${on ? 'translate-x-[18px]' : 'translate-x-0.5'}`} /></span>
    <span className="min-w-0"><span className="flex items-center gap-1 text-sm font-semibold text-ink"><PencilLine className="h-3.5 w-3.5" aria-hidden="true" />Lesson editing</span><span id={`lesson-editing-${instructor.id}`} className="block text-xs text-ink-muted">{detail}</span></span>
  </button>
}
