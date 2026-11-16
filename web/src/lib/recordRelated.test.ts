import { describe, expect, it } from 'vitest'
import { relatedRows, type RecordRelated } from './recordRelated'

const related = (canEdit: boolean | undefined): RecordRelated => ({
  type: 'submission',
  id: 812,
  context: { cohort: { id: 4, name: 'Cohort 3' }, student: { id: 20, name: 'Alex Rivera' } },
  items: [
    { key: 'lesson', count: null, value: 'Make Decisions with JavaScript', lesson_id: 30, ...(canEdit === undefined ? {} : { can_edit: canEdit }) },
    { key: 'lesson_submissions', count: 5, value: null, cohort_id: 4, lesson_id: 30 },
  ],
})
const instructor = { is_staff: true, is_admin: false }
const admin = { is_staff: true, is_admin: true }

describe('submission related rows', () => {
  it('opens the lesson editor for admins and instructors with editing access, and the lesson otherwise', () => {
    const lesson = (data: RecordRelated, viewer: typeof admin) => relatedRows(data, { viewer, returnTo: '/admin/grading' }).find((row) => row.key === 'lesson')!
    expect(lesson(related(true), instructor)).toMatchObject({ value: 'Edit', to: '/admin/lessons/30/edit' })
    expect(lesson(related(false), instructor).value).toBe('Open')
    expect(lesson(related(false), instructor).to).not.toContain('/edit')
    // Older servers send no can_edit: admins still edit.
    expect(lesson(related(undefined), admin)).toMatchObject({ value: 'Edit', to: '/admin/lessons/30/edit' })
  })

  it('links every submission for the lesson to the Grading workbench in that cohort', () => {
    const row = relatedRows(related(true), { viewer: instructor, returnTo: '/admin/grading' }).find((item) => item.key === 'lesson_submissions')!
    expect(row).toMatchObject({ label: 'All submissions for this lesson', count: 5, to: '/admin/grading?filter=all&cohort_id=4&lesson_id=30' })
    expect(relatedRows(related(true), { viewer: 'student', returnTo: '/' }).find((item) => item.key === 'lesson_submissions')!.to).toBeNull()
  })
})
