import { Navigate, useLocation, useParams } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import { cohortPath, type CohortWorkspaceTab } from '../../lib/routes'

/** Preserve bookmarks and notification fragments from the former Manage cohort page. */
export function CohortSettingsEntry() {
  const { user } = useAuthContext()
  const { id } = useParams()
  const location = useLocation()
  if (!id || !/^[1-9]\d*$/.test(id)) return <Navigate to="/admin/cohorts" replace />
  const sections: Record<string, CohortWorkspaceTab> = { students: 'students', recordings: 'recordings', schedule: 'schedule', communication: 'communication', curriculum: 'settings' }
  const requested = sections[location.hash.slice(1)] || 'settings'
  const tab = requested === 'settings' && !user?.is_admin ? 'overview' : requested
  return <Navigate to={`${cohortPath(Number(id), tab)}${tab === 'overview' ? '?settings_notice=1' : ''}${location.hash === '#curriculum' && user?.is_admin ? '#curriculum' : ''}`} state={location.state} replace />
}
