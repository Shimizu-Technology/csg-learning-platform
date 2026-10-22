import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FlatList } from 'react-native';
import TodayScreen from '../../app/(app)/(tabs)';
import { learningKeys } from '../../lib/learning';
import UpdatesScreen from '../../app/(app)/(tabs)/updates';
import { updatesKeys, type AnnouncementListPayload, type PagedUpdates } from '../../lib/updates-cache';
import type { Announcement } from '../../lib/types';

const mockRouter = { push: jest.fn(), setParams: jest.fn() };
const mockUser = { id: 7, is_staff: false };
const mockApi = { announcements: jest.fn(), notifications: jest.fn(), announcement: jest.fn(), markAllNotificationsRead: jest.fn(), markNotificationRead: jest.fn(), dashboard: jest.fn(), weeklyPlan: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({}), useFocusEffect: () => undefined }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('../cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('../../providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('../../providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: mockUser }) }));
jest.mock('../../providers/cohort-provider', () => ({ useCohort: () => ({ cohorts: [{ id: 4 }], selectedCohortId: 4, selectCohort: jest.fn() }) }));
jest.mock('../../providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: [] }) }));

const notices: Announcement[] = Array.from({ length: 52 }, (_, index) => ({ id: index + 1, title: `Notice ${index + 1}`, body: `Details ${index + 1}`, audience: index === 0 ? 'global' : 'cohort', cohort_id: index === 0 ? null : 4, cohort_name: index === 0 ? null : 'Python pilot', status: 'published', pinned: false, read_at: null, unread: true, published_at: '2026-10-22T00:00:00Z', archived_at: null, created_at: '2026-10-22T00:00:00Z', updated_at: '2026-10-22T00:00:00Z' }));
function meta(page: number) { return { page, per_page: 50, total_count: 52, total_pages: 2, has_prev_page: page > 1, has_next_page: page === 1 }; }
let client: QueryClient;
let readAll = false;
let announcementRead = false;
beforeEach(() => {
  jest.clearAllMocks(); readAll = false; announcementRead = false; mockUser.is_staff = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockApi.announcements.mockImplementation(async ({ page }) => ({ announcements: (page === 1 ? notices.slice(0, 50) : [notices[49], ...notices.slice(50)]).map((item) => readAll ? { ...item, read_at: 'now', unread: false } : item), unread_count: readAll ? 0 : 52, meta: meta(page) }));
  mockApi.notifications.mockImplementation(async ({ page }) => ({ notifications: (page === 1 ? notices.slice(0, 50) : notices.slice(50)).map((item) => ({ ...item, notification_type: 'announcement', path: `/announcements/${item.id}`, notifiable: { type: 'Announcement', id: item.id }, read_at: readAll ? 'now' : null })), unread_count: readAll ? 0 : 52, meta: meta(page) }));
  mockApi.announcement.mockImplementation(async (id) => { announcementRead = true; return { announcement: { ...notices.find((item) => item.id === id), read_at: 'now', unread: false } }; });
  mockApi.markNotificationRead.mockImplementation(async () => { announcementRead = true; return { notification: { id: 1, read_at: 'now' }, unread_count: 0 }; });
  mockApi.dashboard.mockImplementation(async () => ({ dashboard: { enrolled: true, user: { id: 7, full_name: 'Test Learner', role: 'student' }, cohort: { id: 4, name: 'Python pilot', cohort_type: 'bootcamp', status: 'active', start_date: '2026-01-01', announcements: [{ ...notices[0], pinned: true, read_at: readAll || announcementRead ? 'now' : null, unread: !readAll && !announcementRead }], unread_notifications_count: readAll || announcementRead ? 0 : 1 }, modules: [{ id: 1, name: 'Python', lessons: [{ id: 1, title: 'Start', completed: false }] }] } }));
  mockApi.weeklyPlan.mockResolvedValue({ weekly_plan: { enrolled: false } });
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
  client.setQueryData(['updates', 7, 'announcements', 'visible', 4], { announcements: notices, unread_count: 52, meta: meta(1) });
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

it.each(['announcement', 'notification', 'mark-all'])('refreshes persisted Today counts after an Updates %s read across all cohort caches', async (operation) => {
  client.setQueryDefaults(['learning', 7, 'dashboard'], { staleTime: Infinity });
  const initial = await mockApi.dashboard();
  for (const cohort of [undefined, 4, 9]) client.setQueryData(learningKeys.dashboard(7, cohort), initial);
  const view = render(<QueryClientProvider client={client}><TodayScreen /></QueryClientProvider>);
  await view.findByText('1 updates');
  expect(view.getByTestId('announcement-unread-1')).toBeTruthy();
  if (operation === 'notification') mockApi.notifications.mockResolvedValue({ notifications: [{ id: 1, title: 'Notice 1', body: 'Details 1', notification_type: 'system', notifiable: { type: 'Enrollment', id: 1 }, path: '/dashboard', read_at: null }], unread_count: 1, meta: meta(1) });
  view.rerender(<QueryClientProvider client={client}><UpdatesScreen /></QueryClientProvider>);
  await view.findByLabelText('Open announcement: Notice 1');
  if (operation === 'announcement') fireEvent.press(view.getByLabelText('Open announcement: Notice 1'));
  else {
    fireEvent.press(view.getByRole('tab', { name: /Inbox/ }));
    if (operation === 'mark-all') fireEvent.press(view.getByText('Mark everything read'));
    else fireEvent.press(view.getByLabelText('Unread. Notice 1. Details 1'));
  }
  await waitFor(() => expect(operation === 'mark-all' ? readAll : announcementRead).toBe(true));
  await waitFor(() => {
    for (const cohort of [undefined, 4, 9]) expect(client.getQueryState(learningKeys.dashboard(7, cohort))?.isInvalidated).toBe(true);
  });
  view.rerender(<QueryClientProvider client={client}><TodayScreen /></QueryClientProvider>);
  await waitFor(() => expect(view.queryByText('1 updates')).toBeNull(), { timeout: 5000 });
  expect(mockApi.dashboard).toHaveBeenCalledTimes(2);
  view.unmount();
});

it('uses an explicit unread flag for historical pinned Today announcements without delivery', async () => {
  const initial = await mockApi.dashboard();
  initial.dashboard.cohort.announcements[0].unread = false;
  initial.dashboard.cohort.unread_notifications_count = 0;
  client.setQueryData(learningKeys.dashboard(7, 4), initial);
  client.setQueryDefaults(['learning', 7, 'dashboard'], { staleTime: Infinity });
  const view = render(<QueryClientProvider client={client}><TodayScreen /></QueryClientProvider>);
  await view.findByLabelText('Open announcement: Notice 1');
  expect(view.queryByTestId('announcement-unread-1')).toBeNull();
  view.unmount();
});

it.each([
  ['/admin/submissions/31?cohort_id=4&student_id=18', '/staff/submission/31?cohort_id=4&student_id=18'],
  ['/lessons/42?cohort_id=9#block-8', '/lesson/42?cohort_id=9&block_id=8'],
  ['/recordings?cohort_id=9&recording=31', '/recording/31?cohort_id=9'],
])('navigates to validated exact notification destination %s instead of the legacy path', async (destination, expected) => {
  mockApi.notifications.mockResolvedValue({ notifications: [{ id: 91, title: 'Review work', body: 'Exact submission', path: '/admin/grading', destination_path: destination, read_at: 'now', notification_type: 'submission', notifiable: { type: 'Submission', id: 31 } }], unread_count: 0, meta: meta(1) });
  const view = screen();
  await view.findByLabelText('Open announcement: Notice 1');
  fireEvent.press(view.getByRole('tab', { name: /Inbox/ }));
  fireEvent.press(await view.findByLabelText('Review work. Exact submission'));
  expect(mockRouter.push).toHaveBeenCalledWith(expected);
  view.unmount();
});

it('labels the management cohort filter as exact', async () => {
  mockUser.is_staff = true;
  const view = screen();
  await view.findByLabelText('Open announcement: Notice 1');
  fireEvent(view.getByLabelText('Include drafts and archived announcements'), 'valueChange', true);
  await view.findByText('Manage announcements for this cohort');
  expect(mockApi.announcements).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'manage', cohort_id: 4 }));
  view.unmount();
});
