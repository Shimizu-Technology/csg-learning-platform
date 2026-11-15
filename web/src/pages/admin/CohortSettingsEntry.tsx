import { type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import { cohortPath } from '../../lib/routes'

// The workspace API checks instructor assignment before exposing teaching tools.
export function CohortSettingsEntry({ children }: { children: ReactNode }) {
  const { user } = useAuthContext()
  const { id } = useParams()
  if (user?.is_admin) return children
  if (!id || !/^[1-9]\d*$/.test(id)) return <Navigate to="/admin/cohorts" replace />
  return <Navigate to={`${cohortPath(Number(id), 'recordings')}&settings_notice=1`} replace />
}
