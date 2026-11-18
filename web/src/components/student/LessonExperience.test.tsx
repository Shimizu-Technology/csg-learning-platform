// @vitest-environment jsdom
import { act, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { LessonExperience } from './LessonExperience'
import type { LessonDetail } from '../../types/api'
const update = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { progress: { status: 'completed' } } }))
vi.mock('../../lib/api', () => ({ api: { updateProgress: update } }))
vi.mock('./PersonActions', () => ({ PersonActions: () => <button>Message Tia</button> }))
vi.mock('./ContextualHelp', () => ({ ContextualHelp: ({ contexts }: { contexts?: unknown }) => <button data-contexts={JSON.stringify(contexts)}>Ask for help</button> }))
vi.mock('../shared/LearningObjectivesPanel', () => ({ LearningObjectivesPanel: () => null }))
const lesson = {
  id: 2,
  title: 'Loops',
  cohort_id: 1,
  module_id: 10,
  content_blocks: [],
  learning_navigation: {
    number: 3,
    total: 26,
    next: { id: 9, title: 'Functions', module_id: 20 },
    previous: { id: 1, title: 'Reading', module_id: 10 },
    next_module: true,
    course_complete: false,
    counts: { completed_lessons: 3, total_lessons: 26 },
    manual_block_ids: [4],
  },
  outline: {
    mode: 'program',
    modules: [
      {
        id: 10,
        name: 'Foundations',
        number: 1,
        groups: [
          { key: 'm10-1', label: 'Week 1', lessons: [{ id: 2, title: 'Loops', status: 'open', available: true }] },
        ],
      },
    ],
  },
} as unknown as LessonDetail
async function render(value = lesson, initial: string | { pathname: string; search?: string; state?: unknown } = '/lessons/2?cohort_id=1', readOnly = false) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const reload = vi.fn()
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[initial]}>
        <LessonExperience
          lesson={value}
          readOnly={readOnly}
          savedData={false}
          error={null}
          reload={reload}
          helpRequests={[]}
          helpRequestsLoading={false}
          setHelpRequests={() => {}}
          refreshHelp={async () => {}}
        >
          <p>Lesson content</p>
        </LessonExperience>
      </MemoryRouter>
    )
  )
  return {
    host,
    reload,
    close: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}
it('shows outline position, one help, one completion and a next-module link from the server', async () => {
  const page = await render()
  try {
    expect(page.host.textContent).toContain('Week 1 · Lesson 3 of 26')
    expect(
      [...page.host.querySelectorAll('button')].filter((node) => node.textContent === 'Ask for help')
    ).toHaveLength(1)
    const button = [...page.host.querySelectorAll('button')].find((node) => node.textContent === 'Mark complete')!
    expect(button.className).not.toContain('bg-action-primary')
    await act(async () => button.click())
    expect(update).toHaveBeenCalledWith(4, 'completed', 1)
    expect(page.reload).toHaveBeenCalledOnce()
    const next = [...page.host.querySelectorAll('a')].find((node) => node.textContent?.includes('Start next module'))!
    expect(next.getAttribute('href')).toBe('/lessons/9?cohort_id=1')
    expect(next.className).toContain('bg-action-primary')
    await act(async () =>
      [...page.host.querySelectorAll('button')].find((node) => node.textContent === 'Outline')!.click()
    )
    expect(page.host.querySelector('[role="dialog"] [aria-current="page"]')?.textContent).toBe('Loops')
  } finally {
    await page.close()
  }
})
it('renders a refreshable real completion screen only when LearnerProgress confirms it', async () => {
  const value = {
    ...lesson,
    learning_navigation: { ...lesson.learning_navigation!, course_complete: true, next: null, manual_block_ids: [] },
  }
  const page = await render(value, '/lessons/2?cohort_id=1&complete=1')
  try {
    expect(page.host.querySelector('[data-testid="course-complete"]')).not.toBeNull()
    expect(page.host.textContent).not.toMatch(/certificate/i)
    expect(page.host.textContent).not.toContain('Lesson content')
    expect(page.host.querySelector('a[href="/materials?cohort_id=1"]')).not.toBeNull()
  } finally {
    await page.close()
  }
  const falseComplete = await render(lesson, '/lessons/2?cohort_id=1&complete=1')
  try {
    expect(falseComplete.host.querySelector('[data-testid="course-complete"]')).toBeNull()
  } finally {
    await falseComplete.close()
  }
})
it('does not offer completion to read-only learners', async () => {
  const page = await render(lesson, undefined, true)
  try {
    expect(page.host.textContent).not.toContain('Mark complete')
  } finally {
    await page.close()
  }
})

