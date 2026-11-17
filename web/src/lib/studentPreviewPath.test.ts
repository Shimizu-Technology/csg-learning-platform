import { expect, it } from 'vitest'
import { studentPreviewPath } from './studentPreviewPath'
it.each([
  ['/lessons/159?cohort_id=4#block-7', '/lessons/159?student_id=3#block-7'],
  ['/modules/5?cohort_id=4', '/modules/5?student_id=3'],
  ['/dashboard', '?student_id=3'],
  ['/materials?cohort_id=99', '/materials?student_id=3'],
  ['/messages/dm/5', '/messages?student_id=3'],
])('renders contained real anchor destinations for %s', (path, expected) => {
  expect(studentPreviewPath(path, 4, 3)).toBe(`/admin/cohorts/4/student-view${expected}`)
})
it('preserves explicit staff exits, external links and already contained destinations', () => {
  for (const path of ['/admin/cohorts/4/students/3/overview', '/admin/cohorts/4/student-view/lessons/159?student_id=3', 'https://example.com/video', 'mailto:help@example.com']) expect(studentPreviewPath(path, 4, 3)).toBe(path)
  expect(studentPreviewPath('/modules/5', 4)).toBe('/admin/cohorts/4/student-view/modules/5')
})
