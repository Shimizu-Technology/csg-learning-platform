import { useCallback, useEffect, useRef, useState } from 'react'
import { Github } from 'lucide-react'
import { api } from '../../lib/api'
import type { components } from '../../types/api.generated'
import { Button } from '../ui/Button'

type Data = components['schemas']['GithubAppInstallationsResponse']

export function GithubAppSettings({ cohortId }: { cohortId: number }) {
  const [data, setData] = useState<Data | null>(null)
  const [installationId, setInstallationId] = useState('')
  const [setup, setSetup] = useState<components['schemas']['GithubAppPrepareResponse'] | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const requestVersion = useRef(0)
  const load = useCallback(async () => {
    const version = ++requestVersion.current
    try {
      const result = await api.getGithubAppInstallations(cohortId)
      if (version !== requestVersion.current) return
      if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Current connection status is unavailable.')
      setData(result.data); setLoadError('')
    } catch (error) { if (version === requestVersion.current) setLoadError((error as Error).message) }
  }, [cohortId])
  useEffect(() => { setData(null); void load(); return () => { requestVersion.current += 1 } }, [load])
  async function prepare() {
    setBusy(true); setMessage('')
    try {
      const result = await api.prepareGithubAppInstallation(cohortId)
      if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Could not prepare the connection. Try again.')
      setSetup(result.data)
    } catch (error) { setMessage((error as Error).message) }
    finally { setBusy(false) }
  }
  return <section className="app-surface space-y-4 p-5" aria-label="GitHub App connection">
    <h2 className="flex items-center gap-2 text-lg font-bold"><Github className="h-5 w-5" aria-hidden="true" />GitHub App connection</h2>
    <p className="text-sm text-ink-secondary">Connect installations that can read learners’ personal repositories. Learners must verify their own repository before staff can sync it.</p>
    <Button variant="secondary" disabled={busy} onClick={() => void load()}>Reload connections</Button>
    {loadError && <p role="alert" className="text-sm text-danger-ink">{loadError} Reload connections to confirm current status.</p>}
    {data && <>
      {!data.configured && <p className="text-sm text-ink-secondary">GitHub App setup is awaiting deployment configuration. Ask your administrator to finish setup.</p>}
      <ul className="space-y-3">{data.installations.map(row => <li key={row.id} className="rounded-xl border border-line p-3 text-sm">
        <p className="break-words font-semibold">{row.account_login} · {row.connection_state === 'connected' ? 'Connected' : 'Reconnect required'}</p>
        <p className="text-ink-secondary">App {row.app_id} · Installation {row.installation_id} · {row.repository_selection === 'selected' ? 'Selected repositories' : 'All repositories'}</p>
        {row.failure_reason && <p className="mt-1 text-danger-ink">{row.failure_reason}</p>}
      </li>)}</ul>
      {!data.installations.length && <p className="text-sm text-ink-secondary">No installations connected yet.</p>}
      <Button variant="secondary" disabled={busy || !data.configured} onClick={() => void prepare()}>{busy ? 'Preparing…' : 'Prepare installation'}</Button>
      {setup && <div className="space-y-3 rounded-xl border border-line p-4">
        <a className="app-link inline-flex min-h-11 items-center" href={setup.installation_url} target="_blank" rel="noreferrer">Choose repositories on GitHub</a>
        <p className="text-sm text-ink-secondary">Return here to confirm the installation ID, or follow GitHub’s setup redirect. Complete setup within 15 minutes; prepare again if it expires.</p>
        <form className="space-y-3" onSubmit={async event => {
          event.preventDefault(); requestVersion.current += 1; setBusy(true); setMessage('')
          try {
            const result = await api.connectGithubAppInstallation(cohortId, { state: setup.state, installation_id: Number(installationId) })
            if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Could not connect. Prepare setup again and retry.')
            const saved = result.data.installation
            setData(current => current && { ...current, installations: current.installations.some(row => row.id === saved.id) ? current.installations.map(row => row.id === saved.id ? saved : row) : [...current.installations, saved] })
            setMessage('Installation connected. Repository verification is now available.'); setInstallationId(''); setSetup(null); await load()
          } catch (error) { setMessage((error as Error).message) }
          finally { setBusy(false) }
        }}>
          <label className="block text-sm font-semibold">Installation ID<input className="app-control mt-1 w-full text-base" inputMode="numeric" pattern="[1-9][0-9]*" required value={installationId} onChange={event => setInstallationId(event.target.value)} /></label>
          <Button type="submit" disabled={busy}>{busy ? 'Connecting…' : 'Confirm installation'}</Button>
        </form>
      </div>}
    </>}
    {message && <p role="status" className="text-sm text-ink-secondary">{message}</p>}
  </section>
}
