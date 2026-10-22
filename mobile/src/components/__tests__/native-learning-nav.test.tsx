import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { demoDashboard } from '@/lib/demo-learning';
import { demoStudentProgress } from '@/lib/demo-staff';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { useSession } from '@/providers/session-provider';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? true : () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }), useLocalSearchParams: () => mockParams }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: jest.fn() }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: jest.fn() }));
jest.mock('@/components/native-video-player', () => ({ NativeVideoPlayer: () => null }));
jest.mock('@/components/in-app-media-player', () => ({ InAppMediaPlayer: () => null }));
jest.mock('@/components/contextual-help', () => ({ ContextualHelp: () => null }));
jest.mock('@/components/cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('@/components/staff-curriculum', () => ({ StaffCurriculumLibrary: () => null }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: jest.fn(), openExternalPage: jest.fn() }));
// eslint-disable-next-line import/first
import ModuleScreen from '../../app/(app)/module/[id]';
// eslint-disable-next-line import/first
import LearnScreen from '../../app/(app)/(tabs)/learn';
// eslint-disable-next-line import/first
import StaffStudentScreen from '../../app/(app)/staff/student/[id]';
// eslint-disable-next-line import/first
import ActivityScreen from '../../app/(app)/activity';
// eslint-disable-next-line import/first
import RecordingDetailScreen from '../../app/(app)/recording/[id]';

let client: QueryClient;
let selected = 4;
let loading = false;
const dashboard = jest.fn();
const submissions = jest.fn();
const studentProgress = jest.fn();
const activityEvents = jest.fn();
const recordings = jest.fn();
const recordingProgress = jest.fn();
const lessonVideoProgress = jest.fn();
const supportQueue = jest.fn();
const moduleFixture = demoDashboard.modules![0];
const openLesson = { ...moduleFixture.lessons[0], id: 77, title: 'Find arrays', available: true, completed: false };
const lockedLesson = { ...openLesson, id: 78, title: 'Find locked arrays', available: false, unlock_date: '2026-12-01' };
const progress = { ...demoStudentProgress, cohort: { ...demoStudentProgress.cohort, id: 4 }, modules: [{ ...demoStudentProgress.modules[0], lessons: [{ ...demoStudentProgress.modules[0].lessons[0], blocks: [{ id: 700 }] }] }] };
function mount(element: React.ReactElement) { return render(<QueryClientProvider client={client}>{element}</QueryClientProvider>); }
function session(staff = false) {
  jest.mocked(useSession).mockReturnValue({ user: { id: 1, is_staff: staff }, enrollments: [], api: { dashboard, submissions, studentProgress, activityEvents, recordings, studentRecordingProgress: recordingProgress, studentLessonVideoProgress: lessonVideoProgress, supportQueue } } as unknown as ReturnType<typeof useSession>);
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  selected = 4; loading = false;
  mockParams = { id: String(moduleFixture.id) };
  jest.mocked(useCsgAuth).mockReturnValue({ demo: false } as ReturnType<typeof useCsgAuth>);
  jest.mocked(useCohort).mockImplementation(() => ({ selectedCohortId: loading ? null : selected, selectedCohort: { id: selected, name: `Cohort ${selected}`, cohort_type: 'bootcamp' }, loading, error: null, refresh: jest.fn() }) as unknown as ReturnType<typeof useCohort>);
  dashboard.mockImplementation(async (_signal, cohort) => ({ dashboard: { ...demoDashboard, cohort: { ...demoDashboard.cohort, id: cohort, name: `Cohort ${cohort}` }, modules: [{ ...moduleFixture, name: `Module ${cohort}`, lessons: [openLesson, lockedLesson] }] } }));
  studentProgress.mockResolvedValue(progress);
  submissions.mockResolvedValue({ submissions: [] });
  recordingProgress.mockResolvedValue({ watch_progresses: [] });
  lessonVideoProgress.mockResolvedValue({ lesson_videos: [] });
  supportQueue.mockResolvedValue({ support_queue: { interventions: [] } });
  activityEvents.mockResolvedValue({ activity_events: [], next_before_id: null });
  session();
});
afterEach(() => client.clear());

