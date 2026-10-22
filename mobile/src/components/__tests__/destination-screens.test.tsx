import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import UpdatesScreen from '../../app/(app)/(tabs)/updates';
import SupportScreen from '../../app/(app)/staff/support/[id]';
import LessonScreen from '../../app/(app)/lesson/[id]';
import RecordingDetailScreen from '../../app/(app)/recording/[id]';
import GradingScreen from '../../app/(app)/staff/grading';

let mockParams: Record<string, string> = {};
let mockStaff = false;
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), setParams: jest.fn() };
const mockSelect = jest.fn();
const mockHandoff = jest.fn();
const mockApi = { lesson: jest.fn(), recordings: jest.fn(), submissions: jest.fn(), announcements: jest.fn(), notifications: jest.fn(), announcement: jest.fn(), helpRequest: jest.fn() };
jest.mock('expo-router', () => ({ useFocusEffect: () => {}, useLocalSearchParams: () => mockParams, useRouter: () => mockRouter }));
jest.mock('@/providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: [] }) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: { id: 9, is_staff: mockStaff } }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ cohorts: [{ id: 2 }], selectedCohortId: 3, loading: false, selectCohort: mockSelect }) }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: (...args: unknown[]) => mockHandoff(...args) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('@/components/lesson-content-block', () => ({ LessonContentBlockCard: () => null }));
jest.mock('@/components/lesson-objectives', () => ({ LessonObjectives: () => null }));
jest.mock('@/components/rubric-panel', () => ({ RubricPanel: () => null }));
jest.mock('@/components/contextual-help', () => ({ ContextualHelp: () => null }));
jest.mock('@/components/staff-curriculum-management', () => ({ LessonSettingsModal: () => null }));
jest.mock('@/components/native-video-player', () => ({ NativeVideoPlayer: () => null }));
jest.mock('@/components/in-app-media-player', () => ({ InAppMediaPlayer: () => null }));
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
  jest.clearAllMocks(); mockStaff = false; mockParams = {};
  mockSelect.mockResolvedValue(undefined); mockHandoff.mockResolvedValue(undefined);
  mockApi.lesson.mockResolvedValue({ lesson: { id: 42, cohort_id: 2, module_id: 1, title: 'Source lesson', lesson_type: 'exercise', content_blocks: [{ id: 8, block_type: 'exercise', position: 0, submissions: [] }], objectives: [] } });
  mockApi.announcements.mockResolvedValue({ announcements: [], unread_count: 0 });
  mockApi.notifications.mockResolvedValue({ notifications: [], unread_count: 0 });
  mockApi.submissions.mockResolvedValue({ submissions: [] });
});
it('uses the source cohort before querying and highlights the notified exercise', async () => {
  mockParams = { id: '42', cohort_id: '2', block_id: '8' };
  const screen = render(<LessonScreen />, { wrapper: Wrapper });
  await waitFor(() => expect(screen.getByText('Opened from your update')).toBeTruthy());
  expect(mockApi.lesson).toHaveBeenCalledWith(42, expect.anything(), 2);
  expect(mockSelect).toHaveBeenCalledWith(2);
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
