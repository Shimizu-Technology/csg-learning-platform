import { useAuthContext } from '../../contexts/AuthContext'
import ProtectedRoute from '../auth/ProtectedRoute'
import { PublicFooter, PublicHeader } from '../brand/PublicChrome'
import { LinkButton } from '../ui/Button'
import { Layout } from './Layout'
import { LoadingSpinner } from './LoadingSpinner'
import { StatusPage } from './StatusPage'

export function NotFound() { return <StatusPage variant="not-found" /> }

export function NotFoundRoute() {
  const { isLoading, isSignedIn, accessDenied } = useAuthContext()
  if (isLoading) return <LoadingSpinner message="Loading..." fullScreen />
  if (isSignedIn && !accessDenied) {
    return <ProtectedRoute><Layout><NotFound /></Layout></ProtectedRoute>
  }
  return (
    <div className="flex min-h-svh flex-col bg-brand-cream text-ink">
      <PublicHeader actions={<LinkButton to="/sign-in" variant="quiet" shape="brand" className="px-3 text-ink">Sign in</LinkButton>} />
      <main className="safe-px mx-auto flex w-full max-w-[1200px] flex-1 items-center justify-center py-12">
        <NotFound />
      </main>
      <PublicFooter />
    </div>
  )
}
