// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MessageAuthorContext } from './MessageAuthorContext'
import type { ChannelMessage } from '../../types/api'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const getUser = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api', () => ({ api: { getUser } }))
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
