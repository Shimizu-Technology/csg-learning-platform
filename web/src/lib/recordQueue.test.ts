// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  filterSupportRequests,
  moduleQueueSource,
  queuePositionLabel,
  queueStep,
  readRoster,
  rememberRoster,
  clearRosters,
  authorizedRoster,
  retargetReturnPath,
  supportQueueSource,
} from './recordQueue'
import { moduleReviewQueue } from './submissionQueue'

describe('queueStep', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }]
  it('finds neighbours, with none past either end', () => {
    expect(queueStep(items, (item) => item.id === 2)).toEqual({ index: 1, total: 3, previous: { id: 1 }, next: { id: 3 } })
    expect(queueStep(items, (item) => item.id === 1).previous).toBeNull()
    expect(queueStep(items, (item) => item.id === 3).next).toBeNull()
  })
  it('offers the first item when the current one left the queue', () => {
    const step = queueStep(items, (item) => item.id === 9)
    expect(step).toEqual({ index: -1, total: 3, previous: null, next: { id: 1 } })
    expect(queuePositionLabel(step)).toBe('Not in queue · 3 left')
    expect(queuePositionLabel(queueStep([], () => true))).toBe('Queue is empty')
    expect(queuePositionLabel({ index: 2, total: 9 })).toBe('3 of 9')
  })
})

describe('moduleQueueSource', () => {
  it('reads the module page filters from its URL', () => {
    expect(moduleQueueSource('/admin/cohorts/4/modules/2/grading?view=queue&filter=redo&review=42#grading-cell-4-8')).toEqual({ cohortId: 4, moduleId: 2, view: 'queue', filter: 'redo', studentId: null })
    expect(moduleQueueSource('/admin/cohorts/4/modules/2/grading?view=students&student=9')).toMatchObject({ view: 'students', studentId: 9, filter: 'ungraded' })
  })
  it('ignores other pages, unsafe paths and junk values', () => {
    expect(moduleQueueSource('/admin/grading?filter=redo')).toBeNull()
    expect(moduleQueueSource('//evil.example/admin/cohorts/4/modules/2/grading')).toBeNull()
    expect(moduleQueueSource('/admin/cohorts/0/modules/2/grading')).toBeNull()
    expect(moduleQueueSource('/admin/cohorts/4/modules/2/grading?view=hack&filter=drop&student=-1')).toEqual({ cohortId: 4, moduleId: 2, view: 'grid', filter: 'ungraded', studentId: null })
    expect(moduleQueueSource(null)).toBeNull()
  })
})

describe('support queue', () => {
  it('reads the Support filters and walks the same list', () => {
    const source = supportQueueSource('/admin/support?cohort_id=3&urgency=urgent')
    expect(source).toEqual({ cohortId: 3, view: 'active', urgentOnly: true })
    const queue = { help_requests: [{ id: 1, urgency: 'urgent' }, { id: 2, urgency: 'normal' }], recently_resolved: [{ id: 3, urgency: 'normal' }] }
    expect(filterSupportRequests(queue, source!).map((item) => item.id)).toEqual([1])
    expect(filterSupportRequests(queue, { view: 'resolved', urgentOnly: false }).map((item) => item.id)).toEqual([3])
    expect(supportQueueSource('/admin/support?cohort_id=abc&view=weird')).toEqual({ cohortId: null, view: 'active', urgentOnly: false })
    expect(supportQueueSource('/admin/grading')).toBeNull()
  })
})

describe('retargetReturnPath', () => {
  it('moves the list selection to the item now open', () => {
    expect(retargetReturnPath('/admin/grading?filter=redo&submission=42', { id: 41 })).toBe('/admin/grading?filter=redo&submission=41')
    expect(retargetReturnPath('/admin/cohorts/4/modules/2/grading?view=grid&review=42#grading-cell-4-8', { id: 41, user_id: 4, content_block_id: 9 })).toBe('/admin/cohorts/4/modules/2/grading?view=grid&review=41#grading-cell-4-9')
    expect(retargetReturnPath('/admin/grading?filter=redo', { id: 41 })).toBe('/admin/grading?filter=redo')
    expect(retargetReturnPath('/admin/support', { id: 41 })).toBe('/admin/support')
  })
})

