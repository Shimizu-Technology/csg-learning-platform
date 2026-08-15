import type { HelpRequest, Intervention, StaffDashboard, StaffVideoProgress, StudentProgressDetail, Submission, SupportQueue } from './types';

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
  learning_evidence_scope: { kind: 'curriculum', curriculum_id: 3, curriculum_name: 'Full-Stack Web Development', enrollment_count: 1, shared_across_enrollments: false },
  overall_progress: { completed: 19, total: 41, percentage: 46 },
  recent_activity: [
    { content_block_id: 203, block_title: 'Responsive card grid', block_type: 'exercise', completed_at: ago(1) },
    { content_block_id: 202, block_title: 'Layout checklist', block_type: 'checkpoint', completed_at: ago(2) },
  ],
  modules: [{
    id: 10, name: 'Frontend Foundations', module_type: 'course', position: 1, total_blocks: 21, completed_blocks: 14, progress_percentage: 67,
    lessons: [
      { id: 100, title: 'HTML and semantic structure', lesson_type: 'lesson', available: true, total_blocks: 4, completed_blocks: 4, completed: true, blocks: [{ id: 198, title: 'Accessible form audit', block_type: 'exercise', status: 'completed', completed_at: ago(3), submission: { id: 30, grade: 'R', feedback: 'Connect every error message with aria-describedby.', submitted_at: ago(3), graded_at: ago(2) } }] },
      { id: 101, title: 'Responsive layouts with Grid', lesson_type: 'lesson', available: true, total_blocks: 5, completed_blocks: 3, completed: false, blocks: [{ id: 203, title: 'Responsive card grid', block_type: 'exercise', status: 'completed', completed_at: ago(1), submission: { id: 31, grade: null, feedback: null, submitted_at: ago(1), graded_at: null } }] },
    ],
  }, {
    id: 11, name: 'JavaScript Applications', module_type: 'course', position: 2, total_blocks: 20, completed_blocks: 5, progress_percentage: 25, lessons: [],
  }],
};

export const demoStaffSubmissions: Submission[] = [
  { id: 31, content_block_id: 203, user_id: 18, user_name: 'Maya Santos', submission_type: 'repo_and_live_url_submission', text: null, grade: null, feedback: null, graded_by: null, graded_at: null, github_issue_url: 'https://github.com/example/project/issues/4', github_code_url: null, repo_url: 'https://github.com/example/project', pr_url: 'https://github.com/example/project/pull/12', live_url: 'https://example.com', branch: 'feature/responsive-grid', commit_sha: 'abc1234', notes: 'Ready for accessibility review.', num_submissions: 2, created_at: ago(1), content_block_title: 'Responsive card grid', content_block_type: 'exercise', lesson_title: 'Responsive layouts with Grid', filename: null, language_hint: 'css', exercise_body: 'Build a responsive card grid and deploy it.', github_checks: { head_sha: 'abc1234', fetched_at: ago(0.04), summary: { total: 3, passed: 2, failed: 1, pending: 0, neutral: 0 }, runs: [{ id: 1, external_id: 701, name: 'TypeScript and ESLint', workflow_name: 'Web CI', app_slug: 'github-actions', head_sha: 'abc1234', status: 'completed', conclusion: 'success', details_url: 'https://github.com/example/project/actions/runs/701', started_at: ago(0.08), completed_at: ago(0.07), fetched_at: ago(0.04) }, { id: 2, external_id: 702, name: 'Accessibility checks', workflow_name: 'Web CI', app_slug: 'github-actions', head_sha: 'abc1234', status: 'completed', conclusion: 'failure', details_url: 'https://github.com/example/project/actions/runs/702', started_at: ago(0.08), completed_at: ago(0.06), fetched_at: ago(0.04) }, { id: 3, external_id: 703, name: 'Unit tests', workflow_name: 'Web CI', app_slug: 'github-actions', head_sha: 'abc1234', status: 'completed', conclusion: 'success', details_url: 'https://github.com/example/project/actions/runs/703', started_at: ago(0.08), completed_at: ago(0.07), fetched_at: ago(0.04) }] } },
  { id: 30, content_block_id: 198, user_id: 18, user_name: 'Maya Santos', submission_type: 'text_submission', text: 'I used semantic landmarks and explicit form labels.', grade: 'R', feedback: 'Connect every error message with aria-describedby.', graded_by: 'Leon Shimizu', graded_at: ago(2), github_issue_url: null, github_code_url: null, num_submissions: 1, created_at: ago(3), content_block_title: 'Accessible form audit', content_block_type: 'exercise', lesson_title: 'Accessible forms', filename: null, language_hint: null },
];

