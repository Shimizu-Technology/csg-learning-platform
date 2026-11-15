import { useAuthContext } from '../../contexts/AuthContext'
import ProtectedRoute from '../auth/ProtectedRoute'
import { Layout } from './Layout'
import { LoadingSpinner } from './LoadingSpinner'
import { StatusPage } from './StatusPage'

export function NotFound() { return <StatusPage variant="not-found" /> }

export function NotFoundRoute() {
  const { isLoading, isSignedIn } = useAuthContext()
  if (isLoading) return <LoadingSpinner message="Loading..." />
  return isSignedIn ? <ProtectedRoute><Layout><NotFound /></Layout></ProtectedRoute> : <main className="min-h-dvh bg-surface-page px-4 py-16"><NotFound /></main>
}
