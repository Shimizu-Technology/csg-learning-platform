// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom'
import { ConfirmProvider } from '../../contexts/ConfirmContext'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./LazyMarkdownEditor', async () => ({ LazyMarkdownEditor: (await import('./MarkdownEditor')).MarkdownEditor }))
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('./MarkdownRenderer', () => ({ MarkdownRenderer: ({ starterLinks, content, variant }: { content?: string; variant?: string; starterLinks?: { lessonReturn: { url: string; label?: string | null }; hint: string; newTab?: boolean } }) => (starterLinks ? <div data-starter-hint={starterLinks.hint} data-starter-return={starterLinks.lessonReturn.url} data-starter-label={starterLinks.lessonReturn.label ?? ''} data-starter-new-tab={String(Boolean(starterLinks.newTab))} /> : <div data-markdown-variant={variant}>{content}</div>) }))
vi.mock('./CodeEditor', () => ({ CodeEditor: ({ value, readOnly, busy, onChange }: { value: string; readOnly?: boolean; busy?: boolean; onChange?: (value: string) => void }) => <pre data-editor={readOnly || busy ? 'readonly' : 'editable'} onClick={() => onChange?.(`${value}\n# edited`)}>{value}</pre>, detectLanguage: () => 'python' }))
vi.mock('./FeedbackBody', () => ({ FeedbackBody: ({ feedback }: { feedback: string }) => <div data-feedback="">{feedback}</div> }))
vi.mock('./CodeRunner', () => ({ CodeRunner: () => null }))
vi.mock('./VideoPlayer', () => ({ VideoPlayer: ({ trackProgress, onSaveProgress }: { trackProgress?: boolean; onSaveProgress: (data: object) => void }) => <div data-video="playable" data-tracking={String(trackProgress)}><button onClick={(event) => {
  const position = Number(event.currentTarget.dataset.position ?? 9) + 1
  event.currentTarget.dataset.position = String(position)
  onSaveProgress({ last_position_seconds: position, total_watched_seconds: position, duration_seconds: 20 })
}}>Simulate video progress</button></div> }))
vi.mock('./GradeDisplay', () => ({ GradeDisplay: () => null }))
const vimeo = vi.hoisted(() => ({
  create: vi.fn(),
  handlers: new Map<string, (event: { seconds: number; duration: number; playbackRate: number }) => void>(),
  pause: vi.fn(async () => undefined),
  destroy: vi.fn(async () => undefined),
}))
vi.mock('@vimeo/player', () => ({
  default: class {
    constructor(_element: HTMLElement, options: { url: string }) { vimeo.create(options.url) }
    on(event: string, callback: (event: { seconds: number; duration: number; playbackRate: number }) => void) { vimeo.handlers.set(event, callback) }
    getDuration = async () => 60
    setCurrentTime = async () => undefined
    ready = async () => undefined
    play = async () => undefined
    pause = vimeo.pause
    destroy = vimeo.destroy
  },
}))

import { ContentBlockRenderer } from './ContentBlockRenderer'
import { api } from '../../lib/api'
import { StudentExperienceProvider } from '../../lib/studentExperience'

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

