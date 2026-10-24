import type { SessionEnrollment } from '@/lib/types';
import { ApiError } from '@/lib/api';
import { learningKeys } from '@/lib/learning';
import { parseCachedSession, serializeCachedSession } from '@/lib/session-access';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CohortProvider, useCohort } from '@/providers/cohort-provider';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type PropsWithChildren } from 'react';
import { AppState, Text } from 'react-native';
import ActivityScreen from '../../app/(app)/activity';
import UpdatesScreen from '../../app/(app)/(tabs)/updates';
import SupportScreen from '../../app/(app)/staff/support/[id]';
import LessonScreen from '../../app/(app)/lesson/[id]';
import ModuleScreen from '../../app/(app)/module/[id]';
import RecordingDetailScreen from '../../app/(app)/recording/[id]';
import GradingScreen from '../../app/(app)/staff/grading';

jest.mock('expo-network', () => ({ useNetworkState: () => ({ isConnected: true, isInternetReachable: true }), addNetworkStateListener: jest.fn(() => ({ remove: jest.fn() })) }));
const realNow = Date.now;

let mockParams: Record<string, string> = {};
let mockStaff = false;
let mockEnrollments: SessionEnrollment[] = [];
let mockUseRealCohort = false;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
const mockSelect = jest.fn();
const mockHandoff = jest.fn();
const mockFocusTarget = jest.fn();
jest.mock('@/lib/focus-scroll-target', () => ({ focusScrollTarget: (...args: unknown[]) => mockFocusTarget(...args) }));
const mockApi = { setCohortContextReadOnly: jest.fn(), activityEvents: jest.fn(), accessibleCohorts: jest.fn(), lesson: jest.fn(), recordings: jest.fn(), submissions: jest.fn(), announcements: jest.fn(), notifications: jest.fn(), announcement: jest.fn(), dashboard: jest.fn(), helpRequest: jest.fn() };
jest.mock('expo-router', () => ({ useFocusEffect: () => {}, useLocalSearchParams: () => mockParams, useGlobalSearchParams: () => mockParams, usePathname: () => '/updates', useRouter: () => mockRouter }));
jest.mock('@/providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: [] }) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: { id: 9, is_staff: mockStaff }, enrollments: mockEnrollments }) }));
jest.mock('@react-native-async-storage/async-storage', () => require('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/providers/cohort-provider', () => {
  const actual = jest.requireActual('@/providers/cohort-provider');
  return { ...actual, useCohort: () => mockUseRealCohort ? actual.useCohort() : ({ cohorts: [{ id: 2 }, { id: 3 }], selectedCohortId: 3, loading: false, selectCohort: mockSelect }) };
});
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: (...args: unknown[]) => mockHandoff(...args) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('@/components/lesson-content-block', () => ({ LessonContentBlockCard: () => null }));
jest.mock('@/components/lesson-objectives', () => ({ LessonObjectives: () => null }));
jest.mock('@/components/rubric-panel', () => ({ RubricPanel: () => null }));
jest.mock('@/components/staff-curriculum-management', () => ({ LessonSettingsModal: () => null }));
jest.mock('@/components/native-video-player', () => ({ NativeVideoPlayer: () => null }));
jest.mock('@/components/in-app-media-player', () => ({ InAppMediaPlayer: () => null }));
jest.mock('@/components/contextual-help', () => ({ ContextualHelp: (props: object) => jest.requireActual('react').createElement(jest.requireActual('react-native').View, { testID: 'recording-help', ...props }) }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {} }));
const clients: QueryClient[] = [];
afterEach(() => { clients.forEach(client => client.clear()); clients.length = 0; });
function Wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  jest.clearAllMocks(); mockApi.dashboard.mockResolvedValue({ dashboard: { enrolled: false } }); mockEnrollments = []; mockStaff = false; mockParams = {}; mockUseRealCohort = false;
  mockSelect.mockResolvedValue(undefined); mockHandoff.mockResolvedValue(undefined);
  mockApi.lesson.mockResolvedValue({ lesson: { id: 42, cohort_id: 2, module_id: 1, title: 'Source lesson', lesson_type: 'exercise', content_blocks: [{ id: 8, block_type: 'exercise', position: 0, submissions: [] }], objectives: [] } });
  mockApi.announcements.mockResolvedValue({ announcements: [], unread_count: 0, meta: { page: 1, per_page: 50, total_count: 0, total_pages: 0, has_next_page: false, has_prev_page: false } });
  mockApi.notifications.mockResolvedValue({ notifications: [], unread_count: 0, meta: { page: 1, per_page: 50, total_count: 0, total_pages: 0, has_next_page: false, has_prev_page: false } });
  mockApi.submissions.mockResolvedValue({ submissions: [] });
});
it('uses the source cohort before querying and highlights the notified exercise', async () => {
  mockParams = { id: '42', cohort_id: '2', block_id: '8' };
  const screen = render(<LessonScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Opened from your update')).toBeTruthy());
  expect(mockApi.lesson).toHaveBeenCalledWith(42, expect.anything(), 2);

  expect(screen.getByTestId('lesson-block-8')).toBeTruthy();
});
it('shows inaccessible cohort recovery without fetching under the selected cohort', () => {
  mockParams = { id: '42', cohort_id: '99', block_id: '8' };
  const screen = render(<LessonScreen />, { wrapper: Wrapper });
  expect(screen.getByText(/do not have access to the cohort/)).toBeTruthy();
  expect(mockApi.lesson).not.toHaveBeenCalled();
});
it('keeps old lesson links scoped to the current cohort', async () => {
  mockParams = { id: '42' };
  const screen = render(<LessonScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Source lesson')).toBeTruthy());
  expect(mockApi.lesson).toHaveBeenCalledWith(42, expect.anything(), 3);
});
it.each(['9', 'legacy-2-1'])('opens the exact recording %s across cohorts', async (id) => {
  mockParams = { id, cohort_id: '2' };
  mockApi.recordings.mockResolvedValue({ items: [{ id, item_key: id, cohort_id: 2, title: 'Exact recording', source: 'external', url: 'https://example.com/video' }, { id: 8, item_key: 'recording-8', cohort_id: 3, title: 'Other recording', source: 'uploaded' }] });
  const screen = render(<RecordingDetailScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Exact recording')).toBeTruthy());
  expect(screen.queryByText('Other recording')).toBeNull();
});
it('preserves the queue resolved cohort in full grading handoff', async () => {
  mockStaff = true; mockParams = { cohort_id: '2' };
  const screen = render(<GradingScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Open full grading')).toBeTruthy());
  fireEvent.press(screen.getByText('Open full grading'));
  expect(mockHandoff).toHaveBeenCalledWith(mockApi, '/admin/grading?cohort_id=2');
});

it('fetches a routed announcement outside the selected cohort feed and opens its detail', async () => {
  mockParams = { announcement_id: '80' };
  mockApi.announcement.mockResolvedValue({ announcement: { id: 80, title: 'Exact old announcement', body: 'Read this exact notice', cohort_id: 2, audience: 'cohort', status: 'published', read_at: '2026-10-22' } });
  const screen = render(<UpdatesScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Exact old announcement')).toBeTruthy());
  expect(mockApi.announcement).toHaveBeenCalledWith(80);
  expect(mockRouter.setParams).toHaveBeenCalledWith({ announcement_id: undefined });
});
it.each([['primary', 9, '/recording/9?cohort_id=2'], ['legacy', 0, '/recording/legacy-2-1?cohort_id=2']])('opens old %s recording help directly in native', async (source, id, path) => {
  mockStaff = true; mockParams = { id: '41' };
  mockApi.helpRequest.mockResolvedValue({ help_request: { id: 41, cohort: { id: 2, name: 'Source cohort' }, context_type: 'recording', context_source: source, context_id: id, context_path: '/recordings', context_label: 'Recording question', status: 'resolved', category: 'concept', urgency: 'normal', created_at: '2026-10-22', message: 'Help' } });
  const screen = render(<SupportScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Open learning context')).toBeTruthy());
  fireEvent.press(screen.getByText('Open learning context'));
  expect(mockRouter.push).toHaveBeenCalledWith(path);
  expect(mockHandoff).not.toHaveBeenCalled();
});

it('resolves a legacy recording link after promotion to a first-class recording', async () => {
  mockParams = { id: 'legacy-2-1', cohort_id: '2' };
  mockApi.recordings.mockResolvedValue({ items: [{ id: 9, item_key: 'recording-9', legacy_item_key: 'legacy-2-1', cohort_id: 2, title: 'Promoted recording', source: 'external', url: 'https://example.com/video' }] });
  const screen = render(<RecordingDetailScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Promoted recording')).toBeTruthy());
});

it('runs the lesson layout callback with native refs and completes focus only after measurement succeeds', async () => {
  mockParams = { id: '42', cohort_id: '2', block_id: '8' };
  const node = { measureLayout: jest.fn() };
  const screen = render(<LessonScreen />, { wrapper: Wrapper, createNodeMock: () => node });
  await waitFor(() => expect(screen.getByTestId('lesson-block-8')).toBeTruthy());
  const block = screen.getByTestId('lesson-block-8');
  const layout = { nativeEvent: { layout: { x: 0, y: 200, width: 300, height: 100 } } };
  fireEvent(block, 'layout', layout);
  expect(mockFocusTarget).toHaveBeenCalledTimes(1);
  expect(typeof mockFocusTarget.mock.calls[0][0].measureLayout).toBe('function');
  expect(Object.keys(mockFocusTarget.mock.calls[0][2])).toContain('current');
  fireEvent(block, 'layout', layout);
  expect(mockFocusTarget).toHaveBeenCalledTimes(2);
  mockFocusTarget.mock.calls[1][3]();
  fireEvent(block, 'layout', layout);
  expect(mockFocusTarget).toHaveBeenCalledTimes(2);
});


it('lets the provider synchronize an Updates link and notice before the screen clears its cohort parameter', async () => {
  mockUseRealCohort = true;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('csg.cohort.active.9', '3');
  mockApi.accessibleCohorts.mockResolvedValue({ cohorts: [{ id: 2, name: 'Linked cohort', status: 'active' }, { id: 3, name: 'Previous cohort', status: 'active' }] });
  mockRouter.setParams.mockImplementation((params) => { mockParams = { ...mockParams, ...params }; });
  const screen = render(<CohortProvider><UpdatesScreen /></CohortProvider>, { wrapper: Wrapper });
  try {
    await waitFor(() => expect(mockApi.announcements).toHaveBeenCalledWith(expect.objectContaining({ cohort_id: 3 })));
    mockParams = { cohort_id: '2' };
    screen.rerender(<CohortProvider><UpdatesScreen /></CohortProvider>);
    await waitFor(() => expect(mockRouter.setParams).toHaveBeenCalledWith({ cohort_id: undefined }));
    await act(async () => {});
    expect(screen.getByText('Switched to Linked cohort')).toBeTruthy();
    expect(await AsyncStorage.getItem('csg.cohort.active.9')).toBe('2');
    expect(mockApi.announcements).toHaveBeenLastCalledWith(expect.objectContaining({ cohort_id: 2 }));
  } finally {
    screen.unmount();
    mockRouter.setParams.mockReset();
  }
});

function SelectedCohort() {
  const { selectedCohortId } = useCohort();
  return <Text testID="selected-cohort">{selectedCohortId}</Text>;
}

function ActivityDestinationJourney() {
  const [path, setPath] = useState('/activity');
  useEffect(() => {
    mockRouter.push.mockImplementation((destination: string) => {
      const url = new URL(destination, 'https://csg.test');
      mockParams = { ...Object.fromEntries(url.searchParams), id: url.pathname.split('/').at(-1)! };
      setPath(url.pathname);
    });
  }, []);
  return <CohortProvider><SelectedCohort />{path.startsWith('/lesson/') ? <LessonScreen /> : path.startsWith('/recording/') ? <RecordingDetailScreen /> : <ActivityScreen />}</CohortProvider>;
}

it.each(['lesson', 'recording'])('opens an activity %s destination while another cohort is selected and persists the switch', async (kind) => {
  mockUseRealCohort = true;
  await AsyncStorage.clear();
  await AsyncStorage.setItem('csg.cohort.active.9', '3');
  mockApi.accessibleCohorts.mockResolvedValue({ cohorts: [{ id: 2, name: 'Linked cohort', status: 'active' }, { id: 3, name: 'Previous cohort', status: 'active' }] });
  mockApi.activityEvents.mockResolvedValue({ activity_events: [{ id: 1, event_type: kind === 'lesson' ? 'video_started' : 'recording_started', actor: { id: 9 }, subject_user_id: 9, cohort_id: 2, record_label: 'Linked activity', created_at: '2026-10-22', destination: { kind, cohort_id: 2, student_id: 9, lesson_id: 42, content_block_id: 8, recording_id: 9, destination_path: kind === 'lesson' ? '/lessons/42?cohort_id=2#block-8' : '/recordings?cohort_id=2&recording=9' } }], next_before_id: null });
  mockApi.recordings.mockResolvedValue({ items: [
    { id: 9, item_key: 'recording-9', cohort_id: 3, title: 'Wrong cohort recording', source: 'uploaded' },
    { id: 8, item_key: 'recording-8', cohort_id: 2, title: 'First recording', source: 'uploaded' },
    { id: 9, item_key: 'recording-9', cohort_id: 2, title: 'Exact activity recording', source: 'uploaded' },
  ] });
  const screen = render(<ActivityDestinationJourney />, { wrapper: Wrapper, createNodeMock: () => ({ measureLayout: jest.fn() }) });
  try {
    await waitFor(() => expect(screen.getByTestId('selected-cohort').props.children).toBe(3));
    await screen.findByRole('button', { name: 'Open Linked activity' });
    fireEvent.press(screen.getByRole('button', { name: 'Open Linked activity' }));
    await screen.findByText('Switched to Linked cohort');
    await waitFor(() => expect(screen.getByTestId('selected-cohort').props.children).toBe(2));
    expect(await AsyncStorage.getItem('csg.cohort.active.9')).toBe('2');
    if (kind === 'lesson') {
      await screen.findByText('Source lesson');
      expect(screen.getByTestId('lesson-block-8')).toBeTruthy();
      expect(screen.getByText('Opened from your update')).toBeTruthy();
      fireEvent(screen.getByTestId('lesson-block-8'), 'layout', { nativeEvent: { layout: { y: 200 } } });
      expect(mockFocusTarget).toHaveBeenCalled();
      expect(mockApi.lesson).toHaveBeenCalledWith(42, expect.anything(), 2);
      expect(mockApi.lesson.mock.calls.every(([, , cohort]) => cohort === 2)).toBe(true);
    } else {
      await screen.findByText('Exact activity recording');
      expect(screen.queryByText('First recording')).toBeNull();
      expect(screen.queryByText('Wrong cohort recording')).toBeNull();
      expect(mockApi.recordings).toHaveBeenCalledWith(expect.anything(), 2);
    }
  } finally { screen.unmount(); mockRouter.push.mockReset(); }
});

it.each([
  { id: 18, item_key: 'recording-18', destination_path: '/recordings?cohort_id=2&recording=18', expected: '18', source: 'primary', contextId: 18 },
  { id: 'legacy-2-1', item_key: 'legacy-2-1', expected: 'legacy-2-1', source: 'legacy', contextId: 0 },
  { id: 'legacy-2-4', item_key: 'legacy-2-4', expected: 'legacy-2-4', source: 'legacy', contextId: 3 },
  { id: 19, item_key: 'recording-19', legacy_item_key: 'legacy-2-3', expected: '19', source: 'primary', contextId: 19 },
])('shares the exact canonical web recording from native ($item_key)', async (item) => {
  mockParams = { id: item.legacy_item_key || item.item_key, cohort_id: '2' };
  mockApi.recordings.mockResolvedValue({ recordings: [], s3_recordings: [], items: [{ ...item, cohort_id: 2, cohort_name: 'Python', title: 'Exact replay', source: 'external' }] });
  const screen = render(<RecordingDetailScreen />, { wrapper: Wrapper });
  const help = await screen.findByTestId('recording-help');
  expect(help.props.contextPath).toBe(`https://learn.codeschoolofguam.com/recordings?cohort_id=2&recording=${item.expected}`);
  expect(help.props.contextSource).toBe(item.source);
  expect(help.props.contextId).toBe(item.contextId);
});

it('refreshes a freshly hydrated old lesson even inside the normal cache freshness window', async () => {
  mockParams = { id: '42', cohort_id: '2' };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 60_000 } } });
  clients.push(client);
  const cached = { lesson: { id: 42, cohort_id: 2, module_id: 1, title: 'Cached source lesson', lesson_type: 'reading', content_blocks: [], objectives: [] } };
  const { hydrate, dehydrate } = jest.requireActual('@tanstack/react-query');
  const source = new QueryClient();
  source.setQueryData(learningKeys.lesson(9, 42, 2), cached);
  hydrate(client, JSON.parse(JSON.stringify(dehydrate(source))));
  source.clear();
  let resolve!: (value: unknown) => void;
  mockApi.lesson.mockReturnValueOnce(new Promise((done) => { resolve = done; }));
  const screen = render(<QueryClientProvider client={client}><LessonScreen /></QueryClientProvider>);
  expect(screen.getByText('Cached source lesson')).toBeTruthy();
  await waitFor(() => expect(mockApi.lesson).toHaveBeenCalledWith(42, expect.anything(), 2));
  await act(async () => resolve({ lesson: { ...cached.lesson, title: 'Fresh source lesson', capabilities: { can_submit: true, read_only: false } } }));
  await screen.findByText('Fresh source lesson');
});

it.each([true, false])('hides a cached lesson after its cached enrollment expires (explicit route: %s)', async (explicit) => {
  mockUseRealCohort = true;
  mockParams = { id: '42', ...(explicit ? { cohort_id: '2' } : {}) };
  await AsyncStorage.clear();
  await AsyncStorage.setItem('csg.cohort.active.9', '2');
  const user = { id: 9, full_name: 'Student', email: 'student@example.com', role: 'student',
    avatar_url: null, is_admin: false, is_staff: false, clerk_id: 'student',
    first_name: 'Student', last_name: '', github_username: null };
  const expiresAt = Date.now() + 60_000;
  const cached = serializeCachedSession(user, [{ id: 12, status: 'completed', enrolled_at: null,
    access_expires_at: new Date(expiresAt).toISOString(),
    cohort: { id: 2, name: 'Expired course', status: 'active', cohort_type: 'bootcamp', start_date: '2026-01-01' },
  }], 'student');
  const foreground = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  const clock = jest.spyOn(Date, 'now').mockImplementation(() => realNow() + 60_001);
  mockEnrollments = parseCachedSession(cached, 'student')!.enrollments;
  mockApi.accessibleCohorts.mockRejectedValue(new ApiError('Offline'));
  mockApi.lesson.mockRejectedValue(new ApiError('Offline'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  client.setQueryData(learningKeys.lesson(9, 42, 2), { lesson: { id: 42, title: 'Private cached lesson', content_blocks: [] } });
  const screen = render(<QueryClientProvider client={client}><CohortProvider><LessonScreen /></CohortProvider></QueryClientProvider>);
  try {
    await screen.findByText(/Offline — changes paused/);
    expect(screen.queryByText('Private cached lesson')).toBeNull();
    expect(screen.getByText(explicit ? 'You do not have access to the cohort named in this lesson link.' : 'Choose a cohort to open this lesson.')).toBeTruthy();
    expect(mockApi.lesson).not.toHaveBeenCalled();
  } finally { clock.mockRestore(); screen.unmount(); foreground.mockRestore(); }
});

it('hides cached lessons at both cohort deadlines after the selected cohort expires first', async () => {
  jest.useFakeTimers();
  mockUseRealCohort = true;
  mockParams = { id: '42' };
  await AsyncStorage.clear();
  await AsyncStorage.setItem('csg.cohort.active.9', '2');
  mockEnrollments = [2, 3].map((id, index) => ({ id, status: 'active', enrolled_at: null,
    access_expires_at: new Date(Date.now() + (index + 1) * 10_000).toISOString(),
    cohort: { id, name: `Saved cohort ${id}`, status: 'active', cohort_type: 'bootcamp', start_date: '2026-01-01' },
  }));
  const foreground = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockApi.accessibleCohorts.mockReset().mockRejectedValueOnce(new ApiError('Offline')).mockReturnValue(new Promise(() => {}));
  mockApi.lesson.mockRejectedValue(new ApiError('Offline'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  for (const [id, cohort] of [[42, 2], [43, 3]]) {
    client.setQueryData(learningKeys.lesson(9, id, cohort), { lesson: { id, title: `Cached lesson ${cohort}`, lesson_type: 'exercise', content_blocks: [], objectives: [] } });
  }
  const screen = render(<QueryClientProvider client={client}><CohortProvider><LessonScreen /></CohortProvider></QueryClientProvider>);
  try {
    await screen.findByText('Cached lesson 2');
    await act(async () => { jest.advanceTimersByTime(10_001); });
    expect(screen.queryByText('Cached lesson 2')).toBeNull();
    expect(screen.getByText('Choose a cohort to open this lesson.')).toBeTruthy();
    mockParams = { id: '43', cohort_id: '3' };
    screen.rerender(<QueryClientProvider client={client}><CohortProvider><LessonScreen /></CohortProvider></QueryClientProvider>);
    await screen.findByText('Cached lesson 3');
    await act(async () => { jest.advanceTimersByTime(10_000); });
    expect(screen.queryByText('Cached lesson 3')).toBeNull();
    expect(screen.getByText('You do not have access to the cohort named in this lesson link.')).toBeTruthy();
  } finally { screen.unmount(); foreground.mockRestore(); jest.useRealTimers(); }
});


it.each(['timer', 'foreground', 'render'] as const)('expires a successfully validated lesson offline via %s', async (trigger) => {
  jest.useFakeTimers();
  mockUseRealCohort = true;
  mockParams = { id: '42', cohort_id: '2' };
  await AsyncStorage.clear();
  await AsyncStorage.setItem('csg.cohort.active.9', '2');
  const expiresAt = Date.now() + 10_000;
  mockEnrollments = [{ id: 12, status: 'active', enrolled_at: null,
    access_expires_at: new Date(expiresAt).toISOString(),
    cohort: { id: 2, name: 'Python course', status: 'active', cohort_type: 'bootcamp', start_date: '2026-01-01' },
  }];
  const foreground = jest.spyOn(AppState, 'addEventListener').mockImplementation(() => ({ remove: jest.fn() }));
  mockApi.accessibleCohorts.mockReset().mockResolvedValue({ cohorts: [mockEnrollments[0].cohort] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const tree = () => <QueryClientProvider client={client}><CohortProvider><LessonScreen /></CohortProvider></QueryClientProvider>;
  const screen = render(tree());
  try {
    await screen.findByText('Source lesson');
    expect(mockApi.setCohortContextReadOnly).toHaveBeenLastCalledWith(false);
    expect(screen.queryByText(/Offline — changes paused/)).toBeNull();
    mockApi.lesson.mockRejectedValue(new ApiError('Offline'));
    mockApi.accessibleCohorts.mockRejectedValue(new ApiError('Offline'));
    if (trigger === 'timer') await act(async () => { jest.advanceTimersByTime(10_001); });
    else {
      jest.setSystemTime(expiresAt + 1);
      if (trigger === 'foreground') await act(async () => { foreground.mock.calls[foreground.mock.calls.length - 1][1]('active'); });
      else screen.rerender(tree());
    }
    expect(screen.queryByText('Source lesson')).toBeNull();
    expect(screen.getByText(`Your access to Python course ended on ${new Date(expiresAt).toLocaleDateString()}.`)).toBeTruthy();
    expect(mockApi.accessibleCohorts).toHaveBeenCalledTimes(1);
  } finally { screen.unmount(); foreground.mockRestore(); jest.useRealTimers(); }
});

it('labels effective required and optional lessons while browsing a source-cohort module', async () => {
  mockParams = { id: '1', cohort_id: '2' };
  const lesson = { lesson_type: 'exercise', available: true, completed: false, completed_blocks: 0, total_blocks: 1 };
  mockApi.dashboard.mockResolvedValue({ dashboard: { enrolled: true, user: { id: 9, role: 'student' }, modules: [{ id: 1, name: 'My module', module_type: 'live_class', completed_blocks: 0, total_blocks: 1, progress_percentage: 0, lessons: [{ ...lesson, id: 41, title: 'Core application', required: true }, { ...lesson, id: 42, title: 'AI enrichment', required: false }] }] } });
  const screen = render(<ModuleScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('exercise · Required')).toBeTruthy());
  expect(screen.getByText('exercise · Optional')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Open AI enrichment'));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/lesson/[id]', params: { id: '42', cohort_id: '2' } });
});
