// @vitest-environment jsdom
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { summarizeCodeChecks } from '../../lib/codeChecks'
import { StudentExperienceProvider } from '../../lib/studentExperience'
import { ContentBlockRenderer } from './ContentBlockRenderer'

const runCodeChecks = vi.hoisted(() => vi.fn())
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: (query: string) => query === '(pointer: coarse)' || query === '(any-pointer: coarse)' }))
vi.mock('@monaco-editor/react', () => ({ default: () => <div data-monaco="true" /> }))
vi.mock('../../lib/monacoLoader', () => ({ PHONE_CODE_EDITOR_QUERY: '(max-width: 639px)', getMonacoLoadStatus: () => 'ready', ensureMonacoLoaded: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3 }, enrollments: [] }) }))
vi.mock('../student/SubmissionDraftGuard', () => ({ SubmissionDraftGuard: () => null }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../lib/codeChecks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/codeChecks')>()),
  runCodeChecks,
}))

const CHECKS = [{ id: 'c1', name: 'Adds', code: 'assertEqual(3, add(1, 2))' }]
const STARTER = 'function add(a, b) {\n}'
const block = {
  id: 8, position: 0, block_type: 'exercise', title: 'Add', body: null, video_url: null, filename: 'add.js', submission_type: 'text_submission', metadata: {},
  submission_config: { runner: { enabled: true, language: 'javascript', starter_code: STARTER, checks: CHECKS } },
}

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  runCodeChecks.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  localStorage.clear()
})

const editor = () => container.querySelector('textarea[aria-label="Your code"]') as HTMLTextAreaElement
const button = (label: string) => [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === label)
function type(value: string) {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(editor(), value)
  editor().dispatchEvent(new Event('input', { bubbles: true }))
}

it('starts from the starter code, can reset it, and runs the checks against the current code', async () => {
  await act(async () => root.render(<StudentExperienceProvider v2><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>))
  expect(editor().value).toBe(STARTER)
  expect(button('Reset starter code')).toBeUndefined()

  const solution = 'function add(a, b) {\n  return a + b\n}'
  await act(async () => type(solution))
  expect(button('Reset starter code')).toBeTruthy()

  runCodeChecks.mockResolvedValue(summarizeCodeChecks([{ id: 'c1', name: 'Adds', passed: true, timedOut: false, error: null, stdout: '', durationMs: 2 }]))
  await act(async () => button('Run checks')!.click())
  expect(runCodeChecks).toHaveBeenCalledWith({ language: 'javascript', code: solution, checks: CHECKS })
  expect(container.textContent).toContain('1 of 1 check passed')

  await act(async () => button('Reset starter code')!.click())
  expect(editor().value).toBe(STARTER)
  expect(container.textContent).toContain('Your code changed since these checks ran.')
})

it('starts from the latest submission, not the starter code, once the student has submitted', async () => {
  const submitted = { ...block, submissions: [{ id: 1, text: 'function add(a, b) { return a + b }', grade: null, feedback: null, num_submissions: 1, created_at: '2026-11-26T00:00:00Z', updated_at: '2026-11-26T00:00:00Z' }] }
  await act(async () => root.render(<StudentExperienceProvider v2={false}><ContentBlockRenderer block={submitted as never} cohortId={1} /></StudentExperienceProvider>))
  expect(editor().value).toBe('function add(a, b) { return a + b }')
  expect(button('Reset starter code')).toBeUndefined()
})
