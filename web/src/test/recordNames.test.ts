import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkExceptions, pageSources, scanPages, scanSource, type RecordNameException } from './recordNameScan'

/*
 * Record names on staff and student pages must open their record (L-0.2,
 * redesign §4.4): render them with <RecordLink>, which falls back to plain
 * text when the viewer can't open the record.
 *
 * The scanner is a heuristic (see recordNameScan.ts): it matches likely name
 * fields by property name, so treat a pass as "no known bare names", not proof.
 *
 * Adding an exception: when a name really should stay plain text, add
 * `'<file> <expression>': '<why>'` below, or `{ count, reason }` when the
 * same expression is bare more than once in that file. The expression is
 * written as the scanner prints it (optional chaining and `!` removed). The
 * count is exact: another bare occurrence of the same expression in the same
 * file fails until you link it or raise the count. Good reasons: it is the
 * record's own page title; the id needed for a link isn't in the data; the
 * record is locked; or the name sits inside a row that is already a link (the
 * scanner can't see through a JSX variable). Exceptions that allow more
 * occurrences than remain fail the test, so update them when the code changes.
 */
const EXCEPTIONS: Record<string, RecordNameException> = {
  // The record's own page title.
  'src/pages/admin/LessonEditor.tsx lesson.title': 'Title of the lesson editor',
  'src/pages/admin/CohortStudentView.tsx module.name': 'Type line of a previewed lesson; the learner preview has no module page',
  'src/pages/student/ModuleView.tsx mod.name': 'Title of the module page',
  'src/pages/student/StudentCohortHome.tsx home.cohort.name': 'Title of the cohort home',
  // No id to link with.
  'src/pages/admin/PrivateMeetings.tsx booking.student_name': 'Shown only when the booking has no student id; otherwise linked',
  'src/pages/student/Profile.tsx enrollment.cohort_name': 'Session enrollments carry no cohort id',
  'src/pages/shared/Announcements.tsx announcement.cohort_name': 'Shown only when the announcement has no cohort id; otherwise linked',
  'src/components/admin/StaffActivityFeed.tsx event.cohort_name': 'Shown only when the event has no cohort id; otherwise linked',
  // Locked or not yet open.
  'src/pages/admin/CohortStudentView.tsx lesson.title': 'Locked preview lessons; available lessons link within preview',
  'src/pages/student/ModuleView.tsx lesson.title': 'Locked lessons; open lessons are row links',
  'src/pages/student/CourseOutline.tsx lesson.title': 'Each row is the lesson link (rendered through a JSX variable); locked lessons stay plain',
  'src/pages/student/CourseOutline.tsx mod.name': { count: 2, reason: 'Section heading of Learn, the course outline itself; in the redesign a module is a place in Learn, not a page' },
  'src/components/student/PersonalLearningPlan.tsx lesson.title': '"Not open yet" lessons; open lessons are linked',
  'src/components/student/WeeklyPlan.tsx unlock.module_title': 'Modules that unlock on a later date',
  // Rendered inside a row link through a JSX variable.
  'src/pages/student/Dashboard.tsx mod.name': 'Row content of the module row link (plain when locked)',
  'src/pages/student/Materials.tsx lesson.title': 'Row content of the lesson row link (plain when locked)',
  // Inside the learning-plan editor: context for picking lessons; a link would leave an unsaved draft.
  'src/components/admin/StudentLearningPlan.tsx lessonsById.get(id).module_name': 'Context line under a lesson in the plan draft',
  'src/components/admin/learningPlan/LessonPicker.tsx mod.name': 'Group heading in the lesson picker dialog',
  // Staff preview of the learner view: links here would leave the preview.
  'src/pages/admin/CohortStudentView.tsx data.cohort.name': { count: 3, reason: 'Preview shell' },
  'src/pages/admin/CohortStudentView.tsx selectedStudent.full_name': 'Preview shell',
  'src/pages/admin/CohortStudentView.tsx announcement.cohort_name': 'Preview shell',
}

const webRoot = resolve(__dirname, '../..')

describe('record names on staff and student pages', () => {
  const { bare, stale } = checkExceptions(scanPages(webRoot), EXCEPTIONS)

  it('scans the staff and student pages', () => {
    expect(pageSources(webRoot).length).toBeGreaterThan(60)
  })

  it('renders record names with RecordLink', () => {
    expect(bare, 'Render these names with <RecordLink>, or add an exception with a reason (see the top of this file)').toEqual([])
  })

  it('keeps no stale exceptions', () => {
    expect(stale).toEqual([])
  })
})

describe('record name scanner', () => {
  const scan = (body: string) => scanSource('x.tsx', `export function X({ request, cohort, sub, items }: any) { return ${body} }`).map((finding) => finding.expression)

  it('flags names rendered as text', () => {
    expect(scan('<p>{cohort.name}</p>')).toEqual(['cohort.name'])
    expect(scan('<p>{request.student?.full_name}</p>')).toEqual(['request.student.full_name'])
    expect(scan('<p>{sub.lesson_title} · {sub.user_name}</p>')).toEqual(['sub.lesson_title', 'sub.user_name'])
    expect(scan('<p>{sub.cohort_name ? `In ${sub.cohort_name}` : null}</p>')).toEqual(['sub.cohort_name'])
    expect(scan('<ul>{items.map((mod: any) => <li key={mod.id}>{mod.name}</li>)}</ul>')).toEqual(['mod.name'])
  })

  it('holds each exception to its exact count, so a new bare occurrence in the same file fails', () => {
    const findings = scanSource('x.tsx', 'export function X({ cohort }: any) { return <div><h1>{cohort.name}</h1><p>{cohort.name}</p></div> }')
    expect(checkExceptions(findings, { 'x.tsx cohort.name': 'Page title' }).bare).toEqual([
      'x.tsx:1 cohort.name (exception allows 1, found 2)',
      'x.tsx:1 cohort.name (exception allows 1, found 2)',
    ])
    expect(checkExceptions(findings, { 'x.tsx cohort.name': { count: 2, reason: 'Title and subtitle' } })).toEqual({ bare: [], stale: [] })
    expect(checkExceptions(findings, { 'x.tsx cohort.name': { count: 3, reason: 'Was three' } }).stale).toEqual(['x.tsx cohort.name (exception allows 3, found 2)'])
    expect(checkExceptions([], { 'x.tsx cohort.name': 'Gone' }).stale).toEqual(['x.tsx cohort.name (exception allows 1, found 0)'])
  })

  it('accepts links and controls, and ignores attributes and other fields', () => {
    expect(scan('<RecordLink record={{ type: "cohort", id: 1 }}>{cohort.name}</RecordLink>')).toEqual([])
    expect(scan('<Link to="/x"><span>{cohort.name}</span></Link>')).toEqual([])
    expect(scan('<button type="button">{sub.user_name}</button>')).toEqual([])
    expect(scan('<p title={cohort.name} aria-label={cohort.name}>{cohort.status}</p>')).toEqual([])
    expect(scan('<p>{request.owner.full_name}</p>')).toEqual([])
  })
})
