// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { StudentLearningPlan } from './StudentLearningPlan'
import type { LearningPlanManagement } from '../../types/api'

const { getPlan, savePlan } = vi.hoisted(() => ({ getPlan: vi.fn(), savePlan: vi.fn() }))
vi.mock('../../lib/api', () => ({ api: { getLearningPlan: getPlan, saveLearningPlan: savePlan } }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const regular: LearningPlanManagement = { learning_plan: null, lessons: [{ id: 12, title: 'Backend project', module_name: 'Live class', standard_required: true }], revisions: [] }
let container: HTMLDivElement
let root: Root
beforeEach(() => { vi.clearAllMocks(); getPlan.mockResolvedValue({ data: regular }); container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container) })
afterEach(async () => { await act(async () => root.unmount()); container.remove() })
async function mount() { await act(async () => root.render(<StudentLearningPlan enrollmentId={8} onSaved={vi.fn()} />)) }
async function click(text: string) { const button = [...container.querySelectorAll('button')].find((element) => element.textContent === text); expect(button).toBeTruthy(); await act(async () => button!.click()) }
async function title(value: string) { const input = container.querySelector<HTMLInputElement>('input[maxlength="160"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) }) }
async function submit() { await act(async () => container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))) }

it('uses regular curriculum until staff explicitly customize and save', async () => {
  await mount(); expect(container.textContent).toContain('Regular curriculum'); expect(savePlan).not.toHaveBeenCalled()
  await click('Customize plan'); await title('Finish the application'); await click('Cancel'); expect(savePlan).not.toHaveBeenCalled()
})

it('keeps the draft after a failed save and offers an explicit reload', async () => {
  savePlan.mockResolvedValue({ data: null, error: 'Learning plan changed. Reload before saving.' })
  await mount(); await click('Customize plan'); await title('Keep my draft'); await submit()
  expect(container.querySelector('[role="alert"]')?.textContent).toContain('Learning plan changed')
  expect(container.querySelector<HTMLInputElement>('input[maxlength="160"]')?.value).toBe('Keep my draft')
  expect(container.textContent).toContain('Reload latest plan')
})

it('restores regular curriculum after confirmation and includes the current version', async () => {
  const personal: LearningPlanManagement = { ...regular, learning_plan: { id: 4, active: true, title: 'Personal finish', description: null, target_date: null, next_check_in_on: null, milestones: [], lesson_overrides: [], lock_version: 3, updated_at: '2026-10-24T10:00:00Z' } }
  getPlan.mockResolvedValue({ data: personal }); savePlan.mockResolvedValue({ data: regular })
  await mount(); await click('Return to regular curriculum'); expect(savePlan).not.toHaveBeenCalled(); await click('Restore regular curriculum')
  expect(savePlan).toHaveBeenCalledWith(8, expect.objectContaining({ active: false, lock_version: 3 }))
})
