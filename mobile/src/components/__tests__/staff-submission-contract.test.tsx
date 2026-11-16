jest.mock('expo-router/react-navigation', () => ({ usePreventRemove: jest.fn() }));
import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { themedAlert } from '@/lib/alerts';
import { demoStaffSubmissions } from '@/lib/demo-staff';
import StaffSubmissionScreen from '../../app/(app)/staff/submission/[id]';

const mockPush = jest.fn();
const mockApi = { submission: jest.fn(), feedbackSnippets: jest.fn(), gradeSubmission: jest.fn() };
let mockRole = 'instructor';
const mockMarkSent = jest.fn();
jest.mock('@/components/ui/pressable-scale', () => ({ PressableScale: jest.requireActual('react-native').Pressable }));
jest.mock('expo-router', () => ({ useNavigation: () => ({ dispatch: jest.fn() }), usePathname: () => '/', useLocalSearchParams: () => ({ id: '41' }), useRouter: () => ({ canGoBack: () => false, push: mockPush, replace: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: { id: 7, is_staff: true, role: mockRole, is_admin: mockRole === 'admin' } }) }));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ captureProductEvent: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: jest.fn(), openExternalPage: jest.fn() }));
jest.mock('@/lib/alerts', () => ({ themedAlert: { alert: jest.fn() } }));
jest.mock('@/lib/submission-storage', () => ({ loadGradingDraft: jest.fn().mockResolvedValue(null), saveGradingDraft: jest.fn().mockResolvedValue(undefined), clearGradingDraft: jest.fn().mockResolvedValue(undefined), gradingDraftMatches: jest.fn() }));
jest.mock('@/hooks/use-voice-draft', () => ({ useVoiceDraft: () => ({ state: 'idle', markSent: mockMarkSent }) }));
jest.mock('@/components/voice-draft-controls', () => ({ VoiceDraftButton: () => null, VoiceDraftPanel: () => null }));
jest.mock('@/components/message-code-block', () => ({ MessageCodeBlock: () => null }));
jest.mock('@/components/authored-content', () => ({ AuthoredContent: () => null }));
const clients: QueryClient[] = [];
beforeEach(() => { jest.clearAllMocks(); notifyManager.setScheduler((callback) => callback()); });
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; notifyManager.setScheduler((callback) => setTimeout(callback, 0)); });

