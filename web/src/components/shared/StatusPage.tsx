import { FileQuestion, ShieldAlert } from 'lucide-react'
import { useId } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import { Button, LinkButton } from '../ui/Button'

export function StatusPage({ variant }: { variant: 'not-found' | 'no-access' }) {
  const { user, isSignedIn } = useAuthContext()
  const navigate = useNavigate()
  const titleId = useId()
  const missing = variant === 'not-found'
  const Icon = missing ? FileQuestion : ShieldAlert
  return <section className="app-page max-w-3xl" aria-labelledby={titleId}>
    <div className="rounded-2xl border border-line bg-surface-raised p-6 sm:p-8">
      <Icon className="h-8 w-8 text-ink-secondary" aria-hidden="true" />
      <h1 id={titleId} className="app-title mt-4">{missing ? 'Page not found' : 'No access'}</h1>
      <p className="mt-3 text-ink-secondary">{missing ? 'This page may have moved, or the address may be incorrect.' : 'You can’t open this page with your current account.'}</p>
      <div className="mt-6 flex flex-wrap gap-3">
        <LinkButton to={!missing ? '/dashboard' : isSignedIn ? user?.is_staff ? '/admin' : '/dashboard' : '/'} className="min-h-11">{!missing || isSignedIn ? 'Go to Today' : 'Go to home'}</LinkButton>
        <Button variant="secondary" className="min-h-11" onClick={() => navigate(-1)}>Back</Button>
      </div>
    </div>
  </section>
}
