import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';

import ActivityScreen from '../../app/(app)/activity';
import CohortHomeScreen from '../../app/(app)/cohort/[id]';
import RecordingDetailScreen from '../../app/(app)/recording/[id]';
import RecordingsScreen from '../../app/(app)/recordings';
import RecordingLinkScreen from '../../app/(app)/recordings/link';
import RecordingUploadScreen from '../../app/(app)/recordings/upload';
import type { RecordingItem } from '@/lib/types';

let mockParams: Record<string, string> = {};
let mockStaff = true;
let mockRole = 'instructor';
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
const mockApi = { activityEvents: jest.fn(), cohortHome: jest.fn(), cohorts: jest.fn(), recordings: jest.fn(), dashboard: jest.fn(), publishRecording: jest.fn(), createExternalRecording: jest.fn() };
const mockAlert = jest.fn();
const mockHandoff = jest.fn();
const mockUpload = jest.fn();
const mockPick = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => mockRouter, Redirect: () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: { id: 1, is_staff: mockStaff, role: mockRole }, enrollments: [] }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ cohorts: [{ id: 2 }], selectedCohortId: 2, selectedCohort: { id: 2, name: 'Python' } }) }));
jest.mock('@/providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: [] }) }));
jest.mock('@/components/cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('@/components/staff-attention', () => ({ StaffAttention: () => null }));
jest.mock('@/components/native-video-player', () => ({ NativeVideoPlayer: () => null }));
jest.mock('@/components/in-app-media-player', () => ({ InAppMediaPlayer: () => null }));
jest.mock('@/components/contextual-help', () => ({ ContextualHelp: () => null }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: (...args: unknown[]) => mockHandoff(...args) }));
jest.mock('@/lib/alerts', () => ({ themedAlert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
jest.mock('@/lib/recording-upload', () => ({ MAX_RECORDING_SIZE: 5 * 1024 ** 3, uploadRecording: (...args: unknown[]) => mockUpload(...args) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: () => mockPick() }));
jest.mock('expo-file-system', () => ({ File: class { size = 1000; type = 'video/mp4'; } }));
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));

const clients: QueryClient[] = [];
function Wrapper({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const draft: RecordingItem = { id: 9, item_key: 'recording-9', cohort_id: 2, cohort_name: 'Python', title: 'Class replay', description: null, recorded_date: '2026-10-22', source: 'uploaded', status: 'draft' };
function payload(item: RecordingItem = draft) { return { items: [item], recordings: [], s3_recordings: [item] }; }
const home = { cohort: { id: 2, name: 'Python', cohort_type: 'bootcamp', status: 'active', start_date: '2026-10-01' }, permissions: { can_manage_schedule: true, can_manage_learning_schedule: true }, students: [{ user_id: 20, enrollment_id: 200, full_name: 'Ari', invite_delivery_status: 'accepted', progress_percentage: 50 }, { user_id: 21, enrollment_id: 201, full_name: 'Bea', invite_delivery_status: 'accepted', progress_percentage: 20 }], counts: { active_students: 2, joined: 2, invited: 0, ungraded: 0, open_help: 0 }, upcoming_events: [], recent_announcements: [] };
const event = { id: 10, event_type: 'submission_graded', actor: { id: 1, name: 'Teacher', role: 'instructor' }, subject_user_id: 20, subject_user: { id: 20, name: 'Ari', role: 'student' }, cohort_id: 2, cohort_name: 'Python', record_label: 'Loops', created_at: new Date().toISOString(), evidence: 'server_record', destination: { kind: 'submission', cohort_id: 2, student_id: 20, submission_id: 50 } };
beforeEach(() => {
  jest.clearAllMocks(); mockStaff = true; mockRole = 'instructor'; mockHandoff.mockResolvedValue(undefined); mockParams = {};
  mockApi.cohorts.mockResolvedValue({ cohorts: [{ id: 2, name: 'Python', status: 'active', start_date: '2026-10-01' }] });
  mockApi.cohortHome.mockResolvedValue({ home });
  mockApi.recordings.mockResolvedValue(payload());
  mockApi.publishRecording.mockResolvedValue({ recording: { ...draft, status: 'published' } });
  mockApi.createExternalRecording.mockResolvedValue({ recording: draft });
  mockUpload.mockResolvedValue({ recording: draft });
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///class.mp4', name: 'class.mp4', size: 1000, mimeType: 'video/mp4' }] });
  mockApi.activityEvents.mockResolvedValue({ activity_events: [event], next_before_id: null, recorded_since: '2026-10-01T00:00:00Z' });
});
afterEach(() => { clients.forEach((client) => client.clear()); clients.length = 0; });

it.each(['link', 'upload'])('saves a %s as a private draft and continues to that exact recording', async (kind) => {
  const screen = render(kind === 'link' ? <RecordingLinkScreen /> : <RecordingUploadScreen />, { wrapper: Wrapper });
  fireEvent.press(await screen.findByRole('radio'));
  if (kind === 'link') fireEvent.changeText(screen.getByLabelText('Recording video link'), 'https://youtube.com/watch?v=abcdefghijk');
  else {
    fireEvent.press(screen.getByLabelText('Choose video'));
    await screen.findByText('class.mp4');
  }
  fireEvent.changeText(screen.getByLabelText('Recording title'), 'Class replay');
  fireEvent.press(screen.getByRole('button', { name: kind === 'link' ? 'Save recording link as draft' : 'Upload recording as draft' }));
  await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Draft saved', expect.any(String), expect.any(Array)));
  if (kind === 'link') expect(mockApi.createExternalRecording).toHaveBeenCalledWith(2, expect.objectContaining({ publish_immediately: false }));
  else expect(mockUpload).toHaveBeenCalledWith(expect.objectContaining({ publishImmediately: false, cohortId: 2 }));
  const action = mockAlert.mock.calls[0][2][0];
  expect(action.text).toBe('Review draft');
  act(() => action.onPress());
  expect(mockRouter.replace).toHaveBeenCalledWith({ pathname: '/recording/[id]', params: { id: '9', cohort_id: '2' } });
});

it('labels draft and published recordings and opens their exact cohort', async () => {
  mockApi.recordings.mockResolvedValue({ ...payload(), items: [draft, { ...draft, id: 10, item_key: 'recording-10', title: 'Ready replay', status: 'published' }] });
  const screen = render(<RecordingsScreen />, { wrapper: Wrapper });
  await screen.findByText('Draft');
  expect(screen.getByText('Published')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Open Class replay'));
  expect(mockRouter.push).toHaveBeenCalledWith('/recording/recording-9?cohort_id=2');
});

it('publishes a reviewed draft in its exact cohort and updates the detail state', async () => {
  mockParams = { id: '9', cohort_id: '2' };
  const screen = render(<RecordingDetailScreen />, { wrapper: Wrapper });
  await screen.findByText('Draft');
  const button = await screen.findByRole('button', { name: 'Publish recording' });
  mockApi.recordings.mockResolvedValue(payload({ ...draft, status: 'published' }));
  fireEvent.press(button);
  await screen.findByText('Published');
  expect(mockApi.publishRecording).toHaveBeenCalledWith(2, 9);
  expect(screen.queryByText('Draft')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Publish recording' })).toBeNull();
});

it('keeps a failed publish as a draft and allows an explicit retry', async () => {
  mockParams = { id: '9', cohort_id: '2' };
  mockApi.publishRecording.mockRejectedValueOnce(new Error('Permission changed'));
  const screen = render(<RecordingDetailScreen />, { wrapper: Wrapper });
  fireEvent.press(await screen.findByRole('button', { name: 'Publish recording' }));
  await screen.findByText(/This recording remains a private draft/);
  expect(screen.getByText('Draft')).toBeTruthy();
  expect(screen.queryByText('Published')).toBeNull();
  expect(mockApi.recordings).toHaveBeenCalledTimes(1);
  mockApi.recordings.mockResolvedValue(payload({ ...draft, status: 'published' }));
  fireEvent.press(screen.getByRole('button', { name: 'Publish recording' }));
  await screen.findByText('Published');
  expect(mockApi.publishRecording).toHaveBeenCalledTimes(2);
});

it.each(['unassigned instructor', 'student'])('does not offer publication to an %s', async (role) => {
  mockParams = { id: '9', cohort_id: '2' };
  if (role === 'student') { mockStaff = false; mockApi.dashboard.mockResolvedValue({ dashboard: { enrolled: false } }); }
  else mockApi.cohorts.mockResolvedValue({ cohorts: [{ id: 3 }] });
  const screen = render(<RecordingDetailScreen />, { wrapper: Wrapper });
  await screen.findByText('Draft');
  await act(async () => {});
  expect(screen.queryByRole('button', { name: 'Publish recording' })).toBeNull();
  expect(mockApi.publishRecording).not.toHaveBeenCalled();
});

it('links cohort activity from the staff cohort home', async () => {
  mockParams = { id: '2' };
  const screen = render(<CohortHomeScreen />, { wrapper: Wrapper });
  fireEvent.press(await screen.findByRole('button', { name: 'Cohort activity' }));
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/activity', params: { feed: 'cohort', cohort_id: '2', name: 'Python' } });
});

it('opens the combined cohort schedule and hides administrative controls from instructors', async () => {
  mockParams = { id: '2' };
  const screen = render(<CohortHomeScreen />, { wrapper: Wrapper });
  fireEvent.press(await screen.findByRole('button', { name: 'Schedule' }));
  expect(mockHandoff).toHaveBeenCalledWith(mockApi, '/admin/cohorts/2?tab=schedule');
  expect(screen.queryByRole('button', { name: 'Learning schedule and releases' })).toBeNull();
});
it('retains the authorized administrative learning controls for admins', async () => {
  mockRole = 'admin'; mockParams = { id: '2' };
  const screen = render(<CohortHomeScreen />, { wrapper: Wrapper });
  expect(await screen.findByRole('button', { name: 'Learning schedule and releases' })).toBeTruthy();
});

it('opens learner, exact record, and cohort separately from the cohort feed', async () => {
  mockParams = { feed: 'cohort', cohort_id: '2', name: 'Python' };
  const screen = render(<ActivityScreen />, { wrapper: Wrapper });
  await screen.findByText(/Recorded since/);
  fireEvent.press(await screen.findByRole('button', { name: 'Open learner Ari' }));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/staff/student/[id]', params: { id: '20', cohort_id: '2' } });
  fireEvent.press(screen.getByLabelText('Open Loops'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/staff/submission/[id]', params: { id: '50', student_id: '20', cohort_id: '2' } });
  fireEvent.press(screen.getByText('Open cohort home'));
  expect(mockRouter.push).toHaveBeenLastCalledWith({ pathname: '/cohort/[id]', params: { id: '2' } });
  expect(mockApi.activityEvents).toHaveBeenCalledWith(expect.objectContaining({ feed: 'cohort', cohort_id: 2, user_id: undefined }), expect.anything());
  expect(screen.getByText(/By Teacher/)).toBeTruthy();
  expect(screen.queryByText('Sign-ins')).toBeNull();
});

it('preserves learner/category/time filters in route params and paginates within the same scope', async () => {
  mockParams = { feed: 'cohort', cohort_id: '2', learner_id: '20', category: 'work', days: '7' };
  mockApi.activityEvents.mockImplementation((params) => Promise.resolve({ activity_events: params.before_id ? [{ ...event, id: 9, record_label: 'Earlier work' }] : [event, { ...event, id: 8, record_label: 'Old work', created_at: '2020-01-01' }], next_before_id: params.before_id ? null : 8 }));
  const screen = render(<ActivityScreen />, { wrapper: Wrapper });
  await screen.findByText('Graded submitted work · Loops');
  expect(screen.queryByText('Graded submitted work · Old work')).toBeNull();
  fireEvent.press(screen.getByText('Show earlier activity'));
  await screen.findByText('Graded submitted work · Earlier work');
  expect(mockApi.activityEvents).toHaveBeenLastCalledWith({ feed: 'cohort', cohort_id: 2, user_id: 20, category: 'work', before_id: 8 }, expect.anything());
  fireEvent.press(screen.getByText('Learning'));
  await waitFor(() => expect(mockApi.activityEvents).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'learning', user_id: 20 }), expect.anything()));
  fireEvent.press(screen.getByText('Bea'));
  await waitFor(() => expect(mockApi.activityEvents).toHaveBeenLastCalledWith(expect.objectContaining({ user_id: 21, cohort_id: 2 }), expect.anything()));
  fireEvent.press(screen.getByText('Last 30 days'));
  expect(mockRouter.setParams).toHaveBeenCalledWith({ category: 'learning' });
  expect(mockRouter.setParams).toHaveBeenCalledWith({ learner_id: '21' });
  expect(mockRouter.setParams).toHaveBeenCalledWith({ days: '30' });
});

it('resets cohort filters on a reused route and never shows the prior cohort data', async () => {
  mockParams = { feed: 'cohort', cohort_id: '2', learner_id: '20', category: 'work' };
  const screen = render(<ActivityScreen />, { wrapper: Wrapper });
  await screen.findByLabelText('Open Loops');
  mockApi.activityEvents.mockResolvedValue({ activity_events: [], next_before_id: null });
  mockParams = { feed: 'cohort', cohort_id: '3' };
  screen.rerender(<ActivityScreen />);
  await screen.findByText('No activity recorded for these filters yet.');
  expect(screen.queryByLabelText('Open Loops')).toBeNull();
  expect(mockApi.activityEvents).toHaveBeenLastCalledWith(expect.objectContaining({ cohort_id: 3, user_id: undefined, category: undefined }), expect.anything());
});

it('keeps personal activity on the original endpoint contract', async () => {
  mockStaff = false;
  const screen = render(<ActivityScreen />, { wrapper: Wrapper });
  await screen.findByText('Graded submitted work · Loops');
  expect(mockApi.activityEvents).toHaveBeenCalledWith({ user_id: undefined, cohort_id: undefined, category: undefined, before_id: undefined }, expect.anything());
  expect(mockApi.cohortHome).not.toHaveBeenCalled();
});

it.each([{ feed: 'school', cohort_id: '2' }, { feed: 'cohort' }])('rejects unsupported or incomplete collection scope %j', (params) => {
  mockParams = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined)) as Record<string, string>;
  const screen = render(<ActivityScreen />, { wrapper: Wrapper });
  expect(screen.getByText('Activity unavailable')).toBeTruthy();
  expect(mockApi.activityEvents).not.toHaveBeenCalled();
});
it('denies native cohort activity to students', () => {
  mockStaff = false; mockParams = { feed: 'cohort', cohort_id: '2' };
  const screen = render(<ActivityScreen />, { wrapper: Wrapper });
  expect(screen.getByText('Activity unavailable')).toBeTruthy();
  expect(mockApi.activityEvents).not.toHaveBeenCalled();
});
