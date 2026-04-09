import { Navigate, Outlet } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import { LoadingSpinner } from '../shared/LoadingSpinner'

interface ProtectedRouteProps {
  requiredRole?: 'admin' | 'instructor' | 'staff'
  children?: React.ReactNode
}

export default function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { isClerkEnabled, isSignedIn, isLoading, user } = useAuthContext()

  if (!isClerkEnabled) {
    return children ? <>{children}</> : <Outlet />
  }

  if (isLoading) {
    return <LoadingSpinner message="Loading..." fullScreen={false} />
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

  return children ? <>{children}</> : <Outlet />
}
