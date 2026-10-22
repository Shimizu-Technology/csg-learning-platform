import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ScrollView } from 'react-native';
import LessonScreen from '../../app/(app)/lesson/[id]';

let mockConnected = true;
const mockLesson = jest.fn();
const mockSubmit = jest.fn();
const mockVideoProgress = jest.fn();
const mockSaveDraft = jest.fn().mockResolvedValue(undefined);
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-network', () => ({ useNetworkState: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: '138', cohort_id: '2' }), useRouter: () => ({ back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: { lesson: mockLesson, createSubmission: mockSubmit, updateContentVideoProgress: mockVideoProgress }, user: { id: 4, is_staff: false } }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ cohorts: [{ id: 2 }], selectedCohortId: 2, loading: false, stale: false, error: null }) }));
jest.mock('@/lib/analytics', () => ({ analyticsAgeBucket: () => 'recent', captureProductEvent: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebLesson: jest.fn() }));
jest.mock('@/lib/submission-storage', () => ({ ...jest.requireActual('@/lib/submission-storage'), loadSubmissionDraft: jest.fn().mockResolvedValue(null), clearSubmissionDraft: jest.fn().mockResolvedValue(undefined), saveSubmissionDraft: (...args: unknown[]) => mockSaveDraft(...args) }));
jest.mock('@/components/staff-curriculum-management', () => ({ LessonSettingsModal: () => null }));
jest.mock('@/components/lesson-objectives', () => ({ LessonObjectives: () => null }));
jest.mock('@/components/rubric-panel', () => ({ RubricPanel: () => null }));
jest.mock('@/components/contextual-help', () => ({ ContextualHelp: () => null }));
jest.mock('@/components/native-video-player', () => ({ NativeVideoPlayer: (props: object) => jest.requireActual('react').createElement(jest.requireActual('react-native').View, { testID: 'video', ...props }) }));
jest.mock('@/components/in-app-media-player', () => ({ InAppMediaPlayer: () => null }));

jest.mock('@/lib/focus-scroll-target', () => ({ focusScrollTarget: jest.fn() }));
jest.setTimeout(30000);
const base = { position: 0, body: '', metadata: {}, submissions: [] };
const savedLesson = { id: 138, cohort_id: 2, module_id: 2, title: 'Connectivity lesson', lesson_type: 'exercise', requires_github: false, capabilities: { can_submit: true, read_only: false }, content_blocks: [
  { ...base, id: 1, block_type: 'checkpoint', title: 'Submit', submission_type: 'text_submission' },
  { ...base, id: 2, block_type: 'checkpoint', title: 'Complete', submission_type: 'manual_complete' },
  { ...base, id: 3, block_type: 'checkpoint', title: 'Recall', knowledge_check: { id: 1, prompt: 'Choose', options: ['One', 'Two'], attempt_count: 0, latest_attempt: null } },
  { ...base, id: 4, block_type: 'video', title: 'Watch', has_s3_video: true },
] };
let client: QueryClient;
beforeEach(() => { mockConnected = true; jest.clearAllMocks(); mockLesson.mockResolvedValue({ lesson: savedLesson }); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); });
it('pauses every write after online lesson refresh fails and restores the draft after successful reconnect refetch', async () => {
  const screen = render(<QueryClientProvider client={client}><LessonScreen /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark complete' })).toBeEnabled());
  fireEvent.changeText(screen.getByTestId('submission-code-input'), 'keep my work');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Submit work' })).toBeEnabled());
  fireEvent.press(screen.getAllByRole('radio')[0]);
  mockConnected = false;
  mockLesson.mockRejectedValue(new Error('Network unavailable'));
  screen.rerender(<QueryClientProvider client={client}><LessonScreen /></QueryClientProvider>);
  await act(async () => { await screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(screen.getByText('Showing the saved lesson. Changes need a connection.')).toBeTruthy());
  expect(screen.getAllByText('Offline — reconnect to submit')).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Submit work' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Mark complete' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Check answer' })).toBeDisabled();
  expect(screen.getAllByRole('radio').every(node => node.props.accessibilityState.disabled)).toBe(true);
  expect(screen.getByTestId('video').props.trackProgress).toBe(false);
  fireEvent.press(screen.getByRole('button', { name: 'Submit work' }));
  expect(mockSubmit).not.toHaveBeenCalled();
  await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledWith(4, 1, expect.objectContaining({ text: 'keep my work' }), null, null, 2));
  mockConnected = true;
  screen.rerender(<QueryClientProvider client={client}><LessonScreen /></QueryClientProvider>);
  expect(screen.getByRole('button', { name: 'Submit work' })).toBeDisabled();
  mockLesson.mockResolvedValue({ lesson: savedLesson });
  await act(async () => { await screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(screen.queryByText('Showing the saved lesson. Changes need a connection.')).toBeNull());
  expect(screen.getByTestId('submission-code-input').props.value).toBe('keep my work');
  expect(screen.getByRole('button', { name: 'Submit work' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Mark complete' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Check answer' })).toBeEnabled();
  expect(screen.getByTestId('video').props.trackProgress).toBe(true);
});

it('keeps writes paused when an earlier heartbeat updates the cache after a failed refresh', async () => {
  let finishHeartbeat!: (value: unknown) => void;
  mockVideoProgress.mockImplementation(() => new Promise(resolve => { finishHeartbeat = resolve; }));
  const screen = render(<QueryClientProvider client={client}><LessonScreen /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByTestId('video').props.trackProgress).toBe(true));
  const previousSave = screen.getByTestId('video').props.saveProgress;
  let heartbeat!: Promise<void>;
  act(() => { heartbeat = previousSave({ last_position_seconds: 12, total_watched_seconds: 12, duration_seconds: 100 }); });
  mockLesson.mockRejectedValue(new Error('Refresh failed'));
  await act(async () => { screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark complete' })).toBeDisabled());
  await act(async () => {
    finishHeartbeat({ video_progress: { status: 'in_progress', completed: false, last_position: 12, total_watched: 12 } });
    await heartbeat;
  });
  await waitFor(() => expect(screen.getByTestId('video').props.initialPosition).toBe(12));
  expect(screen.getByText('Showing the saved lesson. Changes need a connection.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Mark complete' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Submit work' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Check answer' })).toBeDisabled();
  expect(screen.getByTestId('video').props.trackProgress).toBe(false);
  await act(async () => { await previousSave({ last_position_seconds: 13, total_watched_seconds: 13, duration_seconds: 100 }); });
  expect(mockVideoProgress).toHaveBeenCalledTimes(1);
  mockLesson.mockResolvedValue({ lesson: savedLesson });
  await act(async () => { screen.UNSAFE_getByType(ScrollView).props.refreshControl.props.onRefresh(); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Mark complete' })).toBeEnabled());
  expect(screen.getByTestId('video').props.trackProgress).toBe(true);
});
