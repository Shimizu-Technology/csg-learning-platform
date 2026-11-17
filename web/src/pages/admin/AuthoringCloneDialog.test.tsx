// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AuthoringCloneDialog } from './AuthoringCloneDialog'

const clone = vi.hoisted(() => vi.fn())
vi.mock('../../components/shared/Modal', () => ({ Modal: ({ children, title }: { children: React.ReactNode; title: string }) => <div role="dialog" aria-label={title}>{children}</div> }))
vi.mock('../../lib/api', () => ({ api: { cloneAuthoring: clone } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root, container: HTMLDivElement
beforeEach(() => {
  clone.mockReset().mockResolvedValue({ error: 'Network interrupted. Retry.' })
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove() })
const submit = () => act(async () => document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
it('retains the request ID on retry and changes it only when clone options change', async () => {
  await act(async () => root.render(<AuthoringCloneDialog kind="curricula" source={{ id: 1, name: 'Web' }} onClose={() => {}} onCloned={async () => {}} />))
  await submit()
  expect(document.body.textContent).toContain('Network interrupted')
  await submit()
  expect(clone.mock.calls[1][2].client_request_id).toBe(clone.mock.calls[0][2].client_request_id)
  await act(async () => {
    const input = document.querySelector('form input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'New name')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await submit()
  expect(clone.mock.calls[2][2].client_request_id).not.toBe(clone.mock.calls[0][2].client_request_id)
})
it('shows inherited off distinctly from explicit off after a cohort clone', async () => {
  clone.mockResolvedValue({ data: { clone: { id: 4, name: 'New class', features: { recordings: false, help_requests: false }, feature_overrides: { recordings: null, help_requests: false } } } })
  await act(async () => root.render(<AuthoringCloneDialog kind="cohorts" source={{ id: 1, name: 'Web' }} onClose={() => {}} onCloned={async () => {}} />))
  await submit()
  expect(document.body.textContent).toContain('Inherit → Off')
  expect(document.body.textContent).toContain('Off (explicit)')
  expect(document.body.textContent).toContain('0 learners')
  expect(clone.mock.calls[0][2].clone_curriculum).toBe(false)
})
