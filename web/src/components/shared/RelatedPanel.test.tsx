// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { relatedRows, type RecordRelated, type RelatedRowOptions } from '../../lib/recordRelated'
import { RelatedPanel } from './RelatedPanel'

const admin = { is_staff: true, is_admin: true }
const instructor = { is_staff: true, is_admin: false }
const context = { cohort: { id: 3, name: 'Cohort 3' }, student: { id: 9, name: 'Alex Rivera' }, lesson: { id: 40, title: 'Make decisions' }, module: { id: 7, name: 'Week 10' } }
const here = '/admin/submissions/812'
const options = (extra: Partial<RelatedRowOptions> = {}): RelatedRowOptions => ({ viewer: instructor, returnTo: here, ...extra })
const item = (key: string, fields: Record<string, unknown> = {}) => ({ key, count: null, value: null, ...fields })
const byKey = (related: RecordRelated, opts = options()) => Object.fromEntries(relatedRows(related, opts).map((row) => [row.key, row]))
const back = encodeURIComponent(here)

describe('related rows per record type', () => {
  it('submission: lesson, module grid, rubric, other attempts, help on the exercise, conversation', () => {
    const message = vi.fn()
    const scrollTo = vi.fn()
    const related: RecordRelated = { type: 'submission', id: 812, context, items: [
      item('lesson', { value: 'Make decisions', lesson_id: 40 }),
      item('module_grid', { value: 'Week 10', cohort_id: 3, module_id: 7 }),
      item('rubric', { count: 3, value: 'Ticket rubric' }),
      item('other_attempts', { count: 1 }),
      item('help', { count: 1, open_count: 1, help_request_id: 55, cohort_id: 3 }),
      item('conversation', { direct_conversation_id: null, cohort_id: 3, user_id: 9 }),
    ] }
    const rows = byKey(related, options({ actions: { message, scrollTo } }))
    // Lessons read only Activity as return_to (route registry), so none is added here.
    expect(rows.lesson).toMatchObject({ label: 'Lesson', value: 'Open', to: '/lessons/40?cohort_id=3' })
    expect(byKey(related, options({ viewer: admin })).lesson).toMatchObject({ value: 'Edit', to: '/admin/lessons/40/edit' })
    expect(rows.module_grid).toMatchObject({ label: 'Week 10 grading', to: '/admin/cohorts/3/modules/7/grading' })
    expect(rows.rubric).toMatchObject({ label: 'Rubric', value: '3 criteria' })
    rows.rubric.onSelect!()
    expect(scrollTo).toHaveBeenCalledWith('rubric')
    expect(rows.other_attempts).toMatchObject({ count: 1, to: `/admin/cohorts/3/students/9/work?return_to=${back}` })
    expect(rows.help).toMatchObject({ label: 'Help on this exercise', count: 1, attention: true, to: `/admin/help-requests/55?return_to=${back}` })
    expect(rows.conversation).toMatchObject({ label: 'Conversation with Alex', value: 'Start', to: null })
    rows.conversation.onSelect!()
    expect(message).toHaveBeenCalledOnce()
  })

  it('help request: lesson, intervention, conversation, other requests', () => {
    const rows = byKey({ type: 'help_request', id: 4, context, items: [
      item('lesson', { lesson_id: 40 }),
      item('follow_up', { count: 1, intervention_id: 61 }),
      item('conversation', { direct_conversation_id: 12, cohort_id: 3, last_message_at: new Date(Date.now() - 3 * 3_600_000).toISOString() }),
      item('other_requests', { count: 2, cohort_id: 3, user_id: 9 }),
    ] })
    expect(rows.follow_up).toMatchObject({ label: 'Follow-up plan', count: 1, to: `/admin/interventions/61?return_to=${back}` })
    expect(rows.conversation).toMatchObject({ value: '3 h', to: '/messages/dm/12?cohort_id=3' })
    expect(rows.other_requests).toMatchObject({ label: 'Other requests from Alex', count: 2, to: `/admin/cohorts/3/students/9/support?return_to=${back}` })
  })

  it('intervention: evidence, recovery plan, source help request, conversation', () => {
    const rows = byKey({ type: 'intervention', id: 5, context, items: [
      item('evidence', { count: 2 }),
      item('recovery_plan', { count: 1, value: 'Active' }),
      item('help_request', { count: 1, help_request_id: 4 }),
    ] }, options({ actions: { scrollTo: vi.fn() } }))
    expect(rows.evidence).toMatchObject({ label: 'Why this plan started', count: 2 })
    expect(rows.evidence.onSelect).toBeTypeOf('function')
    expect(rows.recovery_plan).toMatchObject({ value: 'Active' })
    expect(rows.help_request).toMatchObject({ label: 'Source help request', to: `/admin/help-requests/4?return_to=${back}` })
  })

  it('lesson (learner): your work, your help requests, class recordings', () => {
    const rows = byKey({ type: 'lesson', id: 40, view: 'learner', context, items: [
      item('your_work', { count: 1, value: 'redo_requested', content_block_id: 81, work_count: 1 }),
      item('help', { count: 1, open_count: 0 }),
      item('recordings', { count: 4, cohort_id: 3 }),
    ] }, options({ viewer: { is_staff: false }, learnerLesson: (id, anchor) => `/lessons/${id}?cohort_id=3#${anchor}`, actions: { scrollTo: vi.fn() } }))
    expect(rows.your_work).toMatchObject({ label: 'Your work', value: 'Redo requested', attention: true, to: '/lessons/40?cohort_id=3#block-81' })
    expect(rows.help).toMatchObject({ label: 'Your help requests', count: 1, attention: false })
    expect(rows.recordings).toMatchObject({ label: 'Class recordings', count: 4, to: '/recordings?cohort_id=3' })
  })

  it('lesson (staff), student workspace and cohort rows open focused, cohort-scoped lists', () => {
    const lesson = byKey({ type: 'lesson', id: 40, view: 'staff', context: { cohort: context.cohort }, items: [item('waiting_review', { count: 2, cohort_id: 3 }), item('open_help', { count: 0, cohort_id: 3 }), item('recordings', { count: 1, cohort_id: 3 })] })
    expect(lesson.waiting_review).toMatchObject({ count: 2, to: '/admin/grading?cohort_id=3' })
    expect(lesson.open_help).toMatchObject({ count: 0, attention: false, to: '/admin/support?cohort_id=3' })
    expect(lesson.recordings.to).toBe('/admin/cohorts/3?tab=recordings')

    const student = byKey({ type: 'student', id: 9, context, items: [item('cohort', { value: 'Cohort 3', cohort_id: 3 }), item('help_requests', { count: 2, open_count: 1, cohort_id: 3 }), item('follow_ups', { count: 0, cohort_id: 3, user_id: 9 }), item('meetings', { count: 1, cohort_id: 3 }), item('other_enrollments', { count: 1, cohort_id: 4, user_id: 9 })] })
    expect(student.cohort).toMatchObject({ label: 'Cohort 3', to: '/admin/cohorts/3' })
    expect(student.help_requests).toMatchObject({ count: 2, value: '1 open', to: `/admin/cohorts/3/students/9/support?return_to=${back}` })
    expect(student.meetings.to).toBe('/admin/meetings?cohort_id=3')
    expect(student.other_enrollments.to).toBe('/admin/cohorts/4/students/9/overview')

    const cohort = byKey({ type: 'cohort', id: 3, context: { cohort: context.cohort }, items: [item('students', { count: 12, cohort_id: 3 }), item('follow_ups', { count: 2, cohort_id: 3 }), item('updates', { count: 5, cohort_id: 3 }), item('recordings', { count: 1, cohort_id: 3 })] })
    expect(cohort.students.to).toBe('/admin/cohorts/3?tab=students')
    expect(cohort.follow_ups.to).toBe('/admin/support?cohort_id=3')
    expect(cohort.updates.to).toBe('/announcements?scope=manage&audience=cohort&cohort_id=3')
    expect(cohort.recordings.to).toBe('/admin/cohorts/3?tab=recordings')
  })

  it('a switched-off feature has no row: the server leaves it out and nothing fills the gap', () => {
    const rows = relatedRows({ type: 'submission', id: 812, context, items: [item('lesson', { lesson_id: 40 }), item('other_attempts', { count: 0 }), item('conversation', {})] }, options())
    expect(rows.map((row) => row.key)).toEqual(['lesson', 'other_attempts', 'conversation'])
    expect(rows.some((row) => row.label.includes('Help'))).toBe(false)
  })

  it('learners never get staff links', () => {
    const rows = byKey({ type: 'lesson', id: 40, view: 'learner', context, items: [item('waiting_review', { count: 1, cohort_id: 3 }), item('help_requests', { count: 1, cohort_id: 3, user_id: 9 })] }, options({ viewer: 'student' }))
    expect(rows.waiting_review.to).toBeNull()
    expect(rows.help_requests.to).toBeNull()
  })
})

