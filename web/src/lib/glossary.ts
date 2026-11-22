import { PRODUCT_NAME, SCHOOL_NAME, brand } from './brand'

/**
 * One name per concept (redesign README §2). Use these in UI copy, page
 * titles, toasts and emails instead of retyping a term, so a rename happens in
 * one place. The retired names live in `fixtures/glossary.json`, which the web
 * and mobile naming tests read.
 *
 * UI copy only: API routes, models, columns and payload keys keep their
 * names (`/admin/interventions/:id` is a follow-up plan in the UI).
 */
export const TERMS = {
  today: 'Today',
  learn: 'Learn',
  myWork: 'My work',
  updates: 'Updates',
  update: 'update',
  postUpdate: 'Post update',
  notifications: 'Notifications',
  askForHelp: 'Ask for help',
  helpRequest: 'help request',
  viewResponse: 'View response',
  /** How long a self-paced learner can ask an instructor for help. */
  helpPeriod: 'Help period',
  contactSchool: `Contact ${brand.schoolAbbreviation}`,
  messages: 'Messages',
  support: 'Support',
  followUpPlan: 'Follow-up plan',
  followUpPlans: 'Follow-up plans',
  startFollowUpPlan: 'Start follow-up plan',
  /** The pace-and-scope plan inside a follow-up plan for a learner coming back after time away. */
  returnPlan: 'Return plan',
  needsAttention: 'Needs attention',
  grading: 'Grading',
  waitingForReview: 'Waiting for review',
  redoRequested: 'Redo requested',
  graded: 'Graded',
  exercise: 'Exercise',
  checkpoint: 'Checkpoint',
  content: 'Content',
  cohort: 'Cohort',
  /** A messaging space that isn't a cohort. */
  community: 'Community',
  liveProgram: 'Live program',
  smallClass: 'Small class',
  smallClassDelivery: 'Small class (online lessons + optional check-ins)',
  optionalCheckIn: 'Optional check-in',
  selfPaced: 'Self-paced',
  liveClass: 'Live class',
  officeHours: 'Office hours',
  meetings: 'Meetings',
  recordings: 'Recordings',
  resources: 'Resources',
  viewAsStudent: 'View as student',
  markComplete: 'Mark complete',
  classChat: 'Class chat',
  alumniLibrary: `${brand.schoolAbbreviation} Alumni library`,
  editLesson: 'Edit lesson',
} as const

/** Grade letters as people read them: "R" is stored, "Redo" is shown. */
export function gradeLabel(grade: string | null | undefined): string {
  if (!grade) return ''
  return grade === 'R' ? 'Redo' : grade
}

/** Browser tab title: the page name, then "· CSG Learn" (README §2). The landing page names the school. */
export function pageTitle(page?: string | null): string {
  return page && page !== PRODUCT_NAME ? `${page} · ${PRODUCT_NAME}` : `${PRODUCT_NAME} · ${SCHOOL_NAME}`
}

/**
 * A stored value ("extended_absence") as words ("Extended absence"). Prefer a
 * label map; this is the fallback so raw enum values never reach the screen.
 */
export function humanize(value: string | null | undefined, labels: Record<string, string> = {}): string {
  if (!value) return ''
  if (labels[value]) return labels[value]
  const words = value.replace(/[_-]+/g, ' ').trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1).toLowerCase() : ''
}
