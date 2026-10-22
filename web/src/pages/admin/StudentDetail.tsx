import { useCallback, useState } from 'react'
import { Link, Navigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath } from '../../lib/routes'
import { requireSection, SectionBoundary, useSection } from '../../lib/useSection'
import { useAuthContext } from '../../contexts/AuthContext'
import { AddStudentToCohort, StudentProfileFacts } from '../../components/admin/StudentAccess'
import { Button } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'

// Compatibility entry point: an enrollment is always the operational record.
export function StudentDetail() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const cohortId = Number(params.get('cohort_id'))
  const tab = params.get('legacy') === '1' ? 'access' : 'overview'
  if (Number.isInteger(cohortId) && cohortId > 0)
    return <Navigate to={cohortStudentPath(cohortId, Number(id), tab)} replace state={location.state} />
  return <EnrollmentChooser key={id} studentId={Number(id)} access={tab === 'access'} />
}

function EnrollmentChooser({ studentId, access }: { studentId: number; access: boolean }) {
  const { user: staff } = useAuthContext()
  const location = useLocation()
  const [restoreError, setRestoreError] = useState('')
  const [restoring, setRestoring] = useState(false)
  const student = useSection(
    String(studentId),
    useCallback(async () => requireSection(await api.getUser(studentId)), [studentId])
  )
  const enrollments = student.data?.enrollments || []
  if (student.status === 'success' && enrollments.length === 1)
    return (
      <Navigate
        to={cohortStudentPath(enrollments[0].cohort_id, studentId, access ? 'access' : 'overview')}
        replace
        state={location.state}
      />
    )
  return (
    <div className="app-page space-y-6">
      <Link to="/admin/students" className="app-link inline-flex min-h-11 items-center">
        Students
      </Link>
      <SectionBoundary section={student} label="Student enrollments">
        {student.data && (
          <>
            <header>
              <p className="app-eyebrow">{enrollments.length ? 'Choose an enrollment' : 'No enrollments'}</p>
              <h1 className="app-title mt-2 [overflow-wrap:anywhere]">{student.data.user.full_name}</h1>
              <p className="mt-2 text-sm text-ink-muted">
                {enrollments.length
                  ? 'Choose a cohort to open this student’s progress, support, messages, and access.'
                  : 'This student has no enrollment workspace. Their profile is available below.'}
              </p>
            </header>
            <div className="app-surface mt-5 divide-y divide-line">
              {enrollments.map((enrollment) => (
                <Link
                  key={enrollment.id}
                  to={cohortStudentPath(enrollment.cohort_id, studentId, access ? 'access' : 'overview')}
                  state={location.state}
                  className="flex min-h-20 items-center justify-between gap-3 p-5 hover:bg-surface-sunken"
                >
                  <span className="min-w-0 font-semibold text-ink [overflow-wrap:anywhere]">
                    {enrollment.cohort_name}
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-2">
                    <Badge>{enrollment.status}</Badge>
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </span>
                </Link>
              ))}
            </div>
            {!enrollments.length && (
              <div className="mt-5 space-y-6">
                <StudentProfileFacts user={student.data.user} onSaved={student.retry} />
                {student.data.user.archived_at && (
                  <p className="text-sm text-ink-muted">
                    This account is archived. Restore it before adding an enrollment.
                  </p>
                )}
                {staff?.is_admin &&
                  (student.data.user.archived_at ? (
                    <section className="app-surface space-y-3 p-5">
                      <h2 className="text-lg font-bold text-ink">Add to cohort</h2>
                      <Button
                        disabled={restoring}
                        onClick={async () => {
                          setRestoring(true)
                          setRestoreError('')
                          try {
                            const result = await api.unarchiveUser(studentId)
                            if (result.error) throw new Error(result.error)
                            student.retry()
                          } catch (error) {
                            setRestoreError((error as Error).message)
                          } finally {
                            setRestoring(false)
                          }
                        }}
                      >
                        {restoring ? 'Restoring…' : 'Restore account to add an enrollment'}
                      </Button>
                      {restoreError && (
                        <p role="alert" className="text-sm text-danger-700">
                          {restoreError}
                        </p>
                      )}
                    </section>
                  ) : (
                    <AddStudentToCohort studentId={studentId} />
                  ))}
              </div>
            )}
          </>
        )}
      </SectionBoundary>
    </div>
  )
}
