import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FlatList } from 'react-native';
import UpdatesScreen from '../../app/(app)/(tabs)/updates';
import { updatesKeys, type AnnouncementListPayload, type PagedUpdates } from '../../lib/updates-cache';
import type { Announcement } from '../../lib/types';

const mockRouter = { push: jest.fn(), setParams: jest.fn() };
const mockUser = { id: 7, is_staff: false };
const mockApi = { announcements: jest.fn(), notifications: jest.fn(), announcement: jest.fn(), markAllNotificationsRead: jest.fn(), markNotificationRead: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}), useFocusEffect: () => undefined }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('../../providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('../../providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: mockUser }) }));
jest.mock('../../providers/cohort-provider', () => ({ useCohort: () => ({ cohorts: [{ id: 4 }], selectedCohortId: 4, selectCohort: jest.fn() }) }));
jest.mock('../../providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: [] }) }));

const notices: Announcement[] = Array.from({ length: 52 }, (_, index) => ({ id: index + 1, title: `Notice ${index + 1}`, body: `Details ${index + 1}`, audience: index === 0 ? 'global' : 'cohort', cohort_id: index === 0 ? null : 4, cohort_name: index === 0 ? null : 'Python pilot', status: 'published', pinned: false, read_at: null, unread: true, published_at: '2026-10-22T00:00:00Z', archived_at: null, created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' }));
function meta(page: number) { return { page, per_page: 50, total_count: 52, total_pages: 2, has_prev_page: page > 1, has_next_page: page === 1 }; }
let client: QueryClient;
let readAll = false;
beforeEach(() => {
  jest.clearAllMocks(); readAll = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockApi.announcements.mockImplementation(async ({ page }) => ({ announcements: (page === 1 ? notices.slice(0, 50) : [notices[49], ...notices.slice(50)]).map((item) => readAll ? { ...item, read_at: 'now', unread: false } : item), unread_count: readAll ? 0 : 52, meta: meta(page) }));
  mockApi.notifications.mockImplementation(async ({ page }) => ({ notifications: (page === 1 ? notices.slice(0, 50) : notices.slice(50)).map((item) => ({ ...item, notification_type: 'announcement', path: `/announcements/${item.id}`, notifiable: { type: 'Announcement', id: item.id }, read_at: readAll ? 'now' : null })), unread_count: readAll ? 0 : 52, meta: meta(page) }));
  mockApi.announcement.mockImplementation(async (id) => ({ announcement: { ...notices.find((item) => item.id === id), read_at: 'now', unread: false } }));
  mockApi.markAllNotificationsRead.mockImplementation(async () => { readAll = true; return { unread_count: 0 }; });
});
afterEach(() => client.clear());
function screen() { return render(<QueryClientProvider client={client}><UpdatesScreen /></QueryClientProvider>); }

it('loads beyond 50, deduplicates overlap and keeps an exact detail selected during refresh', async () => {
  const view = screen();
  await view.findByLabelText('Open announcement: Notice 1');
  expect(view.getByText('School-wide')).toBeTruthy();
  expect(mockApi.announcements).toHaveBeenCalledWith({ cohort_id: 4, per_page: 50, page: 1 });
  fireEvent.press(view.getByLabelText('Load earlier updates'));
  await waitFor(() => expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(52));
  fireEvent.press(view.getByLabelText('Open announcement: Notice 1'));
  await waitFor(() => expect(mockApi.announcement).toHaveBeenCalledWith(1));
  await act(async () => { await client.refetchQueries({ queryKey: updatesKeys.root(7) }); });
  expect(view.getByLabelText('Close')).toBeTruthy();
  expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(52);
  view.unmount();
});

it('retries a failed later page, and mark-all clears unread announcement caches in every cohort scope', async () => {
  const view = screen();
  await view.findByLabelText('Open announcement: Notice 1');
  fireEvent.press(view.getByRole('tab', { name: /Inbox/ }));
  mockApi.notifications.mockRejectedValueOnce(new Error('Could not load older notices'));
  fireEvent.press(view.getByLabelText('Load earlier updates'));
  await view.findByText('Could not load older notices');
  fireEvent.press(view.getByText('Try again'));
  await waitFor(() => expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(52));
  client.setQueryData(updatesKeys.announcements(7, false, 9), { pages: [{ announcements: notices.slice(0, 1), unread_count: 1, meta: meta(1) }], pageParams: [1] });
  fireEvent.press(view.getByText('Mark everything read'));
  await waitFor(() => expect(mockApi.markAllNotificationsRead).toHaveBeenCalledTimes(1));
  await waitFor(() => {
    const otherScope = client.getQueryData<PagedUpdates<AnnouncementListPayload>>(updatesKeys.announcements(7, false, 9));
    expect(otherScope?.pages[0].unread_count).toBe(0);
    expect(otherScope?.pages[0].announcements[0].unread).toBe(false);
  });
  view.unmount();
});