describe('manual exercise completion (S-14)', () => {
  const manual = { id: 7, block_type: 'exercise', position: 0, title: 'Reflect', body: null, video_url: null, filename: null, submission_type: 'manual_complete', metadata: {} } as const
  const render = (v2: boolean) => renderToStaticMarkup(<StudentExperienceProvider v2={v2}><ContentBlockRenderer block={manual} cohortId={2} /></StudentExperienceProvider>)

  it('has one completion control with the new student experience on', () => {
    const html = render(true)
    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html.match(/Mark complete/g)).toHaveLength(1)
    expect(html).toContain('aria-label="Exercise not complete yet"')
    expect(html).not.toContain('aria-label="Mark exercise complete"')
    expect(html).not.toMatch(/practice/i)
  })

  it('keeps both of today’s controls and copy when the switch is off', () => {
    const html = render(false)
    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).toContain('aria-label="Mark exercise complete"')
    expect(html).toContain('For practice exercises that don&#x27;t need a submission.')
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
  return { submission_type: 'text_submission', repo_url: null, pr_url: null, live_url: null, branch: null, commit_sha: null, notes: null, updated_at: '2026-10-16T00:00:00Z', github_issue_url: null, github_code_url: null, id: 1, text: 'print("hi")', grade: null, feedback: null, graded_at: null, num_submissions: 1, created_at: '2026-10-16T00:00:00Z', ...overrides }
}

describe('checkpoint submissions', () => {
  it('gives a text-submission checkpoint the editor and a Submit button instead of a bare circle', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint()} cohortId={2} />)
    expect(html).toContain('Write your solution')
    expect(html).toContain('Submit checkpoint')
    expect(html).toContain('data-editor="editable"')
    expect(html).not.toContain('Mark complete')
  })

  it('does not repeat "Checkpoint" when the title already starts with it', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ title: 'Checkpoint 1 — budget decision' })} cohortId={2} />)
    expect(html).toContain('Checkpoint 1 — budget decision')
    expect(html).not.toMatch(/Checkpoint<\/span>.{0,80}· /)
    expect(renderExercise('text_submission', false)).toMatch(/Exercise<\/span><span[^>]*> · <\/span><span[^>]*>Practice/)
  })

  it('keeps a labeled toggle for checkpoints that do not take submissions', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ submission_type: 'manual_complete' })} cohortId={2} />)
    expect(html).toContain('Mark complete')
    expect(html).not.toContain('Submit checkpoint')
  })

  it('shows submitted work as waiting for review in a neutral pending tone', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ submissions: [submission()] })} cohortId={2} />)
    expect(html).toContain('Submitted · waiting for review')
    expect(html).toContain('bg-surface-sunken')
    expect(html).not.toContain('bg-primary-soft')
    expect(html).toContain('Update submission')
  })

  it('keeps passing reviewed work inspectable without creating another attempt', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ submissions: [submission({ grade: 'A' })] })} cohortId={2} />)
    expect(html).toContain('Review complete.')
    expect(html).toContain('Your submission')
    expect(html).not.toContain('data-editor="editable"')
    expect(html).not.toContain('Update submission</button>')
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

  it('PATCHes the ungraded attempt and preserves the edited draft and API validation error', async () => {
    const create = vi.spyOn(api, 'createSubmission')
    const update = vi.spyOn(api, 'updateSubmission').mockResolvedValue({ data: null, error: 'Submission text is required', status: 422 })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<ContentBlockRenderer block={checkpoint({ submissions: [submission()] })} cohortId={2} />) })
    await act(async () => { (container.querySelector('[data-editor="editable"]') as HTMLElement).click() })
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Update submission')!.click() })
    expect(update).toHaveBeenCalledWith(1, { cohort_id: 2, text: 'print("hi")\n# edited' })
    expect(create).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Submission text is required')
    expect(container.querySelector('[data-editor="editable"]')?.textContent).toContain('# edited')
    expect(localStorage.getItem('csg-learn:submission-draft:v1:me:2:138')).toContain('# edited')
    act(() => root.unmount())
    update.mockRestore()
    create.mockRestore()
  })

  it('keeps the saved edit visible while the parent still has the previous version of the same attempt', async () => {
    const saved = { module_position: null, course_delivery: null, week_number: null, cohort_id: 2, enrollment_id: 1, latest_submission_id: 1, submission_config: {}, rubric: null, cohort_name: null, ...submission(), content_block_id: 138, user_id: 4, user_name: 'Learner', text: 'print("hi")\n# edited', updated_at: '2026-10-22T00:00:00Z', graded_by: null, github_issue_url: null, github_code_url: null, content_block_title: 'Checkpoint', content_block_type: 'checkpoint', lesson_title: 'Lesson', lesson_id: 3, module_id: 2, module_name: 'Module', filename: null, language_hint: null }
    const update = vi.spyOn(api, 'updateSubmission').mockResolvedValue({ data: { submission: saved }, error: null })
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => { root.render(<ContentBlockRenderer block={checkpoint({ submissions: [submission()] })} cohortId={2} />) })
    await act(async () => { (container.querySelector('[data-editor="editable"]') as HTMLElement).click() })
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Update submission')!.click() })
    expect(container.querySelector('[data-editor="editable"]')?.textContent).toBe(saved.text)
    expect(container.textContent).toContain('Updated. Your instructor will review it')
    expect(container.textContent).toContain('Your submission')
    expect(localStorage.getItem('csg-learn:submission-draft:v1:me:2:138')).toBeNull()
    await act(async () => { root.render(<ContentBlockRenderer block={checkpoint({ submissions: [submission({ text: 'Other cohort work' })] })} cohortId={3} />) })
    expect(container.querySelector('[data-editor="editable"]')?.textContent).toBe('Other cohort work')
    act(() => root.unmount())
    update.mockRestore()
  })

  it('creates a new attempt after a redo', async () => {
    const create = vi.spyOn(api, 'createSubmission').mockResolvedValue({ data: null, error: 'Try later' })
    const update = vi.spyOn(api, 'updateSubmission')
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => { root.render(<ContentBlockRenderer block={checkpoint({ submissions: [submission({ grade: 'R' })] })} cohortId={2} />) })
    await act(async () => { Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Resubmit checkpoint')!.click() })
    expect(create).toHaveBeenCalledWith({ content_block_id: 138, cohort_id: 2, text: 'print("hi")' })
    expect(update).not.toHaveBeenCalled()
    act(() => root.unmount())
    update.mockRestore()
    create.mockRestore()
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
    const warningCards = html.match(/border-warning-line bg-warning-soft/g) || []
    // One status badge (header) + one feedback card.
    expect(warningCards.length).toBe(2)
    expect(html.match(/Redo requested<\/span>/g)?.length).toBe(1)
    expect(html).toContain('aria-label="Instructor feedback: redo requested"')
    expect(html.match(/Define the name first\./g)?.length).toBe(1)
  })

  it('keeps submission history neutral', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={redoBlock} cohortId={2} />)
    const history = html.slice(html.indexOf('Your submissions'))
    // The Copy button's own failure state is the only status colour allowed in the history.
    expect(history.replace(/data-\[state=failed\]:[\w-]+/g, '')).not.toMatch(/warning-|danger-|red-/)
    expect(history).toContain('Earlier feedback · redo requested')
  })

  it('has exactly one primary action in the exercise (Resubmit)', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={redoBlock} cohortId={2} />)
    expect(html.match(/data-variant="primary"/g)?.length).toBe(1)
    expect(html).toContain('Resubmit')
  })
})

