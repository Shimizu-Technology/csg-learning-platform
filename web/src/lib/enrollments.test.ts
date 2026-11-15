import { describe, expect, it } from 'vitest'
import type { SessionEnrollment } from '../types/api'
import { isAlumniOnlyEnrollment } from './enrollments'

function enrollment(id: number, cohortType: string, status = 'active'): SessionEnrollment {
  return {
    id, access_expires_at: null, first_opened_at: null, support_expires_at: null,
    cohort: { features: {}, course_delivery: 'program', id, name: `Cohort ${id}`, cohort_type: cohortType, start_date: '2026-09-01', status: 'active' },
    status,
    enrolled_at: '2026-09-01T00:00:00Z',
  }
}

describe('isAlumniOnlyEnrollment', () => {
  it('identifies a user whose active enrollments are all alumni', () => {
    expect(isAlumniOnlyEnrollment([enrollment(1, 'alumni')])).toBe(true)
  })

  it('keeps recordings available when any active enrollment is not alumni', () => {
    expect(isAlumniOnlyEnrollment([enrollment(1, 'alumni'), enrollment(2, 'standard')])).toBe(false)
  })

  it('does not treat inactive or missing enrollments as alumni-only access', () => {
    expect(isAlumniOnlyEnrollment([enrollment(1, 'alumni', 'completed')])).toBe(false)
    expect(isAlumniOnlyEnrollment([])).toBe(false)
  })
})
