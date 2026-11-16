import { describe, expect, it } from 'vitest'
import {
  gradingFilterOptions,
  gradingQueue,
  gradingStatusCounts,
  moduleGridLinks,
  queueContextLabel,
  sortGradingQueue,
  waitingLabel,
  waitingSentence,
  waitingTooLong,
  type GradingQueueItem,
} from './gradingQueue'
import { gradingFiltersFromSearch, gradingQueueSource } from './recordQueue'

const item = (id: number, overrides: Partial<GradingQueueItem> = {}): GradingQueueItem => ({
  id,
  enrollment_id: 1,
  cohort_id: 3,
  cohort_name: 'Cohort 3',
  latest_submission_id: id,
  user_id: 10,
  user_name: 'Alex Rivera',
  content_block_id: id,
  grade: null,
  created_at: `2026-11-${String(id).padStart(2, '0')}T08:00:00Z`,
  lesson_id: 100 + id,
  lesson_title: `Lesson ${id}`,
  module_id: 7,
  module_name: 'JavaScript',
  module_position: 2,
  ...overrides,
})

describe('gradingQueue', () => {
  it('lists the oldest first by default and the newest first on request, ids breaking ties', () => {
    const items = [item(3), item(1), item(2), item(4, { created_at: item(1).created_at })]
    expect(gradingQueue(items, { filter: 'ungraded' }).map((row) => row.id)).toEqual([1, 4, 2, 3])
    expect(gradingQueue(items, { filter: 'ungraded', sort: 'newest' }).map((row) => row.id)).toEqual([3, 2, 4, 1])
  })

  it('uses the latest-attempt definition for Waiting and Redo, and every attempt for All', () => {
    const items = [
      item(1, { content_block_id: 50, latest_submission_id: 2 }),
      item(2, { content_block_id: 50, latest_submission_id: 2 }),
      item(3, { grade: 'R' }),
      item(4, { grade: 'B' }),
    ]
    expect(gradingQueue(items, { filter: 'ungraded' }).map((row) => row.id)).toEqual([2])
    expect(gradingQueue(items, { filter: 'redo' }).map((row) => row.id)).toEqual([3])
    expect(gradingQueue(items, { filter: 'all' }).map((row) => row.id)).toEqual([1, 2, 3, 4])
  })

  it('narrows by module, student and lesson', () => {
    const items = [item(1), item(2, { module_id: 8, module_name: 'Python' }), item(3, { user_id: 11, user_name: 'Blair Cruz' })]
    expect(gradingQueue(items, { filter: 'ungraded', moduleId: 8 }).map((row) => row.id)).toEqual([2])
    expect(gradingQueue(items, { filter: 'ungraded', studentId: 11 }).map((row) => row.id)).toEqual([3])
    expect(gradingQueue(items, { filter: 'ungraded', lessonId: 101 }).map((row) => row.id)).toEqual([1])
    expect(gradingStatusCounts(items, { moduleId: 7 })).toEqual({ ungraded: 2, redo: 0, all: 2 })
  })

  it('offers only modules and students with work, with counts, keeping a chosen one at zero', () => {
    const items = [item(1), item(2), item(3, { module_id: 8, module_name: 'Python', module_position: 1, grade: 'A' })]
    const options = gradingFilterOptions(items, { filter: 'ungraded' })
    expect(options.modules).toEqual([{ id: 7, label: 'JavaScript', count: 2 }])
    expect(options.students).toEqual([{ id: 10, label: 'Alex Rivera', count: 2 }])
    const chosen = gradingFilterOptions(items, { filter: 'ungraded', moduleId: 8 })
    expect(chosen.modules).toEqual([{ id: 8, label: 'Python', count: 0 }, { id: 7, label: 'JavaScript', count: 2 }])
    // Choosing a module narrows the students to that module's work.
    expect(chosen.students).toEqual([])
  })

  it('sorts oldest first without changing the input', () => {
    const items = [item(2), item(1)]
    expect(sortGradingQueue(items).map((row) => row.id)).toEqual([1, 2])
    expect(items.map((row) => row.id)).toEqual([2, 1])
  })
})

describe('moduleGridLinks', () => {
  it('gives each cohort module with work a waiting count and leaves empty modules out', () => {
    const links = moduleGridLinks([
      item(1),
      item(2, { grade: 'A' }),
      item(3, { module_id: 9, module_name: 'Basics', module_position: 1, grade: 'A' }),
      item(4, { cohort_id: 5, cohort_name: 'Python Fundamentals', module_id: 12, module_name: 'Lists' }),
    ])
    expect(links).toEqual([
      { cohortId: 3, cohortName: 'Cohort 3', moduleId: 9, moduleName: 'Basics', waiting: 0 },
      { cohortId: 3, cohortName: 'Cohort 3', moduleId: 7, moduleName: 'JavaScript', waiting: 1 },
      { cohortId: 5, cohortName: 'Python Fundamentals', moduleId: 12, moduleName: 'Lists', waiting: 1 },
    ])
  })
})

describe('waiting labels', () => {
  const now = Date.parse('2026-11-16T12:00:00Z')
  it('reads as a short count in rows and a sentence in the header', () => {
    expect(waitingLabel('2026-11-16T11:58:00Z', now)).toBe('now')
    expect(waitingLabel('2026-11-16T11:30:00Z', now)).toBe('30 min')
    expect(waitingLabel('2026-11-16T07:00:00Z', now)).toBe('5 h')
    expect(waitingLabel('2026-11-14T12:00:00Z', now)).toBe('2 d')
    expect(waitingLabel('2026-10-01T12:00:00Z', now)).toBe('6 wk')
    expect(waitingSentence('2026-11-14T12:00:00Z', now)).toBe('Waiting 2 days')
    expect(waitingSentence('2026-11-16T11:00:00Z', now)).toBe('Waiting 1 hour')
    expect(waitingTooLong('2026-11-09T12:00:00Z', now)).toBe(true)
    expect(waitingTooLong('2026-11-10T12:00:00Z', now)).toBe(false)
  })

  it('names the cohort and week, or self-paced', () => {
    expect(queueContextLabel({ cohort_name: 'Cohort 3', week_number: 10, course_delivery: 'program' })).toBe('Cohort 3 · Week 10')
    expect(queueContextLabel({ cohort_name: 'Python Fundamentals', week_number: null, course_delivery: 'self_paced' })).toBe('Python Fundamentals · self-paced')
    expect(queueContextLabel({ cohort_name: null })).toBe('')
  })
})

describe('gradingQueueSource', () => {
  it('reads the workbench filters from its URL and ignores anything else', () => {
    expect(gradingQueueSource('/admin/grading?cohort_id=3&filter=redo&module_id=7&student_id=10&lesson_id=101&sort=newest&submission=4')).toEqual({
      cohortId: 3, filter: 'redo', moduleId: 7, studentId: 10, lessonId: 101, sort: 'newest',
    })
    expect(gradingFiltersFromSearch('?filter=bogus&module_id=-1&sort=sideways')).toEqual({
      cohortId: null, filter: 'ungraded', moduleId: null, studentId: null, lessonId: null, sort: 'oldest',
    })
    expect(gradingQueueSource('/admin/cohorts/3/modules/7/grading')).toBeNull()
    expect(gradingQueueSource('//evil.example/admin/grading')).toBeNull()
  })
})
