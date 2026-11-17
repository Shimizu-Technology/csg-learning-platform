import { PRODUCT_NAME } from './brand'
import { TERMS, pageTitle } from './glossary'

/**
 * A React Router path ("/admin/cohorts/:id/settings") as an exact matcher.
 * `:param` is one segment, `:param?` an optional one, a trailing `/*` any
 * tail, and a trailing slash is allowed. Nothing else matches, so a malformed
 * path that shares a prefix ("/courses-not-real") is "Page not found".
 */
function routePattern(path: string): RegExp {
  const splat = path.endsWith('/*')
  const segments = (splat ? path.slice(0, -2) : path).split('/').filter(Boolean)
  const body = segments.map((segment) => {
    if (segment.startsWith(':')) return segment.endsWith('?') ? '(?:/[^/]+)?' : '/[^/]+'
    return `/${segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`
  }).join('')
  return new RegExp(`^${body}${splat ? '(?:/.*)?' : ''}/?$`)
}

/**
 * The page name for each route in App.tsx, used for the browser tab title
 * (README §2: "<Page> · CSG Learn"). Names match the nav and the page heading.
 * Paths are written as in App.tsx; pageTitles.test.ts checks every App route
 * has one.
 */
export const ROUTE_TITLES: Array<[path: string, name: string]> = [
  ['/', PRODUCT_NAME],
  ['/courses', 'Focused courses'],
  ['/courses/:slug', 'Course'],
  ['/sign-in', 'Sign in'],
  ['/sign-up', 'Create account'],
  ['/privacy', 'Privacy policy'],
  ['/terms', 'Terms and community guidelines'],
  ['/account-deletion', 'Account deletion'],
  ['/dashboard', TERMS.today],
  ['/cohorts/:id', 'My cohort'],
  ['/meetings', 'My meetings'],
  ['/materials', TERMS.learn],
  ['/modules/:id', 'Module'],
  ['/lessons/:id', 'Lesson'],
  ['/profile', 'Profile'],
  ['/recordings', TERMS.recordings],
  ['/resources', TERMS.resources],
  ['/announcements', TERMS.updates],
  ['/announcements/:id', TERMS.updates],
  ['/messages', TERMS.messages],
  ['/messages/dm/:dmId', TERMS.messages],
  ['/messages/:channelId', TERMS.messages],
  ['/admin', TERMS.today],
  ['/admin/meetings', TERMS.meetings],
  ['/admin/students', 'Students'],
  ['/admin/students/:id', 'Student'],
  ['/admin/cohorts', 'Cohorts'],
  ['/admin/cohorts/:id', TERMS.cohort],
  ['/admin/cohorts/:id/settings', 'Cohort settings'],
  ['/admin/cohorts/:id/watch-progress', 'Watch progress'],
  ['/admin/cohorts/:id/student-view/*', TERMS.viewAsStudent],
  ['/admin/cohorts/:cohortId/students/:id/:tab?', 'Student'],
  ['/admin/cohorts/:cohortId/modules/:moduleId/grading', 'Module grading'],
  ['/admin/grading', TERMS.grading],
  ['/admin/submissions/:id', 'Submission'],
  ['/admin/support', TERMS.support],
  ['/admin/help-requests/:id', 'Help request'],
  ['/admin/interventions/:id', TERMS.followUpPlan],
  ['/admin/content', TERMS.content],
  ['/admin/curricula/:id', 'Curriculum'],
  ['/admin/modules/:id', 'Module'],
  ['/admin/lessons/:id', 'Lesson'],
  ['/admin/lessons/:id/edit', TERMS.editLesson],
  ['/admin/meetings/:id', 'Meeting'],
  ['/admin/recordings/:id', 'Recording'],
  ['/admin/office-hours/:id', 'Session'],
  ['/admin/learning-plans/:id', 'Learning plan'],
  ['/admin/channels/:id', 'Conversation details'],
  ['/admin/rubrics/:id', 'Rubric'],
  ['/admin/activity/:id', 'Activity'],
  ['/admin/activity', 'School activity'],
  ['/admin/moderation', 'Safety'],
  ['/admin/team', 'Team'],
  ['/admin/team/:id', 'Team member'],
]

const MATCHERS = ROUTE_TITLES.map(([path, name]) => [routePattern(path), name] as const)

/** Page name when the app fails to render (the root error boundary). */
export const ERROR_PAGE_NAME = 'Something went wrong'

/** The page name for a path, or null for unknown routes ("Page not found"). */
export function pageNameForPath(pathname: string): string | null {
  return MATCHERS.find(([pattern]) => pattern.test(pathname))?.[1] ?? null
}

/** The browser tab title for a path. */
export function documentTitleForPath(pathname: string): string {
  return pageTitle(pageNameForPath(pathname) ?? 'Page not found')
}