describe('roster memory', () => {
  beforeEach(() => window.sessionStorage.clear())
  it('returns the roster only for the same viewer, list page and filters', () => {
    rememberRoster(1, '/admin/students?filter=at-risk', [{ cohortId: 3, userId: 9 }, { cohortId: 3, userId: 9 }, { cohortId: 3, userId: 11 }, { cohortId: -1, userId: 2 }])
    expect(readRoster(1, '/admin/students?filter=at-risk')).toEqual([{ cohortId: 3, userId: 9 }, { cohortId: 3, userId: 11 }])
    // A different filter on the same list is a different queue.
    expect(readRoster(1, '/admin/students?filter=quiet')).toBeNull()
    expect(readRoster(1, null)).toBeNull()
    // Another account in this tab never sees it, and with no viewer nothing is read or kept.
    expect(readRoster(2, '/admin/students?filter=at-risk')).toBeNull()
    expect(readRoster(null, '/admin/students?filter=at-risk')).toBeNull()
    rememberRoster(undefined, '/admin/students', [{ cohortId: 3, userId: 9 }])
    expect(Object.keys(window.sessionStorage).filter((key) => !key.startsWith('csg:roster:1:'))).toEqual([])
  })
  it('never stores search text, only the filter keys', () => {
    rememberRoster(1, '/admin/students?filter=quiet&q=Synthetic%20Person%20synthetic%40example.com&cohort_id=3', [{ cohortId: 3, userId: 9 }])
    const stored = Object.entries(window.sessionStorage).map(([key, value]) => `${key} ${value}`).join('\n')
    expect(stored).not.toMatch(/synthetic|example\.com|q=/i)
    expect(stored).toContain('cohort_id=3&filter=quiet')
    // The same filters with other search text match the slot the list keeps re-saving as it renders.
    expect(readRoster(1, '/admin/students?cohort_id=3&filter=quiet&q=other')).toEqual([{ cohortId: 3, userId: 9 }])
  })
  it('forgets every roster on sign-out or account switch', () => {
    rememberRoster(1, '/admin/students', [{ cohortId: 3, userId: 9 }])
    rememberRoster(1, '/admin/cohorts/3/students', [{ cohortId: 3, userId: 9 }])
    window.sessionStorage.setItem('csg-other', 'kept')
    clearRosters()
    expect(readRoster(1, '/admin/students')).toBeNull()
    expect(Object.keys(window.sessionStorage)).toEqual(['csg-other'])
  })
  it('drops malformed storage without throwing', () => {
    window.sessionStorage.setItem('csg:roster:1:/admin/students', '{not json')
    expect(readRoster(1, '/admin/students')).toBeNull()
    window.sessionStorage.setItem('csg:roster:1:/admin/students', JSON.stringify({ filters: '', ids: ['3:9', 'x', 4, '0:1', '3:12'] }))
    expect(readRoster(1, '/admin/students')).toEqual([{ cohortId: 3, userId: 9 }, { cohortId: 3, userId: 12 }])
  })
  it('keeps only entries the viewer can open now, and nothing when a cohort could not be checked', () => {
    const roster = [{ cohortId: 3, userId: 9 }, { cohortId: 3, userId: 10 }, { cohortId: 4, userId: 11 }]
    expect(authorizedRoster(roster, new Map([[3, [9]], [4, [11]]]))).toEqual([{ cohortId: 3, userId: 9 }, { cohortId: 4, userId: 11 }])
    expect(authorizedRoster(roster, new Map([[3, [9, 10]]]))).toBeNull()
  })
})

describe('moduleReviewQueue', () => {
  const base = { cohort_id: 4, enrollment_id: 1, created_at: '2026-10-20T00:00:00Z' }
  const subs = [
    { ...base, id: 1, latest_submission_id: 1, user_id: 4, content_block_id: 8, grade: null, created_at: '2026-10-22T00:00:00Z' },
    { ...base, id: 2, enrollment_id: 2, latest_submission_id: 2, user_id: 5, content_block_id: 8, grade: 'R' },
    { ...base, id: 3, latest_submission_id: 4, user_id: 4, content_block_id: 9, grade: null },
    { ...base, id: 4, latest_submission_id: 4, user_id: 4, content_block_id: 9, grade: 'A', created_at: '2026-10-23T00:00:00Z' },
  ]
  it('matches the module page views', () => {
    expect(moduleReviewQueue(subs, { view: 'grid', filter: 'ungraded' }).map((item) => item.id)).toEqual([1, 2, 4])
    expect(moduleReviewQueue(subs, { view: 'queue', filter: 'ungraded' }).map((item) => item.id)).toEqual([1])
    expect(moduleReviewQueue(subs, { view: 'queue', filter: 'redo' }).map((item) => item.id)).toEqual([2])
    expect(moduleReviewQueue(subs, { view: 'students', filter: 'ungraded', studentId: 4 }).map((item) => item.id)).toEqual([4, 1, 3])
  })
})
