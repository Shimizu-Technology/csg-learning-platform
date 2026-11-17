// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { withLeaveGuard } from '../../test/TestRouter'
import type { LessonBlockEditorResponse, LessonUsage } from '../../types/api'
import { LessonEditor } from './LessonEditor'

const session = vi.hoisted(() => ({ user: { id: 1, role: 'admin', is_staff: true, is_admin: true } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => session }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../contexts/UploadContext', () => ({ useUpload: () => ({ uploads: [], completeDeferredUpload: vi.fn() }) }))
vi.mock('../../components/shared/CodeEditor', () => ({
  CodeEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => <textarea aria-label="Solution code" value={value} onChange={(event) => onChange(event.target.value)} />,
  detectLanguage: () => 'javascript',
}))
vi.mock('../../components/admin/VideoUploadField', () => ({
  VideoUploadField: ({ videoUrl, onVideoUrlChange }: { videoUrl: string; onVideoUrlChange: (url: string) => void }) => <input aria-label="Video link" value={videoUrl} onChange={(event) => onVideoUrlChange(event.target.value)} />,
}))
vi.mock('../../components/admin/AdminVideoPreview', () => ({ AdminVideoPreview: () => null }))
vi.mock('../../components/shared/ContentBlockRenderer', () => ({
  ContentBlockRenderer: ({ block }: { block: { block_type: string; title: string | null; body: string | null } }) => <div data-preview-block={block.block_type}>{block.title} {block.body}</div>,
}))
vi.mock('../../components/shared/LazyMarkdownEditor', async () => {
  const { MarkdownEditor } = await import('../../components/shared/MarkdownEditor/MarkdownEditor')
  return { LazyMarkdownEditor: MarkdownEditor }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const base = {
  title: null, body: null, video_url: null, filename: null, submission_type: null, effective_submission_type: null, submission_type_explicit: null,
  submission_config: {}, metadata: {}, s3_video_key: null, objective_ids: [], rubric: null, knowledge_check: null, has_s3_video: false, completion_required: false, solution: null,
}
const blocks = [
  { ...base, id: 1, block_type: 'text', position: 0, body: '## Why decisions matter' },
  { ...base, id: 2, block_type: 'video', position: 1, title: 'Walkthrough', video_url: 'https://example.invalid/walkthrough' },
  { ...base, id: 3, block_type: 'exercise', position: 2, title: 'Ticket prices', body: 'Write `ticketPrice(age)`.', filename: 'tickets.js', submission_type_explicit: 'text_submission' },
  { ...base, id: 4, block_type: 'code_challenge', position: 3, title: 'Seniors', body: 'Handle 65 and over.' },
  { ...base, id: 5, block_type: 'checkpoint', position: 4, title: 'Quick check', knowledge_check: { id: 8, prompt: 'What does else run?', options: ['Every other case', 'Nothing'], objective_code: null, attempt_count: 0, latest_attempt: null, correct_option: 0, explanation: 'else catches the rest.', learning_objective_id: null } },
  { ...base, id: 6, block_type: 'recording', position: 5, title: 'Class recording', video_url: 'https://example.invalid/class' },
]

const adminAccess: LessonBlockEditorResponse['access'] = { can_edit: true, reason: 'admin', message: null, grants: [], shared_with: [], copy_cohorts: [], copy_of: null }
const leonGrant = { cohort: { id: 4, name: 'Cohort 3' }, granted_by: { id: 9, full_name: 'Leon Tester' }, granted_at: '2026-11-14T02:00:00Z' }
let access: LessonBlockEditorResponse['access'] = adminAccess

function response(overrides: Partial<LessonBlockEditorResponse['lesson']> = {}): LessonBlockEditorResponse {
  return {
    access,
    lesson: {
      id: 2, curriculum_id: 1, module_id: 3, title: 'Make decisions', lesson_type: 'exercise', position: 0, release_day: 0, required: true,
      requires_submission: true, submission_type: 'text_submission', content_blocks_count: blocks.length, archived_at: null,
      updated_at: '2026-11-16T00:00:00.000000Z', objectives: [], content_blocks: blocks, prev_lesson: null, next_lesson: null, ...overrides,
    } as LessonBlockEditorResponse['lesson'],
    block_activity: blocks.map((block) => ({ content_block_id: block.id, submissions: block.id === 3 ? 5 : 0, progress: block.id === 3 ? 5 : 0, watched: 0, check_attempts: 0 })),
    context: {
      curriculum: { id: 1, name: 'Synthetic Web Lab' },
      module: { id: 3, name: 'JavaScript basics', release_days: [{ release_day: 0, week: 1, day_name: 'Monday' }, { release_day: 1, week: 1, day_name: 'Tuesday' }, { release_day: 7, week: 2, day_name: 'Monday' }] },
      used_in: [{ id: 4, name: 'Cohort 3', status: 'active', start_date: '2026-11-10' }],
      other_cohorts_count: 0, submissions_count: 5, waiting_count: 2, open_help_count: 1,
    },
  }
}

let root: Root
let container: HTMLDivElement
let router: ReturnType<typeof createMemoryRouter>
let save: ReturnType<typeof vi.fn>

beforeEach(() => {
  access = adminAccess
  session.user = { id: 1, role: 'admin', is_staff: true, is_admin: true }
  window.localStorage.clear()
  document.execCommand = vi.fn(() => false)
  Element.prototype.scrollIntoView = vi.fn()
  Range.prototype.getClientRects = (() => []) as unknown as Range['getClientRects']
  Range.prototype.getBoundingClientRect = (() => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) })) as Range['getBoundingClientRect']
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  vi.spyOn(api, 'getLessonBlockEditor').mockImplementation(async () => ({ data: response(), error: null }))
  vi.spyOn(api, 'getLearningObjectives').mockResolvedValue({ data: { learning_objectives: [] }, error: null })
  vi.spyOn(api, 'getRubrics').mockResolvedValue({ data: { rubrics: [] }, error: null })
  vi.spyOn(api, 'getRecordUsage').mockResolvedValue({ data: { usage: lessonUsage() }, error: null, status: 200 })
  save = vi.fn(async (_id: number, lesson: { title?: string }) => ({ data: response({ title: lesson.title, updated_at: '2026-11-16T00:00:05.000000Z' }), error: null }))
  vi.spyOn(api, 'saveLessonBlockEditor').mockImplementation(save as never)
})

afterEach(async () => {
  await act(async () => root.unmount())
  document.querySelectorAll('[data-state="closing"]').forEach((ghost) => ghost.dispatchEvent(new Event('animationend', { bubbles: true })))
  container.remove()
  vi.restoreAllMocks()
})

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

/** Opened from Content by default, as the Content studio links do (router state names the origin). */
const fromContent = { returnTo: '/admin/content', returnLabel: 'Content' }

function lessonUsage(): LessonUsage {
  return {
    type: 'lesson', id: 2, title: 'Make decisions', lesson_type: 'lesson', required: true, archived: false, release_day: 0, week: 1, day_name: 'Monday',
    curriculum: { id: 1, name: 'Synthetic Web Lab' }, module: { id: 3, name: 'JavaScript basics' }, can_edit: true, blocks: [], objectives: [],
    cohorts: [{ id: 4, name: 'Cohort 3', status: 'active', course_delivery: 'program', start_date: '2026-11-10', end_date: null, on_sale: false, assigned: true, release_date: '2026-11-10', submissions: 5, waiting: 2, open_help: 1 }],
    other_cohorts_count: 0, help_requests: [], totals: { submissions: 5, waiting: 2, open_help: 1 },
  }
}

async function mount(path = '/admin/lessons/2/edit', state: unknown = fromContent) {
  router = createMemoryRouter(withLeaveGuard([
    { path: '/admin/lessons/:id/edit', element: <LessonEditor /> },
    { path: '/admin/lessons/:id', element: <p>Lesson page</p> },
    { path: '/admin/content', element: <p>Content library</p> },
  ]), { initialEntries: [{ pathname: path.split('?')[0], search: path.includes('?') ? `?${path.split('?')[1]}` : '', state }] })
  await act(async () => root.render(<RouterProvider router={router} />))
  await settle()
  await settle()
}

const cards = () => Array.from(container.querySelectorAll<HTMLElement>('article[data-block-key]'))
const cardLabels = () => cards().map((card) => card.getAttribute('aria-label'))
const button = (label: string, scope: ParentNode = document) => Array.from(scope.querySelectorAll<HTMLButtonElement>('button')).find((item) => item.getAttribute('aria-label') === label || item.textContent?.trim() === label)
const click = async (element: HTMLElement | undefined | null) => {
  expect(element).toBeTruthy()
  await act(async () => element!.click())
  await settle()
}
const type = async (input: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!
  await act(async () => {
    setter.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
const sentLesson = () => save.mock.calls.at(-1)![1] as { blocks: Array<{ id?: number; client_id?: string; block_type: string; title: string | null }>; removed_block_ids: number[]; title: string; release_day: number }

describe('block lesson editor', () => {
  it('shows every block in order as an editable card with the two-mode editor on formatted text', async () => {
    await mount()
    expect(cardLabels()).toEqual([
      'Text block, 1 of 6', 'Video block, 2 of 6', 'Exercise block, 3 of 6', 'Code challenge block, 4 of 6', 'Checkpoint block, 5 of 6', 'Recording block, 6 of 6',
    ])
    expect(container.querySelector('h1')?.textContent).toBe('Make decisions')
    expect(container.textContent).toContain('Synthetic Web Lab')
    expect(container.textContent).toContain('Week 1, Mon')
    // Text, exercise, code challenge and checkpoint instructions all use Rich | Markdown.
    expect(container.querySelectorAll('[role="group"][aria-label="Editor mode"]').length).toBe(4)
    expect(Array.from(container.querySelectorAll('[role="group"][aria-label="Editor mode"]'))[0].textContent).toMatch(/Rich.*Markdown/)
    expect(cards()[2].querySelector<HTMLInputElement>('input')!.value).toBe('Ticket prices')
    expect(cards()[4].querySelector<HTMLTextAreaElement>('textarea')!.value).toBe('What does else run?')
    expect(container.textContent).toContain('Saved')
  })

  it('adds a block between, reorders with the keyboard, duplicates and deletes, then saves the whole lesson in order', async () => {
    await mount()
    await click(button('Add block after block 1'))
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Checkpoint'))
    expect(cardLabels()[1]).toBe('Checkpoint block, 2 of 7')

    const handle = button('Move Text block, 1 of 7')!
    await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })))
    await settle()
    expect(cardLabels().slice(0, 2)).toEqual(['Checkpoint block, 1 of 7', 'Text block, 2 of 7'])
    expect(container.querySelector('[aria-live="polite"]')!.textContent).toBe('Moved text block to position 2 of 7.')

    await click(button('Duplicate code challenge block'))
    expect(cardLabels()[5]).toBe('Code challenge block, 6 of 8')

    // The exercise has submissions, so it can't be deleted.
    expect(button('Exercise block has learner work and can\'t be deleted')!.disabled).toBe(true)
    await click(button('Delete video block'))
    await click(button('Delete block'))
    expect(cardLabels()).toHaveLength(7)

    await click(button('Save'))
    const lesson = sentLesson()
    expect(lesson.blocks.map((block) => block.id ?? block.block_type)).toEqual(['checkpoint', 1, 3, 4, 'code_challenge', 5, 6])
    expect(lesson.blocks[4]).toMatchObject({ title: 'Seniors', client_id: expect.stringMatching(/^new-/) })
    expect(lesson.removed_block_ids).toEqual([2])
  })

  it('edits an exercise solution in a dialog, outside the movable card', async () => {
    await mount()
    expect(cards()[2].querySelector('textarea[aria-label="Solution code"]')).toBeNull()
    await click(button('Add solution', cards()[2]))
    const dialog = Array.from(document.querySelectorAll('[role="dialog"]')).find((item) => item.textContent?.includes('Solution for Ticket prices'))!
    await type(dialog.querySelector<HTMLTextAreaElement>('textarea[aria-label="Solution code"]')!, 'const ticketPrice = (age) => age < 12 ? 5 : 10')
    await click(button('Done', dialog))
    expect(cards()[2].textContent).toContain('Solution (staff only)· 1 line')
    await click(button('Save'))
    expect((sentLesson().blocks[2] as { solution?: string }).solution).toBe('const ticketPrice = (age) => age < 12 ? 5 : 10')
  })

  it('saves only when asked, with the Save button or the keyboard, and shows the save state', async () => {
    await mount()
    expect(button('Save')!.disabled).toBe(true)
    await type(cards()[2].querySelector('input')!, 'Ticket prices for a cinema')
    expect(container.textContent).toContain('Unsaved changes')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1700)) })
    await settle()
    expect(save).not.toHaveBeenCalled()

    await click(button('Save'))
    expect(save).toHaveBeenCalledTimes(1)
    expect(sentLesson().blocks[2].title).toBe('Ticket prices for a cinema')
    expect(container.textContent).toMatch(/Saved · \d+s ago/)
    expect(button('Save')!.disabled).toBe(true)

    await type(cards()[2].querySelector('input')!, 'Ticket prices again')
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })) })
    await settle()
    expect(save).toHaveBeenCalledTimes(2)
    expect(sentLesson().blocks[2].title).toBe('Ticket prices again')
  })

  it('runs one save at a time and builds each payload from the newest edits and version', async () => {
    const pending: Array<() => void> = []
    save.mockImplementation(async (_id: number, lesson: { title?: string; blocks: unknown[] }) => {
      await new Promise<void>((resolve) => pending.push(resolve))
      return { data: response({ title: lesson.title, updated_at: `2026-11-16T00:00:0${save.mock.calls.length}.000000Z` }), error: null }
    })
    await mount()
    await type(cards()[2].querySelector('input')!, 'First')
    await click(button('Save'))
    await type(cards()[2].querySelector('input')!, 'Second')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }))
    })
    await settle()
    expect(save).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('Saving…')

    await act(async () => pending.shift()!())
    await settle()
    expect(save).toHaveBeenCalledTimes(2)
    const second = save.mock.calls[1][1] as { blocks: Array<{ title: string | null }>; base_updated_at: string }
    expect(second.blocks[2].title).toBe('Second')
    expect(second.base_updated_at).toBe('2026-11-16T00:00:01.000000Z')

    await act(async () => pending.shift()!())
    await settle()
    expect(save).toHaveBeenCalledTimes(2)
    expect(container.textContent).toMatch(/Saved · \d+s ago/)
  })

  it('queues removal of a new block deleted while its first save was in flight', async () => {
    let release: () => void = () => {}
    save.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      const created = { ...base, id: 7, block_type: 'checkpoint', position: 6, title: 'Draft note' }
      return { data: response({ content_blocks: [...blocks, created], content_blocks_count: 7, updated_at: '2026-11-16T00:00:01.000000Z' }), error: null }
    })
    await mount()
    await click(button('Add block at the end'))
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Checkpoint'))
    await type(cards()[6].querySelector('input')!, 'Draft note')
    await click(button('Save'))
    expect(sentLesson().blocks[6]).toMatchObject({ client_id: expect.stringMatching(/^new-/), title: 'Draft note' })

    await click(button('Delete checkpoint block', cards()[6]))
    await click(button('Delete block'))
    expect(cards()).toHaveLength(6)
    await act(async () => release())
    await settle()

    expect(container.textContent).toContain('Unsaved changes')
    await click(button('Save'))
    expect(save).toHaveBeenCalledTimes(2)
    expect(sentLesson().removed_block_ids).toEqual([7])
    expect(sentLesson().blocks.map((block) => block.id)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('keeps a local backup of unsaved edits and restores it only when asked', async () => {
    await mount()
    await type(cards()[2].querySelector('input')!, 'Typed before a crash')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)) })
    expect(window.localStorage.getItem('csg:lesson-editor-draft:v1:1:2')).toContain('Typed before a crash')

    await act(async () => root.unmount())
    root = createRoot(container)
    await mount()
    expect(cards()[2].querySelector('input')!.value).toBe('Ticket prices')
    expect(container.textContent).toContain('This browser kept changes you didn\'t save')
    await click(button('Restore changes'))
    expect(cards()[2].querySelector('input')!.value).toBe('Typed before a crash')
    expect(save).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Unsaved changes')

    await click(button('Save'))
    expect(sentLesson().blocks[2].title).toBe('Typed before a crash')
    await settle()
    expect(window.localStorage.getItem('csg:lesson-editor-draft:v1:1:2')).toBeNull()
  })

  it('offers no restore when the lesson was saved after the backup', async () => {
    window.localStorage.setItem('csg:lesson-editor-draft:v1:1:2', JSON.stringify({
      savedAt: Date.now(), baseUpdatedAt: '2026-11-15T00:00:00.000000Z',
      draft: { title: 'Old', required: true, release_day: 0, blocks: [], removed_block_ids: [], alignments: [] },
    }))
    await mount()
    expect(container.textContent).toContain('the lesson was saved since then')
    expect(button('Restore changes')).toBeUndefined()
    await click(button('Dismiss'))
    expect(window.localStorage.getItem('csg:lesson-editor-draft:v1:1:2')).toBeNull()
  })

  // L-3.1: the header names the lesson's place and Back goes where the editor was opened from.
  it('links the breadcrumb to the curriculum, module and lesson pages, and Back falls back to the lesson page', async () => {
    // The origin is remembered per tab; this tab has none.
    window.sessionStorage.clear()
    await mount('/admin/lessons/2/edit', null)
    const crumbs = Array.from(container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Breadcrumb"] a')).map((link) => [link.textContent, link.getAttribute('href')])
    expect(crumbs).toEqual([['Synthetic Web Lab', '/admin/curricula/1'], ['JavaScript basics', '/admin/modules/3'], ['Make decisions', '/admin/lessons/2']])
    const back = container.querySelector<HTMLAnchorElement>('header a[data-back-link]')!
    expect(back.getAttribute('aria-label')).toBe('Back to lesson')
    await click(back)
    expect(router.state.location.pathname).toBe('/admin/lessons/2')
  })

  it('goes Back to Grading when opened from Grading', async () => {
    window.sessionStorage.clear()
    await mount('/admin/lessons/2/edit?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dall', null)
    expect(container.querySelector('header a[data-back-link]')!.getAttribute('aria-label')).toBe('Back to Grading · All submissions')
  })

  it('shows the inspector for the lesson and for the selected block', async () => {
    await mount()
    const aside = container.querySelector('aside[aria-label="Settings"]')!
    expect(aside.textContent).toContain('Schedule')
    expect(aside.textContent).toContain('Objectives')
    expect(aside.textContent).toContain('Cohort 3')
    // "Used in" (L-3.1): the cohort, when the lesson opens there, View as student, and its work and help.
    expect(aside.textContent).toContain('Live program · Opened Tue, Nov 10')
    expect(aside.querySelector('a[href="/admin/cohorts/4/student-view/lessons/2"]')?.textContent).toContain('View as student')
    expect(aside.querySelector('a[href="/admin/grading?cohort_id=4&lesson_id=2&filter=all"]')?.textContent).toBe('5 submissions')
    expect(aside.querySelector('a[href="/admin/grading?cohort_id=4&lesson_id=2"]')?.textContent).toBe('2 waiting')
    expect(aside.querySelector('a[href="/admin/support?cohort_id=4"]')?.textContent).toBe('1 open help')

    await act(async () => cards()[2].dispatchEvent(new Event('pointerdown', { bubbles: true })))
    await settle()
    expect(button('Exercise block', aside)!.getAttribute('aria-selected')).toBe('true')
    const submission = Array.from(aside.querySelectorAll('label')).find((label) => label.textContent === 'Submission type')!
    expect((document.getElementById(submission.htmlFor) as HTMLSelectElement).value).toBe('text_submission')
    expect(aside.querySelector<HTMLInputElement>('input[placeholder="ticket-price.js"]')!.value).toBe('tickets.js')
    expect(aside.textContent).toContain('Rubric')
    expect(aside.textContent).toContain('Students have work here (5 submissions)')

    await click(button('Lesson', aside))
    const day = aside.querySelector<HTMLSelectElement>('select[aria-label="Day"]')!
    await act(async () => {
      day.value = '1'
      day.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(container.textContent).toContain('Week 1, Tue')
  })

  it('previews every block the way students see it', async () => {
    await mount()
    await click(button('Preview'))
    const preview = container.querySelector('[data-testid="lesson-preview"]')!
    expect(Array.from(preview.querySelectorAll('[data-preview-block]')).map((item) => item.getAttribute('data-preview-block')))
      .toEqual(['text', 'video', 'exercise', 'code_challenge', 'checkpoint', 'recording'])
    expect(router.state.location.search).toBe('?preview=true')
  })

  it('asks before leaving with unsaved edits and can save and leave', async () => {
    await mount()
    await type(cards()[2].querySelector('input')!, 'Changed title')
    await click(container.querySelector<HTMLAnchorElement>('a[aria-label="Back to Content"]'))
    expect(document.body.textContent).toContain('Leave without saving?')
    expect(button('Keep editing')).toBeTruthy()
    expect(button('Discard')).toBeTruthy()
    await click(button('Save and leave'))
    await settle()
    expect(save).toHaveBeenCalledTimes(1)
    expect(router.state.location.pathname).toBe('/admin/content')
  })

  it('can keep editing or discard when leaving with unsaved edits', async () => {
    await mount()
    await type(cards()[2].querySelector('input')!, 'Changed title')
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)) })
    await click(container.querySelector<HTMLAnchorElement>('a[aria-label="Back to Content"]'))
    await click(button('Keep editing'))
    expect(router.state.location.pathname).toBe('/admin/lessons/2/edit')
    expect(cards()[2].querySelector('input')!.value).toBe('Changed title')

    await click(container.querySelector<HTMLAnchorElement>('a[aria-label="Back to Content"]'))
    await click(button('Discard'))
    await settle()
    expect(router.state.location.pathname).toBe('/admin/content')
    expect(save).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('csg:lesson-editor-draft:v1:1:2')).toBeNull()
  })

  it('asks before replacing a watched video and resends the save with the blocks the server named', async () => {
    const message = 'Replacing the video in "Walkthrough" resets watch progress for 3 students. Confirm the reset to save.'
    save.mockResolvedValueOnce({ data: null, error: message, status: 422, errorCode: 'confirm_watch_reset', errorBlockIds: [2] })
    await mount()
    const link = container.querySelector<HTMLInputElement>('input[aria-label="Video link"]')
    expect(link).toBeTruthy()
    await type(link!, 'https://example.invalid/new-walkthrough')
    await click(button('Save'))

    expect(document.body.textContent).toContain(message)
    expect((save.mock.calls[0][1] as { confirm_watch_reset_block_ids?: number[] }).confirm_watch_reset_block_ids).toBeUndefined()
    await click(button('Replace and reset watch time'))
    expect(save).toHaveBeenCalledTimes(2)
    expect((sentLesson() as unknown as { confirm_watch_reset_block_ids: number[] }).confirm_watch_reset_block_ids).toEqual([2])
  })

  it('keeps edits and explains a conflict when another admin saved first', async () => {
    save.mockResolvedValueOnce({ data: null, error: 'Someone else saved this lesson after you opened it.', status: 409, errorCode: 'stale_editor' })
    await mount()
    await type(cards()[2].querySelector('input')!, 'Mine')
    await click(button('Save'))
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('Someone else saved this lesson')
    expect(button('Reload latest version')).toBeTruthy()
    expect(cards()[2].querySelector('input')!.value).toBe('Mine')
    expect(container.textContent).toContain('Not saved: newer version')
  })
})

