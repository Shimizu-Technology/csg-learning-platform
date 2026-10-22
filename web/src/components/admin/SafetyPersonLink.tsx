import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { cohortStudentPath } from '../../lib/routes'
import { Modal } from '../shared/Modal'
import { Button } from '../ui/Button'
import type { UserEnrollment } from '../../types/api'

// Safety reports can name staff or accounts without enrollments. Resolve the
// current account before offering learner destinations; never guess a cohort.
export function SafetyPersonLink({ person, returnTo }: { person: { id: number; full_name: string; role?: string }; returnTo: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [choices, setChoices] = useState<UserEnrollment[]>([])
  const [message, setMessage] = useState<string | null>(null)
  async function resolve() {
    setOpen(true); setLoading(true); setMessage(null); setChoices([])
    const result = await api.getUser(person.id)
    setLoading(false)
    if (!result.data || result.error || result.fromCache) { setMessage(result.error || 'Could not load learner context. Try again.'); return }
    if (result.data.user.role !== 'student') { setMessage('This account is not a learner. No learner workspace is available.'); return }
    setChoices(result.data.enrollments)
    if (!result.data.enrollments.length) setMessage('This learner has no enrollments. No learner workspace is available.')
  }
  if (person.role && person.role !== 'student') return <span>{person.full_name}</span>
  return <><button type="button" className="app-link inline-flex min-h-11 items-center text-left underline underline-offset-4" onClick={() => void resolve()}>{person.full_name}</button>{createPortal(<Modal open={open} onClose={() => setOpen(false)} title={`Learner context · ${person.full_name}`} size="md">{loading ? <p className="text-sm text-ink-muted">Loading enrollments…</p> : message ? <div><p role="status" className="text-sm text-ink-secondary">{message}</p><Button variant="quiet" onClick={() => void resolve()}>Try again</Button></div> : <div className="space-y-3"><p className="text-sm text-ink-secondary">{choices.length > 1 ? 'Choose an enrollment.' : 'Open this learner’s enrollment.'}</p>{choices.map((enrollment) => <Link key={enrollment.id} className="pressable flex min-h-11 items-center rounded-xl border border-line p-3 font-semibold text-ink hover:bg-surface-sunken" to={`${cohortStudentPath(enrollment.cohort_id, person.id)}?return_to=${encodeURIComponent(returnTo)}`} state={{ returnTo, returnLabel: 'Safety queue' }}>{enrollment.cohort_name} · {enrollment.status}</Link>)}</div>}</Modal>, document.body)}</>
}
