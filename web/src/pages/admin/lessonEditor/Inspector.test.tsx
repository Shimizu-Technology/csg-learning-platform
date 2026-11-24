// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ToastProvider } from '../../../contexts/ToastContext'
import { TestRouter } from '../../../test/TestRouter'
import type { components } from '../../../types/api.generated'
import { newBlock, type BlockDraft } from './blockDraft'
import { Inspector } from './Inspector'
import type { CheckPolicyEditors } from './ExerciseCheckPolicyEditor'

const api = vi.hoisted(() => ({
  getExerciseCheckPolicy: vi.fn(),
  saveExerciseCheckPolicy: vi.fn(),
  deactivateExerciseCheckPolicy: vi.fn(),
}))
vi.mock('../../../lib/api', () => ({ api }))

const activePolicy: components['schemas']['ExerciseCheckPolicy'] = {
  id: 1, content_block_id: 12, version: 1, active: true, required_checks: ['exercise-111'],
  allowed_app_slugs: ['github-actions'], allowed_branch: 'main',
  expected_workflow_path: '.github/workflows/checks.yml', expected_workflow_sha: 'a'.repeat(40),
  created_by_id: 1, created_by_name: 'Test Author', created_at: null, updated_at: null,
}
const response = (policy: typeof activePolicy | null) => ({ data: { content_block_id: 12, active_policy: policy, versions: policy ? [policy] : [] } })
const block = { ...newBlock('exercise'), id: 12, filename: '111.rb', submission_type: 'prework_github_sync' }

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.resetAllMocks()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  api.getExerciseCheckPolicy.mockResolvedValue(response(null))
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function InspectorFixture({ selected, configured }: { selected: BlockDraft; configured: boolean }) {
  const [checkPolicyEditors, setCheckPolicyEditors] = useState<CheckPolicyEditors>({})
  return (
    <TestRouter><ToastProvider>
      <Inspector tab="block" onTab={vi.fn()} draft={{ title: 'Lesson', required: true, release_day: 0, blocks: [selected], removed_block_ids: [], alignments: [] }}
        onLesson={vi.fn()} block={selected} onBlock={vi.fn()} activity={new Map()}
        context={{ curriculum: { id: 1, name: 'Prework' }, module: { id: 1, name: 'Ruby', release_days: [] }, used_in: [], other_cohorts_count: 0,
          submissions_count: 0, waiting_count: 0, open_help_count: 0, github_grade_suggestions_configured: configured }}
        curriculumId={1} lessonId={1} objectives={[]} onObjectiveCreated={vi.fn()} rubrics={[]} onRubricCreated={vi.fn()} rubricDrafts={{}} setRubricDrafts={vi.fn()}
        checkPolicyEditors={checkPolicyEditors} setCheckPolicyEditors={setCheckPolicyEditors}
      />
    </ToastProvider></TestRouter>
  )
}

function render(selected: BlockDraft = block, configured = false) {
  return act(async () => root.render(<InspectorFixture selected={selected} configured={configured} />))
}

function button(name: string) {
  return [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === name)!
}

function enterCheck(value: string) {
  const input = container.querySelector<HTMLInputElement>('input[placeholder="exercise-111"]')!
  return act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it('shows rules for saved synced exercises, including filename-backed exercises when suggestions are configured', async () => {
  await render({ ...block, id: null })
  expect(api.getExerciseCheckPolicy).not.toHaveBeenCalled()
  await render({ ...block, submission_type: 'text_submission' })
  expect(api.getExerciseCheckPolicy).not.toHaveBeenCalled()
  await render({ ...block, submission_type: 'text_submission' }, true)
  expect(api.getExerciseCheckPolicy).toHaveBeenCalledWith(12)
  expect(container.textContent).toContain('Checks used for grade suggestions')
  expect(container.textContent).toContain('No check rules yet')
})

it('creates rules from an approachable check list and keeps advanced fields collapsed', async () => {
  api.saveExerciseCheckPolicy.mockResolvedValue(response({ ...activePolicy, allowed_branch: null, expected_workflow_path: null, expected_workflow_sha: null }))
  await render()
  expect(container.querySelector('summary')?.parentElement?.hasAttribute('open')).toBe(false)
  expect(button('Save check rules').disabled).toBe(true)
  await enterCheck(' exercise-111 ')
  await act(async () => button('Add').click())
  expect(container.querySelector('[aria-label="Required checks"]')?.textContent).toContain('exercise-111')
  await act(async () => button('Save check rules').click())
  expect(api.saveExerciseCheckPolicy).toHaveBeenCalledWith(12, {
    required_checks: ['exercise-111'], allowed_app_slugs: ['github-actions'],
    allowed_branch: null, expected_workflow_path: null, expected_workflow_sha: null,
  })
  expect(container.textContent).toContain('Active · 1 required check · Version 1')
  expect(button('Save check rules').disabled).toBe(true)
})

it('updates rules without clearing advanced settings and requires confirmation to turn off suggestions', async () => {
  api.getExerciseCheckPolicy.mockResolvedValue(response(activePolicy))
  api.saveExerciseCheckPolicy.mockResolvedValue(response({ ...activePolicy, required_checks: ['exercise-111', 'exercise-112'], version: 2 }))
  api.deactivateExerciseCheckPolicy.mockResolvedValue(response(null))
  await render()
  await enterCheck('exercise-112')
  await act(async () => button('Save check rules').click())
  expect(api.saveExerciseCheckPolicy).toHaveBeenCalledWith(12, expect.objectContaining({
    required_checks: ['exercise-111', 'exercise-112'], allowed_branch: 'main',
    expected_workflow_path: activePolicy.expected_workflow_path, expected_workflow_sha: activePolicy.expected_workflow_sha,
  }))
  expect(container.textContent).toContain('Active · 2 required checks · Version 2')
  await enterCheck('A draft to discard on deactivation')
  await act(async () => button('Turn off check suggestions for this exercise').click())
  expect(api.deactivateExerciseCheckPolicy).not.toHaveBeenCalled()
  await act(async () => button('Cancel').click())
  expect(api.deactivateExerciseCheckPolicy).not.toHaveBeenCalled()
  await act(async () => button('Turn off check suggestions for this exercise').click())
  await act(async () => button('Turn off suggestions').click())
  expect(api.deactivateExerciseCheckPolicy).toHaveBeenCalledWith(12)
  expect(container.textContent).toContain('No check rules yet')
  expect(container.querySelector<HTMLInputElement>('input[placeholder="exercise-111"]')?.value).toBe('')
  expect(button('Reset check-rule edits')).toBeUndefined()
})

it('keeps the draft if a save fails and does not reuse another block’s rules', async () => {
  api.getExerciseCheckPolicy.mockResolvedValueOnce(response(activePolicy))
  api.saveExerciseCheckPolicy.mockResolvedValue({ error: 'Check name is invalid' })
  await render()
  await enterCheck('another-check')
  await act(async () => button('Save check rules').click())
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Check name is invalid')
  expect(container.querySelector<HTMLInputElement>('input[placeholder="exercise-111"]')?.value).toBe('another-check')
  await render({ ...block, id: 13, key: 'b13' })
  expect(api.getExerciseCheckPolicy).toHaveBeenLastCalledWith(13)
  expect(container.textContent).toContain('No check rules yet')
  expect(container.querySelector('[role="alert"]')).toBeNull()
})
