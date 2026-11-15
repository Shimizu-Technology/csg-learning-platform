import { Link } from 'react-router-dom'
import { FileQuestion } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { Layout } from './Layout'
import { LoadingSpinner } from './LoadingSpinner'

export function NotFound() {
  const { user, isSignedIn } = useAuthContext()
  return <section className="mx-auto max-w-xl rounded-2xl border border-line bg-surface-raised p-6 sm:p-10">
    <FileQuestion className="mb-4 h-8 w-8 text-ink-muted" aria-hidden="true" />
    <h1 className="app-title">Page not found</h1>
    <p className="mt-3 text-ink-secondary">This page may have moved, or the address may be incorrect.</p>
    <Link to={isSignedIn ? user?.is_staff ? '/admin' : '/dashboard' : '/'} className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-ruby-600 px-4 font-semibold text-white">{isSignedIn ? 'Go to Today' : 'Go to home'}</Link>
  </section>
}

export function NotFoundRoute() {
  const { isLoading, isSignedIn } = useAuthContext()
  if (isLoading) return <LoadingSpinner message="Loading..." />
  return isSignedIn ? <Layout><NotFound /></Layout> : <main className="min-h-dvh bg-surface-page px-4 py-16"><NotFound /></main>
}
