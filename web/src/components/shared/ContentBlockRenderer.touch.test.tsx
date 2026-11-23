// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { StudentExperienceProvider } from '../../lib/studentExperience'
import { ContentBlockRenderer } from './ContentBlockRenderer'

const media = vi.hoisted(() => ({ coarse: true, phone: false }))
vi.mock('../../lib/useMediaQuery', () => ({
  useMediaQuery: (query: string) => {
    if (query === '(pointer: coarse)') return media.coarse
    if (query === '(max-width: 639px)') return media.phone
    return query === '(any-pointer: coarse)'
  },
}))
vi.mock('./CodeEditor', () => ({ CodeEditor: () => <div data-monaco="true" />, detectLanguage: () => 'python' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3 }, enrollments: [] }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

const block = { id: 8, position: 0, block_type: 'exercise', title: 'Counter', body: null, video_url: null, filename: 'counter.py', submission_type: 'text_submission', metadata: {} }

it('uses the code textarea immediately on coarse primary pointer in both v2 and v1', () => {
  const on = renderToStaticMarkup(<StudentExperienceProvider v2><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
  expect(on).toContain('aria-label="Your code"')
  expect(on).toContain('wrap="off"')
  expect(on).toContain('text-base')
  expect(on).not.toContain('data-monaco')

  const off = renderToStaticMarkup(<StudentExperienceProvider v2={false}><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
  expect(off).toContain('aria-label="Your code"')
  expect(off).toContain('wrap="soft"')
  expect(off).toContain('text-base')
  expect(off).not.toContain('data-monaco')
})

it('uses the code textarea immediately on phone viewports in both v2 and v1', () => {
  media.coarse = false
  media.phone = true
  try {
    const on = renderToStaticMarkup(<StudentExperienceProvider v2><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
    expect(on).toContain('aria-label="Your code"')
    expect(on).not.toContain('data-monaco')

    const off = renderToStaticMarkup(<StudentExperienceProvider v2={false}><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
    expect(off).toContain('aria-label="Your code"')
    expect(off).not.toContain('data-monaco')
  } finally {
    media.coarse = true
    media.phone = false
  }
})

it('keeps Monaco on a touchscreen laptop with a fine primary pointer', () => {
  media.coarse = false
  media.phone = false
  try {
    const on = renderToStaticMarkup(<StudentExperienceProvider v2><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
    expect(on).toContain('data-monaco="true"')
    expect(on).not.toContain('aria-label="Your code"')

    const off = renderToStaticMarkup(<StudentExperienceProvider v2={false}><ContentBlockRenderer block={block} cohortId={1} /></StudentExperienceProvider>)
    expect(off).toContain('data-monaco="true"')
    expect(off).not.toContain('aria-label="Your code"')
  } finally {
    media.coarse = true
  }
})
