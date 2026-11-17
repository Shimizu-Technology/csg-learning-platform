import { TestRouter } from '../../test/TestRouter'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Link, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { planProblems, StudentLearningPlan } from './StudentLearningPlan'
import type { LearningPlanEditorLesson, LearningPlanManagement } from '../../types/api'

const { getPlan, savePlan } = vi.hoisted(() => ({ getPlan: vi.fn(), savePlan: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { getLearningPlan: getPlan, saveLearningPlan: savePlan } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const lesson = (id: number, title: string, extra: Partial<LearningPlanEditorLesson> = {}): LearningPlanEditorLesson => ({ id, title, module_id: 1, module_name: 'Live class', standard_required: true, week: 1, status: 'open', completed: false, ...extra })
const regular: LearningPlanManagement = { learning_plan: null, lessons: [lesson(12, 'Backend project')], revisions: [] }
// About what production looks like: finished prework, then live weeks.
const course: LearningPlanManagement = {
  learning_plan: null,
  revisions: [],
  lessons: [
    lesson(1, 'Install your tools', { module_id: 7, module_name: 'Prework', week: 1, status: 'done', completed: true }),
    lesson(2, 'HTML basics', { module_id: 7, module_name: 'Prework', week: 1, status: 'done', completed: true }),
    lesson(3, 'Variables', { module_id: 8, module_name: 'JavaScript Foundations', week: 1 }),
    lesson(4, 'Loops', { module_id: 8, module_name: 'JavaScript Foundations', week: 1, status: 'redo' }),
    lesson(5, 'Arrays and objects', { module_id: 8, module_name: 'JavaScript Foundations', week: 2, status: 'awaiting_review', completed: true }),
    lesson(6, 'Functions recap', { module_id: 8, module_name: 'JavaScript Foundations', week: 2, standard_required: false }),
    lesson(7, 'Components', { module_id: 9, module_name: 'React', week: 3 }),
  ],
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  vi.clearAllMocks()
  getPlan.mockResolvedValue({ data: regular })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0))
  vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })

function Where() { return <p data-testid="where">{useLocation().pathname}</p> }
async function mount() { await act(async () => root.render(<TestRouter><StudentLearningPlan enrollmentId={8} cohortId={3} onSaved={vi.fn()} /><Link to="/elsewhere">Elsewhere</Link><Where /></TestRouter>)) }
const buttons = () => [...container.querySelectorAll('button')]
async function click(text: string) { const button = buttons().find((element) => element.textContent === text); expect(button, text).toBeTruthy(); await act(async () => button!.click()) }
function setValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}
async function title(value: string) { const input = container.querySelector<HTMLInputElement>('input[maxlength="160"]')!; await act(async () => setValue(input, value)) }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }
// Modals render in place; closing one leaves an inert exit copy in document, so look inside the mount.
const dialog = () => container.querySelector<HTMLElement>('[role="dialog"]')
const option = (name: string) => [...dialog()!.querySelectorAll('label')].find((label) => label.textContent?.includes(name))?.querySelector('input') as HTMLInputElement | undefined
async function milestone(name: string, due: string) {
  await click('Add milestone')
  const inputs = [...container.querySelectorAll<HTMLInputElement>('fieldset fieldset input')]
  await act(async () => { setValue(inputs.at(-2)!, name); setValue(inputs.at(-1)!, due) })
}

it('uses regular curriculum until staff explicitly customize and save', async () => {
  await mount(); expect(container.textContent).toContain('Regular curriculum'); expect(savePlan).not.toHaveBeenCalled()
  await click('Customize plan'); await title('Finish the application'); await click('Cancel'); expect(savePlan).not.toHaveBeenCalled()
})

it('keeps the draft after a failed save and offers an explicit reload next to the save button', async () => {
  savePlan.mockResolvedValue({ data: null, error: 'Learning plan changed. Reload before saving.' })
  await mount(); await click('Customize plan'); await title('Keep my draft'); await submit()
  const bar = container.querySelector('[data-testid="plan-save-bar"]')!
  expect(bar.querySelector('[role="alert"]')?.textContent).toContain('Learning plan changed')
  expect(container.querySelector<HTMLInputElement>('input[maxlength="160"]')?.value).toBe('Keep my draft')
  expect(bar.textContent).toContain('Reload latest plan')
})

it('restores regular curriculum after confirmation and includes the current version', async () => {
  const personal: LearningPlanManagement = { ...regular, learning_plan: { id: 4, active: true, title: 'Personal finish', description: null, target_date: null, next_check_in_on: null, milestones: [], lesson_overrides: [], lock_version: 3, updated_at: '2026-10-24T10:00:00Z' } }
  getPlan.mockResolvedValue({ data: personal }); savePlan.mockResolvedValue({ data: regular })
  await mount(); await click('Return to regular curriculum'); expect(savePlan).not.toHaveBeenCalled(); await click('Restore regular curriculum')
  expect(savePlan).toHaveBeenCalledWith(8, expect.objectContaining({ active: false, lock_version: 3 }))
})

it('starts editing a restored plan clean and protects subsequent edits', async () => {
  getPlan.mockResolvedValue({ data: { ...regular, learning_plan: { id: 4, active: false, title: 'Restored plan', description: null, target_date: null, next_check_in_on: null, milestones: [], lesson_overrides: [], lock_version: 1, updated_at: '2026-10-24T10:00:00Z' } } })
  await mount(); await click('Customize plan')
  let event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
  expect(container.querySelector('[data-testid="plan-save-bar"]')?.textContent).toContain('No changes yet')
  await title('Changed plan')
  expect(container.querySelector('[data-testid="plan-save-bar"]')?.textContent).toContain('Unsaved changes')
  event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(true)
})

