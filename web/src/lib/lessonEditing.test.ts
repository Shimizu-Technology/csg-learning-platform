import { describe, expect, it } from 'vitest'
import { grantLine, readOnlyNotice } from './lessonEditing'

const grant = { cohort: { id: 3, name: 'Cohort 3' }, granted_by: { id: 1, full_name: 'Leon Tester' }, granted_at: '2026-11-14T19:30:00Z' }

describe('lesson editing copy', () => {
  it("names the admin by first name and the school date", () => {
    expect(grantLine(grant)).toBe('Leon gave you this access on Nov 15')
    expect(grantLine({ granted_by: null, granted_at: null }, 'them')).toBe('An admin gave this access')
  })

  it('explains a shared curriculum with the other cohorts and who gave the access', () => {
    const notice = readOnlyNotice({ can_edit: false, reason: 'shared', message: null, grants: [grant], shared_with: [{ id: 2, name: 'Cohort 2' }, { id: 4, name: 'Cohort 4' }] })
    expect(notice.title).toBe('Read only: Cohort 2 and Cohort 4 share this curriculum')
    expect(notice.body).toContain("You can edit Cohort 3's content")
    expect(notice.body).toContain('Leon gave you this access on Nov 15.')
  })

  it('tells an instructor without access who can edit', () => {
    expect(readOnlyNotice({ can_edit: false, reason: 'no_grant', message: null, grants: [], shared_with: [] }).body).toMatch(/Ask an admin/)
  })
})
