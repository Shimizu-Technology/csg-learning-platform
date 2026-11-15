import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PRODUCT_NAME, SCHOOL_NAME } from './brand'
import { documentTitleForPath, pageNameForPath, ROUTE_TITLES } from './pageTitles'

describe('document.title per page (README §2: "<Page> · CSG Learn")', () => {
  it.each([
    ['/', `${PRODUCT_NAME} · ${SCHOOL_NAME}`],
    ['/sign-in', `Sign in · ${PRODUCT_NAME}`],
    ['/sign-up', `Create account · ${PRODUCT_NAME}`],
    ['/privacy', `Privacy policy · ${PRODUCT_NAME}`],
    ['/terms', `Terms and community guidelines · ${PRODUCT_NAME}`],
    ['/dashboard', `Today · ${PRODUCT_NAME}`],
    ['/materials', `Learn · ${PRODUCT_NAME}`],
    ['/cohorts/3', `My cohort · ${PRODUCT_NAME}`],
    ['/lessons/12', `Lesson · ${PRODUCT_NAME}`],
    ['/recordings', `Recordings · ${PRODUCT_NAME}`],
    ['/resources', `Resources · ${PRODUCT_NAME}`],
    ['/messages/dm/4', `Messages · ${PRODUCT_NAME}`],
    ['/announcements', `Updates · ${PRODUCT_NAME}`],
    ['/admin', `Today · ${PRODUCT_NAME}`],
    ['/admin/cohorts', `Cohorts · ${PRODUCT_NAME}`],
    ['/admin/cohorts/3', `Cohort · ${PRODUCT_NAME}`],
    ['/admin/cohorts/3/settings', `Cohort settings · ${PRODUCT_NAME}`],
    ['/admin/cohorts/3/student-view/dashboard', `View as student · ${PRODUCT_NAME}`],
    ['/admin/cohorts/3/students/9/support', `Student · ${PRODUCT_NAME}`],
    ['/admin/students/9', `Student · ${PRODUCT_NAME}`],
    ['/admin/grading', `Grading · ${PRODUCT_NAME}`],
    ['/admin/submissions/812', `Submission · ${PRODUCT_NAME}`],
    ['/admin/support', `Support · ${PRODUCT_NAME}`],
    ['/admin/interventions/5', `Follow-up plan · ${PRODUCT_NAME}`],
    ['/admin/help-requests/5', `Help request · ${PRODUCT_NAME}`],
    ['/admin/meetings', `Meetings · ${PRODUCT_NAME}`],
    ['/admin/moderation', `Safety · ${PRODUCT_NAME}`],
    ['/admin/content', `Content · ${PRODUCT_NAME}`],
    ['/admin/lessons/7/edit', `Edit lesson · ${PRODUCT_NAME}`],
    ['/admin/team', `Team · ${PRODUCT_NAME}`],
    ['/courses', `Focused courses · ${PRODUCT_NAME}`],
    ['/admin/students', `Students · ${PRODUCT_NAME}`],
    ['/admin/students/', `Students · ${PRODUCT_NAME}`],
    ['/admin/cohorts/3/students/9', `Student · ${PRODUCT_NAME}`],
    ['/admin/cohorts/3/student-view', `View as student · ${PRODUCT_NAME}`],
    ['/admin/cohorts/3/modules/4/grading', `Module grading · ${PRODUCT_NAME}`],
    ['/no-such-page', `Page not found · ${PRODUCT_NAME}`],
  ])('%s → %s', (path, title) => {
    expect(documentTitleForPath(path)).toBe(title)
  })

  it('never titles the lesson editor "Today" or "Staff home", or a cohort "Cohort workspace" (U-2.5)', () => {
    expect(pageNameForPath('/admin/lessons/7/edit')).toBe('Edit lesson')
    expect(pageNameForPath('/admin/cohorts/3')).toBe('Cohort')
  })
})

describe('unknown routes are "Page not found", even when they share a real prefix', () => {
  it.each([
    '/courses-not-real',
    '/courses/extra',
    '/admin/students-invalid',
    '/admin/students/9/extra',
    '/admin/cohorts-old',
    '/admin/cohorts/3/settings/extra',
    '/admin/cohorts/3/students',
    '/admin/cohorts/3/students/9/support/extra',
    '/admin/cohorts/3/modules/4',
    '/admin/lessons/7',
    '/admin/teams',
    '/admin/interventions',
    '/dashboard-old',
    '/lessons',
    '/sign-in-now',
    '/administrator',
  ])('%s', (path) => {
    expect(pageNameForPath(path)).toBeNull()
    expect(documentTitleForPath(path)).toBe(`Page not found · ${PRODUCT_NAME}`)
  })
})

describe('every route in App.tsx has a title', () => {
  it('matches the route table', () => {
    const app = readFileSync(resolve(__dirname, '../App.tsx'), 'utf8')
    const paths = [...app.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]).filter((path) => path !== '*')
    expect(paths.length).toBeGreaterThan(40)
    expect([...new Set(paths)].sort()).toEqual([...new Set(ROUTE_TITLES.map(([path]) => path))].sort())
  })
})
