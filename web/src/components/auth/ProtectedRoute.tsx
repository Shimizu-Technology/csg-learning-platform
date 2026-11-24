import { NoAccess } from '../shared/NoAccess'
import { brand, PRODUCT_NAME } from '../../lib/brand'
import { useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { Loader2, LogOut, Mail, RefreshCw, WifiOff } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { LoadingSpinner } from '../shared/LoadingSpinner'
import { MessagesLoadingShell } from '../shared/MessagesLoadingShell'
import { EmptyState } from '../shared/EmptyState'
import { AnchorButton, Button } from '../ui/Button'
import { CommunityStandardsGate } from './CommunityStandardsGate'

interface ProtectedRouteProps {
  requiredRole?: 'admin' | 'instructor' | 'staff'
  children?: React.ReactNode
  noAccessElement?: React.ReactNode
}

export default function ProtectedRoute({ children, requiredRole, noAccessElement }: ProtectedRouteProps) {
  const { isSignedIn, isLoading, user, sessionError, accessDenied, syncSession, signOut } = useAuthContext()
  const location = useLocation()
  const [retrying, setRetrying] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  const handleRetry = async () => {
    setRetrying(true)
    try {
      await syncSession()
    } finally {
      setRetrying(false)
    }
  }

  const handleSignOut = async () => {
    if (typeof signOut !== 'function') return
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  if (isLoading) {
    if (location.pathname.startsWith('/messages')) {
      return <MessagesLoadingShell />
    }

    return <LoadingSpinner message="Loading..." fullScreen={false} />
  }

  if (!isSignedIn) {
    return <Navigate to={`/sign-in?${new URLSearchParams({ redirect_url: location.pathname + location.search + location.hash })}`} replace />
  }

  if (accessDenied) {
    return <Navigate to={`/sign-in?${new URLSearchParams({ redirect_url: location.pathname + location.search + location.hash })}`} replace />
  }

  if (!user) {
    return (
      <main className="flex min-h-svh items-center justify-center bg-surface-page px-4">
        <EmptyState
          headingLevel={1}
          icon={WifiOff}
          title="Could not connect to your account"
          description={sessionError || `We could not load your ${brand.schoolAbbreviation} account yet. Check your connection and try again.`}
          action={
            <>
              <Button onClick={() => void handleRetry()} disabled={retrying || signingOut}>
                {retrying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}
                {retrying ? 'Trying...' : 'Try again'}
              </Button>
              <Button variant="secondary" onClick={() => void handleSignOut()} disabled={retrying || signingOut}>
                {signingOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
                {signingOut ? 'Signing out…' : 'Sign out'}
              </Button>
              <AnchorButton
                variant="quiet"
                href={`mailto:${brand.supportEmail}?subject=${encodeURIComponent(`${PRODUCT_NAME} account connection help`)}`}
              >
                <Mail className="h-4 w-4" aria-hidden="true" />
                Contact support
              </AnchorButton>
            </>
          }
        />
      </main>
    )
  }

  if (user.community_policy && !user.community_policy.accepted) {
    return (
      <CommunityStandardsGate
        version={user.community_policy.version}
        accountEmail={user.email}
        onSignOut={handleSignOut}
        onAccepted={syncSession}
      />
    )
  }

  if (requiredRole && user) {
    const hasAccess =
      requiredRole === 'staff' ? user.is_staff :
      requiredRole === 'admin' ? user.is_admin :
      user.role === requiredRole

    if (!hasAccess) {
      return <>{noAccessElement ?? <NoAccess />}</>
    }
  }

  return children ? <>{children}</> : <Outlet />
}