describe('lesson editing access', () => {
  const menuItems = async () => {
    await click(button('More lesson actions'))
    return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).map((item) => item.textContent)
  }

  it('shows an instructor without editing access the lesson read only, with who can edit', async () => {
    session.user = { id: 7, role: 'instructor', is_staff: true, is_admin: false }
    access = { can_edit: false, reason: 'no_grant', message: 'Only admins can edit lessons.', grants: [], shared_with: [], copy_cohorts: [], copy_of: null }
    await mount()

    expect(container.textContent).toContain('Read only.')
    expect(container.textContent).toContain('Ask an admin to give you editing access for your cohort.')
    expect(cards()).toHaveLength(0)
    expect(button('Save')).toBeUndefined()
    expect(api.getLearningObjectives).not.toHaveBeenCalled()
  })

  it('names the other cohorts when a shared curriculum keeps a granted instructor read only', async () => {
    session.user = { id: 7, role: 'instructor', is_staff: true, is_admin: false }
    access = { can_edit: false, reason: 'shared', message: null, grants: [leonGrant], shared_with: [{ id: 5, name: 'Cohort 4' }], copy_cohorts: [], copy_of: null }
    await mount()

    expect(container.textContent).toContain('Read only: Cohort 4 shares this curriculum')
    expect(container.textContent).toContain('Leon gave you this access on Nov 14.')
  })

  it('lets a granted instructor on a shared curriculum make a copy for their cohort, then opens the lesson in the copy', async () => {
    session.user = { id: 7, role: 'instructor', is_staff: true, is_admin: false }
    access = { can_edit: false, reason: 'shared', message: null, grants: [leonGrant], shared_with: [{ id: 5, name: 'Cohort 4' }], copy_cohorts: [{ id: 3, name: 'Cohort 3' }], copy_of: null }
    const preview = vi.spyOn(api, 'getCurriculumCopyPreview').mockResolvedValue({ data: { curriculum_copy_preview: {
      cohort: { id: 3, name: 'Cohort 3' }, source_curriculum: { id: 1, name: 'Web Lab' }, copy_name: 'Web Lab (Cohort 3)', shared_with: [{ id: 5, name: 'Cohort 4' }],
      already_copied: false, copy_curriculum_id: null, can_copy: true, blockers: [],
      counts: { lessons: 4, progresses: 12, submissions: 3, module_assignments: 4, cohort_module_schedules: 1, knowledge_check_attempts: 0 },
    } }, error: null })
    const copy = vi.spyOn(api, 'copyCurriculumForCohort').mockResolvedValue({ data: { curriculum_copy: {
      id: 9, cohort: { id: 3, name: 'Cohort 3' }, source_curriculum: { id: 1, name: 'Web Lab' }, copy_curriculum: { id: 11, name: 'Web Lab (Cohort 3)' },
      created_by: { id: 7, full_name: 'Audreana Tester' }, created_at: '2026-11-16T00:00:00Z', already_copied: false, counts: {}, lesson_ids: { 2: 22 },
    } }, error: null })
    await mount()

    expect(container.textContent).toContain('Make a copy for Cohort 3 to change this lesson without affecting Cohort 4.')
    await click(button('Make a copy for Cohort 3'))
    await settle()
    expect(preview).toHaveBeenCalledWith(3, 1)
    const dialog = document.querySelector('[role="dialog"]')!
    expect(dialog.textContent).toContain('Make a copy for Cohort 3?')
    expect(dialog.textContent).toContain('Cohort 3 switches to its own copy of Web Lab (4 lessons). Its progress, submissions and release dates stay attached. Cohort 4 keeps the shared version.')
    expect(Array.from(dialog.querySelectorAll('[data-testid="copy-counts"] li')).map((item) => item.textContent)).toEqual(['12 steps with progress', '3 submissions', '5 release dates or access settings'])

    await click(button('Make a copy', dialog))
    await settle()
    expect(copy).toHaveBeenCalledWith(3, 1)
    expect(router.state.location.pathname).toBe('/admin/lessons/22/edit')
  })

  it("says when the editor is on a cohort's own copy, and offers admins a copy while cohorts share one", async () => {
    access = { ...adminAccess, copy_cohorts: [{ id: 3, name: 'Cohort 3' }, { id: 5, name: 'Cohort 4' }] }
    vi.spyOn(api, 'getLessonBlockEditor').mockImplementation(async () => ({ data: { ...response(), context: { ...response().context, used_in: [{ id: 3, name: 'Cohort 3', status: 'active', start_date: '2026-11-10' }, { id: 5, name: 'Cohort 4', status: 'active', start_date: '2027-01-12' }] } } as LessonBlockEditorResponse, error: null }))
    await mount()
    expect(container.textContent).toContain('To change it for one cohort only, make a copy first.')
    expect(button('Make a copy for one cohort')).toBeTruthy()

    await act(async () => root.unmount())
    root = createRoot(container)
    access = { ...adminAccess, copy_of: { cohort: { id: 3, name: 'Cohort 3' }, source_curriculum: { id: 1, name: 'Web Lab' }, created_at: '2026-11-16T00:00:00Z' } }
    vi.spyOn(api, 'getLessonBlockEditor').mockImplementation(async () => ({ data: response(), error: null }))
    await mount()
    expect(container.textContent).toContain("You're editing Cohort 3's copy.")
    expect(container.textContent).toContain('Other cohorts keep the shared Web Lab.')
  })

  it("won't start a copy while the editor has unsaved changes, so leaving can't save them on the shared lesson", async () => {
    access = { ...adminAccess, copy_cohorts: [{ id: 3, name: 'Cohort 3' }, { id: 5, name: 'Cohort 4' }] }
    const shared = (lesson?: Parameters<typeof response>[0]) => ({ ...response(lesson), context: { ...response().context, used_in: [{ id: 3, name: 'Cohort 3', status: 'active', start_date: '2026-11-10' }, { id: 5, name: 'Cohort 4', status: 'active', start_date: '2027-01-12' }] } }) as LessonBlockEditorResponse
    vi.spyOn(api, 'getLessonBlockEditor').mockImplementation(async () => ({ data: shared(), error: null }))
    save.mockImplementation(async (_id: number, lesson: { title?: string }) => ({ data: shared({ title: lesson.title, updated_at: '2026-11-16T00:00:05.000000Z' }), error: null }))
    const preview = vi.spyOn(api, 'getCurriculumCopyPreview')
    const copy = vi.spyOn(api, 'copyCurriculumForCohort')
    await mount()
    expect(button('Make a copy for one cohort')!.disabled).toBe(false)

    await type(cards()[2].querySelector<HTMLInputElement>('input')!, 'Ticket prices, edited')
    const action = button('Make a copy for one cohort')!
    expect(action.disabled).toBe(true)
    expect(document.getElementById(action.getAttribute('aria-describedby')!)?.textContent).toBe('Save or discard your changes first')
    await act(async () => action.click())
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(preview).not.toHaveBeenCalled()
    expect(copy).not.toHaveBeenCalled()

    // Saved (on the shared lesson, knowingly, as an admin): the copy can start.
    await click(button('Save'))
    expect(save).toHaveBeenCalledOnce()
    expect(button('Make a copy for one cohort')!.disabled).toBe(false)
    expect(button('Make a copy for one cohort')!.hasAttribute('aria-describedby')).toBe(false)
  })

  it('lets a granted instructor edit and save, says who gave the access, and keeps lesson structure for admins', async () => {
    session.user = { id: 7, role: 'instructor', is_staff: true, is_admin: false }
    access = { can_edit: true, reason: 'granted', message: null, grants: [leonGrant], shared_with: [], copy_cohorts: [], copy_of: null }
    await mount()

    expect(container.textContent).toContain("You can edit Cohort 3's lessons.")
    expect(container.textContent).toContain('Leon gave you this access on Nov 14.')
    expect(cards()).toHaveLength(blocks.length)
    expect(await menuItems()).toEqual(['Copy link'])
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))

    await type(cards()[2].querySelector('input')!, 'Instructor title')
    await click(button('Save'))
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('duplicates the lesson as an archived copy and opens it', async () => {
    const duplicate = vi.spyOn(api, 'duplicateLesson').mockResolvedValue({ data: { lesson: { ...response().lesson, id: 9, title: 'Make decisions (copy)', archived_at: '2026-11-16T00:00:00Z' } }, error: null })
    await mount()
    expect(await menuItems()).toEqual(['Duplicate lesson', 'Move to week or day', 'Copy link', 'Archive lesson'])
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Duplicate lesson'))
    expect(document.body.textContent).toContain('It starts archived on the same day')
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find((item) => item.textContent === 'Duplicate lesson'))

    expect(duplicate).toHaveBeenCalledWith(2)
    expect(router.state.location.pathname).toBe('/admin/lessons/9/edit')
  })

  function moveModules() {
    return [
      { id: 3, curriculum_id: 1, name: 'JavaScript basics', module_type: 'live_class', description: null, position: 0, total_days: null, day_offset: 0, schedule_days: 'weekdays', updated_at: '', scheduled_day_names: [], week_count: 1, lessons_count: 2, archived_lessons_count: 0, submissions_count: 0, deletion_blocked: false,
        lessons: [
          { id: 2, title: 'Make decisions', lesson_type: 'exercise', position: 0, release_day: 0, required: true, requires_submission: true, content_blocks_count: 6, archived_at: null, updated_at: '' },
          { id: 11, title: 'Loops', lesson_type: 'exercise', position: 0, release_day: 2, required: true, requires_submission: false, content_blocks_count: 1, archived_at: null, updated_at: '' },
        ] },
      { id: 8, curriculum_id: 1, name: 'The DOM', module_type: 'live_class', description: null, position: 1, total_days: null, day_offset: 14, schedule_days: 'mwf', updated_at: '', scheduled_day_names: [], week_count: 1, lessons_count: 0, archived_lessons_count: 0, submissions_count: 0, deletion_blocked: false, lessons: [] },
    ]
  }

  it('moves the lesson to another day and place, checking a module change with a dry run first', async () => {
    const modules = moveModules()
    vi.spyOn(api, 'getCurriculum').mockResolvedValue({ data: { curriculum: { id: 1, name: 'Synthetic Web Lab', description: null, total_weeks: null, status: 'active', updated_at: '', modules_count: 2, modules } }, error: null } as never)
    const impact = { learners_losing_access: 2, learners_with_work_losing_access: 0, learners_gaining_access: 0, self_paced_learners: false }
    const move = vi.spyOn(api, 'moveLesson').mockImplementation(async (_id, body) => ({ data: body.dry_run ? { impact } : { lesson: response().lesson, impact }, error: null }))
    await mount()
    await click(button('More lesson actions'))
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Move to week or day'))
    await settle()

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
    const selects = () => Array.from(dialog.querySelectorAll<HTMLSelectElement>('select'))
    const choose = async (select: HTMLSelectElement, value: string) => {
      await act(async () => {
        select.value = value
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
    await choose(selects()[1], '2')
    expect(Array.from(selects()[2].options).map((option) => option.textContent)).toEqual(['First', 'After "Loops"'])
    await choose(selects()[2], '1')
    // A day change can change who sees the lesson too, so it's checked first.
    await click(button('Move lesson', dialog))
    expect(move).toHaveBeenLastCalledWith(2, { module_id: 3, release_day: 2, position: 1, base_updated_at: '2026-11-16T00:00:00.000000Z', dry_run: true })
    await click(button('Move anyway', dialog))
    expect(move).toHaveBeenLastCalledWith(2, {
      module_id: 3, release_day: 2, position: 1, base_updated_at: '2026-11-16T00:00:00.000000Z',
      expected_impact: { learners_losing_access: 2, learners_gaining_access: 0, self_paced_learners: false },
    })

    move.mockClear()
    await mount()
    await click(button('More lesson actions'))
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Move to week or day'))
    await settle()
    const second = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1)!
    await choose(second.querySelectorAll('select')[0] as HTMLSelectElement, '8')
    await click(button('Move lesson', second))
    expect(move).toHaveBeenCalledTimes(1)
    expect(move.mock.calls[0][1]).toMatchObject({ module_id: 8, release_day: 0, dry_run: true })
    expect(second.textContent).toContain('2 students will stop seeing this lesson.')
    await click(button('Move anyway', second))
    expect(move).toHaveBeenCalledTimes(2)
    expect(move.mock.calls[1][1]).not.toHaveProperty('dry_run')
    expect(move.mock.calls[1][1]).toMatchObject({ module_id: 8, expected_impact: { learners_losing_access: 2, learners_gaining_access: 0, self_paced_learners: false } })
  })

  const openMoveDialog = async () => {
    await click(button('More lesson actions'))
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Move to week or day'))
    await settle()
    return Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1)!
  }
  const chooseIn = async (select: HTMLSelectElement, value: string) => {
    await act(async () => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
  }
  const mockModules = (modules = moveModules()) => vi.spyOn(api, 'getCurriculum').mockResolvedValue({ data: { curriculum: { id: 1, name: 'Synthetic Web Lab', description: null, total_weeks: null, status: 'active', updated_at: '', modules_count: modules.length, modules } }, error: null } as never)

  it('keeps a lesson\'s week among the day choices when it moves into a shorter module', async () => {
    const modules = moveModules()
    modules[0].lessons[0].release_day = 70
    vi.spyOn(api, 'getLessonBlockEditor').mockImplementation(async () => ({ data: response({ release_day: 70 }), error: null }))
    mockModules(modules)
    await mount()
    const dialog = await openMoveDialog()
    const selects = () => Array.from(dialog.querySelectorAll<HTMLSelectElement>('select'))
    await chooseIn(selects()[0], '8')

    // Day 70 is a Monday, which "The DOM" (Mon/Wed/Fri, one week) meets.
    expect(selects()[1].value).toBe('70')
    expect(Array.from(selects()[1].options).map((option) => option.value)).toContain('70')
    expect(selects()[1].selectedOptions[0].textContent).toBe('Week 11 · Monday')
  })

  it('ties a dry run to the destination it checked: controls wait for it, and a changed choice is checked again', async () => {
    mockModules()
    const impact = { learners_losing_access: 1, learners_with_work_losing_access: 0, learners_gaining_access: 0, self_paced_learners: false }
    let finishDryRun: (() => void) | null = null
    const move = vi.spyOn(api, 'moveLesson').mockImplementation((_id, body) => body.dry_run
      ? new Promise((resolve) => { finishDryRun = () => resolve({ data: { impact }, error: null }) })
      : Promise.resolve({ data: { lesson: response().lesson, impact }, error: null }) as never)
    await mount()
    const dialog = await openMoveDialog()
    const selects = () => Array.from(dialog.querySelectorAll<HTMLSelectElement>('select'))
    await chooseIn(selects()[0], '8')
    await click(button('Move lesson', dialog))

    // While the dry run is out, the destination can't change.
    expect(selects().every((select) => select.disabled)).toBe(true)
    expect(button('Moving…', dialog)?.disabled).toBe(true)
    await act(async () => { finishDryRun!() })
    await settle()
    expect(dialog.textContent).toContain('1 student will stop seeing this lesson.')

    // Choosing another day drops that answer; the next move checks the new day.
    await chooseIn(selects()[1], '2')
    expect(dialog.textContent).not.toContain('will stop seeing this lesson')
    expect(button('Move lesson', dialog)).toBeTruthy()
    await click(button('Move lesson', dialog))
    expect(move).toHaveBeenCalledTimes(2)
    expect(move.mock.calls[1][1]).toMatchObject({ module_id: 8, release_day: 2, dry_run: true })
    await act(async () => { finishDryRun!() })
    await settle()
    await click(button('Move anyway', dialog))
    expect(move.mock.calls[2][1]).toMatchObject({ module_id: 8, release_day: 2, expected_impact: { learners_losing_access: 1, learners_gaining_access: 0, self_paced_learners: false } })
  })

  it('shows the new numbers when the server says the impact changed since the dry run', async () => {
    mockModules()
    const checked = { learners_losing_access: 1, learners_with_work_losing_access: 0, learners_gaining_access: 0, self_paced_learners: false }
    const now = { ...checked, learners_gaining_access: 3 }
    const move = vi.spyOn(api, 'moveLesson').mockImplementation(async (_id, body) => body.dry_run
      ? { data: { impact: checked }, error: null }
      : body.expected_impact?.learners_gaining_access === 3
        ? { data: { lesson: response().lesson, impact: now }, error: null }
        : { data: null, error: 'Who can open this lesson changed since you checked.', errorCode: 'impact_changed', errorImpact: now } as never)
    await mount()
    const dialog = await openMoveDialog()
    await chooseIn(dialog.querySelectorAll('select')[0] as HTMLSelectElement, '8')
    await click(button('Move lesson', dialog))
    await click(button('Move anyway', dialog))

    expect(dialog.textContent).toContain('Who can open this lesson changed since you checked.')
    expect(dialog.textContent).toContain('3 students will start seeing it.')
    await click(button('Move anyway', dialog))
    expect(move.mock.calls.at(-1)![1]).toMatchObject({ expected_impact: { learners_losing_access: 1, learners_gaining_access: 3, self_paced_learners: false } })
  })

  it('keeps the move dialog open, and the editor locked, until the moved lesson has reloaded', async () => {
    const modules = moveModules()
    modules[0].lessons.push({ id: 12, title: 'Variables', lesson_type: 'reading', position: 1, release_day: 0, required: true, requires_submission: false, content_blocks_count: 1, archived_at: null, updated_at: '' })
    mockModules(modules)
    let finishMove: (() => void) | null = null
    vi.spyOn(api, 'moveLesson').mockImplementation(() => new Promise((resolve) => {
      finishMove = () => resolve({ data: { lesson: response().lesson, impact: { learners_losing_access: 0, learners_with_work_losing_access: 0, learners_gaining_access: 0, self_paced_learners: false } }, error: null })
    }) as never)
    await mount()
    const dialog = await openMoveDialog()
    // Same day, new place: no dry run needed.
    vi.spyOn(api, 'getLessonBlockEditor').mockImplementation(async () => ({ data: response({ release_day: 0, position: 1, updated_at: '2026-11-16T00:00:09.000000Z' }), error: null }))
    await chooseIn(dialog.querySelectorAll('select')[2] as HTMLSelectElement, '1')
    await click(button('Move lesson', dialog))
    expect(api.moveLesson).toHaveBeenCalledWith(2, { module_id: 3, release_day: 0, position: 1, base_updated_at: '2026-11-16T00:00:00.000000Z' })

    expect(button('Cancel', dialog)?.disabled).toBe(true)
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    await settle()
    expect(document.body.contains(dialog)).toBe(true)
    const loadsBefore = vi.mocked(api.getLessonBlockEditor).mock.calls.length

    await act(async () => { finishMove!() })
    await settle()
    await settle()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(vi.mocked(api.getLessonBlockEditor).mock.calls.length).toBe(loadsBefore + 1)
  })
  it('blocks a move that would hide student work and explains it as access, not only assignment', async () => {
    vi.spyOn(api, 'getCurriculum').mockResolvedValue({ data: { curriculum: { id: 1, name: 'Synthetic Web Lab', description: null, total_weeks: null, status: 'active', updated_at: '', modules_count: 2, modules: moveModules() } }, error: null } as never)
    // The learner is assigned "The DOM", but it opens later: the server counts them.
    const impact = { learners_losing_access: 1, learners_with_work_losing_access: 1, learners_gaining_access: 0, self_paced_learners: false }
    const move = vi.spyOn(api, 'moveLesson').mockResolvedValue({ data: { impact }, error: null } as never)
    await mount()
    await click(button('More lesson actions'))
    await click(Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((item) => item.textContent === 'Move to week or day'))
    await settle()
    const dialog = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"]')).at(-1)!
    const moduleSelect = dialog.querySelectorAll('select')[0] as HTMLSelectElement
    await act(async () => {
      moduleSelect.value = '8'
      moduleSelect.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await click(button('Move lesson', dialog))

    expect(move).toHaveBeenCalledTimes(1)
    expect(move.mock.calls[0][1]).toMatchObject({ module_id: 8, dry_run: true })
    const alert = dialog.querySelector('[role="alert"]')!.textContent
    expect(alert).toContain('1 student with work in this lesson couldn\'t open it in "The DOM" on that day')
    expect(alert).toContain("that day hasn't opened for them yet, or it falls after their pause")
    expect(alert).toContain('choose a module and day that are already open to them')
    expect(alert).not.toContain("isn't assigned \"The DOM\"")
    expect(alert).not.toContain('Give them that module first')
    expect(button('Move anyway', dialog)?.disabled).toBe(true)
  })
})

describe('local backups without editing access', () => {
  it('keeps unsaved changes when editing access is off, and offers them as text to copy', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    session.user = { id: 7, role: 'instructor', is_staff: true, is_admin: false }
    const key = 'csg:lesson-editor-draft:v1:7:2'
    const kept = {
      savedAt: Date.now(), baseUpdatedAt: '2026-11-16T00:00:00.000000Z',
      draft: { title: 'Make decisions', required: true, release_day: 0, removed_block_ids: [], alignments: [],
        blocks: [{ key: 'b1', id: 1, block_type: 'text', title: 'Why', body: 'Typed before access changed', solution: '', filename: '', video_url: '', s3_video_key: null, s3_video_content_type: null, s3_video_size: null, submission_type: null, submission_config: {}, rubric_id: null, video_segments: [], metadata: {}, check: null, check_locked: false }] },
    }
    window.localStorage.setItem(key, JSON.stringify(kept))
    access = { can_edit: false, reason: 'shared', message: null, grants: [leonGrant], shared_with: [{ id: 5, name: 'Cohort 4' }], copy_cohorts: [], copy_of: null }
    await mount()
    await settle()

    expect(window.localStorage.getItem(key)).toContain('Typed before access changed')
    expect(container.textContent).toContain("You can't save them without editing access")
    await click(button('Copy unsaved changes'))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('1. Text: Why\nTyped before access changed'))

    // Access comes back: the same backup is offered to restore.
    await act(async () => root.unmount())
    root = createRoot(container)
    access = { can_edit: true, reason: 'granted', message: null, grants: [leonGrant], shared_with: [], copy_cohorts: [], copy_of: null }
    await mount()
    expect(container.textContent).toContain('This browser kept changes you didn\'t save')
    expect(button('Restore changes')).toBeTruthy()
  })
})
