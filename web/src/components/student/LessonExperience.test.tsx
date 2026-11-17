// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { LessonExperience } from './LessonExperience'
import type { LessonDetail } from '../../types/api'
const update = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { progress: { status: 'completed' } } }))
vi.mock('../../lib/api', () => ({ api: { updateProgress: update } }))
vi.mock('./PersonActions', () => ({ PersonActions: () => <button>Message Tia</button> }))
vi.mock('./ContextualHelp', () => ({ ContextualHelp: () => <button>Ask for help</button> }))
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
async function render(value = lesson, initial = '/lessons/2?cohort_id=1', readOnly = false) {
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
it('ignores a completion response after navigating away, including failures', async () => {
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

it.each(['course_question', 'none', 'expired', 'help off'])('does not duplicate or contradict the single support entry for %s', async mode => {
  const page = await render({ ...lesson, instructor: { id: 9, full_name: 'Tia', role: 'instructor', avatar_url: null }, capabilities: { live_support: true, can_submit: true, read_only: false, support_expires_at: null, access_expires_at: null, support_instructor_id: 9, support_mode: mode === 'help off' ? 'guided_help' : mode === 'course_question' ? 'course_question' : 'none', features: { help_requests: mode !== 'help off' } } } as LessonDetail)
  try { expect(page.host.textContent).not.toContain('Message Tia') } finally { await page.close() }
})
