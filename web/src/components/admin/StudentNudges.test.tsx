// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { StudentNudges } from './StudentNudges'
import type { LearnerNudge } from '../../types/api'

vi.mock('../../lib/api', () => ({ api: { getLearnerNudges: vi.fn() } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let host: HTMLDivElement
let root: Root
const nudge = (overrides: Partial<LearnerNudge> = {}): LearnerNudge => ({ id: 1, kind: 'due_soon', threshold: '48h', essential: false,
  title: 'Final project due tomorrow', body: 'Calculator is due by 11:59 PM Guam time.', event_at: '2026-12-21T13:59:59Z',
  sent_at: '2026-12-19T22:00:00Z', email_status: 'sent', push_status: 'attempted', read_at: null, ...overrides })
beforeEach(() => { vi.clearAllMocks(); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function mount() { await act(async () => root.render(<StudentNudges enrollmentId={5} />)) }

it('lists what went out with kind, threshold, Guam time, delivery and read state', async () => {
  vi.mocked(api.getLearnerNudges).mockResolvedValue({ data: { enabled: true, learner_opted_out: false, nudges: [
    nudge(),
    nudge({ id: 2, kind: 'access_ending', threshold: '3d', essential: true, title: 'Your access ends Mon, Jan 4', body: null, email_status: 'failed', push_status: 'pending', read_at: '2026-12-20T01:00:00Z' }),
    nudge({ id: 3, kind: 'inactive', threshold: '7d', title: 'Pick up where you left off', email_status: 'not_configured', push_status: 'not_requested' }),
    nudge({ id: 4, kind: 'support_ending', threshold: '1d', title: 'Your help period ends today', push_status: 'not_sent' }),
    nudge({ id: 5, push_status: 'partial', email_status: 'pending' }),
  ] }, error: null })
  await mount()
  expect(api.getLearnerNudges).toHaveBeenCalledWith(5)
  const rows = [...host.querySelectorAll('li')].map(item => item.textContent)
  expect(rows[0]).toContain('Due soon · 48 hours before')
  expect(rows[0]).toContain('Sent Dec 20, 2026, 8:00 AM ChST')
  expect(rows[0]).toContain('Email sent · Push attempted via both providers · Not read yet')
  expect(rows[1]).toContain('Access ending · Essential · 3 days before')
  expect(rows[1]).toContain('Email failed · Push pending · Read Dec 20, 2026, 11:00 AM ChST')
  expect(rows[2]).toContain('No recent activity · After 7 days inactive')
  expect(rows[2]).toContain('Email not set up · No push')
  expect(rows[3]).toContain('Support ending · 1 day before')
  expect(rows[3]).toContain('Push not sent')
  expect(rows[4]).toContain('Email pending · Push attempted via one provider')
  expect(host.textContent).not.toContain('2026-12-')
})

it('says when the cohort has reminders off or the learner opted out, and when nothing was sent', async () => {
  vi.mocked(api.getLearnerNudges).mockResolvedValue({ data: { enabled: false, learner_opted_out: true, nudges: [] }, error: null })
  await mount()
  expect(host.textContent).toContain('Reminders are off for this cohort.')
  expect(host.textContent).toContain('This learner turned off optional reminders.')
  expect(host.textContent).not.toContain('Access-ending reminders still go out.')
  expect(host.textContent).toContain('No reminders sent yet.')
})

it('recovers from a failed load', async () => {
  vi.mocked(api.getLearnerNudges).mockResolvedValueOnce({ data: null, error: 'Network down' })
    .mockResolvedValueOnce({ data: { enabled: true, learner_opted_out: false, nudges: [nudge()] }, error: null })
  await mount()
  expect(host.querySelector('[role="alert"]')!.textContent).toBe('Network down')
  const reload = [...host.querySelectorAll('button')].find(button => button.textContent === 'Reload reminders')!
  await act(async () => reload.click())
  expect(host.querySelectorAll('li')).toHaveLength(1)
  expect(host.querySelector('[role="alert"]')).toBeNull()
})
