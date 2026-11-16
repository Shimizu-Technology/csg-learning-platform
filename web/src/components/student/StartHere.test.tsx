// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { StartHere } from './StartHere'
import type { DashboardData } from '../../types/api'
const api = vi.hoisted(() => ({ dismissStartHere: vi.fn() }))
vi.mock('../../lib/api', () => ({ api }))
let host: HTMLDivElement, root: ReturnType<typeof createRoot>
afterEach(() => { act(() => root.unmount()); host.remove(); vi.clearAllMocks() })
const data = { cohort: { id: 13 }, review_response_time: 'usually reviewed within 3 days', course_access: { support_weeks: 8, support_expires_at: '2027-01-01' } } as DashboardData
it.each([true, false])('explains the course and support; dismisses only after a successful save (%s)', async success => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  const dismissed = vi.fn(); api.dismissStartHere.mockResolvedValue(success ? { data: { dismissed: true } } : { error: 'Offline' })
  await act(async () => root.render(<StartHere data={data} onDismiss={dismissed} />))
  expect(host.textContent).toContain('8 weeks from your first course open')
  expect(host.textContent).toContain('usually reviewed within 3 days')
  expect(host.textContent).toContain('Ask for help')
  await act(async () => host.querySelector('button')!.click())
  expect(api.dismissStartHere).toHaveBeenCalledWith(13)
  expect(dismissed).toHaveBeenCalledTimes(success ? 1 : 0)
  if (!success) { expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not save'); expect(host.querySelector('button')!.disabled).toBe(false) }
})
