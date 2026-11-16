// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Intervention } from '../../types/api'
import { InterventionDetail } from './InterventionDetail'

const state = vi.hoisted(() => ({ getIntervention: vi.fn(), getRecoveryPlan: vi.fn(), createDirectConversation: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 1, is_staff: true, is_admin: false } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../lib/analytics', () => ({ captureProductEvent: vi.fn(), analyticsAgeBucket: () => 'under_1h' }))
vi.mock('../../lib/recordRelated', () => ({ useRecordRelated: () => ({ related: null, loading: false, error: null, retry: vi.fn() }), relatedRows: () => [] }))
vi.mock('../../lib/api', () => ({ api: state }))

const plan = (overrides: Partial<Intervention> = {}): Intervention => ({
  id: 61, trigger_type: 'redo', severity: 'normal', status: 'open', action_summary: 'Check in.', next_follow_up_at: '2026-11-20T00:00:00Z', follow_up_due: false,
  outcome: null, resolution_summary: null, resolved_at: null, created_at: '2026-11-12T00:00:00Z', updated_at: '2026-11-12T00:00:00Z',
  enrollment: { id: 5, status: 'active', student: { id: 9, full_name: 'Alex Synthetic', email: 'alex@example.com' }, cohort: { id: 3, name: 'Cohort 3' } },
  owner_valid: true, owner: { id: 1, full_name: 'Ina Teacher' }, created_by: { id: 1, full_name: 'Ina Teacher' }, help_request_id: 44, recovery_plan_id: 7, notes: [],
  evidence_snapshot: { submission_ids: [812, 813], count: 2, help_request_id: 44 },
  evidence_links: [
    { key: 'submission_ids', id: 812, label: 'Submission #812', destination: { kind: 'submission', id: 812, context: { cohort_id: 3, student_id: 9 }, anchor: {} } },
    { key: 'help_request_id', id: 44, label: 'Sum an array', destination: { kind: 'help_request', id: 44, context: { cohort_id: 3, student_id: 9 }, anchor: {} } },
    { key: 'context_id', id: 40, label: 'Arrays', destination: { kind: 'lesson', id: 40, context: { cohort_id: 3 }, anchor: {} } },
  ],
  ...overrides,
} as Intervention)

let container: HTMLDivElement
let root: Root
let router: ReturnType<typeof createMemoryRouter>
beforeEach(async () => {
  state.getIntervention.mockResolvedValue({ data: { intervention: plan() }, error: null })
  state.getRecoveryPlan.mockResolvedValue({ data: { recovery_plan: { id: 7, status: 'active', target_pace: 'Two lessons a week', required_scope: 'Required lessons', optional_scope: '', next_check_in_at: '2026-11-20T00:00:00Z', check_in_due: false, check_ins: [], owner_valid: true } }, error: null })
  state.createDirectConversation.mockResolvedValue({ data: { direct_conversation: { id: 77 } }, error: null })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  router = createMemoryRouter([
    { path: '/admin/interventions/:id', element: <InterventionDetail /> },
    { path: '*', element: <div data-elsewhere="" /> },
  ], { initialEntries: [`/admin/interventions/61?return_to=${encodeURIComponent('/admin/support')}`] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })

const href = (text: string) => Array.from(container.querySelectorAll('a')).find((anchor) => anchor.textContent?.trim() === text)?.getAttribute('href')

it('links the evidence that still opens and leaves the rest as text (L-2.5)', () => {
  expect(href('#812')).toMatch(/^\/admin\/submissions\/812\?cohort_id=3&student_id=9&return_to=/)
  expect(href('#813')).toBeUndefined()
  expect(container.textContent).toContain('#813')
  expect(href('Sum an array')).toMatch(/^\/admin\/help-requests\/44\?return_to=/)
  expect(href('Arrays')).toMatch(/^\/lessons\/40\?cohort_id=3/)
})

it('shows the breadcrumb and links the return plan as a record', () => {
  expect(container.textContent).toContain('Back to Support')
  expect(href('Open in student page')).toBe('/admin/cohorts/3/students/9/support?plan_id=7')
})

it('opens Message with the follow-up plan as its source', async () => {
  const message = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Message')!
  await act(async () => message.click())
  await act(async () => new Promise<void>((resolve) => setTimeout(resolve, 0)))
  expect(state.createDirectConversation).toHaveBeenCalledWith({ cohort_id: 3, user_ids: [9] })
  const url = new URL(`${router.state.location.pathname}${router.state.location.search}`, 'https://csg.invalid')
  expect(url.pathname).toBe('/messages/dm/77')
  expect(url.searchParams.get('source_type')).toBe('intervention')
  expect(url.searchParams.get('source_id')).toBe('61')
  expect(url.searchParams.get('source_return_to')).toBe('/admin/support')
})
