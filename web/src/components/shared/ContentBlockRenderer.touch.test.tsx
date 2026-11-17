// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { StudentExperienceProvider } from '../../lib/studentExperience'
import { ContentBlockRenderer } from './ContentBlockRenderer'
const pointer = vi.hoisted(() => ({ coarse: true }))
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: (query: string) => query === '(pointer: coarse)' ? pointer.coarse : query === '(any-pointer: coarse)' }))
vi.mock('./CodeEditor', () => ({ CodeEditor: () => <div data-monaco="true" />, detectLanguage: () => 'python' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3 }, enrollments: [] }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
const block = { id: 8, position: 0, block_type: 'exercise', title: 'Counter', body: null, video_url: null, filename: 'counter.py', submission_type: 'text_submission', metadata: {} }
it('uses a non-wrapping code textarea on touch only when explicitly On; Off keeps Monaco', () => {
  const on = renderToStaticMarkup(<StudentExperienceProvider v2><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
  expect(on).toContain('aria-label="Your code"')
  expect(on).toContain('wrap="off"')
  expect(on).toContain('text-base')
  expect(on).not.toContain('data-monaco')
  const off = renderToStaticMarkup(<StudentExperienceProvider v2={false}><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
  expect(off).toContain('data-monaco="true"')
  expect(off).not.toContain('aria-label="Your code"')
})

it('keeps Monaco on a touchscreen laptop with a fine primary pointer', () => {
  pointer.coarse = false
  try {
    const html = renderToStaticMarkup(<StudentExperienceProvider v2><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
    expect(html).toContain('data-monaco="true"')
    expect(html).not.toContain('aria-label="Your code"')
  } finally { pointer.coarse = true }
})
