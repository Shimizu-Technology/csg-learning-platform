// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ v2: true, receipt: vi.fn(), profile: vi.fn(), auth: { isLoading: false, isSignedIn: true, user: { id: 1, role: 'student', is_staff: false } as { id: number; role: string; is_staff: boolean } | null, enrollments: [] } }))
vi.mock('../../lib/studentExperience', () => ({ useStudentExperience: () => ({ ready: true, v2: state.v2 }) }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => state.auth }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('@clerk/clerk-react', () => ({ useClerk: () => ({ openUserProfile: vi.fn(), signOut: vi.fn() }) }))
vi.mock('../../lib/api', () => ({ api: { getProfile: state.profile, getPushConfig: async () => ({ data: { notifications_enabled: true } }), getBlockedUsers: async () => ({ data: { blocked_users: [] } }), getActivityEvents: async () => ({ data: { activity_events: [], next_before_id: null } }), getCourseReceipt: state.receipt, getCohortHome: async () => ({ error: 'Offline' }), getDashboard: async () => ({ data: { dashboard: { enrolled: false } } }) } }))
import { PrivacyPolicyPage } from '../Legal'
import { Profile } from './Profile'
import { StudentCohortHome } from './StudentCohortHome'
import { Materials } from './Materials'
import { PurchaseReceipt } from '../../components/student/PurchaseReceipt'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let container: HTMLDivElement
let root: Root
beforeEach(() => {
  state.v2 = true
  state.auth.isLoading = false
  state.auth.isSignedIn = true
  state.auth.user = { id: 1, role: 'student', is_staff: false }
  state.profile.mockResolvedValue({ data: { user: { id: 1, full_name: 'Eli Santos', email: 'eli@example.invalid', role: 'student' }, enrollments: [{ id: 1, cohort_id: 2, cohort_name: 'Python', curriculum_name: 'Python', can_open: true, enrolled_at: '2026-11-18', status: 'active', purchase_id: 3, access_expires_at: '2027-05-18' }] } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks() })
async function render(node: ReactNode) { await act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>)) }
it('public legal pages have a way back and deletion stays visible at phone widths', async () => {
  await render(<PrivacyPolicyPage />)
  expect(container.querySelector('a[href="/dashboard"]')?.textContent).toBe('Back to Today')
  expect(container.querySelector('main h1')?.textContent).toBe('Privacy policy')
  const deletion = container.querySelector('nav[aria-label="Legal navigation"] a[href="/account-deletion"]')!
  expect(deletion.className).not.toContain('hidden')
  expect(deletion.className).toContain('min-h-11')
})
it('new Profile has a 44px toggle, human activity copy, access dates and a receipt action', async () => {
  await render(<Profile />)
  expect(container.querySelector('[role="switch"]')?.className).toContain('h-11')
  expect(container.textContent).toContain('Your activity will appear here as you learn.')
  expect(container.textContent).not.toContain('backfilled')
  expect(container.textContent).toContain('Lesson access until')
  expect(container.textContent).toContain('View receipt')
  expect(container.textContent).toContain('Active')
  expect(state.receipt).not.toHaveBeenCalled()
})
it('Off Profile keeps the old toggle and activity copy', async () => {
  state.v2 = false
  const response = await state.profile()
  delete response.data.enrollments[0].purchase_id
  delete response.data.enrollments[0].access_expires_at
  state.profile.mockResolvedValue(response)
  await render(<Profile />)
  expect(container.querySelector('[role="switch"]')?.className).toContain('h-7')
  expect(container.textContent).toContain('Earlier activity was not backfilled.')
  expect(container.textContent).not.toContain('View receipt')
})
it('cohort errors and unenrolled Learn have recovery destinations', async () => {
  await render(<StudentCohortHome />)
  expect(container.querySelector('a[href="/dashboard"]')?.textContent).toBe('Back to Today')
  await render(<Materials />)
  expect(container.querySelector('a[href="/courses"]')?.textContent).toBe('Browse courses')
})
it('receipt failures allow retry and requesting a copy; success uses a safe external link', async () => {
  state.receipt.mockResolvedValueOnce({ error: 'Temporarily unavailable' }).mockResolvedValueOnce({ data: { url: 'https://pay.stripe.com/receipts/synthetic' } })
  await render(<PurchaseReceipt purchaseId={3} />)
  await act(async () => container.querySelector('button')!.click())
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Temporarily unavailable')
  expect(container.querySelector('a[href^="mailto:"]')).not.toBeNull()
  await act(async () => container.querySelector('button')!.click())
  expect(state.receipt).toHaveBeenCalledWith(3)
  expect(container.querySelector('a[href="https://pay.stripe.com/receipts/synthetic"]')?.textContent).toBe('Open receipt')
})

it('Off student recovery states keep their old markup', async () => {
  state.v2 = false
  await render(<StudentCohortHome />)
  expect(container.textContent).toContain('Could not open cohort')
  expect(container.querySelector('a[href="/dashboard"]')).toBeNull()
  await render(<Materials />)
  expect(container.textContent).toContain('No lessons yet')
  expect(container.querySelector('a[href="/courses"]')).toBeNull()
})

it('signed-out legal recovery points home without a protected Today link', async () => {
  state.auth.user = null
  state.auth.isSignedIn = false
  await render(<PrivacyPolicyPage />)
  expect(container.querySelector('main h1')?.textContent).toBe('Privacy policy')
  expect(container.querySelector('main a[href="/"]')?.textContent).toBe('Back to home')
  expect(container.querySelector('main a[href="/dashboard"]')).toBeNull()
})
it('Off learners keep legal recovery markup unchanged, with deletion still visible', async () => {
  state.v2 = false
  await render(<PrivacyPolicyPage />)
  expect(container.querySelector('main h1')?.textContent).toBe('Privacy policy')
  expect(container.querySelector('main a[href="/dashboard"]')).toBeNull()
  expect(container.querySelector('main a[href="/"]')).toBeNull()
  expect(container.querySelector('nav a[href="/account-deletion"]')?.className).not.toContain('hidden')
})
it('mixed Profile enrollments use their own server fields while the Off course is selected', async () => {
  state.v2 = false
  const response = await state.profile()
  response.data.enrollments.push({ id: 2, cohort_id: 3, cohort_name: 'Off program', curriculum_name: 'Program', status: 'active', can_open: true })
  state.profile.mockResolvedValue(response)
  await render(<Profile />)
  const enrollments = Array.from(container.querySelectorAll('li')).filter(row => row.textContent?.includes('Course:'))
  expect(enrollments.find(row => row.textContent?.includes('Python'))?.textContent).toContain('View receipt')
  expect(enrollments.find(row => row.textContent?.includes('Python'))?.textContent).toContain('Lesson access until')
  expect(enrollments.find(row => row.textContent?.includes('Off program'))?.textContent).not.toContain('View receipt')
  expect(enrollments.find(row => row.textContent?.includes('Off program'))?.textContent).not.toContain('Lesson access until')
})

it('authenticated legal loading does not flash a guest or On-only recovery link', async () => {
  state.auth.user = null
  await render(<PrivacyPolicyPage />)
  expect(container.querySelector('main a[href="/"]')).toBeNull()
  expect(container.querySelector('main a[href="/dashboard"]')).toBeNull()
})

it.each([false, true])('legal recovery waits for auth to settle (signed in: %s)', async (signedIn) => {
  state.auth.isLoading = true
  state.auth.isSignedIn = signedIn
  if (!signedIn) state.auth.user = null
  await render(<PrivacyPolicyPage />)
  expect(container.querySelector('main h1')?.textContent).toBe('Privacy policy')
  expect(container.querySelector('main a[href="/"]')).toBeNull()
  expect(container.querySelector('main a[href="/dashboard"]')).toBeNull()
  state.auth.isLoading = false
  await render(<PrivacyPolicyPage />)
  expect(container.querySelector(`main a[href="${signedIn ? '/dashboard' : '/'}"]`)?.textContent).toBe(signedIn ? 'Back to Today' : 'Back to home')
})
