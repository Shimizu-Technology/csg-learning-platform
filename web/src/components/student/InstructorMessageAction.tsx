import { useContext, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { brand } from '../../lib/brand'
import { useCohortContext } from '../../contexts/CohortContext'
import { PreviewNavigationContext } from '../../contexts/PreviewNavigationContext'
import { PersonActions } from './PersonActions'

/** Resolve support and bidirectional block permissions before offering a DM. */
export function InstructorMessageAction() {
  const { selectedCohortId, selectedCohort } = useCohortContext()
  return <ScopedInstructorAction key={selectedCohortId} cohortId={selectedCohortId} courseName={selectedCohort?.name} />
}

function ScopedInstructorAction({ cohortId, courseName }: { cohortId: number | null; courseName?: string }) {
  const preview = useContext(PreviewNavigationContext)
  const [person, setPerson] = useState<{ id: number; full_name: string; role?: string } | null>(null)
  const [empty, setEmpty] = useState(false)
  const [error, setError] = useState(false)
  useEffect(() => {
    if (!cohortId || preview) return
    let active = true
    void Promise.all([api.getDashboard(cohortId), api.getAvailableDirectUsersForCohort(cohortId)]).then(([response, directory]) => {
      if (!active) return
      const dashboard = response.data?.dashboard
      if (!dashboard || response.fromCache || !directory.data || directory.fromCache) { setError(true); return }
      if (dashboard.capabilities?.support_mode === 'none' || dashboard.capabilities?.features?.help_requests !== true) return
      const id = dashboard.support_instructor_id
      if (!id) { setEmpty(true); return }
      setPerson(directory.data.users.find(user => user.id === id) ?? null)
    }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [cohortId, preview])
  if (preview) return <p className="text-sm text-ink-muted">Messaging is unavailable in View as student.</p>
  if (error) return <p role="alert" className="text-sm text-ink-muted">Couldn’t check your course instructor. Reload to try again.</p>
  if (empty) return <p className="text-sm text-ink-muted">No instructor is assigned to {courseName || 'this course'} yet. Contact {brand.schoolName} ({brand.supportEmail}) to arrange help.</p>
  return person && cohortId ? <PersonActions person={person} cohortId={cohortId} /> : null
}
