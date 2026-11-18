import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { components } from '../../types/api.generated'
import { Button } from '../ui/Button'
import { formatShortDateTime } from '../../lib/format'

type Data = components['schemas']['GithubRepositoryBindingsResponse']

export function GithubRepositorySettings({ enrollmentId, title = 'GitHub repository', onReconnectAvailabilityChange }: { enrollmentId: number; title?: string; onReconnectAvailabilityChange?: (enrollmentId: number, available: boolean) => void }) {
  const [data, setData] = useState<Data | null>(null)
  const [name, setName] = useState('')
  const [installation, setInstallation] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const requestVersion = useRef(0)
  const load = useCallback(async () => {
    const version = ++requestVersion.current
    try {
      const result = await api.getGithubRepositoryBindings(enrollmentId)
      if (version !== requestVersion.current) return
      if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Current repository status is unavailable. Reload to confirm it.')
      setData(result.data)
      setLoadError('')
      setInstallation(value => value || String(result.data!.installations[0]?.id || ''))
    } catch (error) { if (version === requestVersion.current) setLoadError((error as Error).message) }
  }, [enrollmentId])
  useEffect(() => {
    setData(null); setLoadError(''); setInstallation(''); setModuleId(''); setName(''); setBusy(false)
    void load()
    return () => { requestVersion.current += 1 }
  }, [load])
  useEffect(() => {
    onReconnectAvailabilityChange?.(enrollmentId, Boolean(data?.can_connect_github && data.github_identity.id && !loadError))
    return () => onReconnectAvailabilityChange?.(enrollmentId, false)
  }, [data, enrollmentId, loadError, onReconnectAvailabilityChange])
  return <section className="app-surface space-y-4 p-5 sm:p-6" aria-label={title}>
    <h2 className="text-lg font-bold">{title}</h2>
    <p className="text-sm text-ink-secondary">Connect GitHub to prove the learner’s identity. Use an original personal repository and an installation for that account. Forks and organization repositories are not accepted.</p>
    <Button variant="secondary" disabled={busy} onClick={() => void load()}>Reload repositories</Button>
    {loadError && <p role="alert" className="text-sm text-danger-ink">{loadError} {data ? 'Displayed bindings are the last confirmed state. Reload to confirm current status.' : 'Reload repositories to try again.'}</p>}
    {data && <>
      {data.github_identity.id ? <p className="text-sm text-success-ink">GitHub identity verified: <strong>{data.github_identity.login}</strong></p> : <p className="text-sm text-ink-secondary">The learner must connect GitHub from their profile before a repository can be verified.</p>}
      {data.can_connect_github && <Button variant="secondary" disabled={busy || Boolean(loadError)} onClick={async () => {
        setBusy(true); setMessage('')
        try {
          const result = await api.prepareGithubIdentity(enrollmentId)
          if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Could not start GitHub authorization. Try again.')
          window.location.assign(result.data.authorization_url)
        } catch (error) { setMessage((error as Error).message); setBusy(false) }
      }}>{data.github_identity.id ? 'Reconnect GitHub' : 'Connect GitHub'}</Button>}

      <ul className="space-y-3">{data.bindings.map(binding => <li key={binding.id} className="space-y-2 rounded-xl border border-line p-4">
        <p className="break-all font-semibold">{binding.full_name}</p>
        <p className="text-sm text-ink-secondary">{binding.curriculum_module_id ? data.modules.find(mod => mod.id === binding.curriculum_module_id)?.name || 'Module' : 'Enrollment default'} · <strong className={binding.verification_state === 'verified' ? 'text-success-ink' : binding.verification_state === 'failed' ? 'text-danger-ink' : ''}>{binding.verification_state === 'verified' ? 'Verified' : binding.verification_state === 'failed' ? 'Failed' : 'Pending verification'}</strong></p>
        {binding.failure_reason && <p className="text-sm text-danger-ink">{binding.failure_reason}</p>}
        {binding.verified_at && <p className="text-xs text-ink-secondary">Verified {formatShortDateTime(binding.verified_at)} · Repository {binding.repository_id}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={busy} onClick={async () => {
            requestVersion.current += 1
            setBusy(true); setMessage('')
            try {
              const result = await api.verifyGithubRepositoryBinding(enrollmentId, binding.id)
              if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Could not verify. Your saved repository is preserved; try again.')
              const updated = result.data.binding
              setData(current => current && { ...current, bindings: current.bindings.map(row => row.id === updated.id ? updated : row) })
              setMessage(updated.verification_state === 'verified' ? 'Repository verified.' : updated.failure_reason || 'Verification failed. Check access and try again.')
            } catch (error) { setMessage((error as Error).message) }
            finally { setBusy(false) }
          }}>{busy ? 'Checking…' : 'Verify repository'}</Button>
          <Button variant="quiet" disabled={busy} onClick={() => { setName(binding.full_name); setModuleId(String(binding.curriculum_module_id || '')); setInstallation(String(binding.github_app_installation_id)); setMessage('Edit the repository below, then save and verify again.') }}>Edit repository</Button>
        </div>
      </li>)}</ul>
      {!data.installations.length ? <p className="text-sm text-ink-secondary">After connecting GitHub, ask an administrator to connect your personal GitHub installation for this cohort.</p> : <form className="space-y-3 border-t border-line pt-4" onSubmit={async event => {
        event.preventDefault(); requestVersion.current += 1; setBusy(true); setMessage('')
        try {
          const result = await api.saveGithubRepositoryBinding(enrollmentId, { full_name: name.trim(), github_app_installation_id: Number(installation), curriculum_module_id: moduleId ? Number(moduleId) : null })
          if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Could not save. Your entries are preserved; try again.')
          const saved = result.data.binding
          setData(current => current && { ...current, bindings: current.bindings.some(row => row.id === saved.id) ? current.bindings.map(row => row.id === saved.id ? saved : row) : [...current.bindings, saved] })
          setMessage('Repository saved. Verify access before syncing.'); await load()
        } catch (error) { setMessage((error as Error).message) }
        finally { setBusy(false) }
      }}>
        <label className="block text-sm font-semibold">Repository (owner/name)<input className="app-control mt-1 w-full text-base" required maxLength={140} placeholder="your-username/prework-exercises" value={name} onChange={event => setName(event.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">GitHub installation<select className="app-control mt-1 w-full text-base" required value={installation} onChange={event => setInstallation(event.target.value)}>{data.installations.map(row => <option key={row.id} value={row.id}>{row.account_login}{row.connection_state === 'failed' ? ' (reconnect required)' : ''}</option>)}</select></label>
          <label className="block text-sm font-semibold">Repository scope<select className="app-control mt-1 w-full text-base" value={moduleId} onChange={event => setModuleId(event.target.value)}><option value="">Enrollment default</option>{data.modules.map(mod => <option key={mod.id} value={mod.id}>{mod.name}</option>)}</select></label>
        </div>
        <p className="text-xs text-ink-secondary">A module repository overrides the enrollment default for that module. Saving resets verification.</p>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save repository'}</Button>
      </form>}
    </>}
    {message && <p role="status" className="text-sm text-ink-secondary">{message}</p>}
  </section>
}
