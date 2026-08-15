import { describe, expect, it } from 'vitest'
import { cohortStudentPath, safeInternalReturnPath, submissionPath } from './routes'

describe('connected record routes', () => {
  it('keeps student identity scoped to a cohort enrollment', () => {
    expect(cohortStudentPath(7, 12, 'work')).toBe('/admin/cohorts/7/students/12/work')
  })

  it('preserves relationship context on submission records', () => {
    expect(submissionPath(44, { cohortId: 7, userId: 12, returnTo: '/admin/grading' }))
      .toBe('/admin/submissions/44?cohort_id=7&student_id=12&return_to=%2Fadmin%2Fgrading')
  })

  it('does not accept an external return path', () => {
    expect(safeInternalReturnPath('//example.com', '/admin/grading')).toBe('/admin/grading')
  })
})
