// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { SupportQueue } from './SupportQueue'
const state = vi.hoisted(() => ({ due: false }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../lib/api', () => ({ api: {} }))
vi.mock('../../lib/useStaffResource', () => ({ useStaffResource: () => ({ loading: false, error: null, reload: vi.fn(), data: {
  summary: { open_help_count: 0, active_intervention_count: state.due ? 1 : 0, due_follow_up_count: state.due ? 1 : 0, due_recovery_check_in_count: state.due ? 1 : 0 }, help_requests: [], recently_resolved: [], students: [],
  interventions: state.due ? [{ id: 5, severity: 'normal', trigger_type: 'manual', owner: { full_name: 'Teacher' }, follow_up_due: true, next_follow_up_at: '2026-10-01T00:00:00Z', enrollment: { student: { full_name: 'Learner' }, cohort: { name: 'Pilot' } } }] : [],
  recovery_plans: state.due ? [{ id: 6, check_in_due: true, intervention_id: 5, target_pace: 'Weekly return', next_check_in_at: '2026-10-01T00:00:00Z', enrollment: { student: { id: 20, full_name: 'Learner' }, cohort: { id: 4, name: 'Pilot' } } }] : [],
} }) }))
it('collapses empty cases and recovery sections while due records open visibly', async () => {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => root.render(<MemoryRouter><SupportQueue /></MemoryRouter>))
    let sections = Array.from(container.querySelectorAll('details'))
    expect(sections.map((item) => item.open)).toEqual([false, false])
    expect(sections[0].querySelector('summary')?.textContent).toBe('No open cases')
    expect(sections[1].querySelector('summary')?.textContent).toBe('No active recovery plans')
    state.due = true
    await act(async () => root.render(<MemoryRouter><SupportQueue /></MemoryRouter>))
    sections = Array.from(container.querySelectorAll('details'))
    expect(sections.map((item) => item.open)).toEqual([true, true])
    expect(container.textContent).toContain('Follow-up due')
    expect(container.textContent).toContain('Check-in due')
    expect(container.querySelector('a[href*="/admin/interventions/5"]')).toBeTruthy()
  } finally { act(() => root.unmount()); container.remove(); state.due = false }
})
