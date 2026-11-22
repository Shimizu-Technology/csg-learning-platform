// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom'
import { StudentExperienceProvider } from '../../lib/studentExperience'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { MessageAuthorContext } from './MessageAuthorContext'
import type { MessageView as ChannelMessage } from '../../types/api'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const features = vi.hoisted(() => ({ private_meetings: false }))
const support = vi.hoisted(() => ({ delivery: 'program', mode: 'course_question', help: true, instructorId: 7 as number | null }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohort: { id: 1, features, course_delivery: support.delivery, capabilities: { support_mode: support.mode, support_instructor_id: support.instructorId, features: { ...features, help_requests: support.help } } } }) }))
const getUser = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', () => ({ api: { getUser, getAvailableDirectUsersForCohort: vi.fn().mockResolvedValue({ data: { users: [{ id: 7 }] } }) } }))
vi.mock('../admin/StudentContextDrawer', () => ({ StudentContextDrawer: ({ cohortId, studentId, onClose }: { cohortId: number; studentId: number; onClose: () => void }) => <div role="dialog">Student {studentId}, cohort {cohortId}<button onClick={onClose}>Close context</button></div> }))
const author: ChannelMessage['author'] = { id: 7, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', avatar_url: null }
const enrollments = [{ id: 11, cohort_id: 1, cohort_name: 'Python', status: 'active' }, { id: 12, cohort_id: 2, cohort_name: 'Web', status: 'completed' }]
let root: Root
let host: HTMLDivElement
beforeEach(() => { getUser.mockReset().mockResolvedValue({ data: { enrollments }, error: null }); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.querySelectorAll('[data-state="closing"]').forEach((node) => node.remove()) })
it('requires an enrollment choice in a community and opens only the chosen cohort', async () => {
  await act(async () => root.render(<MessageAuthorContext author={author} staff onClose={() => {}} />))
  expect(document.body.textContent).toContain('Which enrollment')
  expect(host.textContent).not.toContain('Student 7, cohort')
  const button = [...document.querySelectorAll('button')].find((node) => node.textContent === 'Web · completed')!
  await act(async () => button.click())
  expect(host.textContent).toContain('Student 7, cohort 2')
})
it('uses the explicitly matching cohort, even for a learner with multiple enrollments', async () => {
  await act(async () => root.render(<MessageAuthorContext author={author} staff cohortId={1} onClose={() => {}} />))
  expect(host.textContent).toContain('Student 7, cohort 1')
})
it('does not guess when the conversation cohort is not an accessible enrollment', async () => {
  await act(async () => root.render(<MessageAuthorContext author={author} staff cohortId={99} onClose={() => {}} />))
  expect(document.body.textContent).toContain('Which enrollment')
})
it('shows students a profile without requesting staff records', async () => {
  await act(async () => root.render(<MessageAuthorContext author={author} staff={false} onClose={() => {}} />))
  expect(document.body.textContent).toContain('Maya Santos')
  expect(getUser).not.toHaveBeenCalled()
  expect(document.body.textContent).not.toContain('enrollment')
})
it('offers retry on an unavailable lookup, and an honest empty state', async () => {
  getUser.mockResolvedValueOnce({ data: null, error: 'Offline' }).mockResolvedValueOnce({ data: { enrollments: [] }, error: null })
  await act(async () => root.render(<MessageAuthorContext author={author} staff onClose={() => {}} />))
  expect(document.body.textContent).toContain('Offline')
  await act(async () => (document.querySelector('[aria-label="Retry Student enrollments"]') as HTMLButtonElement).click())
  expect(document.body.textContent).toContain('No accessible enrollments')
})

// An Off or unresolved experience keeps the old name-and-role-only popover.
it('adds actions only On and respects the resolved private-meetings switch', async () => {
  const instructor = { ...author, role: 'instructor' as const }
  const tree = (v2: boolean) => <MemoryRouter><StudentExperienceProvider v2={v2}><MessageAuthorContext author={instructor} staff={false} cohortId={1} onClose={() => {}} /></StudentExperienceProvider></MemoryRouter>
  features.private_meetings = false
  await act(async () => root.render(tree(false)))
  expect(document.body.textContent).not.toContain('Message Maya Santos')
  await act(async () => root.render(tree(true)))
  expect(document.body.textContent).toContain('Message Maya Santos')
  expect(document.body.textContent).not.toContain('Book a meeting')
  features.private_meetings = true
  await act(async () => root.render(tree(true)))
  expect(document.querySelector('a[href="/meetings?cohort_id=1&instructor_id=7"]')).not.toBeNull()
  features.private_meetings = false
})

it('hides Message and Book a meeting for blocked people in the author popover', async () => {
  features.private_meetings = true
  vi.mocked(api.getAvailableDirectUsersForCohort).mockResolvedValueOnce({ data: { users: [] }, error: null })
  try {
    await act(async () => root.render(<MemoryRouter><StudentExperienceProvider v2><MessageAuthorContext author={{ ...author, role: 'instructor' }} staff={false} cohortId={1} onClose={() => {}} /></StudentExperienceProvider></MemoryRouter>))
    expect(document.body.textContent).not.toContain('Message Maya')
    expect(document.body.textContent).not.toContain('Book a meeting')
  } finally { features.private_meetings = false }
})

it.each(['none', 'expired', 'help off'])('hides instructor contact in self-paced author profiles when support is %s', async mode => {
  support.delivery = 'self_paced'
  support.mode = mode === 'help off' ? 'course_question' : 'none'
  support.help = mode !== 'help off'
  features.private_meetings = true
  try {
    await act(async () => root.render(<MemoryRouter><StudentExperienceProvider v2><MessageAuthorContext author={{ ...author, role: 'instructor' }} staff={false} cohortId={1} onClose={() => {}} /></StudentExperienceProvider></MemoryRouter>))
    expect(document.body.textContent).not.toContain('Message Maya')
    expect(document.body.textContent).not.toContain('Book a meeting')
  } finally { support.delivery = 'program'; support.mode = 'course_question'; support.help = true; features.private_meetings = false }
})

it('shows Message for the support instructor but never for a peer in self-paced peer space', async () => {
  support.delivery = 'self_paced'
  support.mode = 'course_question'
  support.help = true
  support.instructorId = 7
  try {
    await act(async () => root.render(<MemoryRouter><StudentExperienceProvider v2><MessageAuthorContext author={{ ...author, id: 7, role: 'instructor' }} staff={false} cohortId={1} onClose={() => {}} /></StudentExperienceProvider></MemoryRouter>))
    expect(document.body.textContent).toContain('Message Maya Santos')
    await act(async () => root.render(<MemoryRouter><StudentExperienceProvider v2><MessageAuthorContext author={{ ...author, id: 88, full_name: 'Peer Student', role: 'student' }} staff={false} cohortId={1} onClose={() => {}} /></StudentExperienceProvider></MemoryRouter>))
    expect(document.body.textContent).toContain('Peer Student')
    expect(document.body.textContent).not.toContain('Message Peer Student')
  } finally { support.delivery = 'program'; support.mode = 'course_question'; support.help = true; support.instructorId = 7 }
})
