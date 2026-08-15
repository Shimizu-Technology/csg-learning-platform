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
    expect(helpRequestPath(9, '/admin/support?view=active')).toBe('/admin/help-requests/9?return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
    expect(interventionPath(61, '/admin/support?view=active')).toBe('/admin/interventions/61?return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
    expect(directMessagePath(6, { type: 'help_request', id: 9, label: 'Nested routes' }))
      .toBe('/messages/dm/6?source_type=help_request&source_id=9&source_label=Nested+routes')
  })

  it('does not accept an external return path', () => {
    expect(safeInternalReturnPath('//example.com', '/admin/grading')).toBe('/admin/grading')
  })
})
