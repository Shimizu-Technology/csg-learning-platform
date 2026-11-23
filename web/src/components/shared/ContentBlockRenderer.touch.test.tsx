// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { StudentExperienceProvider } from '../../lib/studentExperience'
import { ContentBlockRenderer } from './ContentBlockRenderer'

const { media, ensureMonacoLoaded } = vi.hoisted(() => ({
  media: { coarse: true, phone: false },
  ensureMonacoLoaded: vi.fn(),
}))
vi.mock('../../lib/useMediaQuery', () => ({
  useMediaQuery: (query: string) => {
    if (query === '(pointer: coarse)') return media.coarse
    if (query === '(max-width: 639px)') return media.phone
    return query === '(any-pointer: coarse)'
  },
}))
vi.mock('@monaco-editor/react', () => ({ default: () => <div data-monaco="true" /> }))
vi.mock('../../lib/monacoLoader', () => ({
  PHONE_CODE_EDITOR_QUERY: '(max-width: 639px)',
  getMonacoLoadStatus: () => 'ready',
  ensureMonacoLoaded,
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3 }, enrollments: [] }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

const block = { id: 8, position: 0, block_type: 'exercise', title: 'Counter', body: null, video_url: null, filename: 'counter.py', submission_type: 'text_submission', metadata: {} }

beforeEach(() => {
  media.coarse = true
  media.phone = false
  ensureMonacoLoaded.mockReset()
})

afterEach(() => {
  document.body.innerHTML = ''
  if (typeof localStorage !== 'undefined' && typeof localStorage.clear === 'function') {
    localStorage.clear()
  }
  vi.restoreAllMocks()
})

it.each([
  { coarse: true, phone: false },
  { coarse: false, phone: true },
])('uses the textarea immediately with coarse=$coarse and phone=$phone', (pointer) => {
  Object.assign(media, pointer)
  for (const v2 of [true, false]) {
    const html = renderToStaticMarkup(<StudentExperienceProvider v2={v2}><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
    expect(html).toContain('aria-label="Your code"')
    expect(html).toContain(v2 ? 'wrap="off"' : 'wrap="soft"')
    expect(html).not.toContain('data-monaco')
  }
})

it.each([true, false])('keeps closed-window code read-only and submission blocked with v2=%s', (v2) => {
  const html = renderToStaticMarkup(
    <StudentExperienceProvider v2={v2}>
      <ContentBlockRenderer block={block} cohortId={1} submissionsLocked submissionsCloseAt="2026-10-01T00:00:00Z" />
    </StudentExperienceProvider>,
  )
  expect(html).toMatch(/<textarea[^>]*aria-label="Your code"[^>]*readOnly=""/)
  expect(html).not.toMatch(/<textarea[^>]*disabled=""/)
  expect(html).toContain('>Closed</button>')
})

it('freezes the source editor until submission settles and unlocks it after failure', async () => {
  let finish!: (value: Awaited<ReturnType<typeof api.createSubmission>>) => void
  vi.spyOn(api, 'createSubmission').mockReturnValue(new Promise((resolve) => { finish = resolve }))

  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <StudentExperienceProvider v2>
        <ContentBlockRenderer
          block={{
            ...block,
            learner_state: 'redo_requested',
            submissions: [{
              id: 1,
              text: 'print(42)',
              grade: 'R',
              feedback: 'Try again',
              graded_at: '2026-10-16T00:00:00Z',
              num_submissions: 1,
              created_at: '2026-10-15T00:00:00Z',
            }],
          }}
          cohortId={1}
        />
      </StudentExperienceProvider>,
    )
  })

  const textarea = container.querySelector('textarea[aria-label="Your code"]') as HTMLTextAreaElement
  expect(textarea.disabled).toBe(false)
  expect(textarea.readOnly).toBe(false)

  const submit = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('Resubmit')) as HTMLButtonElement
  await act(async () => { submit.click() })
  expect(textarea.disabled).toBe(true)

  await act(async () => { finish({ data: null, error: 'Network error', errorKind: 'network' }) })
  expect(textarea.disabled).toBe(false)

  act(() => root.unmount())
})

it('keeps Monaco on a touchscreen laptop with a fine primary pointer', () => {
  media.coarse = false
  media.phone = false
  const on = renderToStaticMarkup(<StudentExperienceProvider v2><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
  expect(on).toContain('data-monaco="true"')
  expect(on).not.toContain('aria-label="Your code"')

  const off = renderToStaticMarkup(<StudentExperienceProvider v2={false}><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
  expect(off).toContain('data-monaco="true"')
  expect(off).not.toContain('aria-label="Your code"')
})