describe('Hafa Code starter link context', () => {
  const lessonReturn = { url: 'https://learn.codeschoolofguam.com/lessons/419?cohort_id=5#block-138', label: 'Orientation — your first run' }

  it('tells learners to paste into a text submission and only to practice elsewhere', () => {
    const submit = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ body: 'Open the starter.' })} cohortId={2} lessonReturn={lessonReturn} />)
    expect(submit).toContain('data-starter-hint="submit"')
    expect(submit).toContain('data-starter-return="https://learn.codeschoolofguam.com/lessons/419?cohort_id=5#block-138"')
    expect(submit).toContain('data-starter-label="Orientation — your first run"')

    const reading = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ block_type: 'text', submission_type: 'manual_complete', body: 'Worked example.' })} cohortId={2} lessonReturn={lessonReturn} />)
    expect(reading).toContain('data-starter-hint="practice"')

    const repo = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ block_type: 'exercise', submission_type: 'repo_url_submission', body: 'Open the starter.' })} cohortId={2} lessonReturn={lessonReturn} />)
    expect(repo).toContain('data-starter-hint="practice"')
  })

  it('does not point staff or a closed submission at a paste box', () => {
    const staff = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ body: 'Open the starter.' })} cohortId={2} isStaff lessonReturn={lessonReturn} />)
    expect(staff).toContain('data-starter-hint="practice"')
    const closed = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ body: 'Open the starter.' })} cohortId={2} submissionsLocked submissionsCloseAt="2026-10-01T00:00:00Z" lessonReturn={lessonReturn} />)
    expect(closed).toContain('data-starter-hint="practice"')
  })

  it('lets the editor preview force a new tab', () => {
    expect(renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ body: 'x' })} lessonReturn={lessonReturn} starterOpensNewTab />)).toContain('data-starter-new-tab="true"')
    expect(renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ body: 'x' })} lessonReturn={lessonReturn} />)).toContain('data-starter-new-tab="false"')
  })

  it('passes no starter context outside a lesson', () => {
    expect(renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ body: 'Open the starter.' })} cohortId={2} />)).not.toContain('data-starter-hint')
  })
})


