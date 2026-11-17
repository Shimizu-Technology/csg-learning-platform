import { describe, expect, it } from 'vitest'
import { copyNotice, grantLine, readOnlyNotice } from './lessonEditing'

const grant = { cohort: { id: 3, name: 'Cohort 3' }, granted_by: { id: 1, full_name: 'Leon Tester' }, granted_at: '2026-11-14T19:30:00Z' }

describe('lesson editing copy', () => {
  it("names the admin by first name and the school date", () => {
    expect(grantLine(grant)).toBe('Leon gave you this access on Nov 15')
    expect(grantLine({ granted_by: null, granted_at: null }, 'them')).toBe('An admin gave this access')
  })

  it('explains a shared curriculum with the other cohorts and who gave the access', () => {
    const notice = readOnlyNotice({ can_edit: false, reason: 'shared', message: null, grants: [grant], shared_with: [{ id: 2, name: 'Cohort 2' }, { id: 4, name: 'Cohort 4' }], shared_with_others_count: 0, copy_cohorts: [], copy_of: null })
    expect(notice.title).toBe('Read only: Cohort 2 and Cohort 4 share this curriculum')
    expect(notice.body).toContain("You can edit Cohort 3's content")
    expect(notice.body).toContain('Leon gave you this access on Nov 15.')
    const copyable = readOnlyNotice({ can_edit: false, reason: 'shared', message: null, grants: [grant], shared_with: [{ id: 4, name: 'Cohort 4' }], shared_with_others_count: 0, copy_cohorts: [grant.cohort], copy_of: null })
    expect(copyable.body).toBe("You can edit Cohort 3's content. Make a copy for Cohort 3 to change this lesson without affecting Cohort 4. Leon gave you this access on Nov 15.")
  })

  it("names the cohort whose copy is being edited", () => {
    const access = { can_edit: true, reason: 'granted' as const, message: null, grants: [grant], shared_with: [], shared_with_others_count: 0, copy_cohorts: [], copy_of: null }
    expect(copyNotice(access)).toBeNull()
    expect(copyNotice({ ...access, copy_of: { cohort: { id: 3, name: 'Cohort 3' }, source_curriculum: null, created_at: '2026-11-16T00:00:00Z' } }))
      .toEqual({ title: "You're editing Cohort 3's copy", body: "Cohort 3's progress, submissions and release dates moved with it." })
  })

  // L-3.2: a cohort the instructor doesn't teach is a number, never a name, yet the notice still says the curriculum is shared.
  it('counts sharing cohorts the instructor does not teach without naming them', () => {
    const hidden = readOnlyNotice({ can_edit: false, reason: 'shared', message: null, grants: [grant], shared_with: [], shared_with_others_count: 1, copy_cohorts: [grant.cohort], copy_of: null })
    expect(hidden.title).toBe('Read only: 1 other cohort shares this curriculum')
    expect(hidden.body).toBe("You can edit Cohort 3's content. Make a copy for Cohort 3 to change this lesson without affecting 1 other cohort. Leon gave you this access on Nov 15.")
    const mixed = readOnlyNotice({ can_edit: false, reason: 'shared', message: null, grants: [grant], shared_with: [{ id: 4, name: 'Cohort 4' }], shared_with_others_count: 2, copy_cohorts: [], copy_of: null })
    expect(mixed.title).toBe('Read only: Cohort 4 and 2 other cohorts share this curriculum')
    const access = { can_edit: true, reason: 'granted' as const, message: null, grants: [grant], shared_with: [], shared_with_others_count: 0, copy_cohorts: [], copy_of: { cohort: null, source_curriculum: { id: 1, name: 'Web Lab' }, created_at: '2026-11-16T00:00:00Z' } }
    expect(copyNotice(access)).toEqual({ title: "You're editing a cohort's copy", body: "Later changes to the shared Web Lab don't reach it." })
  })

  it('tells an instructor without access who can edit', () => {
    expect(readOnlyNotice({ can_edit: false, reason: 'no_grant', message: null, grants: [], shared_with: [], shared_with_others_count: 0, copy_cohorts: [], copy_of: null }).body).toMatch(/Ask an admin/)
  })
})