export const demoHelpRequests: HelpRequest[] = [{
  id: 41,
  cohort: { id: 4, name: 'Web Dev Cohort 4' },
  context_type: 'exercise',
  context_source: 'primary',
  context_id: 203,
  context_label: 'Responsive card grid',
  context_path: '/learn/lessons/101?block=203',
  category: 'technical',
  urgency: 'urgent',
  status: 'open',
  message: 'My cards wrap correctly locally, but the deployed layout collapses into one column. Can you help me trace the difference?',
  staff_response: null,
  acknowledged_at: null,
  resolved_at: null,
  canceled_at: null,
  created_at: ago(0.08),
  updated_at: ago(0.08),
  owner: null,
  student: { id: 18, full_name: 'Maya Santos', email: 'maya@example.com' },
}];

export const demoInterventions: Intervention[] = [{
  id: 61,
  trigger_type: 'help_request',
  severity: 'urgent',
  status: 'open',
  evidence_snapshot: { help_request_id: 41, category: 'technical', urgency: 'urgent', context_type: 'exercise', context_id: 203 },
  action_summary: 'Respond to the request and confirm the next learning step.',
  next_follow_up_at: ago(-0.2),
  follow_up_due: true,
  outcome: null,
  resolution_summary: null,
  resolved_at: null,
  created_at: ago(0.08),
  updated_at: ago(0.08),
  enrollment: { id: 1, status: 'active', student: { id: 18, full_name: 'Maya Santos', email: 'maya@example.com' }, cohort: { id: 4, name: 'Web Dev Cohort 4' } },
  owner: { id: 7, full_name: 'Leon Shimizu' },
  created_by: { id: 7, full_name: 'Leon Shimizu' },
  help_request_id: 41,
  recovery_plan_id: null,
  notes: [],
}];

export const demoSupportQueue: SupportQueue = {
  generated_at: new Date(now).toISOString(),
  summary: { open_help_count: 1, acknowledged_help_count: 0, urgent_help_count: 1, student_count: 3, active_intervention_count: 1, due_follow_up_count: 1, active_recovery_plan_count: 0, due_recovery_check_in_count: 0 },
  help_requests: demoHelpRequests,
  recently_resolved: [],
  students: [
    { enrollment_id: 1, user_id: 18, cohort_id: 4, full_name: 'Maya Santos', email: 'maya@example.com', cohort_name: 'Web Dev Cohort 4', progress_percentage: 46, completed_blocks: 19, total_blocks: 41, last_activity_at: ago(1), help_request_count: 1, urgent_help_count: 1, redo_count: 1, ungraded_count: 1, inactive: false, active_intervention_id: 61, intervention_status: 'open', follow_up_due: true, recovery_plan_id: null, recovery_check_in_due: false, priority: 9 },
    { enrollment_id: 2, user_id: 20, cohort_id: 4, full_name: 'Kai Perez', email: 'kai@example.com', cohort_name: 'Web Dev Cohort 4', progress_percentage: 61, completed_blocks: 25, total_blocks: 41, last_activity_at: ago(0), help_request_count: 0, urgent_help_count: 0, redo_count: 0, ungraded_count: 2, inactive: false, active_intervention_id: null, intervention_status: null, follow_up_due: false, recovery_plan_id: null, recovery_check_in_due: false, priority: 2 },
    { enrollment_id: 3, user_id: 19, cohort_id: 4, full_name: 'Noah Cruz', email: 'noah@example.com', cohort_name: 'Web Dev Cohort 4', progress_percentage: 28, completed_blocks: 11, total_blocks: 41, last_activity_at: ago(9), help_request_count: 0, urgent_help_count: 0, redo_count: 0, ungraded_count: 0, inactive: true, active_intervention_id: null, intervention_status: null, follow_up_due: false, recovery_plan_id: null, recovery_check_in_due: false, priority: 1 },
  ],
  interventions: demoInterventions,
  recovery_plans: [],
};

export const demoRecordingProgress: StaffVideoProgress[] = [
  { recording_id: 2, recording_title: 'APIs, authentication, and deployment', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', duration_seconds: 5_420, last_position_seconds: 1_580, total_watched_seconds: 1_520, progress_percentage: 28, completed: false, last_watched_at: ago(2) },
];

export const demoLessonVideoProgress: StaffVideoProgress[] = [
  { content_block_id: 202, title: 'Responsive layout walkthrough', lesson_title: 'Responsive layouts with Grid', module_title: 'Frontend Foundations', cohort_id: 4, cohort_name: 'Web Dev Cohort 4', duration_seconds: 1_200, last_position_seconds: 1_200, total_watched_seconds: 1_150, progress_percentage: 96, completed: true, completed_at: ago(2), last_watched_at: ago(2) },
];