describe('past-course review', () => {
  it('keeps submitted code and feedback readable with disabled submission controls', () => {
    const html = renderToStaticMarkup(<ContentBlockRenderer readOnly cohortId={2} block={checkpoint({ submissions: [submission({ grade: 'R', feedback: 'Explain the loop.' })] })} />)
    expect(html).toContain('Review only')
    expect(html).toContain('Explain the loop.')
    // Submitted code is read in the shared code block, with line numbers.
    expect(html).toContain('class="code-block')
    expect(html).toContain('data-line-numbers')
    expect(html).toContain('print(&quot;hi&quot;)')
    expect(html).not.toContain('Revise and resubmit')
    expect(html).not.toContain('resubmit below')
    expect(html).not.toContain('Closed the close time')
  })

  it.each(['text', 'exercise', 'checkpoint', 'video'] as const)('prevents %s writes, including reopening completed practice', async (blockType) => {
    const update = vi.spyOn(api, 'updateProgress')
    const video = vi.spyOn(api, 'updateContentBlockVideoProgress')
    const attempt = vi.spyOn(api, 'attemptKnowledgeCheck')
    const container = document.createElement('div')
    const root = createRoot(container)
    const block = checkpoint({ block_type: blockType, submission_type: 'manual_complete', progress: { status: 'completed', completed_at: '2026-10-01T00:00:00Z' },
      ...(blockType === 'video' ? { s3_video_key: 'lesson.mp4' } : {}),
      ...(blockType === 'checkpoint' ? { knowledge_check: { objective_code: null, id: 6, prompt: 'Which value?', options: ['One', 'Two'], attempt_count: 0, latest_attempt: null } } : {}),
    })
    await act(async () => { root.render(<ContentBlockRenderer block={block} cohortId={2} readOnly />) })
    if (blockType === 'video') {
      expect(container.querySelector('[data-video]')?.getAttribute('data-tracking')).toBe('false')
      await act(async () => { Array.from(container.querySelectorAll('button')).filter((button) => button.textContent?.startsWith('Simulate')).forEach((button) => button.click()) })
    } else {
      const controls = Array.from(container.querySelectorAll('button'))
      const writeControls = controls.filter((button) => /Mark|Done|answer|One|Two/i.test(`${button.textContent} ${button.getAttribute('aria-label')}`))
      if (blockType === 'checkpoint') expect(writeControls.length).toBeGreaterThan(0)
      else expect(writeControls).toHaveLength(0)
      expect(writeControls.every((button) => button.disabled)).toBe(true)
      await act(async () => { writeControls.forEach((button) => button.click()) })
    }
    expect(update).not.toHaveBeenCalled()
    expect(video).not.toHaveBeenCalled()
    expect(attempt).not.toHaveBeenCalled()
    act(() => root.unmount())
  })
})

describe('hosted video completion', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refreshes the lesson once when the video becomes complete, not on every later save', async () => {
    const save = vi.spyOn(api, 'updateContentBlockVideoProgress').mockResolvedValue({ data: { video_progress: { content_block_id: 1, last_position: 10, total_watched: 10, duration: 20, status: 'completed', completed: true } } } as Awaited<ReturnType<typeof api.updateContentBlockVideoProgress>>)
    const refresh = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)
    const block = checkpoint({ block_type: 'video', submission_type: null, s3_video_key: 'lesson.mp4' })
    await act(async () => { root.render(<ContentBlockRenderer block={block} cohortId={2} onProgressUpdate={refresh} />) })
    const progress = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Simulate video progress')!
    for (let i = 0; i < 3; i += 1) await act(async () => { progress.click() })
    expect(save).toHaveBeenCalledTimes(3)
    expect(refresh).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })
})

