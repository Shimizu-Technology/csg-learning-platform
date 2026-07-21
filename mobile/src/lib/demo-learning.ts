import type { LessonDetail, RecordingItem, StudentDashboard } from './types';

export const demoDashboard: StudentDashboard = {
  enrolled: true,
  user: { id: 1, full_name: 'Maya Santos', role: 'student' },
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
