import type { LessonDetail, RecordingItem, StudentDashboard, WeeklyPlan } from './types';
import { demoStudentUser } from './demo-data';

export const demoWeeklyPlan: WeeklyPlan = {
  enrolled: true,
  cohort: { id: 4, name: 'Web Dev Cohort 4' },
  week_number: 8,
  starts_on: '2026-07-20',
  ends_on: '2026-07-26',
  timezone: 'Pacific/Guam',
  summary: { required_count: 3, required_completed_count: 1, open_redo_count: 1, optional_count: 1 },
  required: [
    { id: 'lesson-100', kind: 'lesson', lesson_id: 100, module_id: 10, title: 'HTML and semantic structure', module_title: 'Frontend Foundations', lesson_type: 'reading', required: true, scheduled_for: '2026-07-20', carried_forward: false, state: 'completed', submission_close_at: null, submissions_closed: false },
    { id: 'lesson-101', kind: 'lesson', lesson_id: 101, module_id: 10, title: 'Responsive layouts with Grid', module_title: 'Frontend Foundations', lesson_type: 'exercise', required: true, scheduled_for: '2026-07-22', carried_forward: false, state: 'open', submission_close_at: '2026-07-25T23:59:00+10:00', submissions_closed: false },
    { id: 'lesson-102', kind: 'lesson', lesson_id: 102, module_id: 10, title: 'Accessible forms', module_title: 'Frontend Foundations', lesson_type: 'exercise', required: true, scheduled_for: '2026-07-21', carried_forward: true, state: 'open', submission_close_at: '2026-07-25T23:59:00+10:00', submissions_closed: false },
  ],
  optional: [{ id: 'lesson-104', kind: 'lesson', lesson_id: 104, module_id: 10, title: 'Container query stretch', module_title: 'Frontend Foundations', lesson_type: 'exercise', required: false, scheduled_for: '2026-07-24', carried_forward: false, state: 'upcoming', submission_close_at: null, submissions_closed: false }],
  redos: [{ id: 'redo-9', kind: 'redo', submission_id: 9, lesson_id: 102, title: 'Contact form exercise', lesson_title: 'Accessible forms', feedback: 'Add an explicit label for every field.', state: 'open', submission_close_at: '2026-07-25T23:59:00+10:00' }],
  events: [{ id: 'event-1', kind: 'live_class', office_hour_id: 1, title: 'Frontend live class', description: null, starts_at: '2026-07-22T18:00:00+10:00', ends_at: '2026-07-22T20:00:00+10:00', meeting_url: 'https://meet.google.com/', timezone: 'Pacific/Guam', recurrence: 'weekly', event_kind: 'live_class' }],
  upcoming_unlocks: [{ id: 'unlock-103', kind: 'unlock', lesson_id: 103, module_id: 10, title: 'JavaScript interactions', module_title: 'Frontend Foundations', unlocks_on: '2026-07-25', required: true }],
  recording_catch_up: [{ id: 'recording-2', kind: 'recording', recording_id: 2, title: 'APIs, authentication, and deployment', recorded_on: '2026-07-15', progress_percentage: 28 }],
};

export const demoDashboard: StudentDashboard = {
  enrolled: true,
  user: { id: demoStudentUser.id, full_name: demoStudentUser.full_name, role: 'student' },
  cohort: { id: 4, name: 'Web Dev Cohort 4', start_date: '2026-06-01', status: 'active', unread_notifications_count: 2, announcements: [] },
  overall_progress: { completed: 18, total: 36, percentage: 50 },
  continue_lesson: { id: 101, title: 'Responsive layouts with Grid' },
  action_items: [{ type: 'redo', submission_id: 9, lesson_id: 102, lesson_title: 'Accessible forms', content_block_title: 'Contact form exercise', feedback: 'Add an explicit label for every field.', submissions_closed: false }],
  recently_graded: [{ submission_id: 8, lesson_id: 100, lesson_title: 'HTML and semantic structure', content_block_title: 'Semantic page exercise', grade: 'A', feedback: 'Clear structure and thoughtful landmarks.', graded_at: '2026-07-20T04:00:00Z' }],
  resources: [{ id: 1, title: 'Class repository', url: 'https://github.com/', category: 'code', description: 'Starter files and examples.' }],
  office_hours: [{ id: 1, title: 'Open lab', starts_at: '2026-07-22T08:00:00+10:00', meeting_url: 'https://meet.google.com/' }],
  modules: [{
    id: 10, name: 'Frontend Foundations', module_type: 'course', position: 1, progress_percentage: 50, completed_blocks: 18, total_blocks: 36, assigned: true, unlocked: true, available: true, unlock_date: null,
    lessons: [
      { id: 100, title: 'HTML and semantic structure', lesson_type: 'lesson', available: true, unlock_date: null, completed: true, total_blocks: 4, completed_blocks: 4 },
      { id: 101, title: 'Responsive layouts with Grid', lesson_type: 'lesson', available: true, unlock_date: null, completed: false, total_blocks: 5, completed_blocks: 2 },
      { id: 102, title: 'Accessible forms', lesson_type: 'exercise', available: true, unlock_date: null, completed: false, total_blocks: 3, completed_blocks: 1 },
      { id: 103, title: 'JavaScript interactions', lesson_type: 'lesson', available: false, unlock_date: '2026-07-25', completed: false, total_blocks: 5, completed_blocks: 0 },
    ],
  }],
};