describe('hosted video completion in flight', () => {
  afterEach(() => vi.restoreAllMocks())

  it('refreshes the lesson once when two queued saves both report completion', async () => {
    const resolvers: Array<(value: Awaited<ReturnType<typeof api.updateContentBlockVideoProgress>>) => void> = []
    vi.spyOn(api, 'updateContentBlockVideoProgress').mockImplementation(() => new Promise((resolve) => { resolvers.push(resolve) }))
    const refresh = vi.fn()
    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async () => { root.render(<ContentBlockRenderer block={checkpoint({ block_type: 'video', submission_type: null, s3_video_key: 'lesson.mp4' })} cohortId={2} onProgressUpdate={refresh} />) })
    const progress = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Simulate video progress')!
    await act(async () => { progress.click(); progress.click() })
    const completed = { data: { video_progress: { content_block_id: 1, last_position: 10, total_watched: 10, duration: 20, status: 'completed', completed: true } } } as Awaited<ReturnType<typeof api.updateContentBlockVideoProgress>>
    expect(resolvers).toHaveLength(1)
    await act(async () => { resolvers[0](completed) })
    expect(resolvers).toHaveLength(2)
    await act(async () => { resolvers[1](completed) })
    expect(refresh).toHaveBeenCalledOnce()
    act(() => root.unmount())
  })
})

