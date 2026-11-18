import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../lib/api'
import { Button } from '../../components/ui/Button'

export function GithubIdentityCallback() {
  const [params] = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [login, setLogin] = useState('')
  const [message, setMessage] = useState('')
  const issue = params.get('error') ? 'GitHub authorization was declined. Return to your profile and connect again.' : !params.get('state') || !params.get('code') ? 'This authorization link is incomplete. Return to your profile and connect again.' : ''
  return <section className="app-surface mx-auto max-w-xl space-y-4 p-6">
    <h1 className="text-xl font-bold">Connect GitHub</h1>
    <p className="text-sm text-ink-secondary">Confirm the GitHub account you just authorized. Reconnecting requires repository verification again.</p>
    {!login && <Button disabled={busy || Boolean(issue)} onClick={async () => {
      setBusy(true); setMessage('')
      try {
        const result = await api.completeGithubIdentity({ state: params.get('state') || '', code: params.get('code') || '' })
        if (!result.data) throw new Error(result.status === 404 ? 'Authorization expired or belongs to another account. Return to your profile and connect again.' : result.error || 'Could not connect GitHub. Return to your profile and try again.')
        setLogin(result.data.github_identity.login || '')
      } catch (error) { setMessage((error as Error).message) }
      finally { setBusy(false) }
    }}>{busy ? 'Connecting…' : 'Confirm GitHub identity'}</Button>}
    {login && <p role="status" className="text-success-ink">GitHub connected as {login}. Return to your profile to verify your repository.</p>}
    {issue && <p role="alert" className="text-danger-ink">{issue}</p>}
    {message && <p role="alert" className="text-danger-ink">{message}</p>}
    <Link className="app-link inline-flex min-h-11 items-center" to="/profile">Return to profile</Link>
  </section>
}
