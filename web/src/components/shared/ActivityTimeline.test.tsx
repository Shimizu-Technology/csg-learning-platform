// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ActivityTimeline } from './ActivityTimeline'
import type { ActivityEvent, ActivityEventsResponse } from '../../types/api'

const { getActivityEvents } = vi.hoisted(() => ({ getActivityEvents: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { getActivityEvents } }))
const base = { actor: { id: 20, name: 'Learner', role: 'student' }, subject_user_id: 20, cohort_id: 4, cohort_name: 'Cohort 4', record_type: 'Submission', record_id: 800, record_label: 'Arrays', evidence: 'server_record' as const, created_at: '2026-10-22T00:00:00Z' }
const rows: ActivityEvent[] = [
  { ...base, id: 10, event_type: 'submission_created', destination: { kind: 'submission', cohort_id: 4, student_id: 20, submission_id: 800 } },
  { ...base, id: 9, event_type: 'video_started', destination: { kind: 'lesson', destination_path: '/lessons/77?cohort_id=9#block-700', cohort_id: 9, student_id: 20, lesson_id: 77, content_block_id: 700 } },
  { ...base, id: 8, event_type: 'recording_started', destination: { kind: 'recording', destination_path: '/recordings?cohort_id=4&recording=91', cohort_id: 4, student_id: 20, recording_id: 91 } },
  { ...base, id: 7, event_type: 'account_signed_in', destination: null },
  { ...base, id: 6, event_type: 'video_started', record_label: 'Deleted', destination: null },
]
let root: Root
let container: HTMLDivElement
function Location() { const location = useLocation(); const navigate = useNavigate(); return <><output>{location.pathname}{location.search}{location.hash}</output><button onClick={() => navigate(-1)}>Back</button></> }
function render(cohortId = 4) {
  root.render(<MemoryRouter initialEntries={['/admin/cohorts/4/students/20/activity']}><Location /><Routes><Route path="/admin/cohorts/4/students/20/activity" element={<ActivityTimeline userId={20} cohortId={cohortId} />} /><Route path="*" element={<p>Destination</p>} /></Routes></MemoryRouter>)
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button,a')).find((item) => item.textContent === text)
  expect(button).toBeTruthy()
  await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })))
}
beforeEach(() => {
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  getActivityEvents.mockReset().mockResolvedValue({ data: { activity_events: rows, next_before_id: null } })
})
afterEach(async () => { await act(async () => root.unmount()); container.remove() })

describe('ActivityTimeline', () => {
  it('scopes every load by enrollment and builds links from each event authorized context', async () => {
    await act(async () => render())
    expect(getActivityEvents).toHaveBeenCalledWith({ user_id: 20, cohort_id: 4, category: undefined, before_id: undefined })
    const links = Array.from(container.querySelectorAll('a'))
    expect(links).toHaveLength(3)
    expect(links[0].getAttribute('href')).toContain('/admin/submissions/800?cohort_id=4&student_id=20&return_to=')
    expect(links[1].getAttribute('href')).toBe('/lessons/77?cohort_id=9#block-700')
    expect(links[2].getAttribute('href')).toBe('/recordings?cohort_id=4&recording=91')
    expect(container.querySelectorAll('li')[3].querySelector('a')).toBeNull()
    expect(container.querySelectorAll('li')[4].querySelector('a')).toBeNull()
    await click('Work')
    expect(getActivityEvents).toHaveBeenLastCalledWith({ user_id: 20, cohort_id: 4, category: 'work', before_id: undefined })
    expect(container.querySelector('a')!.getAttribute('href')).toContain('activity_category%3Dwork')
    await click('Open submission')
    expect(container.textContent).toContain('Destination')
    await click('Back')
    expect(container.querySelector('button[aria-pressed="true"]')!.textContent).toBe('Work')
    expect(getActivityEvents).toHaveBeenLastCalledWith({ user_id: 20, cohort_id: 4, category: 'work', before_id: undefined })
  })
  it('ignores late responses from another cohort and scopes pagination', async () => {
    let resolve!: (response: { data: ActivityEventsResponse }) => void
    getActivityEvents.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    await act(async () => render())
    getActivityEvents.mockResolvedValueOnce({ data: { activity_events: [{ ...rows[0], id: 12, record_label: 'New cohort' }], next_before_id: 12 } })
    await act(async () => render(9))
    expect(getActivityEvents).toHaveBeenLastCalledWith({ user_id: 20, cohort_id: 9, category: undefined, before_id: undefined })
    await act(async () => resolve({ data: { activity_events: rows, next_before_id: 6 } }))
    expect(container.textContent).not.toContain('Deleted')
    expect(container.textContent).toContain('New cohort')
    getActivityEvents.mockResolvedValueOnce({ error: 'Offline' })
    await click('Show earlier activity')
    expect(getActivityEvents).toHaveBeenLastCalledWith({ user_id: 20, cohort_id: 9, category: undefined, before_id: 12 })
    expect(container.textContent).toContain('Offline')
    expect(container.textContent).toContain('New cohort')
  })
})
