import { describe, expect, it } from 'vitest'
import { queueContextLabel, waitingLabel, waitingSentence, waitingTooLong } from './gradingQueue'
import { gradingFiltersFromSearch, gradingQueueSource } from './recordQueue'

// The queue itself (order, statuses, filters, counts, options and module grids) is built on the
// server now: api/test/integration/grading_queue_test.rb.

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