describe('linked recording compatibility and recovery', () => {
  const segments = [
    { label: 'Core', start_seconds: 5, end_seconds: 7, required: true },
    { label: 'Edited', start_seconds: 1, end_seconds: 3, required: true },
  ]
  const emit = (event: string, seconds = 0) => vimeo.handlers.get(event)?.({ seconds, duration: 60, playbackRate: 2 })
  const block = checkpoint({ block_type: 'recording', video_url: 'https://vimeo.com/123456/98765',
    metadata: { video_segments: segments } })
  afterEach(() => {
    vimeo.create.mockClear()
    vimeo.handlers.clear()
    vimeo.pause.mockClear()
    vimeo.destroy.mockClear()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it.each([['http', false], ['http', true], ['https', false]])('preserves source-less Vimeo completion (%s, readOnly=%s)', async (protocol, readOnly) => {
    const update = vi.spyOn(api, 'updateProgress').mockResolvedValue({ data: null, error: null })
    const save = vi.spyOn(api, 'updateContentBlockVideoProgress')
    const refresh = vi.fn()
    const root = createRoot(document.createElement('div'))
    try {
      await act(async () => root.render(<ContentBlockRenderer block={{ ...block, video_url: protocol + '://vimeo.com/123456/98765' }} cohortId={2} readOnly={readOnly} onProgressUpdate={refresh} />))
      expect(vimeo.create).toHaveBeenCalledWith('https://vimeo.com/123456/98765')
      await act(async () => emit('ended', 60))
      expect(update).toHaveBeenCalledTimes(readOnly ? 0 : 1)
      if (!readOnly) expect(update).toHaveBeenCalledWith(block.id, 'completed', 2)
      expect(refresh).toHaveBeenCalledTimes(readOnly ? 0 : 1)
      expect(save).not.toHaveBeenCalled()
    } finally { act(() => root.unmount()) }
  })

  it.each([false, true])('handles authenticated YouTube ended events with the correct completion path (source=%s)', async (withSource) => {
    const update = vi.spyOn(api, 'updateProgress').mockResolvedValue({ data: null, error: null })
    const save = vi.spyOn(api, 'updateContentBlockVideoProgress').mockResolvedValue({ data: null, error: 'Unavailable', status: 503 })
    const container = document.body.appendChild(document.createElement('div'))
    const root = createRoot(container)
    try {
      const youtube = { ...block, video_url: withSource ? 'https://youtu.be/abcdef12345' : 'http://youtu.be/abcdef12345',
        ...(withSource ? { video_progress_sources: { default: 'source' } } : {}) }
      await act(async () => root.render(<ContentBlockRenderer block={youtube} cohortId={2} />))
      const frame = container.querySelector('iframe')!
      expect(frame.src).toMatch(/^https:\/\/www\.youtube\.com\/embed\/abcdef12345\?/u)
      const deliver = (origin: string, data: object) => window.dispatchEvent(new MessageEvent('message', { origin, source: frame.contentWindow, data }))
      const ended = { event: 'onStateChange', id: block.id, info: 0 }
      await act(async () => deliver('https://not-youtube.invalid', ended))
      expect(update).not.toHaveBeenCalled()
      expect(save).not.toHaveBeenCalled()
      await act(async () => {
        if (withSource) deliver('https://www.youtube.com', { event: 'infoDelivery', info: { duration: 60 } })
        deliver('https://www.youtube.com', ended)
      })
      expect(update).toHaveBeenCalledTimes(withSource ? 0 : 1)
      expect(save).toHaveBeenCalledTimes(withSource ? 1 : 0)
      if (withSource) expect(save).toHaveBeenCalledWith(block.id, expect.objectContaining({ video_source: 'source', total_watched_seconds: 0 }), 2)
    } finally {
      act(() => root.unmount())
      container.remove()
    }
  })

  it('settles a fast Vimeo seek without awarding the jump', async () => {
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    const save = vi.spyOn(api, 'updateContentBlockVideoProgress').mockResolvedValue({ data: null, error: 'Unavailable', status: 503 })
    const container = document.createElement('div')
    const root = createRoot(container)
    try {
      await act(async () => root.render(<ContentBlockRenderer block={{ ...block, video_progress_sources: { default: 'source' } }} />))
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label^="Play Core"]')!.click())
      await act(async () => {
        emit('play')
        emit('playbackratechange')
        emit('timeupdate', 0)
        emit('seeking')
        clock.mockReturnValue(100)
        emit('seeked', 5.35)
        clock.mockReturnValue(550)
        emit('timeupdate', 6.2)
        clock.mockReturnValue(950)
        emit('timeupdate', 7)
      })
      expect(vimeo.pause).toHaveBeenCalledOnce()
      expect(save).toHaveBeenLastCalledWith(block.id, expect.objectContaining({ total_watched_seconds: 1, completed_section_ranges: ['5:7'] }), undefined)
    } finally { act(() => root.unmount()) }
  })

  it('retains coverage across an in-flight metadata refresh and retries a valid range alongside a rejection', async () => {
    vi.useFakeTimers()
    const clock = vi.spyOn(performance, 'now').mockReturnValue(0)
    type Response = Awaited<ReturnType<typeof api.updateContentBlockVideoProgress>>
    const result = (fields: NonNullable<Response['data']>['video_progress']): Response => ({ data: { video_progress: fields }, error: null })
    const progress = { content_block_id: block.id, last_position: 7, total_watched: 4, duration: 60, status: 'in_progress', completed: false }
    let finishFailedSave!: (response: Response) => void
    const save = vi.spyOn(api, 'updateContentBlockVideoProgress')
      .mockResolvedValueOnce(result({ ...progress, completed_video_sections: {} }))
      .mockImplementationOnce(() => new Promise(resolve => { finishFailedSave = resolve }))
      .mockResolvedValueOnce(result({ ...progress, completed_video_sections: {}, section_rejected_ranges: ['1:3'], section_retry_after_seconds: 2 }))
      .mockResolvedValueOnce(result({ ...progress, completed_video_sections: { source: ['5:7'] } }))
    const container = document.createElement('div')
    const root = createRoot(container)
    const render = (videoSegments: typeof segments) => root.render(<ContentBlockRenderer block={{
      ...block, video_progress_sources: { default: 'source' }, metadata: { video_segments: videoSegments },
    }} cohortId={2} />)
    const sample = (event: string, position: number, time: number) => {
      clock.mockReturnValue(time)
      emit(event, position)
    }
    const retry = () => Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'Retry saving progress')
    try {
      await act(async () => render(segments))
      await act(async () => {
        emit('play')
        emit('playbackratechange')
        sample('timeupdate', 1, 100)
        sample('timeupdate', 3, 1100)
        emit('seeking')
        sample('seeked', 5, 1200)
        sample('pause', 6, 1700)
      })
      expect(save).toHaveBeenLastCalledWith(block.id, expect.objectContaining({ completed_section_ranges: ['1:3'] }), 2)
      await act(async () => render([segments[0], { ...segments[1], end_seconds: 4 }]))
      expect(vimeo.create).toHaveBeenCalledOnce()
      expect(vimeo.destroy).not.toHaveBeenCalled()
      await act(async () => finishFailedSave({ data: null, error: 'Unavailable', status: 503 }))
      expect(container.textContent).toContain('Recording progress could not be saved.')
      expect(retry()).toBeDefined()
      await act(async () => {
        emit('play')
        sample('timeupdate', 6, 1800)
        sample('pause', 7, 2300)
      })
      expect(save).toHaveBeenLastCalledWith(block.id, expect.objectContaining({ completed_section_ranges: ['1:3', '5:7'] }), 2)
      expect(container.textContent).toContain('A section could not be confirmed.')
      expect(container.textContent).toContain('Your watch time is still syncing.')
      await act(async () => retry()!.click())
      expect(save).toHaveBeenCalledTimes(3)
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
      expect(save).toHaveBeenCalledTimes(4)
      expect(save).toHaveBeenLastCalledWith(block.id, expect.objectContaining({ completed_section_ranges: ['5:7'] }), 2)
      expect(container.querySelector('button[aria-label^="Play Core"]')?.getAttribute('aria-label')).toContain('section finished')
      expect(container.textContent).toContain('A section could not be confirmed.')
      expect(retry()).toBeUndefined()
    } finally { act(() => root.unmount()) }
  })
})

