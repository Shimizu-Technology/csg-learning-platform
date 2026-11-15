import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { useToast } from '../../contexts/ToastContext'
import { Button } from '../ui/Button'
export function CohortEnrollment({ cohortId, onSaved }: { cohortId: number; onSaved: () => Promise<unknown> }) {
const toast = useToast()
const [showAddStudent, setShowAddStudent] = useState(false)

const notifyError = toast.error
const notifySuccess = toast.success
  const [addStudentEmail, setAddStudentEmail] = useState('')
  const [addStudentGithub, setAddStudentGithub] = useState('')
  const [addingStudent, setAddingStudent] = useState(false)
  const [studentConflict, setStudentConflict] = useState('')
  const [sendInvite, setSendInvite] = useState(true)
  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!cohortId || !addStudentEmail.trim()) return
    setAddingStudent(true)
    setStudentConflict('')

    const createRes = await api.createUser({
      email: addStudentEmail.trim().toLowerCase(),
      role: 'student',
      github_username: addStudentGithub.trim() || undefined,
      skip_invite: true,
    })
    if (createRes.error) {
      if (createRes.errorCode === 'staff_account_exists') setStudentConflict(createRes.error)
      notifyError(createRes.error)
      setAddingStudent(false)
      return
    }

    const userId = createRes.data?.user?.id
    if (!userId) {
      notifyError('Failed to create user')
      setAddingStudent(false)
      return
    }

    const enrollRes = await api.createEnrollment(cohortId, userId, sendInvite)
    if (enrollRes.error) {
      notifyError(`Account found, but enrollment failed: ${enrollRes.error}`)
      setAddingStudent(false)
      return
    }

    await onSaved()

    if (enrollRes.data?.invitation?.status === 'failed') {
      notifyError(`Added ${addStudentEmail.trim()}, but the invitation needs to be retried from the roster.`)
    } else if (enrollRes.data?.invitation?.status === 'queued') {
      notifySuccess(`Added ${addStudentEmail.trim()} and queued the invitation`)
    } else {
      notifySuccess(`Added ${addStudentEmail.trim()} to cohort`)
    }
    setAddStudentEmail('')
    setAddStudentGithub('')
    setAddingStudent(false)
    setShowAddStudent(false)
  }

return <section className="app-surface space-y-4 p-5"><Button onClick={() => setShowAddStudent(!showAddStudent)}>Add student</Button>{showAddStudent && (            <form onSubmit={handleAddStudent} className="app-surface-muted p-4 space-y-3">
              <p className="text-xs text-ink-secondary">
                Enter the student's email. Their name will be filled automatically when they sign in via Clerk.
              </p>
              {studentConflict && <p role="alert" className="text-sm text-danger-ink">{studentConflict} <Link to="/admin/team" className="font-semibold underline">Open Team</Link></p>}
              <div>
                <label htmlFor="add-student-email" className="block text-xs font-semibold text-ink-secondary mb-1">Email address *</label>
                <input
                  id="add-student-email"
                  type="email"
                  required
                  value={addStudentEmail}
                  onChange={(e) => setAddStudentEmail(e.target.value)}
                  placeholder="student@example.com"
                  className="app-control w-full"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-ink-secondary mb-1">GitHub username (optional)</label>
                <input
                  type="text"
                  value={addStudentGithub}
                  onChange={(e) => setAddStudentGithub(e.target.value)}
                  placeholder="e.g., octocat"
                  className="app-control w-full"
                />
              </div>
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
                <input
                  type="checkbox"
                  checked={sendInvite}
                  onChange={(e) => setSendInvite(e.target.checked)}
                  className="rounded border-line-strong text-primary-ink focus:ring-focus"
                />
                Send invite email
              </label>
              <div className="flex items-center gap-2">
                <Button
                  type="submit"
                  disabled={addingStudent}
                >
                  {addingStudent ? 'Adding...' : 'Add student'}
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => setShowAddStudent(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>)}</section>
}
