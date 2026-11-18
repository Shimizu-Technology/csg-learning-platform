// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { GithubRepositorySettings } from './GithubRepositorySettings'
import { GithubAppSettings } from '../admin/GithubAppSettings'
import { api } from '../../lib/api'

vi.mock('../../lib/api', () => ({ api: Object.fromEntries(['getGithubRepositoryBindings', 'verifyGithubRepositoryBinding', 'saveGithubRepositoryBinding', 'getGithubAppInstallations', 'prepareGithubAppInstallation', 'connectGithubAppInstallation'].map(key => [key, vi.fn()])) }))
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement, root: Root
const binding = { id: 10, full_name: 'learner/original', curriculum_module_id: null, github_app_installation_id: 1, verification_state: 'pending', failure_reason: null, verified_at: null, repository_id: null }
const data = { bindings: [binding], github_identity: { id: '11', login: 'learner', verified_at: '2026-11-18T00:00:00Z' }, can_connect_github: true, installations: [{ id: 1, account_login: 'learner', connection_state: 'connected' }], modules: [] }
const deferred = () => {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(done => { resolve = done })
  return { promise, resolve }
}
async function click(name: string) {
  const button = [...container.querySelectorAll('button')].find(node => node.textContent === name)!
  expect(button).toBeTruthy()
  await act(async () => button.click())
}
beforeEach(() => { vi.clearAllMocks(); container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove() })

it('ignores a first GET that finishes after a second GET and verification', async () => {
  const first = deferred()
  vi.mocked(api.getGithubRepositoryBindings).mockReturnValueOnce(first.promise).mockResolvedValueOnce({ data, error: null } as any)
  const verified = { ...binding, verification_state: 'verified', verified_at: '2026-11-18T00:00:00Z', repository_id: 22 }
  vi.mocked(api.verifyGithubRepositoryBinding).mockResolvedValue({ data: { binding: verified }, error: null } as any)
  await act(async () => root.render(<GithubRepositorySettings enrollmentId={1} />))
  await click('Reload repositories')
  await click('Verify repository')
  await act(async () => first.resolve({ data, error: null }))
  expect(container.textContent).toContain('Repository verified.')
  expect(container.querySelector('strong')?.textContent).toBe('learner')
  expect(container.textContent).not.toContain('Pending verification')
  expect(container.textContent).toContain('Verified Nov')
})

it('keeps the saved pending binding when refresh returns an errored cached verified row', async () => {
  const old = { ...binding, verification_state: 'verified', full_name: 'learner/old', verified_at: '2026-11-18T00:00:00Z' }
  vi.mocked(api.getGithubRepositoryBindings).mockResolvedValueOnce({ data: { ...data, bindings: [old] }, error: null } as any)
    .mockResolvedValueOnce({ data: { ...data, bindings: [old] }, error: 'Offline refresh', fromCache: true } as any)
  const saved = { ...binding, full_name: 'learner/replacement' }
  vi.mocked(api.saveGithubRepositoryBinding).mockResolvedValue({ data: { binding: saved }, error: null } as any)
  await act(async () => root.render(<GithubRepositorySettings enrollmentId={1} />))
  await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(container.textContent).toContain('learner/replacement')
  expect(container.textContent).toContain('Pending verification')
  expect(container.textContent).not.toContain('learner/old')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Offline refresh')
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('last confirmed state')
})

it('shows initial cached-data errors and can reload successfully', async () => {
  vi.mocked(api.getGithubRepositoryBindings).mockResolvedValueOnce({ data, error: 'Unavailable', fromCache: true } as any).mockResolvedValueOnce({ data, error: null } as any)
  await act(async () => root.render(<GithubRepositorySettings enrollmentId={1} />))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Unavailable')
  expect(container.querySelectorAll('li')).toHaveLength(0)
  await click('Reload repositories')
  expect(container.querySelector('[role="alert"]')).toBeNull()
  expect(container.textContent).toContain('learner/original')
})

it('does not present cached connection status as a current successful load', async () => {
  vi.mocked(api.getGithubAppInstallations).mockResolvedValueOnce({ data: { configured: true, installations: [{ id: 1, account_login: 'stale-account', connection_state: 'connected' }] }, error: 'Offline connection status', fromCache: true } as any)
    .mockResolvedValueOnce({ data: { configured: true, installations: [] }, error: null } as any)
  await act(async () => root.render(<GithubAppSettings cohortId={1} />))
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Offline connection status')
  expect(container.textContent).not.toContain('stale-account')
  await click('Reload connections')
  expect(container.textContent).toContain('No installations connected yet.')
})
