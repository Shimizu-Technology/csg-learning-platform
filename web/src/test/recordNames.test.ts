import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { pageSources, scanPages, scanSource } from './recordNameScan'

/*
 * Record names on staff and student pages must open their record (L-0.2,
 * redesign §4.4): render them with <RecordLink>, which falls back to plain
 * text when the viewer can't open the record.
 *
 * Adding an exception: when a name really should stay plain text, add
 * `'<file> <expression>': '<why>'` below. The expression is written as the
 * scanner prints it (optional chaining and `!` removed). Good reasons: it is
 * the record's own page title; the id needed for a link isn't in the data;
 * the record is locked; or the name sits inside a row that is already a link
 * (the scanner can't see through a JSX variable). Exceptions that no longer
 * match anything fail the test, so remove them when the code changes.
 */
const EXCEPTIONS: Record<string, string> = {
  // The record's own page title.
  'src/pages/admin/CohortDetail.tsx cohort.name': 'Title of the cohort settings page',
  'src/pages/admin/CohortWorkspace.tsx cohort.name': 'Title of the cohort workspace',
  'src/pages/admin/CohortModuleGrading.tsx data.module_name': 'Title of the module grading page',
  'src/pages/admin/LessonEditor.tsx lesson.title': 'Title of the lesson editor',
  'src/pages/student/LessonView.tsx lesson.title': 'Title of the lesson page',
  'src/pages/student/ModuleView.tsx mod.name': 'Title of the module page',
  'src/pages/student/StudentCohortHome.tsx home.cohort.name': 'Title of the cohort home',
  // No id to link with.
  'src/pages/admin/PrivateMeetings.tsx booking.student_name': 'Shown only when the booking has no student id; otherwise linked',
  'src/pages/student/Profile.tsx enrollment.cohort_name': 'Session enrollments carry no cohort id',
  'src/pages/shared/Announcements.tsx announcement.cohort_name': 'Shown only when the announcement has no cohort id; otherwise linked',
  'src/components/admin/StaffActivityFeed.tsx event.cohort_name': 'Shown only when the event has no cohort id; otherwise linked',
  // Locked or not yet open.
  'src/pages/student/ModuleView.tsx lesson.title': 'Locked lessons; open lessons are row links',
  'src/components/student/PersonalLearningPlan.tsx lesson.title': '"Not open yet" lessons; open lessons are linked',
  'src/components/student/WeeklyPlan.tsx unlock.module_title': 'Modules that unlock on a later date',
  // Rendered inside a row link through a JSX variable.
  'src/pages/student/Dashboard.tsx mod.name': 'Row content of the module row link (plain when locked)',
  'src/pages/student/Materials.tsx lesson.title': 'Row content of the lesson row link (plain when locked)',
  // Staff preview of the learner view: links here would leave the preview.
  'src/pages/admin/CohortStudentView.tsx data.cohort.name': 'Preview shell',
  'src/pages/admin/CohortStudentView.tsx selectedStudent.full_name': 'Preview shell',
  'src/pages/admin/CohortStudentView.tsx announcement.cohort_name': 'Preview shell',
  'src/pages/admin/CohortStudentView.tsx lesson.title': 'Preview shell',
}

const webRoot = resolve(__dirname, '../..')

describe('record names on staff and student pages', () => {
  const findings = scanPages(webRoot)
  const key = (finding: { file: string; expression: string }) => `${finding.file} ${finding.expression}`

  it('scans the staff and student pages', () => {
    expect(pageSources(webRoot).length).toBeGreaterThan(60)
  })

  it('renders record names with RecordLink', () => {
    const bare = findings.filter((finding) => !EXCEPTIONS[key(finding)]).map((finding) => `${finding.file}:${finding.line} ${finding.expression}`)
    expect(bare, 'Render these names with <RecordLink>, or add an exception with a reason (see the top of this file)').toEqual([])
  })

  it('keeps no stale exceptions', () => {
    const used = new Set(findings.map(key))
    expect(Object.keys(EXCEPTIONS).filter((entry) => !used.has(entry))).toEqual([])
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

  it('accepts links and controls, and ignores attributes and other fields', () => {
    expect(scan('<RecordLink record={{ type: "cohort", id: 1 }}>{cohort.name}</RecordLink>')).toEqual([])
    expect(scan('<Link to="/x"><span>{cohort.name}</span></Link>')).toEqual([])
    expect(scan('<button type="button">{sub.user_name}</button>')).toEqual([])
    expect(scan('<p title={cohort.name} aria-label={cohort.name}>{cohort.status}</p>')).toEqual([])
    expect(scan('<p>{request.owner.full_name}</p>')).toEqual([])
  })
})
