import { activityReturnPath } from './routes'
import { describe, expect, it } from 'vitest'
import { cohortStudentPath, directMessagePath, helpRequestPath, interventionPath, safeInternalReturnPath, submissionPath } from './routes'

describe('connected record routes', () => {
  it('keeps student identity scoped to a cohort enrollment', () => {
    expect(cohortStudentPath(7, 12, 'work')).toBe('/admin/cohorts/7/students/12/work')
  })

  it('preserves relationship context on submission records', () => {
    expect(submissionPath(44, { cohortId: 7, userId: 12, returnTo: '/admin/grading' }))
      .toBe('/admin/submissions/44?cohort_id=7&student_id=12&return_to=%2Fadmin%2Fgrading')
    expect(submissionPath(44, { returnTo: '/admin/grading?filter=redo', queue: 'redo' }))
      .toBe('/admin/submissions/44?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo&queue=redo')
    // The queue keeps its cohort scope so Previous/Next walk the list the inbox showed.
    expect(submissionPath(44, { queue: 'ungraded', queueCohortId: 7 })).toBe('/admin/submissions/44?queue=ungraded&queue_cohort_id=7')
    expect(submissionPath(44, { queueCohortId: 7 })).toBe('/admin/submissions/44')
    expect(helpRequestPath(9, '/admin/support?view=active')).toBe('/admin/help-requests/9?return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
    expect(interventionPath(61, '/admin/support?view=active')).toBe('/admin/interventions/61?return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
    expect(directMessagePath(6, { type: 'help_request', id: 9, label: 'Nested routes' }))
      .toBe('/messages/dm/6?source_type=help_request&source_id=9&source_label=Nested+routes')
  })

  it('does not accept an external return path', () => {
    expect(safeInternalReturnPath('//example.com', '/admin/grading')).toBe('/admin/grading')
    for (const unsafe of ['/\t/evil.example', '/\n/evil.example', '/\r//evil.example', '/\\evil.example', '\t//evil.example', 'https://evil.example']) {
      expect(safeInternalReturnPath(unsafe, '/admin/grading')).toBe('/admin/grading')
    }
    expect(safeInternalReturnPath('/admin/grading?filter=all&q=Maria%20Santos#row-4', '/x')).toBe('/admin/grading?filter=all&q=Maria%20Santos#row-4')
    expect(safeInternalReturnPath('/admin/cohorts/4/students/9/work', '/x')).toBe('/admin/cohorts/4/students/9/work')
  })
})

it.each(['//evil.example/admin/activity', 'https://evil.example/admin/activity', '/\\evil.example/admin/activity', '/admin/cohorts/0?tab=activity', '/admin/cohorts/4?tab=students', '/dashboard', '/admin/activity/../team'])('rejects unsafe or unallowlisted Activity return %s', (path) => {
  expect(activityReturnPath(path)).toBeNull()
})
