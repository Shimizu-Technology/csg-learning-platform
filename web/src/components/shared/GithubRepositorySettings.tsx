import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { components } from '../../types/api.generated'
import { Button } from '../ui/Button'
import { formatShortDateTime } from '../../lib/format'

type Data = components['schemas']['GithubRepositoryBindingsResponse']

export function GithubRepositorySettings({ enrollmentId, title = 'GitHub repository', studentCohortId, onReconnectAvailabilityChange }: { enrollmentId: number; title?: string; studentCohortId?: number; onReconnectAvailabilityChange?: (enrollmentId: number, available: boolean) => void }) {
  const student = studentCohortId !== undefined
  const [data, setData] = useState<Data | null>(null)
  const [name, setName] = useState('')
  const [installation, setInstallation] = useState('')
  const [moduleId, setModuleId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [loadError, setLoadError] = useState('')
  const [checking, setChecking] = useState(true)
  const requestVersion = useRef(0)
  const nameInput = useRef<HTMLInputElement>(null)
  const load = useCallback(async () => {
    const version = ++requestVersion.current
    setChecking(true)
    try {
      const result = await api.getGithubRepositoryBindings(enrollmentId)
      if (version !== requestVersion.current) return
      if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Current repository status is unavailable. Reload to confirm it.')
      setData(result.data)
      setLoadError('')
      const choices = result.data.installations.filter(row => !student || row.connection_state === 'connected')
      setInstallation(value => choices.some(row => String(row.id) === value) ? value : String(choices[0]?.id || ''))
    } catch (error) {
      if (version === requestVersion.current) setLoadError(student
        ? 'Could not check your GitHub setup. Check your connection and try again. If the problem continues, ask your instructor for help.'
        : (error as Error).message)
    } finally {
      if (version === requestVersion.current) setChecking(false)
    }
  }, [enrollmentId, student])
  useEffect(() => {
    setData(null); setLoadError(''); setInstallation(''); setModuleId(''); setName(''); setBusy(false)
    void load()
    return () => { requestVersion.current += 1 }
  }, [load])
  useEffect(() => {
    onReconnectAvailabilityChange?.(enrollmentId, Boolean(data?.can_connect_github && data.github_identity.id && !loadError && !checking))
    return () => onReconnectAvailabilityChange?.(enrollmentId, false)
  }, [data, enrollmentId, loadError, checking, onReconnectAvailabilityChange])
  const installations = data?.installations.filter(row => !student || row.connection_state === 'connected') ?? []
  return <section id={student ? `github-repository-${studentCohortId}` : undefined} className="app-surface scroll-mt-24 space-y-4 p-5 sm:p-6" aria-label={title}>
    <h2 className="text-lg font-bold">{title}</h2>
    {student ? <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-secondary">
      <li>Connect your personal GitHub account.</li>
      <li>Choose an original repository from your personal account. Forks aren’t accepted.</li>
      <li>Make sure Learn has access to that repository on GitHub, then save it here and select Verify repository.</li>
    </ol> : <p className="text-sm text-ink-secondary">Connect GitHub to prove the learner’s identity. Use an original personal repository and an installation for that account. Forks and organization repositories are not accepted.</p>}
    <Button variant="secondary" disabled={busy || (student && checking)} onClick={() => { if (student) setMessage(''); void load() }}>{student && loadError ? 'Try again' : 'Reload repositories'}</Button>
    {student && checking && <p role="status" className="text-sm text-ink-secondary">Checking your GitHub setup…</p>}
    {loadError && <p role="alert" className="text-sm text-danger-ink">{loadError} {!student && (data ? 'Displayed bindings are the last confirmed state. Reload to confirm current status.' : 'Reload repositories to try again.')}</p>}
    {data && (!student || (!loadError && !checking)) && <>
      {data.github_identity.id ? <p className="text-sm text-success-ink">{student ? 'Connected as' : 'GitHub identity verified:'} <strong>{data.github_identity.login}</strong></p> : <p className="text-sm text-ink-secondary">{student ? 'Connect GitHub to get started.' : 'The learner must connect GitHub from their profile before a repository can be verified.'}</p>}
      {data.can_connect_github && <Button variant="secondary" disabled={busy || Boolean(loadError)} onClick={async () => {
        setBusy(true); setMessage('')
        try {
          const result = await api.prepareGithubIdentity(enrollmentId)
          if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Could not start GitHub authorization. Try again.')
          window.location.assign(result.data.authorization_url)
        } catch (error) { setMessage(student ? 'Could not start the GitHub connection. Check your connection and try again.' : (error as Error).message); setBusy(false) }
      }}>{data.github_identity.id ? 'Reconnect GitHub' : 'Connect GitHub'}</Button>}
      {student && !data.can_connect_github && <p className="text-sm text-ink-secondary">Connecting to GitHub is currently unavailable for this course. Ask your instructor for help if you need to connect or change your account.</p>}

      <ul className="space-y-3">{data.bindings.map(binding => {
        const canVerify = !student || Boolean(data.github_identity.id && installations.some(row => row.id === binding.github_app_installation_id))
        const verified = binding.verification_state === 'verified' && canVerify && (!student || Boolean(binding.verified_at && binding.repository_id))
        return <li key={binding.id} className="space-y-2 rounded-xl border border-line p-4">
          <p className="break-all font-semibold">{binding.full_name}</p>
          <p className="text-sm text-ink-secondary">{binding.curriculum_module_id ? data.modules.find(mod => mod.id === binding.curriculum_module_id)?.name || 'Module' : student ? 'Default for this course' : 'Enrollment default'} · <strong className={verified ? 'text-success-ink' : binding.verification_state === 'failed' ? 'text-danger-ink' : ''}>{verified ? 'Verified' : student ? 'Needs verification' : binding.verification_state === 'failed' ? 'Failed' : 'Pending verification'}</strong></p>
          {student ? (!verified && <p className="text-sm text-ink-secondary">{!canVerify
            ? 'Ask your instructor to help restore Learn’s access to this repository, then reload repositories.'
            : binding.verification_state === 'failed'
              ? 'Check the repository name, make sure it’s an original repository you own, and confirm that Learn has access on GitHub. Then verify again.'
              : 'Verify access before Learn can sync your work.'}</p>)
            : binding.failure_reason && <p className="text-sm text-danger-ink">{binding.failure_reason}</p>}
          {verified && binding.verified_at && <p className="text-xs text-ink-secondary">Verified {formatShortDateTime(binding.verified_at)}{!student && ` · Repository ${binding.repository_id}`}</p>}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" disabled={busy || !canVerify} onClick={async () => {
              requestVersion.current += 1
              setBusy(true); setMessage('')
              try {
                const result = await api.verifyGithubRepositoryBinding(enrollmentId, binding.id)
                if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Could not verify. Your saved repository is preserved; try again.')
                const updated = result.data.binding
                setData(current => current && { ...current, bindings: current.bindings.map(row => row.id === updated.id ? updated : row) })
                if (student) await load()
                setMessage(student ? 'Repository check finished.' : updated.verification_state === 'verified' ? 'Repository verified.' : updated.failure_reason || 'Verification failed. Check access and try again.')
              } catch (error) {
                if (student) await load()
                setMessage(student ? 'Could not finish verification. Check your connection and try again.' : (error as Error).message)
              }
              finally { setBusy(false) }
            }}>{busy ? 'Checking…' : 'Verify repository'}</Button>
            <Button variant="quiet" disabled={busy || (student && !installations.length)} onClick={() => {
              setName(binding.full_name); setModuleId(String(binding.curriculum_module_id || ''))
              setInstallation(String((canVerify ? binding.github_app_installation_id : installations[0]?.id) || ''))
              setMessage('Edit the repository below, then save and verify again.')
              if (student) nameInput.current?.focus()
            }}>Edit repository</Button>
          </div>
        </li>
      })}</ul>
      {!installations.length ? (!student || data.github_identity.id) && <p className="text-sm text-ink-secondary">{student
        ? 'Learn needs permission to read your repository. Ask your instructor to help set up access for your GitHub account, then reload repositories.'
        : 'After connecting GitHub, ask an administrator to connect your personal GitHub installation for this cohort.'}</p> : <form className="space-y-3 border-t border-line pt-4" onSubmit={async event => {
        event.preventDefault(); requestVersion.current += 1; setBusy(true); setMessage('')
        try {
          const result = await api.saveGithubRepositoryBinding(enrollmentId, { full_name: name.trim(), github_app_installation_id: Number(installation), curriculum_module_id: moduleId ? Number(moduleId) : null })
          if (result.error || result.fromCache || !result.data) throw new Error(result.error || 'Could not save. Your entries are preserved; try again.')
          const saved = result.data.binding
          setData(current => current && { ...current, bindings: current.bindings.some(row => row.id === saved.id) ? current.bindings.map(row => row.id === saved.id ? saved : row) : [...current.bindings, saved] })
          setMessage('Repository saved. Verify access before syncing.'); await load()
        } catch (error) {
          if (student) await load()
          setMessage(student ? 'Could not confirm the save. Check the repository name and your connection, then try again.' : (error as Error).message)
        }
        finally { setBusy(false) }
      }}>
        <label className="block text-sm font-semibold">{student ? 'Your repository' : 'Repository (owner/name)'}<input ref={nameInput} className="app-control mt-1 w-full text-base" required maxLength={140} placeholder="your-username/prework-exercises" value={name} onChange={event => setName(event.target.value)} /></label>
        {student && <p className="text-sm text-ink-secondary">Enter your GitHub username and the repository name, separated by a slash.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">{student ? 'GitHub account with access' : 'GitHub installation'}<select className="app-control mt-1 w-full text-base" required value={installation} onChange={event => setInstallation(event.target.value)}>{installations.map(row => <option key={row.id} value={row.id}>{row.account_login}{row.connection_state === 'failed' ? ' (reconnect required)' : ''}</option>)}</select></label>
          <label className="block text-sm font-semibold">{student ? 'Use this repository for' : 'Repository scope'}<select className="app-control mt-1 w-full text-base" value={moduleId} onChange={event => setModuleId(event.target.value)}><option value="">{student ? 'Default for this course' : 'Enrollment default'}</option>{data.modules.map(mod => <option key={mod.id} value={mod.id}>{mod.name}</option>)}</select></label>
        </div>
        <p className="text-xs text-ink-secondary">{student ? 'Choose a module if it uses a different repository. Once you save it, that module uses its own repository, which you’ll need to verify before syncing.' : 'A module repository overrides the enrollment default for that module. Saving resets verification.'}</p>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save repository'}</Button>
      </form>}
    </>}
    {message && <p role="status" className="text-sm text-ink-secondary">{message}</p>}
  </section>
}