it('labels a redo separately from a forward module transition', async () => {
  const page = await render({ ...lesson, learning_navigation: { ...lesson.learning_navigation!, next_module: false, next_redo: true, next: { id: 1, module_id: 1, title: 'First' } } })
  try {
    expect(page.host.textContent).toContain('Redo: First')
    expect(page.host.textContent).not.toContain('Start next module')
  } finally { await page.close() }
})
it('keeps reading completion after submissions close', async () => {
  const page = await render({ ...lesson, submission_window: { submissions_closed: true } } as LessonDetail)
  try {
    const complete = [...page.host.querySelectorAll('button')].find(node => node.textContent === 'Mark complete')!
    expect(complete).toBeTruthy()
    await act(async () => complete.click())
    expect(page.reload).toHaveBeenCalledOnce()
  } finally { await page.close() }
})
it('ignores a completion response after unmount, including failures', async () => {
  for (const failure of [false, true]) {
    let resolve!: (value: unknown) => void
    update.mockImplementationOnce(() => new Promise(done => { resolve = done }))
    const page = await render()
    await act(async () => [...page.host.querySelectorAll('button')].find(node => node.textContent === 'Mark complete')!.click())
    await page.close()
    await act(async () => resolve(failure ? { error: 'Offline' } : { data: { progress: {} } }))
    expect(page.reload).not.toHaveBeenCalled()
  }
})

it.each(['success', 'failure'] as const)('keeps lesson B after a real route change when lesson A completion returns %s', async outcome => {
  let resolve!: (value: unknown) => void
  update.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const lessonB: LessonDetail = {
    ...lesson,
    id: 1,
    title: 'Reading',
    learning_navigation: { ...lesson.learning_navigation!, previous: null, manual_block_ids: [] },
  }
  const reloadA = vi.fn()
  const reloadB = vi.fn()
  const unmount = vi.fn()
  function RoutedLesson() {
    const { id } = useParams()
    const location = useLocation()
    const destination = id === String(lesson.id) ? lesson : lessonB
    const [loadedLesson, setLoadedLesson] = useState(destination)
    useEffect(() => { setLoadedLesson(destination) }, [destination])
    useEffect(() => () => { unmount() }, [])
    // Like the page loader, a stale reload can overwrite the displayed data
    // without changing the new URL. Keep this component mounted across routes.
    function reload() {
      if (destination.id === lesson.id) reloadA()
      else reloadB()
      setLoadedLesson(destination)
    }
    return <>
      <output data-location>{location.pathname}{location.search}</output>
      <LessonExperience lesson={loadedLesson} readOnly={false} savedData={false} error={null} reload={reload} helpRequests={[]} helpRequestsLoading={false} setHelpRequests={() => {}} refreshHelp={async () => {}}>
        <p>{loadedLesson.title} content</p>
      </LessonExperience>
    </>
  }
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={['/lessons/2?cohort_id=1']}><Routes><Route path="/lessons/:id" element={<RoutedLesson />} /></Routes></MemoryRouter>))
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Mark complete')!.click())
    expect(update).toHaveBeenLastCalledWith(4, 'completed', 1)
    expect(host.textContent).toContain('Saving…')
    await act(async () => (host.querySelector('a[href="/lessons/1?cohort_id=1"]') as HTMLAnchorElement).click())
    expect(host.querySelector('[data-location]')?.textContent).toBe('/lessons/1?cohort_id=1')
    expect(host.querySelector('h1')?.textContent).toBe('Reading')
    expect(unmount).not.toHaveBeenCalled()
    await act(async () => resolve(outcome === 'success' ? { data: { progress: { status: 'completed' } } } : { error: 'Lesson A completion failed' }))
    expect(host.querySelector('[data-location]')?.textContent).toBe('/lessons/1?cohort_id=1')
    expect(host.querySelector('h1')?.textContent).toBe('Reading')
    expect(host.textContent).toContain('Reading content')
    expect(host.textContent).not.toContain('Loops content')
    expect(host.querySelector('[role="alert"]')).toBeNull()
    expect(host.textContent).not.toContain('Lesson A completion failed')
    expect(reloadA).not.toHaveBeenCalled()
    expect(reloadB).not.toHaveBeenCalled()
    expect(unmount).not.toHaveBeenCalled()
  } finally { await act(async () => root.unmount()); host.remove() }
})

