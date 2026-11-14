// @vitest-environment jsdom
import { act, StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentPostingTokens } from './AgentPostingTokens'
import { api } from '../../lib/api'
import { copyText } from '../../lib/clipboard'
import type { AgentPostingToken } from '../../types/api'

const mocks = vi.hoisted(() => ({ confirm: vi.fn(), success: vi.fn(), error: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { getAgentPostingTokens: vi.fn(), createAgentPostingToken: vi.fn(), revokeAgentPostingToken: vi.fn() } }))
vi.mock('../../lib/clipboard', () => ({ copyText: vi.fn() }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: mocks.success, error: mocks.error }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const PLAINTEXT = `csg_ap_${'0'.repeat(64)}`
const token = (overrides: Partial<AgentPostingToken> = {}): AgentPostingToken => ({
  id: 1, name: 'Home base', scope: 'messages:write', status: 'active', token_hint: 'csg_ap_...',
  created_at: '2026-11-01T00:00:00Z', last_used_at: null, expires_at: '2027-02-01T00:00:00Z', revoked_at: null, ...overrides,
})

let root: Root
let container: HTMLDivElement
beforeEach(() => { container = document.createElement('div'); document.body.append(container); root = createRoot(container) })
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks() })

const tick = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
async function render(tokens: AgentPostingToken[]) {
  vi.mocked(api.getAgentPostingTokens).mockResolvedValue({ data: { agent_posting_tokens: tokens } } as never)
  await act(async () => root.render(<AgentPostingTokens />))
  await tick()
}
const button = (label: string) => Array.from(container.querySelectorAll('button')).find((item) => item.textContent?.trim() === label) as HTMLButtonElement
function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

it('lists tokens with status, created, last used and expiry, and only active ones can be revoked', async () => {
  await render([
    token(),
    token({ id: 2, name: 'Old laptop', status: 'revoked', revoked_at: '2026-11-10T00:00:00Z', last_used_at: '2026-11-09T00:00:00Z' }),
    token({ id: 3, name: 'Trial', status: 'expired', expires_at: '2026-11-05T00:00:00Z' }),
    token({ id: 4, name: 'Forever', expires_at: null }),
  ])
  const rows = Array.from(container.querySelectorAll('li'))
  expect(rows).toHaveLength(4)
  expect(rows[0].textContent).toContain('Active')
  expect(rows[0].textContent).toContain('Last used never')
  expect(rows[0].textContent).toContain('Expires Feb 1, 2027')
  expect(rows[1].textContent).toContain('Revoked')
  expect(rows[1].textContent).toContain('Last used Nov 9, 2026')
  expect(rows[2].textContent).toContain('Expired Nov 5, 2026')
  expect(rows[3].textContent).toContain('No expiry')
  expect(rows.map((row) => Boolean(row.querySelector('button')))).toEqual([true, false, false, true])
  expect(container.textContent).not.toContain(PLAINTEXT)
})

