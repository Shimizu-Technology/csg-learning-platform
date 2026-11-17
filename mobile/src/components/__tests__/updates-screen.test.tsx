import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FlatList } from 'react-native';
import TodayScreen from '../../app/(app)/(tabs)';
import { learningKeys } from '../../lib/learning';
import UpdatesScreen from '../../app/(app)/(tabs)/updates';
import { updatesKeys, type AnnouncementListPayload, type PagedUpdates } from '../../lib/updates-cache';
import type { Announcement } from '../../lib/types';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

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
  await view.findByLabelText('Open update: Notice 1');
  expect(view.getByText('School-wide')).toBeTruthy();
  expect(mockApi.announcements).toHaveBeenCalledWith({ cohort_id: 4, per_page: 50, page: 1 });
  fireEvent.press(view.getByLabelText('Load earlier updates'));
  await waitFor(() => expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(52));
  fireEvent.press(view.getByLabelText('Open update: Notice 1'));
  await waitFor(() => expect(mockApi.announcement).toHaveBeenCalledWith(1));
  await act(async () => { await client.refetchQueries({ queryKey: updatesKeys.root(7) }); });
  expect(view.getByLabelText('Close')).toBeTruthy();
  expect(view.UNSAFE_getByType(FlatList).props.data).toHaveLength(52);
  view.unmount();
});

it('retries a failed later page, and mark-all clears unread announcement caches in every cohort scope', async () => {
  const view = screen();
  await view.findByLabelText('Open update: Notice 1');
  fireEvent.press(view.getByRole('tab', { name: /Notifications/ }));
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
  await view.findByLabelText('Open update: Notice 1');
  if (operation === 'announcement') fireEvent.press(view.getByLabelText('Open update: Notice 1'));
  else {
    fireEvent.press(view.getByRole('tab', { name: /Notifications/ }));
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
  await view.findByLabelText('Open update: Notice 1');
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
  await view.findByLabelText('Open update: Notice 1');
  fireEvent.press(view.getByRole('tab', { name: /Notifications/ }));
  fireEvent.press(await view.findByLabelText('Review work. Exact submission'));
  expect(mockRouter.push).toHaveBeenCalledWith(expected);
  view.unmount();
});

it('labels the management cohort filter as exact', async () => {
  mockUser.is_staff = true;
  const view = screen();
  await view.findByLabelText('Open update: Notice 1');
  fireEvent(view.getByLabelText('Include drafts and archived updates'), 'valueChange', true);
  await view.findByText('Manage updates for this cohort');
  expect(mockApi.announcements).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'manage', cohort_id: 4 }));
  view.unmount();
});

it('shows readers Edited with the time on the card and in the detail', async () => {
  const edited = { ...notices[1], edited_at: '2026-10-23T15:30:00Z', edited_by: { id: 3, full_name: 'QA Editor' } };
  mockApi.announcements.mockResolvedValue({ announcements: [edited], unread_count: 1, meta: { ...meta(1), total_count: 1, total_pages: 1, has_next_page: false } });
  mockApi.announcement.mockResolvedValue({ announcement: { ...edited, read_at: 'now', unread: false } });
  const view = screen();
  await view.findByLabelText('Open update: Notice 2');
  // The school's time zone may put it on the next day.
  expect(view.getByText(/· Edited Oct 2[34], 2026, \d{1,2}:\d{2}/)).toBeTruthy();
  fireEvent.press(view.getByLabelText('Open update: Notice 2'));
  expect(await view.findByTestId('announcement-edited')).toBeTruthy();
  expect(view.queryByText('Edit')).toBeNull();
  view.unmount();
});

