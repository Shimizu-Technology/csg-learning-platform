// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { Announcement, CohortSummary } from '../../types/api'

const mocks = vi.hoisted(() => ({ create: vi.fn(), saved: vi.fn(), click: null as Promise<void> | null }))
vi.mock('../../lib/api', () => ({ api: { createAnnouncement: mocks.create } }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../components/shared/LazyMarkdownEditor', () => ({ LazyMarkdownEditor: () => null }))
// React's DOM event dispatcher discards async handler results. Retain the
// button's returned promise so we can assert propagation without an unhandled rejection.
vi.mock('../../components/ui/Button', () => ({ Button: ({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => Promise<void>; disabled: boolean }) => <button disabled={disabled} onClick={() => { mocks.click = onClick(); void mocks.click.catch(() => {}); }}>{children}</button> }))
import { EMPTY_UPDATE_FORM, UpdateComposer, type UpdateForm } from './UpdateComposer'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('propagates a rejected onSaved after unlocking the composer and keeps the create id', async () => {
  const cohort = { id: 4, name: 'QA cohort' } as CohortSummary
  const form = { ...EMPTY_UPDATE_FORM, title: 'Draft title', body: 'Words', cohort_id: '4' }
  function Harness() {
    const [value, setValue] = useState<UpdateForm>(form)
    return <UpdateComposer form={value} setForm={setValue} cohorts={[cohort]} contextCohort={cohort} defaultCohortId="4" onSaved={mocks.saved} />
  }
  mocks.create.mockImplementation(async (data) => ({ data: { announcement: { ...data, id: 12 } as Announcement }, error: null }))
  mocks.saved.mockRejectedValueOnce(new Error('Refresh failed')).mockResolvedValue(undefined)
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  try {
    await act(async () => root.render(<Harness />))
    const draftButton = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Save draft'))!
    await act(async () => draftButton().click())
    await expect(mocks.click).rejects.toThrow('Refresh failed')
    expect(draftButton().disabled).toBe(false)
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Title"]')!.disabled).toBe(false)
    expect(container.querySelector('[role="alert"]')).toBeNull()
    await act(async () => draftButton().click())
    await expect(mocks.click).resolves.toBeUndefined()
    expect(mocks.create.mock.calls[1][0].client_request_id).toBe(mocks.create.mock.calls[0][0].client_request_id)
  } finally {
    act(() => root.unmount())
    container.remove()
  }
})
