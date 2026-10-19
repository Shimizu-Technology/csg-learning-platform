// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('./MarkdownRenderer', () => ({ MarkdownRenderer: () => null }))
vi.mock('./CodeEditor', () => ({ CodeEditor: ({ value, readOnly, busy, onChange }: { value: string; readOnly?: boolean; busy?: boolean; onChange?: (value: string) => void }) => <pre data-editor={readOnly || busy ? 'readonly' : 'editable'} onClick={() => onChange?.(`${value}\n# edited`)}>{value}</pre>, detectLanguage: () => 'python' }))
vi.mock('./FeedbackBody', () => ({ FeedbackBody: ({ feedback }: { feedback: string }) => <div data-feedback="">{feedback}</div> }))
vi.mock('./CodeRunner', () => ({ CodeRunner: () => null }))
vi.mock('./VideoPlayer', () => ({ VideoPlayer: () => null }))
vi.mock('./GradeDisplay', () => ({ GradeDisplay: () => null }))

import { ContentBlockRenderer } from './ContentBlockRenderer'
import { api } from '../../lib/api'

function renderExercise(submissionType: string, isStaff: boolean) {
  return renderToStaticMarkup(
    <ContentBlockRenderer
      isStaff={isStaff}
      block={{
        id: 1,
        block_type: 'exercise',
        position: 0,
        title: 'Practice',
        body: null,
        video_url: null,
        filename: null,
        submission_type: submissionType,
        metadata: {},
      }}
    />,
  )
}

describe('staff lesson preview', () => {
  it('does not render manual completion controls for staff', () => {
    const staffMarkup = renderExercise('manual_complete', true)

    expect(staffMarkup).not.toContain('Mark complete')
    expect(renderExercise('manual_complete', false)).toContain('Mark complete')
  })

  it('does not render submission controls for staff', () => {
    const staffMarkup = renderExercise('text_submission', true)

    expect(staffMarkup).not.toContain('Write your solution')
    expect(staffMarkup).not.toContain('>Submit<')
    expect(renderExercise('text_submission', false)).toContain('Write your solution')
  })
})

type Block = Parameters<typeof ContentBlockRenderer>[0]['block']

function checkpoint(overrides: Partial<Block> = {}): Block {
  return {
    id: 138,
    block_type: 'checkpoint',
    position: 0,
    title: 'Budget decision',
    body: null,
    video_url: null,
    filename: 'budget_decision.py',
    submission_type: 'text_submission',
    metadata: {},
    ...overrides,
  }
}

function submission(overrides: Partial<NonNullable<Block['submissions']>[number]> = {}) {
  return { id: 1, text: 'print("hi")', grade: null, feedback: null, graded_at: null, num_submissions: 1, created_at: '2026-10-16T00:00:00Z', ...overrides }
}

describe('checkpoint submissions', () => {
  it('gives a text-submission checkpoint the editor and a Submit button instead of a bare circle', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint()} cohortId={2} />)
    expect(html).toContain('Write your solution')
    expect(html).toContain('Submit checkpoint')
    expect(html).toContain('data-editor="editable"')
    expect(html).not.toContain('Mark done')
  })

  it('keeps a labeled toggle for checkpoints that do not take submissions', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ submission_type: 'manual_complete' })} cohortId={2} />)
    expect(html).toContain('Mark done')
    expect(html).not.toContain('Submit checkpoint')
  })

  it('shows submitted work as awaiting review in a neutral pending tone', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ submissions: [submission()] })} cohortId={2} />)
    expect(html).toContain('Submitted · awaiting review')
    expect(html).toContain('bg-pending-50')
    expect(html).not.toContain('bg-primary-50')
    expect(html).toContain('Resubmit checkpoint')
  })

  it('shows the latest feedback exactly once and earlier feedback in history', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ submissions: [
      submission({ id: 2, num_submissions: 2, grade: 'R', feedback: 'Latest: explain **why**', graded_at: '2026-10-17T00:00:00Z' }),
      submission({ id: 1, grade: 'R', feedback: 'First try feedback', graded_at: '2026-10-16T00:00:00Z' }),
    ] })} cohortId={2} />)
    expect(html.match(/Latest: explain \*\*why\*\*/g)).toHaveLength(1)
    expect(html.match(/First try feedback/g)).toHaveLength(1)
    expect(html).toContain('Redo requested')
    expect(html).toContain('Earlier feedback')
  })
})