it('builds a plan from scratch with a searchable picker that hides finished lessons and adds a module’s remaining lessons', async () => {
  getPlan.mockResolvedValue({ data: course })
  savePlan.mockImplementation(async (_id, value) => ({ data: { ...course, learning_plan: { ...value, id: 9, lock_version: 0, updated_at: '2026-11-17T00:00:00Z' } } }))
  await mount(); await click('Customize plan')
  // No native lesson dropdown any more.
  expect(container.querySelector('select[aria-label^="Add lesson"]')).toBeNull()
  await milestone('Catch up on JavaScript', '2026-11-28')
  await click('Add lessons')
  expect(dialog()?.textContent).toContain('Add lessons to Milestone 1: Catch up on JavaScript')
  // Grouped by module and week; finished prework and work waiting for review are hidden.
  expect(dialog()!.querySelectorAll('section h3')).toHaveLength(2)
  expect(dialog()!.textContent).toContain('Week 2')
  expect(option('Install your tools')).toBeUndefined()
  expect(option('Arrays and objects')).toBeUndefined()
  expect(dialog()!.textContent).toContain('Show finished lessons (3)')
  await click('Select all remaining (3)')
  expect(option('Variables')?.checked && option('Loops')?.checked && option('Functions recap')?.checked).toBe(true)
  expect(option('Components')?.checked).toBe(false)
  await click('Add 3 lessons')
  expect(dialog()).toBeNull()
  expect(container.textContent).toContain('3 lessons planned · 1 lesson unfinished and not in a milestone')

  // A second milestone can't take lessons the first already has, and says where they are.
  await milestone('React', '2026-12-05')
  await act(async () => buttons().filter((element) => element.textContent === 'Add lessons').at(-1)!.click())
  expect(dialog()!.textContent).toContain('In Milestone 1')
  expect(option('Variables')?.disabled).toBe(true)
  const search = dialog()!.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => setValue(search, 'week 3'))
  expect(option('Variables')).toBeUndefined()
  await act(async () => option('Components')!.click())
  await click('Add 1 lesson')

  await submit()
  expect(savePlan).toHaveBeenCalledWith(8, expect.objectContaining({
    active: true,
    milestones: [
      { title: 'Catch up on JavaScript', due_on: '2026-11-28', lesson_ids: [3, 4, 6] },
      { title: 'React', due_on: '2026-12-05', lesson_ids: [7] },
    ],
  }))
  expect(container.textContent).toContain('The student now sees this plan')
})

it('supports the keyboard: Down from search, Down/Up between lessons, Ctrl+Enter adds', async () => {
  getPlan.mockResolvedValue({ data: course })
  await mount(); await click('Customize plan'); await milestone('Next', '2026-11-28'); await click('Add lessons')
  const search = dialog()!.querySelector<HTMLInputElement>('input[type="search"]')!
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
  expect(document.activeElement).toBe(search)
  const key = (target: Element, init: KeyboardEventInit) => act(async () => { target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })) })
  await key(search, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(option('Variables'))
  await key(document.activeElement!, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(option('Loops'))
  await act(async () => (document.activeElement as HTMLInputElement).click())
  await key(document.activeElement!, { key: 'ArrowUp' })
  await key(document.activeElement!, { key: 'ArrowUp' })
  expect(document.activeElement).toBe(search)
  await key(search, { key: 'Enter', ctrlKey: true })
  expect(dialog()).toBeNull()
  expect(container.querySelector('[aria-label="Lessons in milestone 1"]')?.textContent).toContain('Loops')
})

it('adds requirement exceptions from the same picker, flipping the regular requirement', async () => {
  getPlan.mockResolvedValue({ data: course })
  await mount(); await click('Customize plan'); await click('Add requirement exceptions')
  expect(dialog()!.textContent).toContain('Would become required')
  await act(async () => option('Functions recap')!.click())
  await click('Add 1 lesson')
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Requirement for Functions recap"]')?.value).toBe('true')
})

it('says what blocks saving in the save bar without calling the server', async () => {
  getPlan.mockResolvedValue({ data: course })
  await mount(); await click('Customize plan'); await milestone('Empty', '2026-11-28'); await submit()
  expect(savePlan).not.toHaveBeenCalled()
  expect(container.querySelector('[data-testid="plan-save-bar"] [role="alert"]')?.textContent).toContain('Milestone 1 needs at least one lesson.')
})

it('asks before leaving with unsaved edits and can save and leave', async () => {
  getPlan.mockResolvedValue({ data: course })
  savePlan.mockImplementation(async (_id, value) => ({ data: { ...course, learning_plan: { ...value, id: 9, lock_version: 0, updated_at: '2026-11-17T00:00:00Z' } } }))
  await mount(); await click('Customize plan'); await title('Catch-up plan')
  await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/elsewhere"]')!.click())
  expect(dialog()?.textContent).toContain('Leave without saving?')
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe('/')
  await click('Keep editing')
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe('/')
  await act(async () => container.querySelector<HTMLAnchorElement>('a[href="/elsewhere"]')!.click())
  await click('Save and leave')
  expect(savePlan).toHaveBeenCalledWith(8, expect.objectContaining({ title: 'Catch-up plan' }))
  expect(container.querySelector('[data-testid="where"]')?.textContent).toBe('/elsewhere')
})

it('lists draft problems once each', () => {
  expect(planProblems({ active: true, title: 'x', description: '', target_date: '2026-11-01', next_check_in_on: null, lesson_overrides: [], milestones: [
    { title: 'B', due_on: '2026-11-20', lesson_ids: [1] }, { title: 'A', due_on: '2026-11-10', lesson_ids: [2] },
  ] })).toEqual(['List milestones in target-date order.', 'The target finish must be on or after the last milestone.'])
})
