// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { StudentExtensions } from './StudentExtensions'
import type { LearnerExtension } from '../../types/api'
vi.mock('../../lib/api', () => ({ api: {
  getLearnerExtensions: vi.fn(), saveLearnerExtension: vi.fn(), removeLearnerExtension: vi.fn(),
} }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const modules = [{ id: 2, name: 'Python', lessons: [{ id: 3, title: 'Final draft', release_day: 0 }] }]
const item: LearnerExtension = { id: 1, scope: 'lesson', lesson_id: 3, module_id: null, week_number: null,
  submissions_close_at: '2030-01-15T13:59:59Z', reason: 'Travel', granted_by_id: 12, granted_by_name: 'Leon Synthetic',
  granted_at: '2026-11-18T00:00:00Z', removed_at: null,
  revisions: [{ reason: 'Travel', granted_at: '2026-11-18T00:00:00Z', submissions_close_at: '2030-01-15T13:59:59Z', removed_at: null }] }
let host: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(0), 0))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
async function mount(personalPace = false, extensions = [item]) {
  vi.mocked(api.getLearnerExtensions).mockResolvedValue({ data: { personal_pace: personalPace, extensions }, error: null })
  await act(async () => root.render(<StudentExtensions enrollmentId={1} modules={modules} onSaved={vi.fn()} />))
}
async function click(label: string, scope: ParentNode = host) {
  const button = [...scope.querySelectorAll('button')].find((element) => element.textContent === label)!
  await act(async () => button.click())
}
async function type(input: HTMLTextAreaElement, text: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
it('offers a lesson default for non-pace learners, with target names, staff names and formatted history', async () => {
  await mount()
  expect(host.querySelector('select')!.value).toBe('lesson:3')
  expect(host.querySelector('option[value="final"]')).toBeNull()
  expect(host.textContent).toContain('Final draft')
  expect(host.textContent).toContain('Granted by Leon Synthetic')
  expect(host.textContent).not.toContain('staff #12')
  expect(host.textContent).not.toContain('2026-11-18T00:00:00Z')
  expect(host.textContent).not.toContain('11:59:59')
  await click('Edit')
  expect(host.querySelector('textarea')!.value).toBe('')
})
it('only offers a final-date default for pace cohorts and explains soft weeks', async () => {
  await mount(true)
  expect(host.querySelector('select')!.value).toBe('final')
  expect(host.textContent).toContain('cohort weekly close times are not enforced')
})
it('removal has independent confirmation and reason, preserving the edit reason', async () => {
  await mount(false, [item, { ...item, id: 2 }])
  await click('Edit')
  await type(host.querySelector('textarea')!, 'Reason for an edit')
  await click('Remove', host.querySelectorAll('li.rounded-xl')[1])
  const modal = document.querySelector('[role="dialog"]')!
  expect(api.removeLearnerExtension).not.toHaveBeenCalled()
  expect(modal.querySelector('textarea')!.value).toBe('')
  await type(modal.querySelector('textarea')!, 'No longer needed')
  vi.mocked(api.removeLearnerExtension).mockResolvedValue({ data: { personal_pace: false, extensions: [item, { ...item, id: 2, removed_at: "2030-01-01T00:00:00Z" }] }, error: null })
  await click('Confirm removal', modal)
  expect(api.removeLearnerExtension).toHaveBeenCalledWith(1, 2, 'No longer needed')
  expect(host.querySelector('textarea')!.value).toBe('Reason for an edit')
})

it('clears the edit draft when removing that same grant and keeps its history visible', async () => {
  await mount()
  await click('Edit')
  await type(host.querySelector('textarea')!, 'Obsolete edit')
  await click('Remove')
  const modal = document.querySelector('[role="dialog"]')!
  await type(modal.querySelector('textarea')!, 'No longer needed')
  vi.mocked(api.removeLearnerExtension).mockResolvedValue({ data: { personal_pace: false, extensions: [{ ...item, removed_at: '2030-01-01T00:00:00Z' }] }, error: null })
  await click('Confirm removal', modal)
  expect(host.querySelector('textarea')!.value).toBe('')
  expect(host.textContent).toContain('Grant extension')
  expect(host.textContent).not.toContain('Save extension change')
  expect(host.textContent).toContain('Removed')
  expect(host.textContent).toContain('Extension history (1)')
})
it('keeps writes disabled after history fails and enables them after a fresh reload', async () => {
  vi.mocked(api.getLearnerExtensions).mockResolvedValueOnce({ data: { personal_pace: false, extensions: [item] }, error: null })
  await act(async () => root.render(<StudentExtensions enrollmentId={1} modules={modules} onSaved={vi.fn()} />))
  vi.mocked(api.getLearnerExtensions).mockResolvedValueOnce({ data: null, error: 'History unavailable' })
  await act(async () => root.render(<StudentExtensions enrollmentId={2} modules={modules} onSaved={vi.fn()} />))
  expect(host.textContent).toContain('History unavailable')
  for (const label of ['Edit', 'Remove', 'Grant extension']) expect([...host.querySelectorAll('button')].find(b => b.textContent === label)!.disabled).toBe(true)
  vi.mocked(api.getLearnerExtensions).mockResolvedValueOnce({ data: { personal_pace: false, extensions: [item] }, error: null })
  await click('Reload extensions')
  expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Grant extension')!.disabled).toBe(false)
})
