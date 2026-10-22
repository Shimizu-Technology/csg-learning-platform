import { demoHelpRequests, demoInterventions, demoSupportQueue } from '../demo-staff';
import { currentSubmissions, appendCatalogItem, buildSubmissionInput, canSubmitWork, isNewSubmissionAttempt, isStaffAttentionQuery, lessonCompletion, safeExternalUrl, staffSubmissionPath, submissionBelongsToStudentProgress, submissionState, submissionTypeFor, updateSupportQueueHelpRequest, updateSupportQueueIntervention } from '../learning';
import type { LessonContentBlock, Submission } from '../types';

const block = (id: number, status: string): LessonContentBlock => ({ id, block_type: 'checkpoint', position: id, title: null, body: null, video_url: null, filename: null, metadata: {}, progress: { status, completed_at: null } });

describe('learning helpers', () => {
  it('sends empty optional artifacts so editing can remove them', () => {
    expect(buildSubmissionInput(1, 'repo_url_submission', { text: '', repoUrl: 'https://github.com/p2/project', liveUrl: '', prUrl: '', branch: '', commitSha: '', notes: '' })).toEqual({ content_block_id: 1, repo_url: 'https://github.com/p2/project', live_url: '', pr_url: '', branch: '', commit_sha: '', notes: '' });
  });

  it('calculates completion from completable blocks', () => {
    expect(lessonCompletion([block(1, 'completed'), block(2, 'in_progress')])).toEqual({ completed: 1, total: 2, percentage: 50 });
  });

  it('preserves refetched catalog entries when a create request completes', () => {
    const refetched = [{ id: 1, title: 'Existing' }, { id: 2, title: 'Refetched while creating' }];

    expect(appendCatalogItem(refetched, { id: 3, title: 'Created' })).toEqual([...refetched, { id: 3, title: 'Created' }]);
  });

  it('matches the server completion driver when a lesson mixes reference and actionable blocks', () => {
    expect(lessonCompletion([
      { ...block(1, 'in_progress'), block_type: 'video', completion_required: false },
      { ...block(2, 'completed'), block_type: 'exercise', completion_required: true },
    ])).toEqual({ completed: 1, total: 1, percentage: 100 });
  });

  it('derives submission behavior and rejects unsafe links', () => {
    expect(submissionTypeFor({ ...block(1, 'not_started'), block_type: 'exercise' })).toBe('text_submission');
    expect(safeExternalUrl('https://codeschoolofguam.com/')).toBe('https://codeschoolofguam.com/');
    expect(safeExternalUrl('javascript:alert(1)')).toBeNull();
  });

  it('uses only the latest attempt to determine pass, redo, and edit state', () => {
    const priorPass = submission({ id: 10, grade: 'P', created_at: '2026-07-20T10:00:00Z' });
    const latestRedo = submission({ id: 11, grade: 'R', created_at: '2026-07-21T10:00:00Z' });
    expect(submissionState([priorPass, latestRedo])).toMatchObject({ latest: latestRedo, passed: false, redo: true, editable: false });

    const latestDraft = submission({ id: 12, grade: null, created_at: '2026-07-22T10:00:00Z' });
    expect(submissionState([priorPass, latestDraft])).toMatchObject({ latest: latestDraft, passed: false, redo: false, editable: true });
  });

  it('does not count edits to an ungraded submission as a new attempt', () => {
    expect(isNewSubmissionAttempt(true)).toBe(false);
    expect(isNewSubmissionAttempt(false)).toBe(true);
  });

  it('validates and normalizes native submission payloads', () => {
    expect(canSubmitWork('repo_and_live_url_submission', { text: '', repoUrl: 'https://github.com/csg/work', liveUrl: '' })).toBe(false);
    expect(canSubmitWork('repo_and_live_url_submission', { text: '', repoUrl: ' https://github.com/csg/work ', liveUrl: ' https://work.example ' })).toBe(true);
    expect(buildSubmissionInput(7, 'repo_url_submission', { text: '', repoUrl: ' https://github.com/csg/work ', liveUrl: '', prUrl: '', branch: ' main ', commitSha: '', notes: ' Ready ' })).toEqual({
      content_block_id: 7,
      repo_url: 'https://github.com/csg/work',
      live_url: '',
      pr_url: '',
      branch: 'main',
      commit_sha: '',
      notes: 'Ready',
    });
  });

  it('only accepts submission relationship context for the same learner and curriculum content', () => {
    const progress = {
      user: { id: 18 },
      modules: [{ lessons: [{ blocks: [{ id: 42 }] }] }],
    } as Parameters<typeof submissionBelongsToStudentProgress>[1];

    expect(submissionBelongsToStudentProgress({ user_id: 18, content_block_id: 42 }, progress)).toBe(true);
    expect(submissionBelongsToStudentProgress({ user_id: 19, content_block_id: 42 }, progress)).toBe(false);
    expect(submissionBelongsToStudentProgress({ user_id: 18, content_block_id: 99 }, progress)).toBe(false);
  });

  it('keeps the support queue and student signal counts in sync when a request changes', () => {
    const acknowledged = { ...demoHelpRequests[0], status: 'acknowledged' as const, acknowledged_at: '2026-07-21T00:00:00Z' };
    const afterAcknowledge = updateSupportQueueHelpRequest(demoSupportQueue, acknowledged);
    expect(afterAcknowledge.summary).toMatchObject({ open_help_count: 0, acknowledged_help_count: 1, urgent_help_count: 1 });
    expect(afterAcknowledge.help_requests[0]).toBe(acknowledged);

    const resolved = { ...acknowledged, status: 'resolved' as const, resolved_at: '2026-07-21T01:00:00Z' };
    const afterResolve = updateSupportQueueHelpRequest(afterAcknowledge, resolved);
    expect(afterResolve.summary).toMatchObject({ open_help_count: 0, acknowledged_help_count: 0, urgent_help_count: 0 });
    expect(afterResolve.help_requests).toEqual([]);
    expect(afterResolve.recently_resolved[0]).toBe(resolved);
    expect(afterResolve.students.find((student) => student.user_id === 18)).toMatchObject({ help_request_count: 0, urgent_help_count: 0 });
  });

  it('keeps intervention metrics and the related student signal in sync', () => {
    const monitoring = { ...demoInterventions[0], status: 'monitoring' as const, follow_up_due: false };
    const afterMonitoring = updateSupportQueueIntervention(demoSupportQueue, monitoring);
    expect(afterMonitoring.summary).toMatchObject({ active_intervention_count: 1, due_follow_up_count: 0 });
    expect(afterMonitoring.students.find((student) => student.enrollment_id === 1)).toMatchObject({ active_intervention_id: 61, intervention_status: 'monitoring', follow_up_due: false });

    const resolved = { ...monitoring, status: 'resolved' as const, resolved_at: '2026-07-21T01:00:00Z' };
    const afterResolve = updateSupportQueueIntervention(afterMonitoring, resolved);
    expect(afterResolve.summary).toMatchObject({ active_intervention_count: 0, due_follow_up_count: 0 });
    expect(afterResolve.interventions).toEqual([]);
    expect(afterResolve.students.find((student) => student.enrollment_id === 1)).toMatchObject({ active_intervention_id: null, intervention_status: null, follow_up_due: false });
  });
});

