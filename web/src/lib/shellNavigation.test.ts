import { expect, it } from 'vitest'
import { shellNavigation, moreIcon, adminIcon } from './shellNavigation'
import type { AccessibleCohort } from '../types/api'
const cohort = (live: boolean, features = {}) => ({ id: 1, workspace_id: 2, available_features: { recordings: true, resources: true }, features, capabilities: { can_submit: false, read_only: false, support_mode: "guided_help", support_expires_at: null, access_expires_at: null, support_instructor_id: null, live_support: live, features } }) as AccessibleCohort
const labels = (nav: ReturnType<typeof shellNavigation>) => [...nav.primary, ...nav.more, ...nav.admin].map(item => item.label)
it.each([true, false])('seven global staff destinations, admin=%s, unique icons', admin => {
  const nav = shellNavigation({ staff: true, admin, cohort: cohort(true) })
  expect(nav.primary.map(item => item.label)).toEqual(['Today', 'Cohorts', 'Students', 'Grading', 'Support', 'Content', 'Messages'])
  expect(nav.primary[1].to).toBe('/admin/cohorts')
  expect(nav.admin.length).toBe(admin ? 3 : 0)
  const icons = [...nav.primary, ...nav.more, ...nav.admin].map(item => item.icon).concat(moreIcon, adminIcon)
  expect(new Set(icons).size).toBe(icons.length)
})
it.each([true, false])('staff management remains reachable with school off, admin=%s', admin => {
  const items = labels(shellNavigation({ staff: true, admin, cohort: cohort(true, { announcements: true, private_meetings: true, recordings: true, help_requests: true, interventions: true }), schoolFeatures: { announcements: false, private_meetings: false, recordings: false, help_requests: false, interventions: false } }))
  for (const label of ['Support', 'Updates', 'Meetings', 'Recordings']) expect(items).toContain(label)
})
it.each([true, false])('learner live-support capability controls cohort/recording/meeting nav, live=%s', live => {
  // With the new student experience off, the nav is exactly what it was.
  const nav = shellNavigation({ staff: false, admin: false, cohort: cohort(live, { student_experience_v2: false }) })
  expect(labels(nav).includes('My cohort')).toBe(live)
  expect(labels(nav).includes('Recordings')).toBe(live)
  expect(labels(nav).includes('My meetings')).toBe(live)
  expect(labels(nav)).toContain('Messages')
})
it('learner resolved switches override school defaults and hide optional features', () => {
  const nav = shellNavigation({ staff: false, admin: false, cohort: cohort(true, { announcements: false, recordings: false, private_meetings: false }), schoolFeatures: { announcements: true } })
  expect(labels(nav)).not.toContain('Updates')
  expect(labels(nav)).not.toContain('Recordings')
  expect(labels(nav)).not.toContain('My meetings')
})

it('the new student experience folds My cohort into Learn, adds My work and keeps everything else', () => {
  const before = labels(shellNavigation({ staff: false, admin: false, cohort: cohort(true, { student_experience_v2: false }) }))
  const after = labels(shellNavigation({ staff: false, admin: false, cohort: cohort(true, { student_experience_v2: true }) }))
  expect(before).toContain('My cohort')
  expect(before).not.toContain('My work')
  const learn = before.indexOf('Learn')
  expect(after).toEqual([...before.slice(0, learn + 1), 'My work', ...before.slice(learn + 1)].filter(label => label !== 'My cohort'))
  expect(shellNavigation({ staff: false, admin: false, cohort: cohort(true, { student_experience_v2: true }) }).primary.find(item => item.label === 'My work')?.to).toMatch(/^\/my-work\?cohort_id=\d+$/)
  // A cached or older payload without the key keeps today's nav.
  expect(labels(shellNavigation({ staff: false, admin: false, cohort: cohort(true, {}), schoolFeatures: { student_experience_v2: true } }))).toEqual(before)
  expect(labels(shellNavigation({ staff: true, admin: true, cohort: cohort(true, { student_experience_v2: false }) }))).toEqual(labels(shellNavigation({ staff: true, admin: true, cohort: cohort(true) })))
})

it('staff retain all management links with school and cohort all off', () => {
  const features = { announcements: false, private_meetings: false, recordings: false, help_requests: false, interventions: false }
  expect(labels(shellNavigation({ staff: true, admin: true, cohort: cohort(true, features), schoolFeatures: features }))).toEqual(labels(shellNavigation({ staff: true, admin: true, cohort: null })))
})
it.each([true, false])('learner defaults survive loading or unavailable access lists: %s', loading => {
  expect(labels(shellNavigation({ staff: false, admin: false, cohort: null, loading }))).toEqual(['Today', 'Learn', 'Messages', 'My meetings', 'Recordings', 'Resources', 'Updates'])
})
it('meetings link targets an enabled course even when the selected course has meetings off', () => {
  const available = { ...cohort(true), id: 9 }
  const nav = shellNavigation({ staff: false, admin: false, cohort: cohort(false, { private_meetings: false }), cohorts: [available] })
  expect(nav.more.find(item => item.label === 'My meetings')?.to).toBe('/meetings?cohort_id=9')
})

it('My work follows only the cohort’s own switch, never the school default (fix round)', () => {
  const bare = { id: 1, workspace_id: 2 } as AccessibleCohort
  expect(labels(shellNavigation({ staff: false, admin: false, cohort: bare, schoolFeatures: { student_experience_v2: true } }))).not.toContain('My work')
  expect(labels(shellNavigation({ staff: false, admin: false, cohort: cohort(true, { student_experience_v2: true }), schoolFeatures: { student_experience_v2: false } }))).toContain('My work')
})

it('new nav hides empty features and keeps explicit off navigation identical', () => {
  const empty = { ...cohort(true, { student_experience_v2: true }), available_features: { recordings: false, resources: false } }
  expect(labels(shellNavigation({ staff: false, admin: false, cohort: empty }))).not.toContain('Recordings')
  expect(labels(shellNavigation({ staff: false, admin: false, cohort: empty }))).not.toContain('Resources')
  const off = { ...empty, features: { student_experience_v2: false }, capabilities: { ...empty.capabilities!, features: { student_experience_v2: false } } }
  expect(shellNavigation({ staff: false, admin: false, cohort: off })).toEqual(shellNavigation({ staff: false, admin: false, cohort: cohort(true, { student_experience_v2: false }) }))
})