describe('manual completion feedback', () => {
  it.each(['R', 'A'])('shows grade %s and instructor feedback', (grade) => {
    const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ submission_type: 'manual_complete', submissions: [submission({ grade, feedback: 'Explain your decision.' })] })} />)
    expect(html).toContain('Explain your decision.')
    expect(html).toContain(grade === 'R' ? 'redo (R)' : 'A (')
  })
})

it.each([
  ['text_submission', 'then resubmit below'],
  ['manual_complete', 'Read the feedback — your instructor will re-check this'],
  ['prework_github_sync', 'Update your code on GitHub — your instructor will re-check it'],
])('uses accurate redo copy for %s', (submission_type, copy) => {
  const html = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ block_type: 'exercise', submission_type, submissions: [submission({ grade: 'R', text: null, feedback: 'Unique redo feedback.' })] })} />)
  expect(html).toContain(copy)
  expect(html.split('Unique redo feedback.')).toHaveLength(2)
  if (submission_type === 'manual_complete') {
    expect(html).not.toContain('Your submission')
    expect(html).not.toContain('No inline code text submitted')
    expect(html).not.toContain('Review complete.')
  }
})

describe('written text submissions', () => {
  it('uses the two-mode Markdown editor for a Markdown answer and the code editor for code', () => {
    const written = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint({ filename: 'reflection.md' })} cohortId={2} />)
    expect(written).toContain('data-md-editor')
    expect(written).toContain('aria-label="Editor mode"')
    expect(written).not.toContain('data-editor=')
    const code = renderToStaticMarkup(<ContentBlockRenderer block={checkpoint()} cohortId={2} />)
    expect(code).toContain('data-editor="editable"')
    expect(code).not.toContain('data-md-editor')
  })
})

it('promises instructor review and the default response time for waiting work', () => {
  const html = renderToStaticMarkup(<ContentBlockRenderer cohortId={13} isStaff={false} block={{ id: 9001, block_type: 'exercise', position: 0, title: 'Practice', body: null, video_url: null, filename: null, metadata: {}, submission_type: 'text_submission', submissions: [{ id: 1, text: 'My answer', grade: null, feedback: null, graded_at: null, num_submissions: 1, created_at: '2026-11-17' }] }} />)
  expect(html).toContain('Your instructor will review it — usually within 2 days')
})

