import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2, RefreshCw, WifiOff } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { MessagesLoadingShell } from '../shared/MessagesLoadingShell'
import { EmptyState } from '../shared/EmptyState'

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
          <button
            type="button"
            onClick={() => void handleRetry()}
            disabled={retrying}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {retrying ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {retrying ? 'Trying...' : 'Try again'}
          </button>
        }
      />
    )
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
