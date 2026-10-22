import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { LessonContentBlock, LessonDetail, SubmissionBrief } from '@/lib/types';

let mockIsStaff = false;
let mockWritesPaused = false;
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ stale: mockWritesPaused, loading: false, error: mockWritesPaused ? 'offline' : null }) }));
const mockProgress = jest.fn();
const mockAttempt = jest.fn();
const mockVideoProgress = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockCreateSubmission = jest.fn();
const mockUpdateSubmission = jest.fn();
const mockSaveDraft = jest.fn().mockResolvedValue(undefined);
const mockLoadDraft = jest.fn().mockResolvedValue(null);

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/analytics', () => ({ analyticsAgeBucket: () => 'recent', analyticsLanguage: () => 'other', captureProductEvent: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openExternalPage: jest.fn(), openAuthenticatedWebLesson: jest.fn() }));
jest.mock('@/lib/submission-storage', () => ({
  ...jest.requireActual('@/lib/submission-storage'),
  clearSubmissionDraft: jest.fn().mockResolvedValue(undefined),
  loadSubmissionDraft: (...args: unknown[]) => mockLoadDraft(...args),
  saveSubmissionDraft: (...args: unknown[]) => mockSaveDraft(...args),
}));
jest.mock('../native-video-player', () => ({ NativeVideoPlayer: (props: object) => jest.requireActual('react').createElement(jest.requireActual('react-native').View, { testID: 'hosted-video', ...props }) }));
jest.mock('../in-app-media-player', () => ({ InAppMediaPlayer: (props: object) => jest.requireActual('react').createElement(jest.requireActual('react-native').View, { testID: 'linked-video', ...props }) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({
  useSession: () => ({ api: { createSubmission: mockCreateSubmission, updateSubmission: mockUpdateSubmission, updateProgress: mockProgress, attemptKnowledgeCheck: mockAttempt, updateContentVideoProgress: mockVideoProgress }, user: { id: 4, is_staff: mockIsStaff, full_name: 'Maria Santos' } }),
}));

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { CODE_INPUT_PROPS, LessonContentBlockCard } from '../lesson-content-block';

const lesson = { capabilities: { can_submit: true, read_only: false, support_mode: 'guided_help', support_expires_at: null, access_expires_at: null, support_instructor_id: null }, id: 138, title: 'Checkpoint 1 — budget decision', cohort_id: 2, module_id: 2, requires_github: false, content_blocks: [] } as unknown as LessonDetail;

function checkpoint(overrides: Partial<LessonContentBlock> = {}): LessonContentBlock {
  return { id: 204, block_type: 'checkpoint', position: 0, title: 'Checkpoint 1 — budget decision', body: 'Submit one clean version of your program.', video_url: null, filename: 'budget_decision.py', submission_type: 'text_submission', metadata: {}, submissions: [], ...overrides };
}

function submission(overrides: Partial<SubmissionBrief> = {}): SubmissionBrief {
  return { id: 9, text: 'amount = 100\nif amount == 100:\n    print("On budget")', grade: null, feedback: null, graded_at: null, num_submissions: 1, created_at: '2026-10-21T00:00:00Z', updated_at: '2026-10-21T00:00:00Z', ...overrides };
}

const queryClients: QueryClient[] = [];
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['performance'] }); mockIsStaff = false; mockWritesPaused = false; });
afterEach(() => {
  cleanup();
  queryClients.splice(0).forEach((client) => client.clear());
  jest.clearAllTimers();
  jest.useRealTimers();
});

function renderWithQuery(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  queryClients.push(client);
  return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
}

