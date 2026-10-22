import { useCallback, useEffect, useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../../lib/api'
import { cohortStudentPath } from '../../lib/routes'
import { requireSection, SectionBoundary, useSection } from '../../lib/useSection'
import { useAuthContext } from '../../contexts/AuthContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { formatShortDateTime } from '../../lib/format'
import type { CohortDetail, StudentProgressResponse } from '../../types/api'
import { Button } from '../ui/Button'

type StudentProfile = StudentProgressResponse['user']
type Override = { unlocked: boolean; unlock_date_override: string | null }

export function StudentProfileFacts({ user, onSaved }: { user: StudentProfile; onSaved: () => void }) {
  const { user: staff } = useAuthContext()
  const [editing, setEditing] = useState(false)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [github, setGithub] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  return (
    <section className="app-surface p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-ink">Profile</h2>
        {staff?.is_admin && !editing && (
          <Button
            variant="secondary"
            onClick={() => {
              const [first, ...last] = user.full_name.split(' ')
              setFirstName(first)
              setLastName(last.join(' '))
              setGithub(user.github_username || '')
              setEditing(true)
            }}
          >
            Edit profile
          </Button>
        )}
      </div>
      <dl className="mt-4 space-y-3 text-sm">
        <Fact label="Name" value={user.full_name} />
        <Fact label="Email" value={user.email} />
        <Fact label="GitHub" value={user.github_username || 'Not set'} />
        <Fact label="Last sign in" value={formatShortDateTime(user.last_sign_in_at, 'Never')} />
        <Fact label="Last activity" value={formatShortDateTime(user.last_seen_at, 'No activity yet')} />
      </dl>
      {editing && staff?.is_admin && (
        <form
          className="mt-5 grid gap-3 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault()
            setSaving(true)
            setError('')
            try {
              const result = await api.updateUser(user.id, {
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                github_username: github.trim(),
              })
              if (result.error) throw new Error(result.error)
              setEditing(false)
              onSaved()
            } catch (error) {
              setError((error as Error).message)
            } finally {
              setSaving(false)
            }
          }}
        >
          <label htmlFor={`${id}-first`} className="text-sm text-ink-secondary">
            First name
            <input
              id={`${id}-first`}
              className="app-control mt-1 w-full"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </label>
          <label htmlFor={`${id}-last`} className="text-sm text-ink-secondary">
            Last name
            <input
              id={`${id}-last`}
              className="app-control mt-1 w-full"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </label>
          <label htmlFor={`${id}-github`} className="text-sm text-ink-secondary">
            GitHub username
            <input
              id={`${id}-github`}
              className="app-control mt-1 w-full"
              value={github}
              onChange={(e) => setGithub(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-end gap-2">
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : 'Save profile'}
            </Button>
            <Button variant="quiet" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger-700 sm:col-span-2">
              {error}
            </p>
          )}
        </form>
      )}
    </section>
  )
}

export function AddStudentToCohort({ studentId, excluded = [] }: { studentId: number; excluded?: number[] }) {
  const navigate = useNavigate()
  const cohorts = useSection(
    'cohorts',
    useCallback(async () => requireSection(await api.getCohorts()).cohorts, [])
  )
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const id = useId()
  return (
    <SectionBoundary section={cohorts} label="Add to cohort">
      <form
        className="app-surface space-y-3 p-5"
        onSubmit={async (e) => {
          e.preventDefault()
          if (!selected || saving) return
          setSaving(true)
          setError('')
          try {
            const result = await api.createEnrollment(Number(selected), studentId)
            if (result.error) throw new Error(result.error)
            navigate(cohortStudentPath(Number(selected), studentId, 'access'))
          } catch (error) {
            setError((error as Error).message)
          } finally {
            setSaving(false)
          }
        }}
      >
        <h2 className="text-lg font-bold text-ink">Add to cohort</h2>
        <label htmlFor={id} className="block text-sm text-ink-secondary">
          Cohort
        </label>
        <select
          id={id}
          className="app-control w-full"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          required
        >
          <option value="">Choose a cohort</option>
          {cohorts.data
            ?.filter((cohort) => !excluded.includes(cohort.id) && cohort.status !== 'archived')
            .map((cohort) => (
              <option key={cohort.id} value={cohort.id}>
                {cohort.name}
              </option>
            ))}
        </select>
        <Button type="submit" disabled={!selected || saving}>
          {saving ? 'Adding…' : 'Add to cohort'}
        </Button>
        {error && (
          <p role="alert" className="text-sm text-danger-700">
            {error}
          </p>
        )}
      </form>
    </SectionBoundary>
  )
}

