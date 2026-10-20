// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ getUsers: vi.fn(), resendInvite: vi.fn(), error: vi.fn(), success: vi.fn() }))

vi.mock('../../lib/api', () => ({ api: { getUsers: state.getUsers, resendInvite: state.resendInvite } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_admin: true } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: state.success, error: state.error }) }))

import { TeamManagement } from './TeamManagement'

const member = (overrides: Record<string, unknown>) => ({
  id: 10, email: 'faye@example.com', first_name: 'Faye', last_name: 'Failed', full_name: 'Faye Failed', role: 'instructor',
  github_username: null, avatar_url: null, last_sign_in_at: null, archived_at: null, invite_pending: true,
  invite_delivery_status: 'failed', invite_state: 'failed', invite_sent_at: null, invite_expires_at: null,
  invite_last_error: 'Invite email delivery failed', created_at: '2026-10-01T00:00:00Z', ...overrides,
})
const ok = (users: unknown[]) => ({ data: { users }, error: null })
const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })

describe('Team invite status', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    state.getUsers.mockReset(); state.resendInvite.mockReset(); state.error.mockReset(); state.success.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  const button = (name: string) => [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === name) as HTMLButtonElement

  it('shows the failure reason and keeps the rows when the refresh after a resend fails', async () => {
    state.getUsers.mockImplementation(({ role }: { role: string }) => Promise.resolve(ok(role === 'instructor' ? [member({})] : [])))
    await act(async () => root.render(<TeamManagement />))
    await flush()
    expect(container.textContent).toContain('Invite failed')
    expect(container.textContent).toContain('Not delivered: Invite email delivery failed')

    state.resendInvite.mockResolvedValue({ data: { message: 'queued', invitation: { status: 'queued' } }, error: null })
    state.getUsers.mockResolvedValue({ data: null, error: 'Server unavailable' })
    await act(async () => button('Retry invite').click())
    await flush()
    expect(container.textContent).toContain('Faye Failed')
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Server unavailable'))
  })

  it('does not refresh the active list into the Archived view after switching tabs mid-resend', async () => {
    state.getUsers.mockImplementation(({ role, include_archived }: { role: string; include_archived?: string }) => Promise.resolve(ok(
      role !== 'instructor' ? [] : include_archived ? [member({ id: 11, full_name: 'Arlo Archived', first_name: 'Arlo', last_name: 'Archived', archived_at: '2026-10-02T00:00:00Z', invite_pending: false })] : [member({})],
    )))
    let finishResend: (value: unknown) => void = () => {}
    state.resendInvite.mockReturnValue(new Promise((resolve) => { finishResend = resolve }))
    await act(async () => root.render(<TeamManagement />))
    await flush()
    await act(async () => button('Retry invite').click())
    await act(async () => button('Archived').click())
    await flush()
    expect(container.textContent).toContain('Arlo Archived')
    const callsBefore = state.getUsers.mock.calls.length
    await act(async () => finishResend({ data: { message: 'queued', invitation: { status: 'queued' } }, error: null }))
    await flush()
    expect(state.getUsers.mock.calls.length).toBe(callsBefore)
    expect(container.textContent).toContain('Arlo Archived')
    expect(container.textContent).not.toContain('Faye Failed')
  })
})
