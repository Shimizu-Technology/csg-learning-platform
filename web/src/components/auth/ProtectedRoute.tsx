import { Navigate } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import { LoadingSpinner } from '../shared/LoadingSpinner'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: 'admin' | 'instructor' | 'staff'
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { isClerkEnabled, isSignedIn, isLoading, user } = useAuthContext()

  if (!isClerkEnabled) {
    return <>{children}</>
  }

  if (isLoading) {
    return <LoadingSpinner message="Loading..." />
  }

  if (!isSignedIn) {
    return <Navigate to="/sign-in" replace />
  }

  if (requiredRole && user) {
    const hasAccess =
      requiredRole === 'staff' ? user.is_staff :
      requiredRole === 'admin' ? user.is_admin :
      user.role === requiredRole

    if (!hasAccess) {
      return <Navigate to="/" replace />
    }
  }

  return <>{children}</>
}