function submission(overrides: Partial<Submission>): Submission {
  return {
    id: 1, content_block_id: 1, user_id: 1, user_name: 'Student', text: null, grade: null, feedback: null,
    graded_by: null, graded_at: null, github_issue_url: null, github_code_url: null, num_submissions: 1,
    created_at: '2026-07-20T00:00:00Z', updated_at: '2026-07-20T00:00:00Z', content_block_title: 'Exercise', content_block_type: 'exercise',
    lesson_title: 'Lesson', filename: null, language_hint: null, ...overrides,
  };
}

describe('staff latest attempt navigation', () => {
  it('retains validated cohort and student context', () => {
    expect(staffSubmissionPath(42, { cohortId: 7, studentId: 4 })).toBe('/staff/submission/42?cohort_id=7&student_id=4');
  });
  it('uses the unscoped record when context is unavailable', () => {
    expect(staffSubmissionPath(42)).toBe('/staff/submission/42');
  });
});

 it('invalidates every attention scope for this staff member while retaining saved record details', () => {
    expect(isStaffAttentionQuery(['learning', 7, 'dashboard', 4], 7)).toBe(true);
    expect(isStaffAttentionQuery(['learning', 7, 'support-queue', 'all'], 7)).toBe(true);
    expect(isStaffAttentionQuery(['cohort-home', 7, 4], 7)).toBe(true);
    expect(isStaffAttentionQuery(['learning', 8, 'dashboard', 4], 7)).toBe(false);
    expect(isStaffAttentionQuery(['learning', 7, 'intervention', 41], 7)).toBe(false);
    expect(isStaffAttentionQuery(['learning', 7, 'staff-submission', 42], 7)).toBe(false);
  });

it('selects current staff work by enrollment and block, respecting latest IDs in partial histories', () => {
  const row = { id: 1, user_id: 4, content_block_id: 8, enrollment_id: 12, created_at: '2026-10-21T00:00:00Z', grade: 'R' };
  expect(currentSubmissions([row, { ...row, id: 2, created_at: '2026-10-22T00:00:00Z', grade: null }]).map((item) => item.id)).toEqual([2]);
  expect(currentSubmissions([row, { ...row, id: 2, enrollment_id: 13 }]).map((item) => item.id)).toEqual([1, 2]);
  expect(currentSubmissions([{ ...row, latest_submission_id: 9 }])).toEqual([]);
});