it('requires rubric ratings and sends the complete server contract from the native staff screen', async () => {
  const submission = { ...demoStaffSubmissions[0], id: 41, latest_submission_id: 41, grade: null, feedback: null, updated_at: '2026-10-22T00:00:00.123456Z', rubric: { id: 1, title: 'Quality', description: null, criteria: [{ id: 12, title: 'Correctness', description: 'Cases pass', position: 0, rating: null, feedback: null }] } };
  mockApi.submission.mockResolvedValue({ submission });
  mockApi.feedbackSnippets.mockResolvedValue({ feedback_snippets: [] });
  mockApi.gradeSubmission.mockResolvedValue({ submission: { ...submission, grade: 'A', feedback: 'Reviewed voice draft' } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const screen = render(<QueryClientProvider client={client}><StaffSubmissionScreen /></QueryClientProvider>);
  await act(async () => {});
  await act(async () => { fireEvent.press(screen.getByLabelText('Select grade A')); });
  await act(async () => { fireEvent.press(screen.getByLabelText('Save grade A')); });
  expect(themedAlert.alert).toHaveBeenCalledWith('Complete the rubric', 'Rate every criterion before saving an A, B, or C. A redo only needs written feedback.');
  expect(mockApi.gradeSubmission).not.toHaveBeenCalled();
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Meets' })); });
  fireEvent.changeText(screen.getByLabelText('Feedback for Correctness'), 'Cases pass');
  fireEvent.changeText(screen.getByLabelText('Feedback for student'), 'Reviewed voice draft');
  await act(async () => { fireEvent.press(screen.getByLabelText('Save grade A')); });
  expect(mockApi.gradeSubmission).toHaveBeenCalledWith(41, 'A', 'Reviewed voice draft', submission.updated_at, [{ rubric_criterion_id: 12, rating: 'meets', feedback: 'Cases pass' }]);
  expect(mockMarkSent).toHaveBeenCalledWith('Reviewed voice draft');
});

it.each(['admin', 'instructor'])('refuses a redo with no written feedback for %s', async (role) => {
  mockRole = role;
  const submission = { ...demoStaffSubmissions[0], id: 41, latest_submission_id: 41, grade: null, feedback: null, rubric: null, updated_at: '2026-10-22T00:00:00.123456Z' };
  mockApi.submission.mockResolvedValue({ submission });
  mockApi.feedbackSnippets.mockResolvedValue({ feedback_snippets: [] });
  mockApi.gradeSubmission.mockResolvedValue({ submission: { ...submission, grade: 'R' } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const screen = render(<QueryClientProvider client={client}><StaffSubmissionScreen /></QueryClientProvider>);
  await act(async () => {});
  expect(screen.getByText('A redo needs written feedback so the student knows what to change. Passing grades may include concise feedback.')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Request redo'));
  await act(async () => { fireEvent.press(screen.getByLabelText('Save redo request')); });
  // A redo needs written feedback (U-0.4): no way to send one without it.
  expect(mockApi.gradeSubmission).not.toHaveBeenCalled();
  expect(themedAlert.alert).toHaveBeenCalledWith('Add feedback first', 'Write feedback before choosing Redo, so the student knows what to change.');
});

// The server refuses a Redo without written feedback (422, W7 PR 7.3 fix round 1). If one gets
// through (an older build, or feedback the server reads as blank), the review shows the
// server's message and keeps the grade, the feedback and the draft.
it('shows the server refusal of a blank redo and keeps the review', async () => {
  const submission = { ...demoStaffSubmissions[0], id: 41, latest_submission_id: 41, grade: null, feedback: null, rubric: null, updated_at: '2026-10-22T00:00:00.123456Z' };
  mockApi.submission.mockResolvedValue({ submission });
  mockApi.feedbackSnippets.mockResolvedValue({ feedback_snippets: [] });
  const { ApiError } = jest.requireActual('@/lib/api');
  const message = 'Write feedback before choosing Redo, so the student knows what to change.';
  mockApi.gradeSubmission.mockRejectedValue(new ApiError(message, 422));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const screen = render(<QueryClientProvider client={client}><StaffSubmissionScreen /></QueryClientProvider>);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Request redo'));
  fireEvent.changeText(screen.getByLabelText('Feedback for student'), 'Look again');
  const storage = jest.requireMock('@/lib/submission-storage');
  storage.clearGradingDraft.mockClear();
  await act(async () => { fireEvent.press(screen.getByLabelText('Save redo request')); });
  expect(mockApi.gradeSubmission).toHaveBeenCalledTimes(1);
  expect(themedAlert.alert).toHaveBeenCalledWith('Could not save grade', message);
  expect(screen.getByLabelText('Save redo request')).toBeTruthy();
  expect(screen.getByLabelText('Feedback for student').props.value).toBe('Look again');
  expect(storage.clearGradingDraft).not.toHaveBeenCalled();
  expect(mockMarkSent).not.toHaveBeenCalled();
});

it('lets a redo with written feedback skip the rubric, and keeps unrated comments from being dropped', async () => {
  const submission = { ...demoStaffSubmissions[0], id: 41, latest_submission_id: 41, grade: null, feedback: null, updated_at: '2026-10-22T00:00:00.123456Z', rubric: { id: 1, title: 'Quality', description: null, criteria: [{ id: 12, title: 'Correctness', description: 'Cases pass', position: 0, rating: null, feedback: null }] } };
  mockApi.submission.mockResolvedValue({ submission });
  mockApi.feedbackSnippets.mockResolvedValue({ feedback_snippets: [] });
  mockApi.gradeSubmission.mockResolvedValue({ submission: { ...submission, grade: 'R', feedback: 'Trace the loop first' } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const screen = render(<QueryClientProvider client={client}><StaffSubmissionScreen /></QueryClientProvider>);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Request redo'));
  fireEvent.changeText(screen.getByLabelText('Feedback for student'), 'Trace the loop first');
  fireEvent.changeText(screen.getByLabelText('Feedback for Correctness'), 'Unrated note');
  await act(async () => { fireEvent.press(screen.getByLabelText('Save redo request')); });
  expect(themedAlert.alert).toHaveBeenCalledWith('Rate the commented criteria', expect.stringContaining('or clear those comments'));
  expect(mockApi.gradeSubmission).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Feedback for Correctness'), '');
  await act(async () => { fireEvent.press(screen.getByLabelText('Save redo request')); });
  expect(themedAlert.alert).not.toHaveBeenCalledWith('Complete the rubric', expect.anything());
  expect(mockApi.gradeSubmission).toHaveBeenCalledWith(41, 'R', 'Trace the loop first', submission.updated_at, []);
});

it('retains Back while a submission loads and after failure', async () => {
  mockApi.submission.mockImplementation(() => new Promise(() => {}));
  mockApi.feedbackSnippets.mockResolvedValue({ feedback_snippets: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const screen = render(<QueryClientProvider client={client}><StaffSubmissionScreen /></QueryClientProvider>);
  expect(screen.getByRole('button', { name: /Back to/ })).toBeTruthy();
  mockApi.submission.mockRejectedValue(new Error('Synthetic submission failure'));
  await act(async () => { await client.resetQueries(); });
  expect(screen.getByText('Synthetic submission failure')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Back to/ })).toBeTruthy();
});

it('links the submission lesson title to its native lesson', async () => {
  const submission = { ...demoStaffSubmissions[0], id: 41, lesson_id: 42 };
  mockApi.submission.mockResolvedValue({ submission });
  mockApi.feedbackSnippets.mockResolvedValue({ feedback_snippets: [] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client);
  const screen = render(<QueryClientProvider client={client}><StaffSubmissionScreen /></QueryClientProvider>);
  fireEvent.press(await screen.findByRole('link', { name: `Open lesson: ${submission.lesson_title}` }));
  expect(mockPush).toHaveBeenCalledWith('/lesson/42');
});
