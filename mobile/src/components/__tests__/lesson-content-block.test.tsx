import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';

import type { LessonContentBlock, LessonDetail, SubmissionBrief } from '@/lib/types';

let mockIsStaff = false;
const mockCreateSubmission = jest.fn();
const mockUpdateSubmission = jest.fn();
const mockSaveDraft = jest.fn().mockResolvedValue(undefined);
const mockLoadDraft = jest.fn().mockResolvedValue(null);

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/analytics', () => ({ analyticsAgeBucket: () => 'recent', analyticsLanguage: () => 'other', captureProductEvent: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openExternalPage: jest.fn(), openAuthenticatedWebLesson: jest.fn() }));
jest.mock('@/lib/submission-storage', () => ({
  clearSubmissionDraft: jest.fn().mockResolvedValue(undefined),
  loadSubmissionDraft: (...args: unknown[]) => mockLoadDraft(...args),
  saveSubmissionDraft: (...args: unknown[]) => mockSaveDraft(...args),
  submissionDraftMatches: () => true,
}));
jest.mock('../native-video-player', () => ({ NativeVideoPlayer: () => null }));
jest.mock('../in-app-media-player', () => ({ InAppMediaPlayer: () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({
  useSession: () => ({ api: { createSubmission: mockCreateSubmission, updateSubmission: mockUpdateSubmission, updateProgress: jest.fn() }, user: { id: 4, is_staff: mockIsStaff, full_name: 'Maria Santos' } }),
}));

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { CODE_INPUT_PROPS, LessonContentBlockCard } from '../lesson-content-block';

const lesson = { id: 138, title: 'Checkpoint 1 — budget decision', cohort_id: 2, module_id: 2, requires_github: false, content_blocks: [] } as unknown as LessonDetail;

function checkpoint(overrides: Partial<LessonContentBlock> = {}): LessonContentBlock {
  return { id: 204, block_type: 'checkpoint', position: 0, title: 'Checkpoint 1 — budget decision', body: 'Submit one clean version of your program.', video_url: null, filename: 'budget_decision.py', submission_type: 'text_submission', metadata: {}, submissions: [], ...overrides };
}

function submission(overrides: Partial<SubmissionBrief> = {}): SubmissionBrief {
  return { id: 9, text: 'amount = 100\nif amount == 100:\n    print("On budget")', grade: null, feedback: null, graded_at: null, num_submissions: 1, created_at: '2026-10-21T00:00:00Z', updated_at: '2026-10-21T00:00:00Z', ...overrides };
}

const queryClients: QueryClient[] = [];
beforeEach(() => { jest.useFakeTimers({ doNotFake: ['performance'] }); mockIsStaff = false; });
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
    expect(mockSaveDraft).toHaveBeenCalledWith(4, 204, 'my revised draft', 9, '2026-10-21T00:00:00Z', 2);
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