it('On shows one server-derived success and hides the revision editor behind an action', () => {
  const html = renderToStaticMarkup(<StudentExperienceProvider v2><ContentBlockRenderer block={checkpoint({ learner_state: 'submitted', submissions: [submission()] })} cohortId={2} reviewerName="Audreana" /></StudentExperienceProvider>)
  expect(html.match(/Waiting for review\./g)).toHaveLength(1)
  expect(html).toContain('Audreana will review it')
  expect(html).toContain('View submission #1')
  expect(html).toContain('Edit and resubmit')
  expect(html).not.toContain('data-editor="editable"')
  expect(html).not.toContain('Revise your answer')
  expect(html).not.toContain('Submitted · waiting')
})
it('On keeps redo feedback and exactly one editor while the prior answer is collapsed', () => {
  const html = renderToStaticMarkup(<StudentExperienceProvider v2><ContentBlockRenderer block={checkpoint({ learner_state: 'redo_requested', submissions: [submission({ grade: 'R', feedback: 'Keep this important feedback.' })] })} cohortId={2} /></StudentExperienceProvider>)
  expect(html.match(/data-editor="editable"/g)).toHaveLength(1)
  expect(html.match(/Keep this important feedback\./g)).toHaveLength(1)
  expect(html).toContain('View submission #1')
  expect(html).not.toContain('<details open')
})

it('On flushes a fresh draft on pagehide before the debounce or React unmount', async () => {
  localStorage.clear()
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(<MemoryRouter><ConfirmProvider><StudentExperienceProvider v2><ContentBlockRenderer block={checkpoint()} cohortId={2} /></StudentExperienceProvider></ConfirmProvider></MemoryRouter>))
    await act(async () => (host.querySelector('[data-editor="editable"]') as HTMLElement).click())
    window.dispatchEvent(new Event('pagehide'))
    expect(localStorage.getItem('csg-learn:submission-draft:v1:me:2:138')).toContain('# edited')
  } finally { await act(async () => root.unmount()); localStorage.clear() }
})

it('renders typed HTML-like written submissions in written mode', () => {
  const html = renderToStaticMarkup(<StudentExperienceProvider v2><ContentBlockRenderer block={checkpoint({ filename: 'answer.md', metadata: { language: 'markdown' }, submissions: [submission({ text: '<p>typed source</p>' })], learner_state: 'submitted' })} cohortId={2} /></StudentExperienceProvider>)
  expect(html).toContain('data-markdown-variant="written"')
  expect(html).toContain('&lt;p&gt;typed source&lt;/p&gt;')
})
it.each([false, true])('reconciles an accepted submission when lesson refresh fails (redo=%s)', async redo => {
  localStorage.clear()
  const accepted = { ...submission({ id: 2, num_submissions: redo ? 2 : 1 }), content_block_id: 138 } as never
  const create = vi.spyOn(api, 'createSubmission').mockResolvedValue({ data: { submission: accepted }, error: null })
  const reload = vi.fn().mockResolvedValue({ error: 'Offline' })
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(<MemoryRouter><ConfirmProvider><StudentExperienceProvider v2><ContentBlockRenderer block={checkpoint({ learner_state: redo ? 'redo_requested' : 'open', submissions: redo ? [submission({ grade: 'R', feedback: 'Try again' })] : [] })} cohortId={2} onProgressUpdate={reload} /></StudentExperienceProvider></ConfirmProvider></MemoryRouter>))
    await act(async () => (host.querySelector('[data-editor="editable"]') as HTMLElement).click())
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === (redo ? 'Resubmit checkpoint' : 'Submit checkpoint'))!.click())
    expect(create).toHaveBeenCalled()
    expect(reload).toHaveBeenCalled()
    expect(host.textContent).toContain('Waiting for review.')
    expect(host.textContent).not.toContain('Your instructor asked for a redo')
    expect(host.textContent).not.toContain('Revise and resubmit')
  } finally { await act(async () => root.unmount()); create.mockRestore(); localStorage.clear() }
})

it('labels a manual-complete filename as an exercise reference only for On learners', () => {
  const block = { id: 99, block_type: 'exercise', position: 0, title: 'Practice', body: null, video_url: null, filename: 'practice.rb', submission_type: 'manual_complete', metadata: {} }
  const render = (v2: boolean) => renderToStaticMarkup(<StudentExperienceProvider v2={v2}><ContentBlockRenderer block={block} cohortId={2} /></StudentExperienceProvider>)
  expect(render(true)).toContain('Exercise file:')
  expect(render(true).match(/practice\.rb/g)).toHaveLength(1)
  expect(render(true)).not.toContain('Nothing to hand in for this one.')
  expect(render(true)).toContain('Work in your own editor. Nothing to upload here.')
  expect(render(false)).not.toContain('Exercise file:')
  expect(render(false)).toContain('practice.rb')
})
