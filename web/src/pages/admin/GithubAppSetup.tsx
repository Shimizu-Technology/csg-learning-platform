import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { useAuthContext } from '../../contexts/AuthContext'
import { Button } from '../../components/ui/Button'
import { cohortPath } from '../../lib/routes'

export function GithubAppSetup() {
  const { user } = useAuthContext()
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [cohortId, setCohortId] = useState<number | null>(null)
  const validInstallation = /^[1-9][0-9]*$/.test(params.get('installation_id') || '')
  const setupIssue = !params.get('state') ? 'This setup link is incomplete. Start again from cohort settings.' : !validInstallation ? 'GitHub has not supplied an installation ID. Ask the account owner to approve access, then prepare setup again in cohort settings.' : ''
  if (!user?.is_admin) return <p>Connection setup is available to administrators.</p>
  return <section className="app-surface mx-auto max-w-xl space-y-4 p-6">
    <h1 className="text-xl font-bold">Confirm GitHub installation</h1>
    <p className="text-sm text-ink-secondary">Confirm this installation for the cohort where you started setup. Repository bindings still need separate verification.</p>
    {!cohortId && <Button disabled={busy || Boolean(setupIssue)} onClick={async () => {
      setBusy(true); setMessage('')
      try {
        const result = await api.completeGithubAppSetup({ state: params.get('state') || '', installation_id: Number(params.get('installation_id')) })
        if (!result.data) throw new Error(result.status === 404 ? 'Setup expired or is unavailable to this account. Return to cohort settings and prepare again.' : result.error || 'Could not connect. Return to cohort settings and prepare again.')
        setCohortId(result.data.cohort_id); setMessage('Installation connected.')
      } catch (error) { setMessage((error as Error).message) }
      finally { setBusy(false) }
    }}>{busy ? 'Connecting…' : 'Confirm connection'}</Button>}
    {setupIssue && <p role="alert" className="text-sm text-danger-ink">{setupIssue}</p>}
    {!cohortId && <Link className="app-link inline-flex min-h-11 items-center" to="/admin/cohorts">Return to cohorts</Link>}
    {message && <p role="status">{message}</p>}
    {cohortId && <Link className="app-link inline-flex min-h-11 items-center" to={cohortPath(cohortId, 'settings')}>Return to cohort settings</Link>}
  </section>
}
