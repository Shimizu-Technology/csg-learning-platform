import { expect, it } from 'vitest'
import { shellNavigation, moreIcon, adminIcon } from './shellNavigation'
import type { AccessibleCohort } from '../types/api'
const cohort = (live: boolean, features = {}) => ({ id: 1, workspace_id: 2, features, capabilities: { live_support: live, features } }) as AccessibleCohort
const labels = (nav: ReturnType<typeof shellNavigation>) => [...nav.primary, ...nav.more, ...nav.admin].map(item => item.label)
it.each([true, false])('seven global staff destinations, admin=%s, unique icons', admin => {
  const nav = shellNavigation({ staff: true, admin, cohort: cohort(true) })
  expect(nav.primary.map(item => item.label)).toEqual(['Today', 'Cohorts', 'Students', 'Grading', 'Support', 'Content', 'Messages'])
  expect(nav.primary[1].to).toBe('/admin/cohorts')
  expect(nav.admin.length).toBe(admin ? 3 : 0)
  const icons = [...nav.primary, ...nav.more, ...nav.admin].map(item => item.icon).concat(moreIcon, adminIcon)
  expect(new Set(icons).size).toBe(icons.length)
})
it.each([true, false])('staff school switches apply independent of selected cohort, admin=%s', admin => {
  const items = labels(shellNavigation({ staff: true, admin, cohort: cohort(true), schoolFeatures: { announcements: false, private_meetings: false, recordings: false, help_requests: false, interventions: false } }))
  for (const label of ['Support', 'Updates', 'Meetings', 'Recordings']) expect(items).not.toContain(label)
})
it.each([true, false])('learner live-support capability controls cohort/recording/meeting nav, live=%s', live => {
  const nav = shellNavigation({ staff: false, admin: false, cohort: cohort(live) })
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
