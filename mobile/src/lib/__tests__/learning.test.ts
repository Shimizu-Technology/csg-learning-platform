import { buildSubmissionInput, canSubmitWork, lessonCompletion, safeExternalUrl, submissionState, submissionTypeFor } from '../learning';
import type { LessonContentBlock, Submission } from '../types';

const block = (id: number, status: string): LessonContentBlock => ({ id, block_type: 'checkpoint', position: id, title: null, body: null, video_url: null, filename: null, metadata: {}, progress: { status, completed_at: null } });

describe('learning helpers', () => {
  it('calculates completion from completable blocks', () => {
    expect(lessonCompletion([block(1, 'completed'), block(2, 'in_progress')])).toEqual({ completed: 1, total: 2, percentage: 50 });
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

  it('validates and normalizes native submission payloads', () => {
    expect(canSubmitWork('repo_and_live_url_submission', { text: '', repoUrl: 'https://github.com/csg/work', liveUrl: '' })).toBe(false);
    expect(canSubmitWork('repo_and_live_url_submission', { text: '', repoUrl: ' https://github.com/csg/work ', liveUrl: ' https://work.example ' })).toBe(true);
    expect(buildSubmissionInput(7, 'repo_url_submission', { text: '', repoUrl: ' https://github.com/csg/work ', liveUrl: '', prUrl: '', branch: ' main ', commitSha: '', notes: ' Ready ' })).toEqual({
      content_block_id: 7,
      repo_url: 'https://github.com/csg/work',
      live_url: undefined,
      pr_url: undefined,
      branch: 'main',
      commit_sha: undefined,
      notes: 'Ready',
    });
  });
});

function submission(overrides: Partial<Submission>): Submission {
  return {
    id: 1, content_block_id: 1, user_id: 1, user_name: 'Student', text: null, grade: null, feedback: null,
    graded_by: null, graded_at: null, github_issue_url: null, github_code_url: null, num_submissions: 1,
    created_at: '2026-07-20T00:00:00Z', content_block_title: 'Exercise', content_block_type: 'exercise',
    lesson_title: 'Lesson', filename: null, language_hint: null, ...overrides,
  };
}
