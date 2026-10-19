import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { MessagesLoadingShell } from '../shared/MessagesLoadingShell'
import { EmptyState } from '../shared/EmptyState'
import { Button } from '../ui/Button'
import { CommunityStandardsGate } from './CommunityStandardsGate'

interface ProtectedRouteProps {
  requiredRole?: 'admin' | 'instructor' | 'staff'
  children?: React.ReactNode
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { isSignedIn, isLoading, user, sessionError, accessDenied, syncSession } = useAuthContext()
  const location = useLocation()
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await syncSession()
    } finally {
      setRetrying(false)
    }
  }

  if (isLoading) {
    if (location.pathname.startsWith('/messages')) {
      return <MessagesLoadingShell />
    }

    return <LoadingSpinner message="Loading..." fullScreen={false} />
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />
  }

  if (accessDenied) {
    return <Navigate to="/sign-in" replace />
  }

  if (!user) {
    return (
      <EmptyState
        icon={WifiOff}
        title="Could not connect to your account"
        description={sessionError || 'We could not load your CSG account yet. Check your connection and try again.'}
        action={
          <Button onClick={() => void handleRetry()} disabled={retrying}>
            {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
            {retrying ? 'Trying...' : 'Try again'}
          </Button>
        }
      />
    )
  }

  if (user.community_policy && !user.community_policy.accepted) {
    return <CommunityStandardsGate version={user.community_policy.version} onAccepted={syncSession} />
  }

  if (requiredRole && user) {
    const hasAccess =
      requiredRole === 'staff' ? user.is_staff :
      requiredRole === 'admin' ? user.is_admin :
      user.role === requiredRole

    if (!hasAccess) {
      return <Navigate to="/dashboard" replace />
    }
  }

  return children ? <>{children}</> : <Outlet />
}
