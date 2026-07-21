import type { StaffDashboard, StaffVideoProgress, StudentProgressDetail, Submission } from './types';

const now = Date.now();
const ago = (days: number) => new Date(now - days * 86_400_000).toISOString();

export const demoStaffDashboard: StaffDashboard = {
  user: { id: 7, full_name: 'Leon Shimizu', role: 'admin' },
  cohorts: [{
    cohort: { id: 4, name: 'Web Dev Cohort 4', start_date: '2026-06-01', status: 'active', active_count: 12, enrolled_count: 12 },
    ungraded_count: 3,
    students: [
      { user_id: 18, full_name: 'Maya Santos', email: 'maya@example.com', github_username: 'mayasantos', progress_percentage: 46, completed_blocks: 19, total_blocks: 41, last_sign_in_at: ago(1), last_seen_at: ago(1), last_activity_at: ago(1), blocks_this_week: 4, submissions_this_week: 2, ungraded_count: 1, redo_count: 1, enrollment_status: 'active' },
      { user_id: 19, full_name: 'Noah Cruz', email: 'noah@example.com', github_username: 'noahcruz', progress_percentage: 28, completed_blocks: 11, total_blocks: 41, last_sign_in_at: ago(9), last_seen_at: ago(9), last_activity_at: ago(9), blocks_this_week: 0, submissions_this_week: 0, ungraded_count: 0, redo_count: 0, enrollment_status: 'active' },
      { user_id: 20, full_name: 'Kai Perez', email: 'kai@example.com', github_username: 'kaiperez', progress_percentage: 61, completed_blocks: 25, total_blocks: 41, last_sign_in_at: ago(0), last_seen_at: ago(0), last_activity_at: ago(0), blocks_this_week: 6, submissions_this_week: 1, ungraded_count: 2, redo_count: 0, enrollment_status: 'active' },
    ],
  }],
};

export const demoStudentProgress: StudentProgressDetail = {
  enrollment: { id: 1, status: 'active' },
  user: { id: 18, full_name: 'Maya Santos', email: 'maya@example.com', github_username: 'mayasantos', avatar_url: null, last_sign_in_at: ago(1), last_seen_at: ago(1) },
  cohort: { id: 4, name: 'Web Dev Cohort 4', start_date: '2026-06-01', status: 'active' },
  overall_progress: { completed: 19, total: 41, percentage: 46 },
  recent_activity: [
    { content_block_id: 203, block_title: 'Responsive card grid', block_type: 'exercise', completed_at: ago(1) },
    { content_block_id: 202, block_title: 'Layout checklist', block_type: 'checkpoint', completed_at: ago(2) },
  ],
  modules: [{
    id: 10, name: 'Frontend Foundations', module_type: 'course', position: 1, total_blocks: 21, completed_blocks: 14, progress_percentage: 67,
    lessons: [
      { id: 100, title: 'HTML and semantic structure', lesson_type: 'lesson', available: true, total_blocks: 4, completed_blocks: 4, completed: true, blocks: [] },
      { id: 101, title: 'Responsive layouts with Grid', lesson_type: 'lesson', available: true, total_blocks: 5, completed_blocks: 3, completed: false, blocks: [] },
    ],
  }, {
    id: 11, name: 'JavaScript Applications', module_type: 'course', position: 2, total_blocks: 20, completed_blocks: 5, progress_percentage: 25, lessons: [],
  }],
};

export const demoStaffSubmissions: Submission[] = [
  { id: 31, content_block_id: 203, user_id: 18, user_name: 'Maya Santos', submission_type: 'repo_and_live_url_submission', text: null, grade: null, feedback: null, graded_by: null, graded_at: null, github_issue_url: 'https://github.com/example/project/issues/4', github_code_url: null, repo_url: 'https://github.com/example/project', pr_url: 'https://github.com/example/project/pull/12', live_url: 'https://example.com', branch: 'feature/responsive-grid', commit_sha: 'abc1234', notes: 'Ready for accessibility review.', num_submissions: 2, created_at: ago(1), content_block_title: 'Responsive card grid', content_block_type: 'exercise', lesson_title: 'Responsive layouts with Grid', filename: null, language_hint: 'css', exercise_body: 'Build a responsive card grid and deploy it.' },
  { id: 30, content_block_id: 198, user_id: 18, user_name: 'Maya Santos', submission_type: 'text_submission', text: 'I used semantic landmarks and explicit form labels.', grade: 'R', feedback: 'Connect every error message with aria-describedby.', graded_by: 'Leon Shimizu', graded_at: ago(2), github_issue_url: null, github_code_url: null, num_submissions: 1, created_at: ago(3), content_block_title: 'Accessible form audit', content_block_type: 'exercise', lesson_title: 'Accessible forms', filename: null, language_hint: null },
];

export const demoRecordingProgress: StaffVideoProgress[] = [
  { recording_id: 2, recording_title: 'APIs, authentication, and deployment', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', duration_seconds: 5_420, last_position_seconds: 1_580, total_watched_seconds: 1_520, progress_percentage: 28, completed: false, last_watched_at: ago(2) },
];

export const demoLessonVideoProgress: StaffVideoProgress[] = [
  { content_block_id: 202, title: 'Responsive layout walkthrough', lesson_title: 'Responsive layouts with Grid', module_title: 'Frontend Foundations', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', duration_seconds: 1_200, last_position_seconds: 1_200, total_watched_seconds: 1_150, progress_percentage: 96, completed: true, completed_at: ago(2), last_watched_at: ago(2) },
];