describe('submission drafts', () => {
  afterEach(() => {
    localStorage.clear()
    document.body.innerHTML = ''
  })

  it('restores an unsent draft for the block with a discard option', async () => {
    localStorage.setItem('csg-learn:submission-draft:v1:me:2:138', JSON.stringify({ version: 1, text: 'if x:\n    print(x)', savedAt: '2026-10-18T07:00:00Z' }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<ContentBlockRenderer block={checkpoint({ submissions: [submission()] })} cohortId={2} />) })

    expect(container.querySelector('[data-editor="editable"]')?.textContent).toBe('if x:\n    print(x)')
    expect(container.textContent).toContain('Restored your unsent draft')

    const discard = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Discard draft')!
    await act(async () => { discard.click() })
    expect(localStorage.getItem('csg-learn:submission-draft:v1:me:2:138')).toBeNull()
    expect(container.querySelector('[data-editor="editable"]')?.textContent).toBe('print("hi")')
    act(() => root.unmount())
  })

  it('saves an edit made right before leaving the lesson', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<ContentBlockRenderer block={checkpoint()} cohortId={2} />) })
    await act(async () => { (container.querySelector('[data-editor="editable"]') as HTMLElement).click() })
    act(() => root.unmount())
    expect(JSON.parse(localStorage.getItem('csg-learn:submission-draft:v1:me:2:138') || '{}').text).toBe('\n# edited')
  })

  it('ignores a draft older than the latest saved submission', async () => {
    localStorage.setItem('csg-learn:submission-draft:v1:me:2:138', JSON.stringify({ version: 1, text: 'old draft', savedAt: '2026-10-15T00:00:00Z' }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<ContentBlockRenderer block={checkpoint({ submissions: [submission()] })} cohortId={2} />) })
    expect(container.querySelector('[data-editor="editable"]')?.textContent).toBe('print("hi")')
    expect(container.textContent).not.toContain('Restored your unsent draft')
    expect(localStorage.getItem('csg-learn:submission-draft:v1:me:2:138')).toBeNull()
    act(() => root.unmount())
  })

  it('locks the editor while a submission is in flight and unlocks it after a failure', async () => {
    let finish: (value: Awaited<ReturnType<typeof api.createSubmission>>) => void = () => {}
    const spy = vi.spyOn(api, 'createSubmission').mockReturnValue(new Promise((resolve) => { finish = resolve }))
    localStorage.setItem('csg-learn:submission-draft:v1:me:2:138', JSON.stringify({ version: 1, text: 'print(1)', savedAt: '2026-10-18T07:00:00Z' }))
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<ContentBlockRenderer block={checkpoint()} cohortId={2} />) })
    const submit = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Submit checkpoint'))!
    await act(async () => { submit.click() })
    expect(container.querySelector('[data-editor]')?.getAttribute('data-editor')).toBe('readonly')
    await act(async () => { finish({ data: null, error: 'Failed to fetch', errorKind: 'network' }) })
    expect(container.querySelector('[data-editor]')?.getAttribute('data-editor')).toBe('editable')
    expect(container.textContent).toContain("couldn't reach CSG Learn")
    expect(localStorage.getItem('csg-learn:submission-draft:v1:me:2:138')).toContain('print(1)')
    spy.mockRestore()
    act(() => root.unmount())
  })
})

describe('feedback block (one warning card, neutral history, one badge)', () => {
  const redoBlock = {
    id: 7,
    block_type: 'exercise',
    position: 0,
    title: 'Repair two errors',
    body: null,
    video_url: null,
    filename: 'exercise_02.py',
    submission_type: 'text_submission',
    metadata: {},
    submissions: [
      { id: 3, text: 'print(name)', grade: 'R', feedback: 'Define the name first.', graded_at: '2026-10-16T00:00:00Z', num_submissions: 2, created_at: '2026-10-16T00:00:00Z' },
      { id: 2, text: 'print(nme)', grade: 'R', feedback: 'Look at the spelling.', graded_at: '2026-10-14T00:00:00Z', num_submissions: 1, created_at: '2026-10-14T00:00:00Z' },
    ],
  }

  it('shows the latest feedback once, inside a single warning card', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={redoBlock} cohortId={2} />)
    const warningCards = html.match(/border-warning-200 bg-warning-50/g) || []
    // One status badge (header) + one feedback card.
    expect(warningCards.length).toBe(2)
    expect(html.match(/Redo requested<\/span>/g)?.length).toBe(1)
    expect(html).toContain('aria-label="Instructor feedback: redo requested"')
    expect(html.match(/Define the name first\./g)?.length).toBe(1)
  })

  it('keeps submission history neutral', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={redoBlock} cohortId={2} />)
    const history = html.slice(html.indexOf('Your submissions'))
    expect(history).not.toMatch(/warning-|danger-|red-/)
    expect(history).toContain('Earlier feedback · redo requested')
  })

  it('has exactly one primary action in the exercise (Resubmit)', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={redoBlock} cohortId={2} />)
    expect(html.match(/data-variant="primary"/g)?.length).toBe(1)
    expect(html).toContain('Resubmit')
  })
})
