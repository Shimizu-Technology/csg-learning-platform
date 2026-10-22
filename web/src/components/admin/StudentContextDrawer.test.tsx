// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/api', () => ({
  api: {
    getStudentProgress: vi.fn().mockResolvedValue({ data: null, error: 'Context unavailable for this test' }),
    getSubmissions: vi.fn().mockResolvedValue({ data: { submissions: [] }, error: null }),
    getHelpRequests: vi.fn().mockResolvedValue({ data: { help_requests: [] }, error: null }),
  },
}))

import { api } from '../../lib/api'
import { StudentContextDrawer } from './StudentContextDrawer'

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <MemoryRouter>
      <button type="button" id="opener" onClick={() => setOpen(true)}>Open context</button>
      <StudentContextDrawer open={open} cohortId={2} studentId={5} onClose={() => setOpen(false)} />
    </MemoryRouter>
  )
}

describe('StudentContextDrawer', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.useFakeTimers()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    document.querySelectorAll('[data-state="closing"]').forEach((node) => node.remove())
    vi.useRealTimers()
  })

  it('keeps Tab inside, returns focus to the opener, and slides out from a frozen copy', async () => {
    await act(async () => root.render(<Harness />))
    const opener = document.getElementById('opener') as HTMLButtonElement
    opener.focus()
    await act(async () => opener.click())
    await act(async () => { await Promise.resolve() })
    const panel = document.querySelector<HTMLElement>('aside[role="dialog"]')!
    expect(panel.textContent).toContain('Context unavailable for this test')

    opener.focus()
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })) })
    expect(panel.contains(document.activeElement)).toBe(true)

    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(document.querySelector('aside[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(opener)
    const ghost = document.querySelector<HTMLElement>('.app-drawer-overlay[data-state="closing"]')!
    expect(ghost.textContent).toContain('Context unavailable for this test')
    expect(ghost.getAttribute('aria-hidden')).toBe('true')
    expect(ghost.querySelector('[role="dialog"]')).toBeNull()
    act(() => vi.advanceTimersByTime(400))
    expect(document.querySelector('[data-state="closing"]')).toBeNull()
  })
  it('keeps failed submissions and help unavailable until each section is retried', async () => {
    vi.mocked(api.getStudentProgress).mockResolvedValue({ data: { user: { full_name: 'Maya' }, cohort: { name: 'Python' }, overall_progress: { percentage: 0, completed: 0, total: 1 }, modules: [] } as never, error: null })
    vi.mocked(api.getSubmissions).mockResolvedValueOnce({ data: null, error: 'Submissions offline' }).mockResolvedValue({ data: { submissions: [] }, error: null } as never)
    vi.mocked(api.getHelpRequests).mockResolvedValueOnce({ data: null, error: 'Help offline' }).mockResolvedValue({ data: { help_requests: [] }, error: null } as never)
    await act(async () => root.render(<Harness />))
    await act(async () => (document.getElementById('opener') as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('Submissions offline')
    expect(document.body.textContent).toContain('Help offline')
    expect(document.body.textContent).not.toContain('to review')
    expect(document.body.textContent).not.toContain('open help')
    await act(async () => (document.querySelector('[aria-label="Retry Submissions"]') as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('to review')
    expect(document.body.textContent).toContain('Help offline')
    await act(async () => (document.querySelector('[aria-label="Retry Help requests"]') as HTMLButtonElement).click())
    expect(document.body.textContent).toContain('open help')
  })

})
