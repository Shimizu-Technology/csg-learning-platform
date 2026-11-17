// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { TestRouter } from '../../test/TestRouter'
import { CohortSettings } from './CohortDetail'

const state = vi.hoisted(() => ({ getCohort: vi.fn(), getFeatureSettings: vi.fn(), saveFeatureSettings: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: state }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { role: 'admin' } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: state.error, success: state.success }) }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
vi.mock('../../lib/realtime', () => ({ subscribeToStaffPresence: async () => () => {} }))
vi.mock('../../components/admin/RecordingUploadManager', () => ({ RecordingUploadManager: () => null }))

it('saves a return to the original review phrase after PATCH succeeded but cohort refresh failed', async () => {
  const original = 'usually reviewed within 2 days'
  let persisted = original
  const cohort = { id: 1, name: 'Pilot', curriculum_id: 7, start_date: '2026-12-01', status: 'active', course_delivery: 'program', modules: [], students: [], active_count: 0 }
  const features = () => ({ features: {}, defaults: {}, overrides: {}, public_catalog_mode: 'automatic', review_response_time_override: persisted, review_response_time_default: original })
  state.getFeatureSettings.mockImplementation(async () => ({ data: features() }))
  state.getCohort.mockResolvedValueOnce({ data: { cohort } }).mockResolvedValue({ error: 'Offline' })
  state.saveFeatureSettings.mockImplementation(async (patch: { review_response_time: string }) => { persisted = patch.review_response_time; return { data: features() } })
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host)
  const setPhrase = async (value: string) => act(async () => {
    const input = [...host.querySelectorAll('label')].find(label => label.textContent?.startsWith('Typical response time'))!.querySelector('input')!
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  const save = async () => act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Save settings')!.click())
  try {
    await act(async () => root.render(<TestRouter initialEntries={['/admin/cohorts/1?tab=settings']}><Routes><Route path="/admin/cohorts/:id" element={<CohortSettings />} /></Routes></TestRouter>))
    await setPhrase('usually reviewed within 3 days'); await save()
    expect(persisted).toBe('usually reviewed within 3 days')
    expect(state.error).toHaveBeenCalledWith(expect.stringContaining('Some settings may have saved'))
    await setPhrase(original)
    const leaving = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(leaving)
    expect(leaving.defaultPrevented).toBe(true)
    await save()
    expect(state.saveFeatureSettings).toHaveBeenLastCalledWith({ review_response_time: original }, 1)
    expect(state.saveFeatureSettings).toHaveBeenCalledTimes(2)
    expect(persisted).toBe(original)
  } finally { act(() => root.unmount()); host.remove(); vi.clearAllMocks() }
})