describe('RelatedPanel', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function Where() {
    const location = useLocation()
    return <output data-testid="where">{`${location.pathname}${location.search}`}|{JSON.stringify(location.state)}</output>
  }
  function render(panel: React.ReactNode) {
    act(() => root.render(<MemoryRouter initialEntries={[here]}><Routes><Route path="*" element={<>{panel}<Where /></>} /></Routes></MemoryRouter>))
  }
  const related: RecordRelated = { type: 'submission', id: 812, context, items: [item('other_attempts', { count: 0 }), item('help', { count: 2, open_count: 1, cohort_id: 3 }), item('conversation', {}), item('rubric', { count: 2 })] }

  it('shows each row with its count, quiet at zero, and links that keep this record as the way back', () => {
    const message = vi.fn()
    render(<RelatedPanel rows={relatedRows(related, options({ actions: { message } }))} returnLabel="Submission #812" />)
    const panel = container.querySelector('aside')!
    expect(panel.getAttribute('aria-labelledby')).toBe(panel.querySelector('h2')!.id)
    expect(panel.querySelector('h2')?.textContent).toBe('Related')
    const row = (key: string) => panel.querySelector(`[data-related-row="${key}"]`)!
    expect(row('other_attempts').querySelector('a')).toBeNull()
    expect(row('other_attempts').querySelector('[data-related-count]')?.textContent).toBe('0')
    expect(row('other_attempts').querySelector('[data-related-count]')?.className).toContain('border-transparent')
    expect(row('help').querySelector('[data-related-count]')?.className).toContain('warning')
    expect(row('rubric').querySelector('a, button')).toBeNull()
    const link = row('help').querySelector('a')!
    expect(link.getAttribute('href')).toBe(`/admin/cohorts/3/students/9/support?return_to=${back}`)
    expect(link.className).toContain('min-h-11')
    act(() => link.click())
    expect(container.querySelector('[data-testid="where"]')?.textContent).toBe(`/admin/cohorts/3/students/9/support?return_to=${back}|${JSON.stringify({ returnTo: here, returnLabel: 'Submission #812' })}`)
  })

  it('renders on-page rows as buttons', () => {
    const message = vi.fn()
    render(<RelatedPanel rows={relatedRows(related, options({ actions: { message } }))} />)
    act(() => container.querySelector<HTMLButtonElement>('[data-related-row="conversation"] button')!.click())
    expect(message).toHaveBeenCalledOnce()
  })

  it('shows loading rows, then a retry on failure', () => {
    render(<RelatedPanel rows={[]} loading />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    const retry = vi.fn()
    render(<RelatedPanel rows={[]} error="Related items are unavailable." onRetry={retry} />)
    expect(container.textContent).toContain('Related items are unavailable.')
    act(() => container.querySelector<HTMLButtonElement>('button')!.click())
    expect(retry).toHaveBeenCalledOnce()
  })
})