export function StudentAccess({
  progress,
  cohort,
  onSaved,
}: {
  progress: StudentProgressResponse
  cohort: CohortDetail
  onSaved: () => void
}) {
  const { user: staff } = useAuthContext()
  const confirm = useConfirm()
  const toast = useToast()
  const navigate = useNavigate()
  const { enrollment, user } = progress
  const catalog = useSection(
    String(cohort.curriculum_id),
    useCallback(
      async () => requireSection(await api.getCurriculum(cohort.curriculum_id)).curriculum.modules,
      [cohort.curriculum_id]
    )
  )
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState(enrollment.status)
  useEffect(() => setStatus(enrollment.status), [enrollment.status])
  const id = useId()
  const canOverride = Boolean(staff?.is_admin || staff?.role === 'instructor')
  const alumni = cohort.cohort_type === 'alumni'
  async function save(action: string, request: () => Promise<{ error: string | null }>, success: string) {
    if (pending) return
    setPending(action)
    setError('')
    setMessage('')
    try {
      const result = await request()
      if (result.error) throw new Error(result.error)
      setMessage(success)
      toast.success(success)
      onSaved()
    } catch (error) {
      setError((error as Error).message)
    } finally {
      setPending(null)
    }
  }
  const assignments = new Map(enrollment.module_assignments.map((item) => [item.module_id, item]))
  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="app-surface p-5 sm:p-6">
          <h2 className="text-lg font-bold text-ink">Enrollment access</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <Fact label="Enrollment status" value={enrollment.status} />
            <Fact label="Cohort status" value={cohort.status} />
            <Fact label="Course access ends" value={formatShortDateTime(enrollment.access_expires_at, 'No expiry')} />
            <Fact
              label="Instructor support ends"
              value={formatShortDateTime(enrollment.support_expires_at, 'No expiry')}
            />
          </dl>
          {staff?.is_admin && (
            <form
              className="mt-5 space-y-3"
              onSubmit={(e) => {
                e.preventDefault()
                void save(
                  'enrollment',
                  () => api.updateEnrollment(enrollment.id, { status }),
                  'Enrollment status saved.'
                )
              }}
            >
              <label htmlFor={`${id}-status`} className="block text-sm font-semibold text-ink-secondary">
                Enrollment status
              </label>
              <select
                id={`${id}-status`}
                className="app-control w-full"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                {['active', 'paused', 'dropped', 'completed'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={Boolean(pending)}>
                Save enrollment
              </Button>
              <Button
                variant="danger"
                disabled={Boolean(pending)}
                onClick={async () => {
                  if (
                    !(await confirm({
                      title: `Remove ${user.full_name} from ${cohort.name}?`,
                      description:
                        'Removing the enrollment is only allowed when its learning and support records can be safely removed. Use Paused or Dropped to retain history.',
                      confirmLabel: 'Remove enrollment',
                      tone: 'danger',
                    }))
                  )
                    return
                  await save(
                    'remove-enrollment',
                    async () => {
                      const result = await api.deleteEnrollment(enrollment.id)
                      if (!result.error) navigate(`/admin/students/${user.id}`, { replace: true })
                      return result
                    },
                    'Enrollment removed.'
                  )
                }}
              >
                Remove enrollment
              </Button>
            </form>
          )}
        </section>
        <StudentProfileFacts user={user} onSaved={onSaved} />
      </div>
      {error && (
        <p role="alert" className="app-surface border-danger-200 p-4 text-sm text-danger-700">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="app-surface p-4 text-sm text-success-700">
          {message}
        </p>
      )}
      {canOverride && (
        <SectionBoundary section={catalog} label="Module and lesson access">
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-bold text-ink">Module and lesson access</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Overrides apply only to this enrollment. Clear a date to use the default schedule.
              </p>
              {alumni && (
                <p className="mt-1 text-sm text-ink-muted">Alumni always have every curriculum module unlocked.</p>
              )}
            </div>
            {catalog.data?.map((mod) => {
              const assignment = assignments.get(mod.id)
              return (
                <section key={mod.id} aria-label={`${mod.name} access`} className="app-surface p-5 sm:p-6">
                  <h3 className="font-bold text-ink">{mod.name}</h3>
                  {assignment ? (
                    <>
                      <p className="mt-1 text-sm text-ink-muted">
                        {assignment.available
                          ? 'Available now'
                          : assignment.next_unlock_date
                            ? `Scheduled ${formatShortDateTime(assignment.next_unlock_date)}`
                            : 'Locked'}
                      </p>
                      {!alumni && (
                        <OverrideForm
                          key={`${assignment.id}:${assignment.unlocked}:${assignment.unlock_date_override}`}
                          label="module"
                          value={assignment}
                          disabled={Boolean(pending)}
                          onSave={(value) =>
                            save(
                              `module-${mod.id}`,
                              () => api.updateModuleAssignment(assignment.id, value),
                              `Saved access for ${mod.name}.`
                            )
                          }
                          onRemove={async () => {
                            if (
                              await confirm({
                                title: `Remove ${mod.name}?`,
                                description:
                                  'Remove this module assignment for this enrollment. Saved learning evidence remains available in Learning.',
                                confirmLabel: 'Remove module',
                                tone: 'danger',
                              })
                            )
                              await save(
                                `remove-${mod.id}`,
                                () => api.deleteModuleAssignment(assignment.id),
                                `Removed ${mod.name}.`
                              )
                          }}
                        />
                      )}
                    </>
                  ) : (
                    <div className="mt-3">
                      <Button
                        variant="secondary"
                        disabled={Boolean(pending)}
                        onClick={() =>
                          void save(
                            `assign-${mod.id}`,
                            () => api.createModuleAssignment(enrollment.id, { module_id: mod.id, unlocked: false }),
                            `Assigned ${mod.name}.`
                          )
                        }
                      >
                        Assign module
                      </Button>
                    </div>
                  )}
                  <details className="mt-4 border-t border-line pt-3">
                    <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-ink-secondary">
                      Lesson overrides · {mod.lessons.length}
                    </summary>
                    <div className="space-y-4">
                      {mod.lessons.map((lesson) => {
                        const current = progress.modules
                          .flatMap((item) => item.lessons)
                          .find((item) => item.id === lesson.id)?.lesson_assignment
                        return (
                          <section
                            key={lesson.id}
                            aria-label={`${lesson.title} access`}
                            className="rounded-xl border border-line p-4"
                          >
                            <h4 className="font-semibold text-ink">{lesson.title}</h4>
                            <OverrideForm
                              key={`${lesson.id}:${current?.id}:${current?.unlocked}:${current?.unlock_date_override}`}
                              label="lesson"
                              value={current || { unlocked: false, unlock_date_override: null }}
                              disabled={Boolean(pending)}
                              onSave={(value) =>
                                save(
                                  `lesson-${lesson.id}`,
                                  () =>
                                    current
                                      ? api.updateLessonAssignment(current.id, value)
                                      : api.createLessonAssignment(enrollment.id, { lesson_id: lesson.id, ...value }),
                                  `Saved override for ${lesson.title}.`
                                )
                              }
                              onRemove={
                                current
                                  ? () =>
                                      save(
                                        `clear-${lesson.id}`,
                                        () => api.deleteLessonAssignment(current.id),
                                        `Cleared override for ${lesson.title}.`
                                      )
                                  : undefined
                              }
                            />
                          </section>
                        )
                      })}
                    </div>
                  </details>
                </section>
              )
            })}
            {catalog.data?.length === 0 && (
              <p className="app-surface p-5 text-sm text-ink-muted">No curriculum modules are available.</p>
            )}
          </section>
        </SectionBoundary>
      )}
      {staff?.is_admin && (
        <>
          <AddStudentToCohort studentId={user.id} excluded={[cohort.id]} />
          <section className="app-surface p-5 sm:p-6">
            <h2 className="text-lg font-bold text-ink">Restart class progress</h2>
            <p className="mt-2 text-sm leading-6 text-ink-secondary">
              Clear this enrollment's learning progress and start an audited recovery plan with an owned intervention
              and weekly follow-up. Messages, identity, and other enrollments remain intact.
            </p>
            <Button
              variant="danger"
              className="mt-4"
              disabled={Boolean(pending)}
              onClick={async () => {
                if (
                  !(await confirm({
                    title: `Restart ${user.full_name}'s class progress?`,
                    description: `This clears submissions, lesson and recording progress, and student-specific lesson overrides for ${cohort.name}. A recovery snapshot, owned intervention, weekly follow-up, and recovery plan are created automatically.`,
                    confirmLabel: 'Restart class progress',
                    tone: 'danger',
                    confirmationText: user.email,
                    confirmationLabel: `Type ${user.email} to confirm`,
                  }))
                )
                  return
                await save(
                  'restart',
                  () => api.restartEnrollment(enrollment.id, user.email, 'Restarted from student workspace Access'),
                  'Class progress restarted. Recovery plan and weekly follow-up are ready in Support.'
                )
              }}
            >
              {pending === 'restart' ? 'Restarting…' : 'Restart class progress'}
            </Button>
          </section>
        </>
      )}
    </div>
  )
}

function OverrideForm({
  label,
  value,
  disabled,
  onSave,
  onRemove,
}: {
  label: 'module' | 'lesson'
  value: Override
  disabled: boolean
  onSave: (value: Override) => Promise<void>
  onRemove?: () => Promise<void>
}) {
  const [unlocked, setUnlocked] = useState(value.unlocked)
  const [date, setDate] = useState(value.unlock_date_override?.slice(0, 10) || '')
  const id = useId()
  return (
    <form
      className="mt-3 space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        void onSave({ unlocked, unlock_date_override: date || null })
      }}
    >
      <label className="flex min-h-11 items-center gap-2 text-sm text-ink-secondary">
        <input
          type="checkbox"
          checked={unlocked}
          disabled={disabled}
          onChange={(event) => setUnlocked(event.target.checked)}
          className="h-4 w-4"
        />
        Force unlock this {label}
      </label>
      <label htmlFor={id} className="block text-sm font-semibold text-ink-secondary">
        {label === 'module' ? 'Module' : 'Lesson'} unlock date override
      </label>
      <input
        id={id}
        type="date"
        className="app-control w-full sm:max-w-xs"
        value={date}
        disabled={disabled}
        onChange={(event) => setDate(event.target.value)}
      />
      <Button variant="quiet" disabled={disabled || !date} onClick={() => setDate('')}>
        Use default date
      </Button>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={disabled}>
          Save {label === 'module' ? 'access' : 'lesson override'}
        </Button>
        {onRemove && (
          <Button variant="danger" disabled={disabled} onClick={() => void onRemove()}>
            {label === 'module' ? 'Remove module' : 'Clear lesson override'}
          </Button>
        )}
      </div>
    </form>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="font-semibold text-ink-secondary [overflow-wrap:anywhere]">{value}</dd>
    </div>
  )
}
