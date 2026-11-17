import { expect, it } from 'vitest'
import { searchDestinationPath } from './searchDestination'
const student = { is_staff: false, is_admin: false }
const staff = { is_staff: true, is_admin: false }
it('uses the role-aware registry for record pages', () => {
  expect(searchDestinationPath({ kind: 'student', id: 3, context: {}, anchor: {} }, student)).toBeNull()
  expect(searchDestinationPath({ kind: 'student', id: 3, context: {}, anchor: {} }, staff)).toBe('/admin/students/3')
  expect(searchDestinationPath({ kind: 'lesson', id: 4, context: { cohort_id: 5 }, anchor: { block_id: 6 } }, student)).toBe('/lessons/4?cohort_id=5#block-6')
})
it('serializes curriculum query before fragment and filters resource lists', () => {
  // Staff open the curriculum page (L-5); learners keep the wire adapter's Learn.
  expect(searchDestinationPath({ kind: 'curriculum', id: 3, context: { staff: true, cohort_id: 4 }, anchor: {} }, staff)).toBe('/admin/curricula/3')
  expect(searchDestinationPath({ kind: 'curriculum', id: 3, context: { cohort_id: 4 }, anchor: {} }, student)).toBe('/materials?cohort_id=4')
  expect(searchDestinationPath({ kind: 'resource', id: 2, context: { cohort_id: 4, query: 'Synthetic & resource' }, anchor: {} }, student)).toBe('/resources?cohort_id=4&resource=2&q=Synthetic+%26+resource')
})
