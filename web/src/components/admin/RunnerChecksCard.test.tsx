// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { summarizeCodeChecks, type CodeChecksRun } from '../../lib/codeChecks'
import { RunnerChecksCard } from './RunnerChecksCard'

const runCodeChecks = vi.hoisted(() => vi.fn())
vi.mock('../../lib/codeChecks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/codeChecks')>()),
  runCodeChecks,
}))

const CHECKS = [{ id: 'c1', name: 'Adds', code: 'assert_equal 5, add(2, 3)' }]
const passed = summarizeCodeChecks([{ id: 'c1', name: 'Adds', passed: true, timedOut: false, error: null, stdout: '', durationMs: 1 }])
let container: HTMLDivElement
let root: Root
const onSelect = vi.fn()

beforeEach(() => {
  runCodeChecks.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const render = (code: string, checks = CHECKS) => act(async () => root.render(
  <RunnerChecksCard submissionId={1} code={code} language="ruby" checks={checks} gradingScale="pass_redo" selectedGrade={null} disabled={false} onSelectSuggested={onSelect} />,
))
const selectButton = () => [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Select Pass')

it('never shows a passing suggestion while the checks rerun for new code or new checks', async () => {
  runCodeChecks.mockResolvedValue(passed)
  await render('def add(a, b) = a + b')
  expect(container.querySelector('[data-runner-checks]')?.getAttribute('data-runner-checks')).toBe('passed')
  expect(selectButton()).toBeTruthy()

  let finish!: (run: CodeChecksRun) => void
  runCodeChecks.mockReturnValue(new Promise((resolve) => { finish = resolve }))
  await render('def add(a, b) = a - b')
  expect(container.querySelector('[data-runner-checks]')?.getAttribute('data-runner-checks')).toBe('running')
  expect(selectButton()).toBeUndefined()
  await act(async () => finish(summarizeCodeChecks([{ id: 'c1', name: 'Adds', passed: false, timedOut: false, error: 'Expected 5, got -1', stdout: '', durationMs: 1 }])))
  expect(container.textContent).toContain('1 of 1 check failed · Review for Redo')
  expect(selectButton()).toBeUndefined()

  runCodeChecks.mockReturnValue(new Promise(() => {}))
  await render('def add(a, b) = a - b', [{ ...CHECKS[0], code: 'assert_equal(-1, add(2, 3))' }])
  expect(container.querySelector('[data-runner-checks]')?.getAttribute('data-runner-checks')).toBe('running')
})
