import { ShieldAlert } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button, LinkButton } from '../ui/Button'

/** Same response for missing and restricted records; never disclose record details. */
export function NoAccess() {
  const navigate = useNavigate()
  return (
    <section className="app-page max-w-3xl" aria-labelledby="no-access-title">
      <div className="rounded-2xl border border-line bg-surface-raised p-6 sm:p-8">
        <ShieldAlert className="h-8 w-8 text-ink-secondary" aria-hidden="true" />
        <h1 id="no-access-title" className="app-title mt-4">No access</h1>
        <p className="mt-3 text-ink-secondary">You can’t open this page with your current account.</p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton to="/dashboard" className="min-h-11">Go to Today</LinkButton>
          <Button variant="secondary" className="min-h-11" onClick={() => navigate(-1)}>Back</Button>
        </div>
      </div>
    </section>
  )
}
