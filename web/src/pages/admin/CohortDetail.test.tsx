import { TestRouter as MemoryRouter } from '../../test/TestRouter'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { CohortSettings as CohortDetail } from './CohortDetail'

const state = vi.hoisted(() => ({ confirm: vi.fn(), deleteOfficeHour: vi.fn(), getCohort: vi.fn(), updateCohort: vi.fn(), updateCohortModuleAccess: vi.fn(), updateCohortModuleSubmissionWindows: vi.fn(), updateCohortClassResources: vi.fn(), createUser: vi.fn(), createEnrollment: vi.fn(), error: vi.fn(), success: vi.fn(), role: 'admin', getCohortInstructorAssignments: vi.fn(), saveFeatureSettings: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { role: state.role } }) }))
vi.mock('../../lib/api', () => ({ api: state }))
vi.mock('../../lib/realtime', () => ({ subscribeToStaffPresence: async () => () => {} }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: state.error, success: state.success }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => state.confirm }))
vi.mock('../../components/admin/RecordingUploadManager', () => ({ RecordingUploadManager: () => null }))

let container: HTMLDivElement
let root: Root
const button = (text: string) => [...container.querySelectorAll('button')].find((el) => el.textContent === text)!

vi.mock('../../components/admin/FeatureSettings', () => ({ FeatureSettings: () => null }))
vi.mock('../../components/admin/ReleaseCommunicationsPanel', () => ({ ReleaseCommunicationsPanel: () => null }))
vi.mock('../../components/admin/ReviewResponseSettings', () => ({
  ReviewResponseSettings: ({ onDraftChange }: { onDraftChange: (value: string) => void }) => (
    <label>Typical response time<input id="review-response-time-test" onChange={e => onDraftChange(e.target.value)} /></label>
  ),
}))
const cohort = { id: 1, name: 'Pilot', curriculum_id: 7, curriculum_name: 'Python', start_date: '2026-12-01', status: 'active', modules: [], students: [], active_count: 0 }
const render = async () => { await act(async () => root.render(<MemoryRouter initialEntries={['/admin/cohorts/1?tab=settings']}><Routes><Route path="/admin/cohorts/:id" element={<CohortDetail />} /></Routes></MemoryRouter>)) }
const input = async (selector: string, value: string) => { await act(async () => { const el = container.querySelector(selector)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })) }) }
beforeEach(() => {
  vi.clearAllMocks(); state.role = 'admin'
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  state.getCohort.mockResolvedValue({ data: { cohort } }); state.updateCohort.mockImplementation(async (_id, patch) => ({ data: { cohort: { ...cohort, ...patch } } }))
})
afterEach(() => { act(() => root.unmount()); container.remove() })
it('shows load errors and retries, including rejected requests', async () => {
  state.getCohort.mockRejectedValueOnce(new Error('offline')); await render()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Could not load')
  await act(async () => button('Retry settings').click())
  expect(container.textContent).toContain('Cohort settings')
})
it('saves date and GitHub together, retains edits after failure, and guards query navigation', async () => {
  await render(); await input('[aria-label="Cohort start date"]', '2026-12-09'); await input('#cohort-github-organization', 'qa-org')
  const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
  state.updateCohort.mockResolvedValueOnce({ error: 'offline' })
  await act(async () => button('Save settings').click()); expect((container.querySelector('#cohort-github-organization') as HTMLInputElement).value).toBe('qa-org')
  state.getCohort.mockResolvedValue({ data: { cohort: { ...cohort, start_date: '2026-12-09', github_organization_name: 'qa-org' } } })
  await act(async () => button('Save settings').click())
  expect(state.updateCohort).toHaveBeenLastCalledWith(1, expect.objectContaining({ start_date: '2026-12-09', github_organization_name: 'qa-org' }))
  const saved = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(saved); expect(saved.defaultPrevented).toBe(false)
})
it('confirms archive consequences before staging and saves only through the unified action', async () => {
  await render(); state.confirm.mockResolvedValueOnce(false)
  await act(async () => button('Archived').click()); expect(button('Active').getAttribute('aria-pressed')).toBe('true')
  state.confirm.mockResolvedValueOnce(true); await act(async () => button('Archived').click())
  expect(state.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Archive cohort?', description: expect.stringContaining('progress and recordings are kept') }))
  expect(state.updateCohort).not.toHaveBeenCalled()
  await act(async () => button('Save settings').click()); expect(state.updateCohort).toHaveBeenCalledWith(1, expect.objectContaining({ status: 'archived' }))
})
it('links back to its cohort and edits shared content through Content', async () => {
  await render(); expect(container.querySelector('a[href="/admin/cohorts/1"]')?.textContent).toContain('Back to Pilot')
  expect(container.querySelector('a[href="/admin/content?open="]')?.textContent).toContain('Edit shared curriculum')
  expect(container.textContent).toContain('changes every cohort'); expect(container.textContent).not.toContain('Add module')
})

it('retains every draft when a later module request fails and finishes the same save on retry', async () => {
  const mod = { id: 2, name: 'Functions', module_type: 'prework', lessons_count: 1, assigned: false, unlocked_count: 0 }
  const withModule = { ...cohort, modules: [mod] }
  state.getCohort.mockResolvedValue({ data: { cohort: withModule } })
  state.updateCohortModuleAccess.mockResolvedValueOnce({ error: 'Unavailable' }).mockResolvedValue({ data: {} })
  await render(); await input('#cohort-github-organization', 'qa-retry')
  await act(async () => button('Assign').click())
  // Closing configuration retains the staged assignment, rather than making a separate request.
  await act(async () => [...document.querySelectorAll('button')].find(el => el.textContent?.trim() === 'Done editing module')!.click())
  await act(async () => button('Save settings').click())
  expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Your edits are preserved'))
  expect((container.querySelector('#cohort-github-organization') as HTMLInputElement).value).toBe('qa-retry')
  state.getCohort.mockResolvedValue({ data: { cohort: { ...withModule, github_organization_name: 'qa-retry', modules: [{ ...mod, assigned: true }] } } })
  await act(async () => button('Save settings').click())
  expect(state.updateCohortModuleAccess).toHaveBeenLastCalledWith(1, expect.objectContaining({ module_id: 2, assigned: true }))
  expect(state.success).toHaveBeenLastCalledWith('Cohort settings saved')
})

it('sends only a changed GitHub field, preserving concurrent status and delivery edits', async () => {
  await render(); await input('#cohort-github-organization', 'changed-org')
  await act(async () => button('Save settings').click())
  expect(state.updateCohort).toHaveBeenCalledWith(1, { github_organization_name: 'changed-org' })
})
it('clears guided terms when switching a guided cohort to a live program', async () => {
  state.getCohort.mockResolvedValue({ data: { cohort: { ...cohort, course_delivery: 'guided', guided_access_ends_on: '2027-03-01', guided_support_ends_on: '2027-02-01', guided_access_months: 12, guided_support_weeks: 8 } } })
  await render()
  await act(async () => container.querySelector<HTMLInputElement>('input[type=radio][value=program]')!.click())
  await act(async () => button('Save settings').click())
  expect(state.updateCohort).toHaveBeenCalledWith(1, { course_delivery: 'program', guided_access_ends_on: null, guided_support_ends_on: null, guided_access_months: null, guided_support_weeks: null })
})
it('assigns a module mid-cohort without pinning its legacy start date', async () => {
  const mod = { id: 2, name: 'Functions', module_type: 'prework', lessons_count: 1, assigned: false, module_start_date: '2026-01-01', unlocked_count: 0 }
  state.getCohort.mockResolvedValue({ data: { cohort: { ...cohort, modules: [mod] } } })
  state.updateCohortModuleAccess.mockResolvedValue({ data: {} })
  await render(); await act(async () => button('Assign').click())
  await act(async () => button('Done editing module').click())
  await act(async () => button('Save settings').click())
  expect(state.updateCohortModuleAccess.mock.calls[0][1]).not.toHaveProperty('module_start_date')
  expect(state.updateCohort).not.toHaveBeenCalled()
})
it.each(['upcoming', 'completed', 'archived'])('explains %s catalog and attention consequences before staging', async status => {
  await render(); await act(async () => button(status[0].toUpperCase() + status.slice(1)).click())
  const options = state.confirm.mock.calls[0][0]
  expect(options.description).toContain('catalog and checkout')
  expect(options.description).toContain('attention lists')
  if (status !== 'upcoming') { expect(options.description).toContain('direct messages become read-only'); expect(options.description).toContain('instructor help stops') }
  if (status === 'archived') expect(options.tone).toBe('danger')
})

it('blocks implicit Enter submission in module inputs', async () => {
  state.getCohort.mockResolvedValue({ data: { cohort: { ...cohort, modules: [{ id: 2, name: 'Functions', module_type: 'prework', lessons_count: 1, assigned: false, module_start_date: '2026-01-01', unlocked_count: 0 }] } } })
  await render(); await act(async () => button('Assign').click())
  const field = container.querySelector('[role="dialog"] input')!
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  await act(async () => field.dispatchEvent(event))
  expect(event.defaultPrevented).toBe(true); expect(state.updateCohort).not.toHaveBeenCalled()
})

it('guards and saves an unsaved response-time edit through Save settings', async () => {
  state.saveFeatureSettings.mockResolvedValue({ data: {} })
  await render()
  await input('#review-response-time-test', 'usually reviewed within 3 days')
  const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving)
  expect(leaving.defaultPrevented).toBe(true)
  await act(async () => button('Save settings').click())
  expect(state.saveFeatureSettings).toHaveBeenCalledWith({ review_response_time: 'usually reviewed within 3 days' }, 1)
  const saved = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(saved)
  expect(saved.defaultPrevented).toBe(false)
})
