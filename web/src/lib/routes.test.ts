import { activityReturnPath } from './routes'
import { describe, expect, it } from 'vitest'
import { cohortStudentPath, directMessagePath, helpRequestPath, interventionPath, safeInternalReturnPath, staffMessageSourcePath, submissionPath } from './routes'

describe('connected record routes', () => {
  it('keeps student identity scoped to a cohort enrollment', () => {
    expect(cohortStudentPath(7, 12, 'work')).toBe('/admin/cohorts/7/students/12/work')
  })

  it('preserves relationship context on submission records', () => {
    expect(submissionPath(44, { cohortId: 7, userId: 12, returnTo: '/admin/grading' }))
      .toBe('/admin/submissions/44?cohort_id=7&student_id=12&return_to=%2Fadmin%2Fgrading')
    expect(submissionPath(44, { returnTo: '/admin/grading?filter=redo', queue: 'redo' }))
      .toBe('/admin/submissions/44?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo&queue=redo')
    // The queue keeps its cohort scope so Previous/Next walk the list the inbox showed.
    expect(submissionPath(44, { queue: 'ungraded', queueCohortId: 7 })).toBe('/admin/submissions/44?queue=ungraded&queue_cohort_id=7')
    expect(submissionPath(44, { queueCohortId: 7 })).toBe('/admin/submissions/44')
    expect(helpRequestPath(9, '/admin/support?view=active')).toBe('/admin/help-requests/9?return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
    expect(interventionPath(61, '/admin/support?view=active')).toBe('/admin/interventions/61?return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
    expect(directMessagePath(6, { type: 'help_request', id: 9, label: 'Nested routes' }))
      .toBe('/messages/dm/6?source_type=help_request&source_id=9&source_label=Nested+routes')
  })

  it('carries the source record\'s own return path into a direct message, internal paths only', () => {
    expect(directMessagePath(6, { type: 'help_request', id: 9, label: 'Loops', returnTo: '/admin/support?view=active' }))
      .toBe('/messages/dm/6?source_type=help_request&source_id=9&source_label=Loops&source_return_to=%2Fadmin%2Fsupport%3Fview%3Dactive')
    expect(directMessagePath(6, { type: 'submission', id: 4, label: 'Loops', returnTo: '//evil.example' }))
      .toBe('/messages/dm/6?source_type=submission&source_id=4&source_label=Loops')
  })

  it('links staff to the staff view of a message source', () => {
    expect(staffMessageSourcePath({ type: 'submission', id: 812, cohort_id: 3 })).toBe('/admin/submissions/812?cohort_id=3')
    expect(staffMessageSourcePath({ type: 'help_request', id: 9 }, '/admin/support')).toBe('/admin/help-requests/9?return_to=%2Fadmin%2Fsupport')
    expect(staffMessageSourcePath({ type: 'lesson', id: 42, cohort_id: 3 })).toBe('/lessons/42?cohort_id=3')
  })

  it('does not accept an external return path', () => {
    expect(safeInternalReturnPath('//example.com', '/admin/grading')).toBe('/admin/grading')
    for (const unsafe of ['/\t/evil.example', '/\n/evil.example', '/\r//evil.example', '/\\evil.example', '\t//evil.example', 'https://evil.example']) {
      expect(safeInternalReturnPath(unsafe, '/admin/grading')).toBe('/admin/grading')
    }
    expect(safeInternalReturnPath('/admin/grading?filter=all&q=Maria%20Santos#row-4', '/x')).toBe('/admin/grading?filter=all&q=Maria%20Santos#row-4')
    expect(safeInternalReturnPath('/admin/cohorts/4/students/9/work', '/x')).toBe('/admin/cohorts/4/students/9/work')
  })
})

it.each(['//evil.example/admin/activity', 'https://evil.example/admin/activity', '/\\evil.example/admin/activity', '/admin/cohorts/0?tab=activity', '/admin/cohorts/4?tab=students', '/dashboard', '/admin/activity/../team'])('rejects unsafe or unallowlisted Activity return %s', (path) => {
  expect(activityReturnPath(path)).toBeNull()
})

describe('auth return destination security', () => {
  it.each([null, '', '//evil.test', '/\\evil.test', '\\\\evil.test', 'javascript:alert(1)', 'https://csg.local/messages', 'https://evil.test', '/%2fevil.test', '/%252fevil.test', '/%5cevil.test', '/%255cevil.test', '/\t/evil.test', '/%0a/evil.test', '/sign-in', '/sign-up?redirect_url=/messages', '/%73ign-in', '/foo/../sign-in', '/%ZZ', '/%252573ign-in'])('rejects %s', value => {
    expect(safeInternalReturnPath(value, '/dashboard')).toBe('/dashboard')
  })
  it.each(['/messages/dm/6?message_id=42#message-42', '/lessons/3?cohort_id=2#block-5', '/admin/students/3', '/messages?search=hello%20world'])('preserves %s', value => {
    expect(safeInternalReturnPath(value, '/dashboard')).toBe(value)
  })
})