it.each(['course_question', 'none', 'expired', 'help off'])('does not duplicate or contradict the single support entry for %s', async mode => {
  const page = await render({ ...lesson, instructor: { id: 9, full_name: 'Tia', role: 'instructor', avatar_url: null }, capabilities: { live_support: true, can_submit: true, read_only: false, support_expires_at: null, access_expires_at: null, support_instructor_id: 9, support_mode: mode === 'help off' ? 'guided_help' : mode === 'course_question' ? 'course_question' : 'none', features: { help_requests: mode !== 'help off' } } } as LessonDetail)
  try { expect(page.host.textContent).not.toContain('Message Tia') } finally { await page.close() }
})

it('offers distinct lesson and exercise contexts, including code challenges', async () => {
  const value = { ...lesson, content_blocks: [{ id: 7, block_type: 'code_challenge', title: 'Loops', position: 0 }, { id: 8, block_type: 'exercise', title: 'Loop more', position: 1 }] } as LessonDetail
  const page = await render(value)
  try {
    const contexts = JSON.parse(page.host.querySelector('[data-contexts]')!.getAttribute('data-contexts')!)
    expect(contexts).toEqual([{ type: 'lesson', id: 2, label: 'Lesson: Loops' }, { type: 'exercise', id: 7, label: 'Exercise 1: Loops' }, { type: 'exercise', id: 8, label: 'Exercise 2: Loop more' }])
  } finally { await page.close() }
})

it.each([
  [{ pathname: '/lessons/2', state: { returnTo: '/dashboard?cohort_id=1', returnLabel: 'Today' } }, 'Back to Today', '/dashboard?cohort_id=1'],
  [{ pathname: '/lessons/2', state: { from: '/announcements?tab=inbox&inbox_page=3' } }, 'Back to Notifications', '/announcements?tab=inbox&inbox_page=3'],
  ['/lessons/2?cohort_id=1&return_to=%2Fannouncements%3Ftab%3Dinbox', 'Back to Notifications', '/announcements?tab=inbox'],
] as const)('new lesson header honors its origin: %j', async (entry, label, destination) => {
  const page = await render(lesson, entry)
  try {
    const back = [...page.host.querySelectorAll('a')].find(link => link.textContent?.trim() === label)
    expect(back?.getAttribute('href')).toBe(destination)
    expect(page.host.textContent).not.toContain('Back to Learn')
  } finally { await page.close() }
})

it('keeps Off-cohort lesson deadline UI unchanged and formats opted-in deadlines in Guam without seconds', async () => {
  const window = { week_number: 1, submissions_close_at: '2030-01-15T00:00:00Z', submissions_closed: false, status: 'scheduled' as const }
  const off = await render({ ...lesson, submission_window: window })
  expect(off.host.textContent).not.toContain('Submission deadline:')
  await off.close()
  const personal = await render({ ...lesson, submission_window: window, show_personal_deadline: true })
  expect(personal.host.textContent).toContain('Jan 15, 2030, 10:00 AM ChST')
  expect(personal.host.textContent).not.toContain('10:00:00')
  await personal.close()
})
