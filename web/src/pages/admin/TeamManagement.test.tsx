// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const state = vi.hoisted(() => ({ getUsers: vi.fn(), resendInvite: vi.fn(), updateUser: vi.fn(), createUser: vi.fn(), unarchiveUser: vi.fn(), syncSession: vi.fn(), error: vi.fn(), success: vi.fn() }))

vi.mock('../../lib/api', () => ({ api: { getUsers: state.getUsers, resendInvite: state.resendInvite, updateUser: state.updateUser, createUser: state.createUser, unarchiveUser: state.unarchiveUser } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_admin: true }, syncSession: state.syncSession }) }))
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
    state.syncSession.mockReset();
    state.updateUser.mockReset(); state.createUser.mockReset(); state.unarchiveUser.mockReset();
    state.getUsers.mockReset(); state.resendInvite.mockReset(); state.error.mockReset(); state.success.mockReset()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => {
      root.unmount()
      // Modal's inert exit copy must finish before jsdom tears down window.
      await new Promise((resolve) => setTimeout(resolve, 350))
    })
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
  const modalButton = (name: string) => [...container.querySelectorAll('button')].find((el) => el.textContent?.trim() === name) as HTMLButtonElement
  const change = async (selector: string, value: string) => act(async () => {
    const input = container.querySelector(selector) as HTMLInputElement
    const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('change', { bubbles: true }))
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })

  it('requires confirmation before changing an existing role and cancellation writes nothing', async () => {
    state.getUsers.mockImplementation(({ role }: { role?: string }) => Promise.resolve(ok(role === 'admin' ? [] : [member({ invite_pending: false })])))
    state.updateUser.mockResolvedValue({ data: { user: member({ role: 'admin' }) }, error: null })
    await act(async () => root.render(<TeamManagement />)); await flush()
    await act(async () => button('Edit').click())
    await change('select[id$="edit-role"]', 'admin')
    await act(async () => modalButton('Save Changes').click())
    expect(container.textContent).toContain('from Instructor to Admin')
    expect(state.updateUser).not.toHaveBeenCalled()
    const cancels = [...container.querySelectorAll('button')].filter((el) => el.textContent === 'Cancel')
    await act(async () => cancels.at(-1)!.click())
    expect(state.updateUser).not.toHaveBeenCalled()
    await act(async () => modalButton('Save Changes').click())
    await act(async () => modalButton('Confirm role change').click())
    expect(state.updateUser).toHaveBeenCalledWith(10, expect.objectContaining({ role: 'admin' }))
  })

  it('explains why the last accepted admin cannot be demoted; pending invites do not count', async () => {
    state.getUsers.mockImplementation(({ role }: { role: string }) => Promise.resolve(ok(role === 'admin'
      ? [member({ id: 1, role: 'admin', invite_pending: false }), member({ id: 2, role: 'admin' })] : [])))
    await act(async () => root.render(<TeamManagement />)); await flush()
    await act(async () => button('Edit').click())
    expect(container.textContent).toContain('last active admin who has accepted their invitation')
    expect((container.querySelector('select[id$="edit-role"] option[value="instructor"]') as HTMLOptionElement).disabled).toBe(true)
    expect((container.querySelector('select[id$="edit-role"] option[value="student"]') as HTMLOptionElement).disabled).toBe(true)
  })

  it('promotes an existing student from Add Team Member only through explicit edit confirmation', async () => {
    const student = member({ role: 'student', invite_pending: false })
    state.getUsers.mockImplementation(({ role }: { role?: string }) => Promise.resolve(ok(role ? [] : [student])))
    state.updateUser.mockResolvedValue({ data: { user: member({}) }, error: null })
    await act(async () => root.render(<TeamManagement />)); await flush()
    await act(async () => button('Add Team MemberAdd').click())
    await change('input[id$="add-email"]', 'faye@example.com')
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(state.createUser).not.toHaveBeenCalled()
    expect(state.updateUser).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Edit Team Member')
    await act(async () => modalButton('Save Changes').click())
    expect(container.textContent).toContain('from Student to Instructor')
    await act(async () => modalButton('Confirm role change').click())
    expect(state.updateUser).toHaveBeenCalledWith(10, expect.objectContaining({ role: 'instructor' }))
  })

  it('refreshes the signed-in session after a confirmed self-demotion', async () => {
    state.getUsers.mockImplementation(({ role }: { role: string }) => Promise.resolve(ok(role === 'admin'
      ? [member({ id: 1, role: 'admin', invite_pending: false }), member({ id: 2, role: 'admin', invite_pending: false })] : [])))
    state.updateUser.mockResolvedValue({ data: { user: member({ id: 1, role: 'instructor' }) }, error: null })
    state.syncSession.mockResolvedValue(true)
    await act(async () => root.render(<TeamManagement />)); await flush()
    await act(async () => button('Edit').click())
    await change('select[id$="edit-role"]', 'instructor')
    await act(async () => modalButton('Save Changes').click())
    await act(async () => modalButton('Confirm role change').click())
    expect(state.updateUser).toHaveBeenCalledWith(1, expect.objectContaining({ role: 'instructor' }))
    expect(state.syncSession).toHaveBeenCalledOnce()
  })

  it('keeps the edit draft when another admin change makes a confirmed demotion invalid', async () => {
    state.getUsers.mockImplementation(({ role }: { role: string }) => Promise.resolve(ok(role === 'admin'
      ? [member({ id: 1, role: 'admin', invite_pending: false }), member({ id: 2, role: 'admin', invite_pending: false })] : [])))
    state.updateUser.mockResolvedValue({ data: null, error: 'Cannot remove the last active admin. Add another admin and have them sign in first.' })
    await act(async () => root.render(<TeamManagement />)); await flush()
    await act(async () => button('Edit').click())
    await change('select[id$="edit-role"]', 'instructor')
    await act(async () => modalButton('Save Changes').click())
    await act(async () => modalButton('Confirm role change').click())
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('last active admin'))
    expect(container.textContent).toContain('Edit Team Member')
    expect(state.syncSession).not.toHaveBeenCalled()
  })

})
