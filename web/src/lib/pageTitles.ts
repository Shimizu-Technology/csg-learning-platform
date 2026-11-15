import { PRODUCT_NAME } from './brand'
import { TERMS, pageTitle } from './glossary'

/**
 * The page name for each route, used for the browser tab title (README §2:
 * "<Page> · CSG Learn"). Names match the nav and the page heading. First
 * match wins, so specific routes come before their parents.
 */
const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/$/, PRODUCT_NAME],
  [/^\/sign-in/, 'Sign in'],
  [/^\/sign-up/, 'Create account'],
  [/^\/courses/, 'Focused courses'],
  [/^\/privacy/, 'Privacy policy'],
  [/^\/terms/, 'Terms and community guidelines'],
  [/^\/account-deletion/, 'Account deletion'],
  [/^\/dashboard/, TERMS.today],
  [/^\/cohorts\//, 'My cohort'],
  [/^\/meetings/, 'My meetings'],
  [/^\/materials/, TERMS.learn],
  [/^\/modules\//, 'Module'],
  [/^\/lessons\//, 'Lesson'],
  [/^\/recordings/, TERMS.recordings],
  [/^\/resources/, TERMS.resources],
  [/^\/messages/, TERMS.messages],
  [/^\/announcements/, TERMS.updates],
  [/^\/profile/, 'Profile'],
  [/^\/admin\/cohorts\/[^/]+\/student-view/, TERMS.viewAsStudent],
  [/^\/admin\/cohorts\/[^/]+\/students\//, 'Student'],
  [/^\/admin\/students\//, 'Student'],
  [/^\/admin\/students/, 'Students'],
  [/^\/admin\/cohorts\/[^/]+\/modules\//, 'Module grading'],
  [/^\/admin\/cohorts\/[^/]+\/watch-progress/, 'Watch progress'],
  [/^\/admin\/cohorts\/[^/]+\/settings/, 'Cohort settings'],
  [/^\/admin\/cohorts\//, TERMS.cohort],
  [/^\/admin\/cohorts/, 'Cohorts'],
  [/^\/admin\/grading/, TERMS.grading],
  [/^\/admin\/submissions\//, 'Submission'],
  [/^\/admin\/interventions\//, TERMS.followUpPlan],
  [/^\/admin\/help-requests\//, 'Help request'],
  [/^\/admin\/support/, TERMS.support],
  [/^\/admin\/meetings/, TERMS.meetings],
  [/^\/admin\/activity/, 'School activity'],
  [/^\/admin\/moderation/, 'Safety'],
  [/^\/admin\/content/, TERMS.content],
  [/^\/admin\/lessons\/[^/]+\/edit/, TERMS.editLesson],
  [/^\/admin\/team/, 'Team'],
  [/^\/admin\/?$/, TERMS.today],
]

/** The page name for a path, or null for unknown routes ("Page not found"). */
export function pageNameForPath(pathname: string): string | null {
  return ROUTE_TITLES.find(([pattern]) => pattern.test(pathname))?.[1] ?? null
}

/** The browser tab title for a path. */
export function documentTitleForPath(pathname: string): string {
  return pageTitle(pageNameForPath(pathname) ?? 'Page not found')
}