describe('LessonContentBlockCard', () => {
  beforeEach(() => {
    mockCreateSubmission.mockReset();
    mockUpdateSubmission.mockReset();
    mockSaveDraft.mockClear();
  });

  it('lets a learner submit a checkpoint for review instead of marking it complete', async () => {
    mockCreateSubmission.mockResolvedValue({ submission: { ...submission(), content_block_id: 204 } });
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint()} lesson={lesson} />);

    expect(screen.getByText('CHECKPOINT · SUBMIT FOR REVIEW')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark complete' })).toBeNull();
    const input = screen.getByTestId('submission-code-input');
    fireEvent.changeText(input, 'amount = 100\nif amount == 100:\n    print("On budget")');
    fireEvent.press(screen.getByRole('button', { name: 'Submit work' }));

    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalledWith({ content_block_id: 204, text: 'amount = 100\nif amount == 100:\n    print("On budget")' }, 2));
  });

  it('keeps an edit and field-specific error when PATCH of the current attempt is rejected', async () => {
    mockUpdateSubmission.mockRejectedValue(new Error('Submission text is required'));
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submissions: [submission()] })} lesson={lesson} />);
    fireEvent.changeText(screen.getByTestId('submission-code-input'), 'my revised draft');
    fireEvent.press(screen.getByRole('button', { name: 'Update submission' }));
    await waitFor(() => expect(mockUpdateSubmission).toHaveBeenCalledWith(9, { text: 'my revised draft' }, 2));
    await waitFor(() => expect(screen.getByText('Not submitted. Submission text is required')).toBeTruthy());
    expect(screen.getByTestId('submission-code-input').props.value).toBe('my revised draft');
    expect(mockCreateSubmission).not.toHaveBeenCalled();
    expect(mockSaveDraft).toHaveBeenCalledWith(4, 204, expect.objectContaining({ text: 'my revised draft' }), 9, '2026-10-21T00:00:00Z', 2);
  });

  it('creates a new attempt only after a redo', async () => {
    mockCreateSubmission.mockResolvedValue({ submission: submission({ id: 10, num_submissions: 2 }) });
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submissions: [submission({ grade: 'R' })] })} lesson={lesson} />);
    fireEvent.press(screen.getByRole('button', { name: 'Submit redo' }));
    await waitFor(() => expect(mockCreateSubmission).toHaveBeenCalled());
    expect(mockUpdateSubmission).not.toHaveBeenCalled();
  });

  it('configures the submission box for code: no autocorrect, capitals, spell check, or smart punctuation; monospace at 16pt', () => {
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint()} lesson={lesson} />);
    const input = screen.getByTestId('submission-code-input');

    expect(input.props).toMatchObject({ autoCapitalize: 'none', autoCorrect: false, spellCheck: false, smartInsertDelete: false, textContentType: 'none' });
    expect(CODE_INPUT_PROPS.keyboardType).toBe('ascii-capable');
    const style = Object.assign({}, ...[input.props.style].flat(3).filter(Boolean));
    expect(style.fontSize).toBe(16);
    expect(style.fontFamily).toBe('Menlo');
  });

  it('shows submitted work as awaiting review and keeps it editable', () => {
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submissions: [submission()] })} lesson={lesson} />);

    expect(screen.getByText('Submitted · awaiting review')).toBeTruthy();
    // The editable response box holds the submitted text exactly; no second copy below it.
    expect(screen.getByTestId('submission-code-input').props.value).toBe('amount = 100\nif amount == 100:\n    print("On budget")');
    expect(screen.getByRole('button', { name: 'Update submission' })).toBeTruthy();
    expect(screen.queryByTestId('submitted-text')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('shows a reviewed attempt with its exact text once the form is gone', () => {
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submissions: [submission({ grade: 'A', feedback: 'Nice' })] })} lesson={lesson} />);

    expect(screen.getByTestId('submitted-text')).toBeTruthy();
    expect(screen.getAllByTestId('message-code-text').some((node) => node.props.children === 'amount = 100\nif amount == 100:\n    print("On budget")')).toBe(true);
    expect(screen.queryByTestId('submission-code-input')).toBeNull();
  });

  it('renders redo feedback as formatted markdown with a real code block', () => {
    const feedback = 'Close! Explain *why* it joins.\n\n```python\nfor word in ["2", "3"]:\n    print(word * 2)\n```';
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submissions: [submission({ grade: 'R', feedback })] })} lesson={lesson} />);

    expect(screen.getByText('Redo requested — read the feedback, then resubmit below.')).toBeTruthy();
    expect(screen.queryByText(/```/)).toBeNull();
    expect(screen.getAllByTestId('message-code-text').some((node) => node.props.children === 'for word in ["2", "3"]:\n    print(word * 2)')).toBe(true);
    expect(screen.getByRole('button', { name: 'Submit redo' })).toBeTruthy();
  });

  it('keeps Mark complete for checkpoints without a reviewed submission type', () => {
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'manual_complete' })} lesson={lesson} />);

    expect(screen.getByRole('button', { name: 'Mark complete' })).toBeTruthy();
    expect(screen.queryByTestId('submission-code-input')).toBeNull();
  });

  it('shows Done for completed GitHub-synced work, but not for reviewed work without a review', () => {
    const synced = renderWithQuery(<LessonContentBlockCard block={checkpoint({ block_type: 'exercise', submission_type: 'prework_github_sync', progress: { status: 'completed', completed_at: null } })} lesson={lesson} />);
    expect(synced.getByText('Done')).toBeTruthy();

    const unreviewed = renderWithQuery(<LessonContentBlockCard block={checkpoint({ progress: { status: 'completed', completed_at: null } })} lesson={lesson} />);
    expect(unreviewed.queryByText('Done')).toBeNull();
  });

  it('does not stack Done over the review status of GitHub-synced work that has a submission', () => {
    const awaiting = renderWithQuery(<LessonContentBlockCard block={checkpoint({ block_type: 'exercise', submission_type: 'prework_github_sync', progress: { status: 'completed', completed_at: null }, submissions: [submission()] })} lesson={lesson} />);
    expect(awaiting.queryByText('Done')).toBeNull();
  });

  it('hides an imported video step that has no video yet', () => {
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ id: 190, block_type: 'video', title: null, body: '', submission_type: 'manual_complete' })} lesson={lesson} />);

    expect(screen.queryByTestId('lesson-block-190')).toBeNull();
  });

  it('does not repeat the lesson title as the block title', () => {
    const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint()} lesson={lesson} />);

    expect(screen.queryByText('Checkpoint 1 — budget decision')).toBeNull();
  });
});

it('keeps instructor solutions readable without student submission controls', () => {
  mockCreateSubmission.mockClear();
  mockIsStaff = true;
  const block = checkpoint({ solution: 'Reference teaching answer', body: 'Read the prompt' });
  const screen = renderWithQuery(<LessonContentBlockCard block={block} lesson={lesson} />);
  expect(screen.getByText('Read the prompt')).toBeTruthy();
  fireEvent.press(screen.getByText('Instructor solution'));
  expect(screen.getByText('Reference teaching answer')).toBeTruthy();
  expect(screen.queryByText('Submit work')).toBeNull();
  expect(mockCreateSubmission).not.toHaveBeenCalled();
  mockIsStaff = false;
});

beforeEach(() => { mockIsStaff = false; mockLoadDraft.mockReset().mockResolvedValue(null); mockSaveDraft.mockClear(); });

const pastLesson = { ...lesson, capabilities: { can_submit: false, read_only: true, support_mode: 'none' as const, support_expires_at: null, access_expires_at: null, support_instructor_id: null } };

it('keeps past-course submissions and feedback readable without a response form', () => {
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submissions: [submission({ grade: 'R', feedback: 'Explain the decision.' })] })} lesson={pastLesson} />);
  expect(screen.getByText('Past course · review only')).toBeTruthy();
  expect(screen.getByText('Explain the decision.')).toBeTruthy();
  expect(screen.getByTestId('submitted-text')).toBeTruthy();
  expect(screen.queryByTestId('submission-code-input')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Submit redo' })).toBeNull();
});

it('disables past-course manual completion and retrieval attempts', () => {
  const manual = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'manual_complete' })} lesson={pastLesson} />);
  expect(manual.queryByRole('button', { name: 'Mark complete' })).toBeNull();
  manual.unmount();
  const recall = renderWithQuery(<LessonContentBlockCard block={checkpoint({ knowledge_check: { id: 1, prompt: 'Choose', options: ['One', 'Two'], attempt_count: 0, latest_attempt: null } as NonNullable<LessonContentBlock['knowledge_check']> })} lesson={pastLesson} />);
  expect(recall.queryByRole('button', { name: 'Check answer' })).toBeNull();
  expect(recall.getAllByRole('radio').every((node) => node.props.accessibilityState.disabled)).toBe(true);
});

it.each([true, false])('plays a past-course video without tracking (hosted=%s)', (hosted) => {
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ block_type: 'video', has_s3_video: hosted, video_url: hosted ? null : 'https://example.com/video.mp4' })} lesson={pastLesson} />);
  expect(screen.getByTestId(hosted ? 'hosted-video' : 'linked-video').props.trackProgress).toBe(false);
});

it('restores all repository draft fields, including optional details', async () => {
  mockLoadDraft.mockResolvedValueOnce({ version: 2, text: '', repo_url: 'https://github.com/me/project', live_url: 'https://example.com', pr_url: 'https://github.com/me/project/pull/1', branch: 'feature/work', commit_sha: 'abc123', notes: 'Please review', base_submission_id: null, base_submission_updated_at: null, saved_at: new Date().toISOString() });
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'repo_and_live_url_submission' })} lesson={lesson} />);
  await waitFor(() => expect(screen.getByLabelText('Repository URL').props.value).toBe('https://github.com/me/project'));
  expect(screen.getByLabelText('Live site URL').props.value).toBe('https://example.com');
  expect(screen.getByLabelText('Pull request URL').props.value).toBe('https://github.com/me/project/pull/1');
  expect(screen.getByLabelText('Branch').props.value).toBe('feature/work');
  expect(screen.getByLabelText('Commit').props.value).toBe('abc123');
  expect(screen.getByLabelText('Notes').props.value).toBe('Please review');
  fireEvent.press(screen.getByLabelText('Discard device draft'));
  expect(screen.getByLabelText('Repository URL').props.value).toBe('');
  expect(screen.getByLabelText('Notes').props.value).toBe('');
});

it('persists a repository and live URL draft when leaving without submitting', async () => {
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'repo_and_live_url_submission' })} lesson={lesson} />);
  await waitFor(() => expect(mockLoadDraft).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText('Repository URL'), 'https://github.com/me/work');
  fireEvent.changeText(screen.getByLabelText('Live site URL'), 'https://example.com');
  fireEvent.press(screen.getByText('Add PR, branch, commit, or notes'));
  fireEvent.changeText(screen.getByLabelText('Branch'), 'test');
  fireEvent.changeText(screen.getByLabelText('Notes'), 'still working');
  screen.unmount();
  await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledWith(4, 204, expect.objectContaining({ repo_url: 'https://github.com/me/work', live_url: 'https://example.com', branch: 'test', notes: 'still working' }), null, null, 2));
});

it('clears the full draft after a successful repository submission and does not restore it on leaving', async () => {
  const clear = jest.requireMock('@/lib/submission-storage').clearSubmissionDraft;
  clear.mockClear(); mockCreateSubmission.mockReset().mockResolvedValue({ submission: { ...submission(), repo_url: 'https://github.com/me/work' } });
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'repo_url_submission' })} lesson={lesson} />);
  await waitFor(() => expect(mockLoadDraft).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText('Repository URL'), 'https://github.com/me/work');
  fireEvent.press(screen.getByLabelText('Submit work'));
  await waitFor(() => expect(screen.getByText('Submitted · your instructor will review it.')).toBeTruthy());
  expect(clear).toHaveBeenCalledWith(4, 204, 2);
  mockSaveDraft.mockClear(); screen.unmount();
  expect(mockSaveDraft).not.toHaveBeenCalled();
});

it('retains an older full draft until explicitly restored or discarded', async () => {
  const draft = { version: 2, text: '', repo_url: 'https://github.com/me/older', live_url: '', pr_url: '', branch: 'old-branch', commit_sha: 'old-sha', notes: 'old notes', base_submission_id: 1, base_submission_updated_at: null, saved_at: new Date().toISOString() };
  mockLoadDraft.mockResolvedValue(draft);
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'repo_url_submission', submissions: [submission({ repo_url: 'https://github.com/me/current' })] })} lesson={lesson} />);
  await waitFor(() => expect(screen.getByText('Restore older device draft')).toBeTruthy());
  expect(screen.getByLabelText('Repository URL').props.value).toBe('https://github.com/me/current');
  fireEvent.press(screen.getByText('Restore older device draft'));
  expect(screen.getByLabelText('Repository URL').props.value).toBe('https://github.com/me/older');
  expect(screen.getByLabelText('Branch').props.value).toBe('old-branch');
  expect(screen.getByLabelText('Notes').props.value).toBe('old notes');
  screen.unmount();
  await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledWith(4, 204, expect.objectContaining({ branch: 'old-branch', notes: 'old notes' }), 9, '2026-10-21T00:00:00Z', 2));
});

it('locks every draft field while a submission is in flight', async () => {
  let complete!: (value: unknown) => void;
  mockCreateSubmission.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'repo_and_live_url_submission' })} lesson={lesson} />);
  await waitFor(() => expect(mockLoadDraft).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText('Repository URL'), 'https://github.com/me/work');
  fireEvent.changeText(screen.getByLabelText('Live site URL'), 'https://example.com');
  fireEvent.press(screen.getByText('Add PR, branch, commit, or notes'));
  fireEvent.press(screen.getByLabelText('Submit work'));
  await waitFor(() => expect(screen.getByLabelText('Repository URL').props.editable).toBe(false));
  for (const label of ['Live site URL', 'Pull request URL', 'Branch', 'Commit', 'Notes']) expect(screen.getByLabelText(label).props.editable).toBe(false);
  expect(screen.getByLabelText('Discard device draft').props.accessibilityState.disabled).toBe(true);
  await act(async () => complete({ submission: submission({ repo_url: 'https://github.com/me/work', live_url: 'https://example.com' }) }));
  await waitFor(() => expect(screen.getByLabelText('Repository URL').props.editable).toBe(true));
});

it('clears an abandoned newer draft after reverting to successfully submitted values', async () => {
  const clear = jest.requireMock('@/lib/submission-storage').clearSubmissionDraft;
  mockCreateSubmission.mockResolvedValue({ submission: submission({ repo_url: 'https://github.com/me/sent' }) });
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'repo_url_submission' })} lesson={lesson} />);
  await waitFor(() => expect(mockLoadDraft).toHaveBeenCalled());
  fireEvent.changeText(screen.getByLabelText('Repository URL'), 'https://github.com/me/sent');
  fireEvent.press(screen.getByLabelText('Submit work'));
  await waitFor(() => expect(screen.getByText('Submitted · your instructor will review it.')).toBeTruthy());
  fireEvent.changeText(screen.getByLabelText('Repository URL'), 'https://github.com/me/abandoned');
  await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledWith(4, 204, expect.objectContaining({ repo_url: 'https://github.com/me/abandoned' }), null, null, 2));
  clear.mockClear(); mockSaveDraft.mockClear();
  fireEvent.changeText(screen.getByLabelText('Repository URL'), 'https://github.com/me/sent');
  screen.unmount();
  await waitFor(() => expect(clear).toHaveBeenCalledWith(4, 204, 2));
  expect(mockSaveDraft).not.toHaveBeenCalled();
});

it('hydrates a pre-capabilities cached lesson read-only, then enables writes after refresh', async () => {
  const cached = { ...lesson, capabilities: undefined };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  queryClients.push(client);
  const key = ['old-cached-lesson'];
  const { hydrate, dehydrate } = jest.requireActual('@tanstack/react-query');
  const source = new QueryClient();
  source.setQueryData(key, { lesson: cached });
  hydrate(client, JSON.parse(JSON.stringify(dehydrate(source))));
  source.clear();
  const restored = client.getQueryData<{ lesson: LessonDetail }>(key)!.lesson;
  const screen = render(<QueryClientProvider client={client}><LessonContentBlockCard block={checkpoint({ submissions: [submission({ grade: 'R', feedback: 'Existing feedback' })] })} lesson={restored} /></QueryClientProvider>);
  expect(screen.getByText('Refreshing…')).toBeTruthy();
  expect(screen.getByText('Submit one clean version of your program.')).toBeTruthy();
  expect(screen.getByText('Existing feedback')).toBeTruthy();
  expect(screen.queryByText('Past course · review only')).toBeNull();
  expect(screen.queryByTestId('submission-code-input')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Update submission' })).toBeNull();
  screen.rerender(<QueryClientProvider client={client}><LessonContentBlockCard block={checkpoint()} lesson={lesson} /></QueryClientProvider>);
  expect(screen.queryByText('Refreshing…')).toBeNull();
  expect(screen.getByTestId('submission-code-input')).toBeTruthy();
});

it.each([true, false])('keeps old cached video playable without progress writes (hosted=%s)', async (hosted) => {
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint({ block_type: 'video', has_s3_video: hosted, video_url: hosted ? null : 'https://example.com/video.mp4' })} lesson={{ ...lesson, capabilities: undefined }} />);
  const player = screen.getByTestId(hosted ? 'hosted-video' : 'linked-video');
  expect(player.props.trackProgress).toBe(false);
  await act(async () => player.props.saveProgress({ last_position_seconds: 3 }));
  expect(screen.getByText('Refreshing…')).toBeTruthy();
});

it('disables manual completion and retrieval on old cached lessons', () => {
  const cached = { ...lesson, capabilities: undefined };
  const manual = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'manual_complete' })} lesson={cached} />);
  expect(manual.queryByRole('button', { name: 'Mark complete' })).toBeNull();
  manual.unmount();
  const recall = renderWithQuery(<LessonContentBlockCard block={checkpoint({ knowledge_check: { id: 1, prompt: 'Choose', options: ['One', 'Two'], attempt_count: 0, latest_attempt: null } as NonNullable<LessonContentBlock['knowledge_check']> })} lesson={cached} />);
  expect(recall.queryByRole('button', { name: 'Check answer' })).toBeNull();
  expect(recall.getAllByRole('radio').every((node) => node.props.accessibilityState.disabled)).toBe(true);
});

it.each(['create', 'update', 'redo', 'progress', 'recall-wrong', 'recall-correct', 'video'])('refreshes all Today and cohort-home variants after %s', async (kind) => {
  mockCreateSubmission.mockResolvedValue({ submission: submission({ id: 10 }) });
  mockUpdateSubmission.mockResolvedValue({ submission: submission() });
  mockProgress.mockResolvedValue({ progress: { status: 'completed' } });
  const check = { id: 1, prompt: 'Choose', options: ['One', 'Two'], attempt_count: 0, latest_attempt: null } as NonNullable<LessonContentBlock['knowledge_check']>;
  mockAttempt.mockResolvedValue({ knowledge_check: { ...check, attempt_count: 1, latest_attempt: { correct: kind === 'recall-correct', selected_option: 0 } }, progress: { status: kind === 'recall-correct' ? 'completed' : 'in_progress' } });
  mockVideoProgress.mockResolvedValue({ video_progress: { completed: true, status: 'completed', last_position: 60, total_watched: 60 } });
  const block = kind === 'video' ? checkpoint({ block_type: 'video', has_s3_video: true })
    : kind.startsWith('recall') ? checkpoint({ knowledge_check: check })
    : kind === 'progress' ? checkpoint({ submission_type: 'manual_complete' })
    : checkpoint({ submissions: kind === 'update' ? [submission()] : kind === 'redo' ? [submission({ grade: 'R' })] : [] });
  const screen = renderWithQuery(<LessonContentBlockCard block={block} lesson={lesson} />);
  const client = queryClients.at(-1)!;
  const keys = [['learning', 4, 'dashboard', 2], ['learning', 4, 'dashboard', 'all'], ['learning', 4, 'weekly-plan', 2], ['learning', 4, 'weekly-plan', 'all'], ['cohort-home', 4, 2]];
  keys.forEach(key => client.setQueryData(key, { saved: true }));
  client.setQueryData(['learning', 99, 'weekly-plan', 2], { otherUser: true });
  if (kind === 'video') await act(async () => { await screen.getByTestId('hosted-video').props.saveProgress({ last_position_seconds: 60 }); });
  else if (kind.startsWith('recall')) {
    fireEvent.press(screen.getAllByRole('radio')[0]);
    fireEvent.press(screen.getByText('Check answer'));
  } else if (kind === 'progress') fireEvent.press(screen.getByRole('button', { name: 'Mark complete' }));
  else {
    fireEvent.changeText(screen.getByTestId('submission-code-input'), 'new answer');
    fireEvent.press(screen.getByRole('button', { name: kind === 'update' ? 'Update submission' : kind === 'redo' ? 'Submit redo' : 'Submit work' }));
  }
  await waitFor(() => keys.forEach(key => expect(client.getQueryState(key)?.isInvalidated).toBe(true)));
  expect(client.getQueryState(['learning', 99, 'weekly-plan', 2])?.isInvalidated).toBe(false);
});

it('disables stale-cohort submission controls and keeps the draft through reconnect', async () => {
  mockCreateSubmission.mockClear();
  const screen = renderWithQuery(<LessonContentBlockCard block={checkpoint()} lesson={lesson} />);
  fireEvent.changeText(screen.getByTestId('submission-code-input'), 'keep my answer');
  mockWritesPaused = true;
  const client = queryClients.at(-1)!;
  screen.rerender(<QueryClientProvider client={client}><LessonContentBlockCard block={checkpoint()} lesson={lesson} /></QueryClientProvider>);
  expect(screen.getByText('Offline — reconnect to submit')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Submit work' })).toBeDisabled();
  expect(screen.getByTestId('submission-code-input').props.editable).toBe(false);
  fireEvent.press(screen.getByRole('button', { name: 'Submit work' }));
  expect(mockCreateSubmission).not.toHaveBeenCalled();
  mockWritesPaused = false;
  screen.rerender(<QueryClientProvider client={client}><LessonContentBlockCard block={checkpoint()} lesson={lesson} /></QueryClientProvider>);
  expect(screen.getByTestId('submission-code-input').props.value).toBe('keep my answer');
  expect(screen.getByRole('button', { name: 'Submit work' })).toBeEnabled();
});

it('disables stale-cohort manual completion, retrieval, and video tracking', async () => {
  mockWritesPaused = true;
  const manual = renderWithQuery(<LessonContentBlockCard block={checkpoint({ submission_type: 'manual_complete' })} lesson={lesson} />);
  expect(manual.getByRole('button', { name: 'Mark complete' })).toBeDisabled(); manual.unmount();
  const recall = renderWithQuery(<LessonContentBlockCard block={checkpoint({ knowledge_check: { id: 1, prompt: 'Choose', options: ['One', 'Two'], attempt_count: 0, latest_attempt: null } as NonNullable<LessonContentBlock['knowledge_check']> })} lesson={lesson} />);
  expect(recall.getAllByRole('radio').every(node => node.props.accessibilityState.disabled)).toBe(true);
  expect(recall.getByText('Check answer')).toBeDisabled(); recall.unmount();
  const video = renderWithQuery(<LessonContentBlockCard block={checkpoint({ block_type: 'video', has_s3_video: true })} lesson={lesson} />);
  expect(video.getByTestId('hosted-video').props.trackProgress).toBe(false);
});