export const demoRecordings: RecordingItem[] = [
  { id: 'legacy-4-1', item_key: 'legacy-4-1', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', title: 'Responsive interfaces and state', description: 'Class replay covering responsive layouts and component state.', recorded_date: '2026-07-18', date: '2026-07-18', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', source: 'youtube' },
  { id: 2, item_key: 'uploaded-2', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', title: 'APIs, authentication, and deployment', description: 'Secure API integration and production deployment walkthrough.', recorded_date: '2026-07-15', duration_seconds: 5420, duration_display: '1:30:20', source: 'uploaded', watch_progress: { last_position_seconds: 1580, total_watched_seconds: 1520, progress_percentage: 28, completed: false, last_watched_at: '2026-07-20T10:00:00Z' } },
];

export const demoLesson: LessonDetail = {
  id: 101, module_id: 10, title: 'Responsive layouts with Grid', lesson_type: 'lesson', position: 2, release_day: 3, required: true, requires_submission: true, submission_type: 'text_submission', content_blocks_count: 3,
  submission_window: { submissions_open: true, submissions_closed: false }, prev_lesson: { id: 100, title: 'HTML and semantic structure' }, next_lesson: { id: 102, title: 'Accessible forms' },
  content_blocks: [
    { id: 201, block_type: 'text', position: 1, title: 'Build flexible page systems', body: 'CSS Grid gives you **two-dimensional control** over rows and columns.\n\nUse a mobile-first layout, then add columns when the content has room.', video_url: null, filename: null, metadata: {}, progress: { status: 'completed', completed_at: '2026-07-20T02:00:00Z' } },
    { id: 202, block_type: 'checkpoint', position: 2, title: 'Layout checklist', body: '- Start with one column\n- Use `minmax()` for flexible tracks\n- Test keyboard and zoom behavior', video_url: null, filename: null, metadata: {}, progress: { status: 'not_started', completed_at: null } },
    { id: 203, block_type: 'exercise', position: 3, title: 'Rebuild the card grid', body: 'Explain how your grid changes between mobile and desktop.', video_url: null, filename: 'styles.css', submission_type: 'text_submission', submission_config: {}, metadata: { language: 'css' }, progress: { status: 'in_progress', completed_at: null }, submissions: [] },
  ],
};

const demoReviewedLesson: LessonDetail = {
  id: 100, module_id: 10, cohort_id: 4, title: 'HTML and semantic structure', lesson_type: 'lesson', position: 1, release_day: 1, required: true, requires_submission: true, submission_type: 'text_submission', content_blocks_count: 2,
  submission_window: { submissions_open: true, submissions_closed: false }, prev_lesson: null, next_lesson: { id: 101, title: 'Responsive layouts with Grid' },
  content_blocks: [
    { id: 198, block_type: 'text', position: 1, title: 'Use meaningful landmarks', body: 'Semantic HTML communicates the purpose of each page region to browsers, assistive technology, and your teammates.', video_url: null, filename: null, metadata: {}, progress: { status: 'completed', completed_at: '2026-07-20T02:00:00Z' } },
    { id: 199, block_type: 'exercise', position: 2, title: 'Semantic page exercise', body: 'Describe the landmarks you chose and why they fit the content.', video_url: null, filename: 'index.html', submission_type: 'text_submission', submission_config: {}, metadata: { language: 'html' }, progress: { status: 'completed', completed_at: '2026-07-20T04:00:00Z' }, submissions: [{ id: 8, submission_type: 'text_submission', text: 'I used header, nav, main, section, and footer so each region has a clear purpose.', grade: 'A', feedback: 'Clear structure and thoughtful landmarks.', graded_at: '2026-07-20T05:00:00Z', num_submissions: 1, created_at: '2026-07-20T04:00:00Z', updated_at: '2026-07-20T05:00:00Z' }] },
  ],
};

const demoRedoLesson: LessonDetail = {
  id: 102, module_id: 10, cohort_id: 4, title: 'Accessible forms', lesson_type: 'exercise', position: 3, release_day: 2, required: true, requires_submission: true, submission_type: 'text_submission', content_blocks_count: 2,
  submission_window: { submissions_open: true, submissions_closed: false }, prev_lesson: { id: 101, title: 'Responsive layouts with Grid' }, next_lesson: { id: 103, title: 'JavaScript interactions' },
  content_blocks: [
    { id: 204, block_type: 'text', position: 1, title: 'Make every field understandable', body: 'Labels, instructions, and errors should remain programmatically connected to the field they describe.', video_url: null, filename: null, metadata: {}, progress: { status: 'completed', completed_at: '2026-07-21T02:00:00Z' } },
    { id: 205, block_type: 'exercise', position: 2, title: 'Contact form exercise', body: 'Explain how your form connects each field with its label and error message.', video_url: null, filename: 'contact.html', submission_type: 'text_submission', submission_config: {}, metadata: { language: 'html' }, progress: { status: 'completed', completed_at: '2026-07-21T03:00:00Z' }, submissions: [{ id: 9, submission_type: 'text_submission', text: 'Each input is next to visible label text and each error is shown below its field.', grade: 'R', feedback: 'Add an explicit label for every field.', graded_at: '2026-07-21T04:00:00Z', num_submissions: 1, created_at: '2026-07-21T03:00:00Z', updated_at: '2026-07-21T04:00:00Z' }] },
  ],
};

const demoInteractionsLesson: LessonDetail = {
  ...demoLesson,
  id: 103,
  title: 'JavaScript interactions',
  position: 4,
  release_day: 6,
  requires_submission: false,
  submission_type: undefined,
  content_blocks_count: 2,
  submission_window: { submissions_open: false, submissions_closed: false },
  prev_lesson: { id: 102, title: 'Accessible forms' },
  next_lesson: { id: 104, title: 'Container query stretch' },
  content_blocks: [
    { id: 206, block_type: 'text', position: 1, title: 'Connect behavior to intent', body: 'Use event listeners to make an interface respond while keeping state changes predictable and accessible.', video_url: null, filename: null, metadata: {}, progress: { status: 'not_started', completed_at: null } },
    { id: 207, block_type: 'checkpoint', position: 2, title: 'Interaction checklist', body: '- Support keyboard input\n- Keep visible focus\n- Announce meaningful state changes', video_url: null, filename: null, metadata: {}, progress: { status: 'not_started', completed_at: null } },
  ],
};

const demoContainerQueryLesson: LessonDetail = {
  ...demoLesson,
  id: 104,
  title: 'Container query stretch',
  position: 5,
  release_day: 5,
  required: false,
  requires_submission: false,
  submission_type: undefined,
  content_blocks_count: 2,
  submission_window: { submissions_open: false, submissions_closed: false },
  prev_lesson: { id: 103, title: 'JavaScript interactions' },
  next_lesson: null,
  content_blocks: [
    { id: 208, block_type: 'text', position: 1, title: 'Respond to the component', body: 'Container queries let a component adapt to the space its parent provides instead of the entire viewport.', video_url: null, filename: null, metadata: {}, progress: { status: 'not_started', completed_at: null } },
    { id: 209, block_type: 'checkpoint', position: 2, title: 'Stretch goal', body: 'Convert one responsive card from a viewport query to a container query and compare the behavior.', video_url: null, filename: null, metadata: {}, progress: { status: 'not_started', completed_at: null } },
  ],
};

export function demoLessonFor(id: number): LessonDetail {
  if (id === demoReviewedLesson.id) return demoReviewedLesson;
  if (id === demoLesson.id) return demoLesson;
  if (id === demoRedoLesson.id) return demoRedoLesson;
  if (id === demoInteractionsLesson.id) return demoInteractionsLesson;
  if (id === demoContainerQueryLesson.id) return demoContainerQueryLesson;
  throw new Error(`Sample lesson ${id} is not available.`);
}
