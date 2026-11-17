// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ContentReportDetail, OfferingDetail, RecoveryPlanDetail } from '../../../types/api'

// The last L-5.2 pages: a return plan (staff in its cohort), a community
// report and a course offering's purchases (admins). Each keeps Back on
// loading, failure and No access, and links through the route registry.

const mocks = vi.hoisted(() => ({
  user: { id: 1, is_staff: true, is_admin: true } as { id: number; is_staff: boolean; is_admin: boolean },
  getRecordDetail: vi.fn(),
  updateContentReport: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('../../../lib/api', () => ({ api: { getRecordDetail: mocks.getRecordDetail, updateContentReport: mocks.updateContentReport, getRecordSummary: vi.fn(), getUser: vi.fn() } }))
vi.mock('../../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: mocks.user }) }))
vi.mock('../../../contexts/ToastContext', () => ({ useToast: () => mocks.toast }))

import { RecoveryPlanRecord } from './RecoveryPlanRecord'
import { ContentReportRecord } from './ContentReportRecord'
import { OfferingRecord } from './OfferingRecord'

const teal = { id: 4, name: 'Cohort Teal', course_delivery: 'program', status: 'active' }
const person = (id: number, name: string) => ({ id, name })
const safety = (about: number, open: number, by: number, made: number, blockedBy: number) => ({ reports_about: about, open_reports_about: open, reports_by: by, blocks_made: made, blocked_by: blockedBy })

const plan: RecoveryPlanDetail = {
  type: 'recovery_plan', id: 44, source: 'manual', status: 'active', target_pace: 'Two lessons a day', required_scope: 'Week 2 exercises', optional_scope: null,
  check_in_cadence: 'weekly', next_check_in_at: '2026-11-20T09:00:00Z', last_check_in_at: '2026-11-17T09:00:00Z', check_in_due: true, outcome: null, completed_at: null,
  created_at: '2026-11-10T09:00:00Z', updated_at: '2026-11-17T09:00:00Z', cohort: teal, student: person(9, 'Alex Rivera'), enrollment_status: 'active',
  owner: { id: 2, name: 'Ivy Instructor', valid: false }, created_by: person(2, 'Ivy Instructor'), can_edit: true,
  follow_up: { id: 61, status: 'open', severity: 'normal', created_at: '2026-11-09T09:00:00Z' }, restart: null,
  check_ins_count: 25, check_ins: [{ id: 99, body: 'Caught up on loops', author: person(2, 'Ivy Instructor'), created_at: '2026-11-17T09:00:00Z', next_check_in_at: '2026-11-20T09:00:00Z' }],
}
const report: ContentReportDetail = {
  type: 'content_report', id: 77, reason: 'harassment', details: 'Mean replies', status: 'pending', created_at: '2026-11-17T09:00:00Z', resolved_at: null,
  reporter: { ...person(9, 'Alex Rivera'), role: 'student', archived: false }, reported_user: { ...person(10, 'Sam Peer'), role: 'student', archived: false }, reviewed_by: null,
  message: { id: 300, body: 'Reported words', created_at: '2026-11-17T08:00:00Z', deleted: false, reply: true, attachments_count: 0,
    conversation: { kind: 'dm', label: 'Direct conversation in Cohort Teal', available: false, destination: null } },
  reporter_safety: safety(0, 0, 1, 1, 0), reported_user_safety: safety(3, 2, 0, 0, 1),
  other_reports_count: 2, other_reports: [{ id: 70, reason: 'spam', status: 'dismissed', created_at: '2026-11-01T09:00:00Z', reporter: person(11, 'Kai Other') }],
  blocks_between: [{ blocker_id: 9, blocked_user_id: 10, created_at: '2026-11-17T09:30:00Z' }],
}
const purchase = (id: number, enrolled: boolean) => ({
  id, status: enrolled ? 'paid' as const : 'pending' as const, checkout_state: enrolled ? 'paid' as const : 'pending' as const, price_cents: 14_900, access_months: 12, support_weeks: 6,
  created_at: '2026-11-17T09:00:00Z', updated_at: '2026-11-17T09:00:00Z', buyer: { id: 100 + id, name: `Buyer ${id}`, email: `buyer${id}@example.invalid` },
  enrollment: enrolled ? { id: 500 + id, status: 'active' } : null,
})
const offering: OfferingDetail = {
  type: 'offering', id: 8, title: 'Self-paced JavaScript', public_slug: 'self-paced-js', checkout_enabled: true, price_cents: 14_900, access_months: 12, support_weeks: 6,
  support_instructor: person(2, 'Ivy Instructor'), curriculum: person(1, 'JS curriculum'), cohort: { id: 8, name: 'JS Self-paced', course_delivery: 'self_paced', status: 'active' },
  purchases_count: 27, status_counts: { paid: 26, pending: 1, refunded: 0, disputed: 0, failed: 0, expired: 0 }, paid_cents: 26 * 14_900, enrolled_count: 26,
  purchases_next_before: 3, purchases: [purchase(27, false), ...Array.from({ length: 24 }, (_, index) => purchase(26 - index, true))],
}
const details: Record<string, unknown> = { recovery_plan: plan, content_report: report, offering }

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  mocks.user = { id: 1, is_staff: true, is_admin: true }
  mocks.getRecordDetail.mockImplementation(async (type: string) => ({ data: { detail: details[type] }, error: null, status: 200 }))
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

async function render(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const router = createMemoryRouter([
    { path: '/admin/recovery-plans/:id', element: <RecoveryPlanRecord /> },
    { path: '/admin/moderation/reports/:id', element: <ContentReportRecord /> },
    { path: '/admin/offerings/:id', element: <OfferingRecord /> },
  ], { initialEntries: [entry] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => { await Promise.resolve() })
  return router
}
const backLink = () => container.querySelector<HTMLAnchorElement>('[data-back-link]')!
const row = (key: string) => container.querySelector(`[data-related-row="${key}"]`)
const hrefs = () => [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href') || '')

it('a return plan shows its owner, scope, follow-up plan and check-ins, and edits on Support', async () => {
  mocks.user = { id: 2, is_staff: true, is_admin: false }
  await render('/admin/recovery-plans/44')
  expect(mocks.getRecordDetail).toHaveBeenCalledWith('recovery_plan', 44)
  expect(container.querySelector('h1')?.textContent).toBe("Alex Rivera's return plan")
  expect(backLink().textContent).toBe('Back to Alex Rivera · Support')
  expect(backLink().getAttribute('href')).toBe('/admin/cohorts/4/students/9/support?plan_id=44')
  expect(container.textContent).toContain('Follow-up due')
  expect(container.textContent).toContain('Needs a new owner')
  expect(container.textContent).toContain('Week 2 exercises')
  expect(container.textContent).toContain('Newest 1 of 25')
  expect(container.textContent).toContain('Caught up on loops')
  expect(row('follow_up')?.querySelector('a')?.getAttribute('href')).toBe('/admin/interventions/61')
  expect(row('check_ins')?.textContent).toContain('25')
  expect(hrefs()).toContain('/admin/cohorts/4/students/9/support?plan_id=44')
  // Team member pages are admin-only, so an instructor sees the owner's name without a link.
  expect(hrefs().some((href) => href.startsWith('/admin/team/'))).toBe(false)
})

it('a community report quotes the message, keeps an unopenable DM as text, and shows both people', async () => {
  await render({ pathname: '/admin/moderation/reports/77', state: { returnTo: '/admin/moderation?view=open', returnLabel: 'Safety' } })
  expect(mocks.getRecordDetail).toHaveBeenCalledWith('content_report', 77)
  expect(container.querySelector('h1')?.textContent).toBe('Alex Rivera reported a message from Sam Peer')
  expect(backLink().textContent).toBe('Back to Safety')
  expect(backLink().getAttribute('href')).toBe('/admin/moderation?view=open')
  expect(container.querySelector('blockquote')?.textContent).toBe('Reported words')
  expect(container.textContent).toContain('a reply in a thread')
  expect(container.textContent).toContain("You’re not in this conversation, so it can’t be opened")
  expect(hrefs().some((href) => href.startsWith('/messages/'))).toBe(false)
  expect(container.textContent).toContain('Alex Rivera blocked Sam Peer')
  expect(container.textContent).toContain('3 reports about them · 0 reports filed · 0 blocks made · blocked by 1')
  expect(hrefs()).toContain('/admin/moderation?person_id=10')
  expect(hrefs().some((href) => href.startsWith('/admin/moderation/reports/70'))).toBe(true)
  expect(container.textContent).toContain('Newest 1 of 2')
})

it('a community report opens a class chat at the message and resolves from the header', async () => {
  mocks.getRecordDetail.mockResolvedValue({ data: { detail: { ...report, message: { ...report.message!, conversation: { kind: 'channel', label: '#Class Chat in Cohort Teal', available: true, destination: { kind: 'channel', id: 30, context: {}, anchor: { message_id: 300 } } } } } }, error: null, status: 200 })
  mocks.updateContentReport.mockResolvedValue({ data: { content_report: {} }, error: null, status: 200 })
  await render('/admin/moderation/reports/77')
  expect(backLink().getAttribute('href')).toBe('/admin/moderation#report-77')
  expect(hrefs()).toContain('/messages/30?message_id=300')
  const actioned = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Actioned')!
  await act(async () => { actioned.click() })
  await act(async () => { await Promise.resolve() })
  expect(mocks.updateContentReport).toHaveBeenCalledWith(77, 'actioned')
  expect(mocks.toast.success).toHaveBeenCalledWith('Report actioned.')
  expect(mocks.getRecordDetail).toHaveBeenCalledTimes(2)
})

it('an offering lists purchases with each buyer’s enrollment and loads more before the last one shown', async () => {
  mocks.getRecordDetail.mockImplementation(async (_type: string, _id: number, options?: { purchasesBefore?: number }) => ({
    data: { detail: options?.purchasesBefore === 3 ? { ...offering, purchases: [purchase(2, true), purchase(1, true)], purchases_next_before: null } : offering },
    error: null, status: 200,
  }))
  await render('/admin/offerings/8')
  expect(container.querySelector('h1')?.textContent).toBe('Self-paced JavaScript')
  expect(backLink().textContent).toBe('Back to JS Self-paced · Settings')
  expect(container.textContent).toContain('$3874.00 from 26 purchases')
  expect(container.querySelectorAll('[data-purchase-row]')).toHaveLength(25)
  // A pending checkout has no enrollment yet, so its buyer isn't a link.
  expect(container.querySelector('[data-purchase-row]')?.textContent).toContain('No enrollment')
  expect(container.querySelector('[data-purchase-row]')!.querySelector('a')).toBeNull()
  expect(hrefs().some((href) => href.startsWith('/admin/cohorts/8/students/126/overview'))).toBe(true)
  expect(hrefs()).toContain('/courses/self-paced-js')
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-show-more-purchases]')!.click() })
  await act(async () => { await Promise.resolve() })
  expect(mocks.getRecordDetail).toHaveBeenLastCalledWith('offering', 8, { purchasesBefore: 3 })
  expect(container.querySelectorAll('[data-purchase-row]')).toHaveLength(27)
  expect(container.querySelector('[data-show-more-purchases]')).toBeNull()
})

it.each([
  ['/admin/recovery-plans/44', 'Back to Support', '/admin/support'],
  ['/admin/moderation/reports/77', 'Back to Safety', '/admin/moderation'],
  ['/admin/offerings/8', 'Back to Cohorts', '/admin/cohorts'],
])('%s keeps a Back link on No access', async (path, label, href) => {
  mocks.getRecordDetail.mockResolvedValue({ data: null, error: 'Not found', status: 404 })
  await render(path)
  expect(container.textContent).toContain('No access')
  expect(backLink().textContent).toBe(label)
  expect(backLink().getAttribute('href')).toBe(href)
})

it('a failed load keeps Back from return_to and retries', async () => {
  mocks.getRecordDetail.mockResolvedValueOnce({ data: null, error: 'Server error', status: 500 })
  await render('/admin/moderation/reports/77?return_to=%2Fadmin%2Fteam%2F2')
  expect(backLink().textContent).toBe('Back to Team member')
  expect(container.textContent).toContain("Couldn't load this report")
  const retry = [...container.querySelectorAll('button')].find((button) => button.textContent?.includes('Try again'))!
  await act(async () => { retry.click() })
  await act(async () => { await Promise.resolve() })
  expect(container.querySelector('h1')?.textContent).toBe('Alex Rivera reported a message from Sam Peer')
})