test('module waits for initialization, switches same-curriculum cohorts, and preserves lesson context', async () => {
  loading = true;
  const screen = mount(<ModuleScreen />);
  expect(dashboard).not.toHaveBeenCalled();
  loading = false;
  screen.rerender(<QueryClientProvider client={client}><ModuleScreen /></QueryClientProvider>);
  await screen.findAllByText('Module 4');
  expect(dashboard).toHaveBeenCalledWith(expect.anything(), 4);
  selected = 9;
  screen.rerender(<QueryClientProvider client={client}><ModuleScreen /></QueryClientProvider>);
  await screen.findAllByText('Module 9');
  expect(screen.queryByText('Module 4')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Open Find arrays' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/lesson/[id]', params: { id: '77', cohort_id: '9' } });
  expect(screen.queryByRole('button', { name: 'Find locked arrays is locked' })).toBeNull();
  expect(dashboard.mock.calls.every(([, cohort]) => cohort === 4 || cohort === 9)).toBe(true);
});
test('module opened from an explicit completed enrollment keeps that cohort', async () => {
  mockParams.cohort_id = '12';
  const screen = mount(<ModuleScreen />);
  await screen.findAllByText('Module 12');
  expect(dashboard).toHaveBeenCalledWith(expect.anything(), 12);
});
test('Learn search shows matching lesson breadcrumbs/status and locked matches, then restores module browsing', async () => {
  loading = true;
  const screen = mount(<LearnScreen />);
  expect(dashboard).not.toHaveBeenCalled();
  loading = false;
  screen.rerender(<QueryClientProvider client={client}><LearnScreen /></QueryClientProvider>);
  await screen.findAllByText('Module 4');
  expect(screen.queryByText('Find arrays')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Search lessons'), 'arrays');
  expect(screen.getByText('Find arrays')).toBeTruthy();
  expect(screen.getByText('Find locked arrays')).toBeTruthy();
  expect(screen.getAllByText('Module 4')).toHaveLength(2);
  expect(screen.getByText('Available to open')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Find locked arrays is locked' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Open Find arrays' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/lesson/[id]', params: { id: '77', cohort_id: '4' } });
  selected = 9;
  screen.rerender(<QueryClientProvider client={client}><LearnScreen /></QueryClientProvider>);
  await screen.findAllByText('Module 9');
  expect(screen.queryByText('Module 4')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Search lessons'), 'not present');
  expect(screen.getByText('No lessons match that search.')).toBeTruthy();
  fireEvent.changeText(screen.getByLabelText('Search lessons'), '');
  fireEvent.press(screen.getByRole('button', { name: 'Open Module 9' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/module/[id]', params: { id: String(moduleFixture.id), cohort_id: '9' } });
});
test('Student Health scopes submissions by resolved cohort and carries it into review and activity', async () => {
  session(true); mockParams = { id: String(progress.user.id) };
  submissions.mockImplementation(async ({ cohort_id }) => ({ submissions: cohort_id === 4 ? [{ id: 800, user_id: progress.user.id, content_block_id: 700, content_block_title: 'Arrays exercise', lesson_title: 'Arrays', grade: null, num_submissions: 1 }] : [{ id: 999, content_block_id: 700, content_block_title: 'Other enrollment work', grade: null, num_submissions: 1 }] }));
  const screen = mount(<StaffStudentScreen />);
  await screen.findByRole('button', { name: 'Review Arrays exercise' });
  expect(submissions).toHaveBeenCalledWith({ user_id: progress.user.id, cohort_id: 4 }, expect.anything());
  expect(recordingProgress).toHaveBeenCalledWith(progress.user.id, 4, expect.anything());
  expect(screen.queryByText('Other enrollment work')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Review Arrays exercise' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/staff/submission/[id]', params: { id: '800', cohort_id: '4', student_id: String(progress.user.id) } });
  fireEvent.press(screen.getByRole('button', { name: `Open activity history for ${progress.user.full_name}` }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/activity', params: { user_id: String(progress.user.id), cohort_id: '4', name: progress.user.full_name } });
});
test('Student Health shows per-section failures instead of false zero counts and retries', async () => {
  session(true); mockParams = { id: String(progress.user.id), cohort_id: '4' };
  submissions.mockRejectedValueOnce(new Error('Submission service offline'));
  recordingProgress.mockRejectedValueOnce(new Error('Player service offline'));
  supportQueue.mockRejectedValueOnce(new Error('Support offline'));
  const screen = mount(<StaffStudentScreen />);
  await screen.findByText('Submissions unavailable');
  expect(screen.getByText('Video activity unavailable')).toBeTruthy();
  expect(screen.getByText('Intervention history unavailable')).toBeTruthy();
  expect(screen.getAllByText('Unavailable')).toHaveLength(3);
  fireEvent.press(screen.getAllByRole('button', { name: 'Try again' })[0]);
  await waitFor(() => expect(screen.queryByText('Submissions unavailable')).toBeNull());
});
const eventBase = { actor: { id: 1, name: 'Learner', role: 'student' }, subject_user_id: 1, cohort_id: 4, cohort_name: 'Cohort 4', record_type: 'ContentBlock', record_id: 700, evidence: 'server_record', created_at: '2026-10-22T00:00:00Z' };
test('Activity scopes categories/pages and opens exact records while retaining its filter', async () => {
  session(true); mockParams = { user_id: '20', cohort_id: '4', name: 'Learner' };
  const events = [
    { ...eventBase, id: 10, event_type: 'submission_created', record_label: 'Exercise', destination: { kind: 'submission', cohort_id: 4, student_id: 20, submission_id: 800 } },
    { ...eventBase, id: 9, event_type: 'video_started', record_label: 'Lesson clip', destination: { kind: 'lesson', cohort_id: 4, student_id: 20, lesson_id: 77, content_block_id: 700 } },
    { ...eventBase, id: 8, event_type: 'recording_started', record_label: 'Class video', destination: { kind: 'recording', cohort_id: 4, student_id: 20, recording_id: 91 } },
    { ...eventBase, id: 7, event_type: 'account_signed_in', destination: null },
    { ...eventBase, id: 6, event_type: 'video_started', record_label: 'Deleted clip', destination: null },
  ];
  activityEvents.mockImplementation(async ({ before_id }) => ({ activity_events: before_id ? [] : events, next_before_id: before_id ? null : 6 }));
  const screen = mount(<ActivityScreen />);
  await screen.findByRole('button', { name: 'Open Exercise' });
  fireEvent.press(screen.getByRole('button', { name: 'Work' }));
  await waitFor(() => expect(activityEvents).toHaveBeenLastCalledWith({ user_id: 20, cohort_id: 4, category: 'work', before_id: undefined }, expect.anything()));
  await screen.findByRole('button', { name: 'Open Exercise' });
  fireEvent.press(screen.getByRole('button', { name: 'Open Exercise' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/staff/submission/[id]', params: { id: '800', cohort_id: '4', student_id: '20' } });
  fireEvent.press(screen.getByRole('button', { name: 'Open Lesson clip' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/lesson/[id]', params: { id: '77', cohort_id: '4', block_id: '700' } });
  fireEvent.press(screen.getByRole('button', { name: 'Open Class video' }));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/recording/[id]', params: { id: 'recording-91', cohort_id: '4' } });
  expect(screen.queryByRole('button', { name: /Signed in|Deleted clip/ })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Show earlier activity' }));
  await waitFor(() => expect(activityEvents).toHaveBeenLastCalledWith({ user_id: 20, cohort_id: 4, category: 'work', before_id: 6 }, expect.anything()));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Show earlier activity' })).toBeNull());
  expect(screen.getByRole('button', { name: 'Work' }).props.accessibilityState.selected).toBe(true);
});

test('recording activity can load an explicitly routed past cohort without an unscoped library request', async () => {
  session(true); mockParams = { id: 'recording-91', cohort_id: '9' };
  recordings.mockResolvedValue({ items: [{ id: 91, item_key: 'recording-91', cohort_id: 9, cohort_name: 'Completed course', title: 'Past recording', source: 'youtube', url: 'https://youtu.be/abc123def45' }] });
  const screen = mount(<RecordingDetailScreen />);
  await screen.findByText('Past recording');
  expect(recordings).toHaveBeenCalledWith(expect.anything(), 9);
  expect(client.getQueryData(['learning', 1, 'recordings', 9])).toBeTruthy();
  expect(client.getQueryData(['learning', 1, 'recordings'])).toBeUndefined();
});