it('shows staff a scheduled update as Scheduled with when it sends, and a posted one with its read counts (U-3.6, L-5.1)', async () => {
  mockUser.is_staff = true;
  // Jan 15, 2030, 9:00 AM in Guam.
  const scheduled = { ...notices[1], id: 90, title: 'Scheduled notice', status: 'draft' as const, published_at: null, unread: false, can_edit: true, scheduled_for: '2030-01-14T23:00:00.000Z', scheduled_send_push: true, schedule_time_zone: 'Pacific/Guam' };
  const posted = { ...notices[2], id: 91, title: 'Posted notice', read_summary: { notified: 4, read: 3 } };
  mockApi.announcements.mockResolvedValue({ announcements: [scheduled, posted], unread_count: 0, meta: { ...meta(1), total_count: 2, total_pages: 1, has_next_page: false } });
  mockApi.announcement.mockImplementation(async (id) => ({ announcement: id === 90 ? scheduled : { ...posted, read_at: 'now', unread: false } }));
  const view = screen();
  await view.findByLabelText('Open update: Scheduled notice');
  expect(view.getByText('Scheduled')).toBeTruthy();
  expect(view.getAllByText(/Sends about Jan 15, 2030, 9:00 AM ChST/).length).toBeGreaterThan(0);
  fireEvent.press(view.getByLabelText('Open update: Posted notice'));
  expect((await view.findByTestId('announcement-read-summary')).props.children).toBe('3 of 4 people it went to have read it');
  view.unmount();
});

it('fetches read counts for staff when an already-read update is opened or long-pressed', async () => {
  const read = { ...notices[2], id: 92, title: 'Read notice', read_at: '2026-10-22T01:00:00Z', unread: false, can_archive: true };
  mockApi.announcements.mockResolvedValue({ announcements: [read], unread_count: 0, meta: { ...meta(1), total_count: 1, total_pages: 1, has_next_page: false } });
  mockApi.announcement.mockResolvedValue({ announcement: { ...read, read_summary: { notified: 5, read: 2 } } });
  mockUser.is_staff = true;
  let view = screen();
  fireEvent.press(await view.findByLabelText('Open update: Read notice'));
  expect((await view.findByTestId('announcement-read-summary')).props.children).toBe('2 of 5 people it went to have read it');
  expect(mockApi.announcement).toHaveBeenCalledWith(92);
  view.unmount();

  mockApi.announcement.mockClear();
  view = screen();
  fireEvent(await view.findByLabelText('Open update: Read notice'), 'longPress');
  expect(await view.findByTestId('announcement-read-summary')).toBeTruthy();
  expect(mockApi.announcement).toHaveBeenCalledWith(92);
  view.unmount();
}, 15_000);

it('makes no request when a learner opens an update already read', async () => {
  const read = { ...notices[2], id: 92, title: 'Read notice', read_at: '2026-10-22T01:00:00Z', unread: false };
  mockApi.announcements.mockResolvedValue({ announcements: [read], unread_count: 0, meta: { ...meta(1), total_count: 1, total_pages: 1, has_next_page: false } });
  const view = screen();
  fireEvent.press(await view.findByLabelText('Open update: Read notice'));
  expect(await view.findByText(/Shared by/)).toBeTruthy();
  expect(mockApi.announcement).not.toHaveBeenCalled();
  expect(view.queryByTestId('announcement-read-summary')).toBeNull();
  view.unmount();
});


it('shows a refused scheduled send on the draft card and its detail', async () => {
  Object.assign(mockUser, { id: 7, is_staff: true, role: 'instructor', is_admin: false });
  const failed = { ...notices[1], id: 99, title: 'Unsent notice', author: { id: 7, full_name: 'QA Author', email: 'author@example.invalid' }, status: 'draft' as const, published_at: null, unread: false, can_edit: false, schedule_failure: 'Not sent: the scheduler no longer teaches QA cohort.' };
  mockApi.announcements.mockResolvedValue({ announcements: [failed], unread_count: 0, meta: { ...meta(1), total_count: 1, total_pages: 1, has_next_page: false } });
  mockApi.announcement.mockResolvedValue({ announcement: failed });
  const view = screen();
  await view.findByLabelText('Open update: Unsent notice');
  expect(view.getByText(/Not sent: the scheduler no longer teaches QA cohort/)).toBeTruthy();
  fireEvent.press(view.getByLabelText('Open update: Unsent notice'));
  await waitFor(() => expect(view.getAllByText(/Not sent: the scheduler no longer teaches QA cohort/).length).toBeGreaterThan(1));
  expect(view.getByText('Delete draft')).toBeTruthy();
  expect(view.queryByText('Edit')).toBeNull();
  view.unmount();
});