it('creates a token and shows the plaintext exactly once with a copy button', async () => {
  await render([])
  expect(container.textContent).toContain('No assistant tokens yet.')
  vi.mocked(api.createAgentPostingToken).mockResolvedValue({ data: { agent_posting_token: token({ id: 9, name: 'Home base' }), token: PLAINTEXT } } as never)
  vi.mocked(copyText).mockResolvedValue(true)

  await act(async () => type(container.querySelector('input')!, '  Home base  '))
  await act(async () => { container.querySelector('select')!.value = '365'; container.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => button('Create token').click())
  await tick()

  expect(api.createAgentPostingToken).toHaveBeenCalledWith({ name: 'Home base', expires_in_days: 365 })
  const revealed = container.querySelector<HTMLInputElement>('input[aria-label="New token"]')!
  expect(revealed.value).toBe(PLAINTEXT)
  expect(revealed.readOnly).toBe(true)
  expect(container.textContent).toContain('only time it will be shown')
  expect(container.querySelectorAll('li')).toHaveLength(1)

  await act(async () => button('Copy').click())
  expect(copyText).toHaveBeenCalledWith(PLAINTEXT)
  expect(button('Copied')).toBeTruthy()

  await act(async () => button('Done').click())
  expect(container.querySelector('input[aria-label="New token"]')).toBeNull()
  expect(container.textContent).not.toContain(PLAINTEXT)
})

it('sends null expiry for no expiry and requires a name', async () => {
  await render([])
  await act(async () => button('Create token').click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Give the token a name')
  expect(api.createAgentPostingToken).not.toHaveBeenCalled()

  vi.mocked(api.createAgentPostingToken).mockResolvedValue({ data: null, error: 'Revoke an existing assistant token before creating another (limit 10)' } as never)
  await act(async () => type(container.querySelector('input')!, 'Another'))
  await act(async () => { container.querySelector('select')!.value = ''; container.querySelector('select')!.dispatchEvent(new Event('change', { bubbles: true })) })
  await act(async () => button('Create token').click())
  await tick()
  expect(api.createAgentPostingToken).toHaveBeenCalledWith({ name: 'Another', expires_in_days: null })
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('limit 10')
  expect(container.querySelector('input[aria-label="New token"]')).toBeNull()
})

it('revokes only after confirmation', async () => {
  await render([token()])
  mocks.confirm.mockResolvedValueOnce(false)
  await act(async () => button('Revoke').click())
  await tick()
  expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ tone: 'danger', confirmLabel: 'Revoke token' }))
  expect(api.revokeAgentPostingToken).not.toHaveBeenCalled()

  mocks.confirm.mockResolvedValueOnce(true)
  vi.mocked(api.revokeAgentPostingToken).mockResolvedValue({ data: { agent_posting_token: token({ status: 'revoked', revoked_at: '2026-11-15T00:00:00Z' }) } } as never)
  await act(async () => button('Revoke').click())
  await tick()
  expect(api.revokeAgentPostingToken).toHaveBeenCalledWith(1)
  expect(container.querySelector('li')?.textContent).toContain('Revoked')
  expect(container.querySelector('li button')).toBeNull()
  expect(mocks.success).toHaveBeenCalled()
})

it('shows a retryable error when the list fails to load', async () => {
  vi.mocked(api.getAgentPostingTokens).mockResolvedValueOnce({ data: null, error: 'Server unavailable' } as never)
  await act(async () => root.render(<AgentPostingTokens />))
  await tick()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Server unavailable')
  vi.mocked(api.getAgentPostingTokens).mockResolvedValueOnce({ data: { agent_posting_tokens: [token()] } } as never)
  await act(async () => button('Try again').click())
  await tick()
  expect(container.querySelectorAll('li')).toHaveLength(1)
})

it('keeps Create disabled until the token list has loaded', async () => {
  let resolveList: (value: unknown) => void = () => {}
  vi.mocked(api.getAgentPostingTokens).mockReturnValue(new Promise((resolve) => { resolveList = resolve }) as never)
  await act(async () => root.render(<AgentPostingTokens />))
  expect(button('Create token').disabled).toBe(true)
  await act(async () => resolveList({ data: { agent_posting_tokens: [token()] } }))
  await tick()
  expect(button('Create token').disabled).toBe(false)
})

it('ignores a list response that arrives after a newer load or a create (StrictMode double load)', async () => {
  const pending: ((value: unknown) => void)[] = []
  vi.mocked(api.getAgentPostingTokens).mockImplementation(() => new Promise((resolve) => { pending.push(resolve) }) as never)
  await act(async () => root.render(<StrictMode><AgentPostingTokens /></StrictMode>))
  expect(pending.length).toBe(2)
  // The newer load answers first, then the user creates a token.
  await act(async () => pending[1]({ data: { agent_posting_tokens: [token()] } }))
  await tick()
  vi.mocked(api.createAgentPostingToken).mockResolvedValue({ data: { agent_posting_token: token({ id: 9, name: 'Laptop' }), token: PLAINTEXT } } as never)
  await act(async () => type(container.querySelector('input')!, 'Laptop'))
  await act(async () => button('Create token').click())
  await tick()
  // The stale first load (from before the create) must not replace the list.
  await act(async () => pending[0]({ data: { agent_posting_tokens: [] } }))
  await tick()
  expect(Array.from(container.querySelectorAll('li')).map((row) => row.textContent)).toEqual([expect.stringContaining('Laptop'), expect.stringContaining('Home base')])
})
