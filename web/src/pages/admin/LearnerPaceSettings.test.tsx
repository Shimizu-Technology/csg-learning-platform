// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { TestRouter } from '../../test/TestRouter'
import { CohortSettings } from './CohortDetail'

const state = vi.hoisted(() => ({ getCohort: vi.fn(), updateCohort: vi.fn(), getFeatureSettings: vi.fn(), saveFeatureSettings: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: state }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { role: 'admin' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: state.error, success: state.success }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../lib/realtime', () => ({ subscribeToStaffPresence: async () => () => {} }))
vi.mock('../../components/admin/RecordingUploadManager', () => ({ RecordingUploadManager: () => null }))

it('keeps the pace choices field while its text is cleared and retyped, without touching the checkbox, and saves the new choices', async () => {
  const cohort = { id: 1, name: 'Python pilot', curriculum_id: 7, start_date: '2026-12-01', status: 'active', course_delivery: 'guided', learner_pace_weeks: [3, 4, 6], modules: [], students: [], active_count: 0 }
  state.getFeatureSettings.mockResolvedValue({ data: { features: {}, defaults: {}, overrides: {}, public_catalog_mode: 'automatic', review_response_time_override: null, review_response_time_default: 'usually reviewed within 2 days' } })
  state.getCohort.mockResolvedValue({ data: { cohort } })
  state.updateCohort.mockImplementation(async (_id: number, patch: Record<string, unknown>) => ({ data: { cohort: { ...cohort, ...patch } } }))
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const choices = () => host.querySelector<HTMLInputElement>('section[aria-labelledby="learner-pace-heading"] input[type="text"]')
  const checkbox = () => host.querySelector<HTMLInputElement>('section[aria-labelledby="learner-pace-heading"] input[type="checkbox"]')!
  const type = async (value: string) => act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(choices()!, value)
    choices()!.dispatchEvent(new Event('input', { bubbles: true }))
  })
  try {
    await act(async () => root.render(<TestRouter initialEntries={['/admin/cohorts/1?tab=settings']}><Routes><Route path="/admin/cohorts/:id" element={<CohortSettings />} /></Routes></TestRouter>))
    expect(checkbox().checked).toBe(true)
    expect(choices()!.value).toBe('3, 4, 6')
    await type('')
    expect(choices(), 'still mounted after clearing').not.toBeNull()
    expect(checkbox().checked).toBe(true)
    await type('2, 5')
    expect(choices()!.value).toBe('2, 5')
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Save settings')!.click())
    expect(state.error).not.toHaveBeenCalled()
    expect(state.updateCohort).toHaveBeenCalledWith(1, expect.objectContaining({ learner_pace_weeks: [2, 5] }))

    // Cleared and saved while still on: refused with the reason, nothing sent.
    state.updateCohort.mockClear()
    await type(' , ')
    await act(async () => [...host.querySelectorAll('button')].find((button) => button.textContent === 'Save settings')!.click())
    expect(state.updateCohort).not.toHaveBeenCalled()
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('at least one pace'))
  } finally { act(() => root.unmount()); host.remove(); vi.clearAllMocks() }
})
