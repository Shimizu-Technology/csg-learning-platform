import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Modal } from 'react-native';
import { themedAlert } from '@/lib/alerts';
import UpdatesScreen from '../../app/(app)/(tabs)/updates';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockApi = { announcements: jest.fn(), notifications: jest.fn(), announcement: jest.fn(), createAnnouncement: jest.fn(), updateAnnouncement: jest.fn(), archiveAnnouncement: jest.fn() };
let mockSelectedCohortId: number | null = 4;
let mockRoutedCohort: string | undefined;
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), setParams: jest.fn() }), useLocalSearchParams: () => ({ cohort_id: mockRoutedCohort }), useFocusEffect: () => undefined }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('../cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('@/lib/alerts', () => ({ themedAlert: { alert: jest.fn() } }));
jest.mock('../../providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('../../providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: { id: 7, is_staff: true } }) }));
jest.mock('../../providers/cohort-provider', () => ({ useCohort: () => ({ cohorts: [{ id: 4 }, { id: 5 }], selectedCohortId: mockSelectedCohortId, selectCohort: jest.fn() }) }));
jest.mock('../../providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: [{ cohort_id: 4, cohort_name: 'Cohort 2', name: 'Cohort 2' }, { cohort_id: 5, cohort_name: 'Cohort 3', name: 'Cohort 3' }] }) }));

const meta = { page: 1, per_page: 50, total_count: 0, total_pages: 0, has_prev_page: false, has_next_page: false };
let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks(); mockSelectedCohortId = 4; mockRoutedCohort = undefined;
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mockApi.announcements.mockResolvedValue({ announcements: [], unread_count: 0, meta });
  mockApi.notifications.mockResolvedValue({ notifications: [], unread_count: 0, meta });
  mockApi.createAnnouncement.mockResolvedValue({ announcement: { id: 1, title: 'Hi', body: 'Body', audience: 'cohort', cohort_id: 4, status: 'published' } });
});
afterEach(() => client.clear());

type Seed = { id: number; title: string; body: string; audience: 'cohort' | 'global' | 'staff'; cohort_id: number | null; status: 'draft' | 'published'; pinned: boolean; can_edit: boolean; can_archive: boolean };
const seed = (overrides: Partial<Seed>): Seed => ({ id: 9, title: 'Saved post', body: 'Saved body', audience: 'cohort', cohort_id: 4, status: 'published', pinned: false, can_edit: true, can_archive: true, ...overrides });
async function openEditor(announcement: Seed) {
  mockApi.announcements.mockResolvedValue({ announcements: [announcement], unread_count: 0, meta });
  mockApi.updateAnnouncement.mockResolvedValue({ announcement });
  const view = render(<QueryClientProvider client={client}><UpdatesScreen /></QueryClientProvider>);
  await act(async () => {});
  fireEvent(await view.findByLabelText('Open update: Saved post'), 'longPress');
  fireEvent.press(view.getByText('Edit'));
  await act(async () => { view.UNSAFE_getAllByType(Modal).find((modal) => modal.props.onShow)!.props.onShow(); });
  return view;
}
const save = async (view: ReturnType<typeof render>) => { await act(async () => { fireEvent.press(view.getByText('Save')); }); };

async function openComposer() {
  const view = render(<QueryClientProvider client={client}><UpdatesScreen /></QueryClientProvider>);
  await act(async () => {});
  fireEvent.press(view.getByLabelText('Post update'));
  await act(async () => { view.UNSAFE_getAllByType(Modal).find((modal) => modal.props.onShow)!.props.onShow(); });
  return view;
}
async function post(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByLabelText('Update title'), 'Class moved');
  fireEvent.changeText(view.getByLabelText('Update message'), 'Room 4 today');
  await act(async () => { fireEvent.press(view.getByText('Save')); });
}
const confirmButton = (text: string) => jest.mocked(themedAlert.alert).mock.calls.at(-1)![2]!.find((button) => button.text === text)!;

it('defaults the audience to the routed cohort over the selected one and posts without a prompt', async () => {
  mockRoutedCohort = '5';
  const view = await openComposer();
  expect(view.getByText('Posting to: Cohort 3')).toBeTruthy();
  await post(view);
  expect(themedAlert.alert).not.toHaveBeenCalled();
  expect(mockApi.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ audience: 'cohort', cohort_id: 5 }));
  view.unmount();
});

it('uses the selected cohort when nothing is routed, and never silently falls back to the first cohort', async () => {
  mockSelectedCohortId = 5;
  let view = await openComposer();
  expect(view.getByText('Posting to: Cohort 3')).toBeTruthy();
  view.unmount();
  mockSelectedCohortId = null;
  view = await openComposer();
  expect(view.getByText('Choose a cohort to post to')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Update title'), 'Class moved');
  fireEvent.changeText(view.getByLabelText('Update message'), 'Room 4 today');
  await act(async () => { fireEvent.press(view.getByText('Save')); });
  expect(mockApi.createAnnouncement).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Cohort 2'));
  expect(view.getByText('Posting to: Cohort 2')).toBeTruthy();
  view.unmount();
});

it('confirms a post to a different cohort or the whole school before sending', async () => {
  const view = await openComposer();
  fireEvent.press(view.getByText('Cohort 3'));
  await post(view);
  expect(themedAlert.alert).toHaveBeenCalledWith('Post to Cohort 3?', expect.stringContaining('You are viewing Cohort 2'), expect.any(Array), expect.anything());
  expect(mockApi.createAnnouncement).not.toHaveBeenCalled();
  await act(async () => { confirmButton('Cancel').onPress!(); });
  expect(mockApi.createAnnouncement).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('global'));
  expect(view.getByText('Posting to: Everyone')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByText('Save')); });
  expect(themedAlert.alert).toHaveBeenLastCalledWith('Post to everyone?', expect.stringContaining('every student and staff member'), expect.any(Array), expect.anything());
  await act(async () => { confirmButton('Post').onPress!(); });
  expect(mockApi.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ audience: 'global', cohort_id: null }));
  view.unmount();
});

it('asks before publishing a saved cohort draft to the whole school, and cancelling changes nothing', async () => {
  const view = await openEditor(seed({ status: 'draft' }));
  fireEvent(view.getByLabelText('Post now'), 'valueChange', true);
  fireEvent.press(view.getByText('global'));
  await save(view);
  expect(themedAlert.alert).toHaveBeenCalledWith('Post to everyone?', expect.stringContaining('every student and staff member'), expect.any(Array), expect.anything());
  await act(async () => { confirmButton('Cancel').onPress!(); });
  expect(mockApi.updateAnnouncement).not.toHaveBeenCalled();
  await save(view);
  await act(async () => { confirmButton('Post').onPress!(); });
  expect(mockApi.updateAnnouncement).toHaveBeenCalledWith(9, expect.objectContaining({ audience: 'global', cohort_id: null, status: 'published' }));
  view.unmount();
});

it('publishes a draft that already targets the viewed cohort without a prompt, and saving it as a draft never asks', async () => {
  let view = await openEditor(seed({ status: 'draft' }));
  fireEvent(view.getByLabelText('Post now'), 'valueChange', true);
  await save(view);
  expect(mockApi.updateAnnouncement).toHaveBeenLastCalledWith(9, expect.objectContaining({ status: 'published', audience: 'cohort', cohort_id: 4 }));
  expect(themedAlert.alert).not.toHaveBeenCalled();
  expect(mockApi.updateAnnouncement).toHaveBeenCalledTimes(1);
  view.unmount();
  view = await openEditor(seed({ status: 'draft', audience: 'staff', cohort_id: null }));
  await save(view);
  expect(themedAlert.alert).not.toHaveBeenCalled();
  expect(mockApi.updateAnnouncement).toHaveBeenLastCalledWith(9, expect.objectContaining({ status: 'draft' }));
  view.unmount();
});

it('keeps a posted update\'s audience: no audience, cohort, post or push controls, and nobody is asked or notified again', async () => {
  const view = await openEditor(seed({}));
  expect(view.getByText('Edit update')).toBeTruthy();
  expect(view.queryByText('Cohort 3')).toBeNull();
  expect(view.queryByText('global')).toBeNull();
  expect(view.queryByLabelText('Post now')).toBeNull();
  expect(view.queryByLabelText('Send a push notification')).toBeNull();
  expect(view.getByText(/can’t change after it’s posted/)).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('Update title'), 'Saved post, corrected');
  await save(view);
  expect(themedAlert.alert).not.toHaveBeenCalled();
  expect(mockApi.updateAnnouncement).toHaveBeenCalledWith(9, { title: 'Saved post, corrected', body: 'Saved body', pinned: false });
  view.unmount();
});

it('does not ask when editing only the body of a published announcement, even a school-wide one', async () => {
  const view = await openEditor(seed({ audience: 'global', cohort_id: null }));
  fireEvent.changeText(view.getByLabelText('Update message'), 'Updated details');
  await save(view);
  expect(themedAlert.alert).not.toHaveBeenCalled();
  expect(mockApi.updateAnnouncement).toHaveBeenCalledWith(9, expect.objectContaining({ body: 'Updated details' }));
  expect(mockApi.updateAnnouncement.mock.calls[0][1]).not.toHaveProperty('audience');
  view.unmount();
});

it('offers no Edit on an update the viewer cannot edit, and no Archive without can_archive', async () => {
  mockApi.announcements.mockResolvedValue({ announcements: [seed({ can_edit: false, can_archive: false })], unread_count: 0, meta });
  const view = render(<QueryClientProvider client={client}><UpdatesScreen /></QueryClientProvider>);
  await act(async () => {});
  fireEvent(await view.findByLabelText('Open update: Saved post'), 'longPress');
  expect(view.queryByText('Edit')).toBeNull();
  expect(view.queryByText('Archive')).toBeNull();
  view.unmount();
});

it('lets cohort staff archive a posted update they cannot edit', async () => {
  mockApi.announcements.mockResolvedValue({ announcements: [seed({ can_edit: false, can_archive: true })], unread_count: 0, meta });
  mockApi.archiveAnnouncement.mockResolvedValue({ announcement: { ...seed({ can_edit: false, can_archive: false }), status: 'archived' } });
  const view = render(<QueryClientProvider client={client}><UpdatesScreen /></QueryClientProvider>);
  await act(async () => {});
  fireEvent(await view.findByLabelText('Open update: Saved post'), 'longPress');
  expect(view.queryByText('Edit')).toBeNull();
  await act(async () => { fireEvent.press(view.getByText('Archive')); });
  expect(mockApi.archiveAnnouncement).toHaveBeenCalledWith(9);
  view.unmount();
});

it('offers the message Markdown toolbar and previews the same source saved in announcements', async () => {
  const view = await openComposer();
  fireEvent.changeText(view.getByLabelText('Update title'), 'Markdown notice');
  fireEvent.changeText(view.getByLabelText('Update message'), 'Hello');
  fireEvent(view.getByLabelText('Update message'), 'selectionChange', { nativeEvent: { selection: { start: 0, end: 5 } } });
  fireEvent.press(view.getByLabelText('Bold'));
  expect(view.getByLabelText('Update message').props.value).toBe('**Hello**');
  fireEvent.press(view.getByLabelText('Preview'));
  expect(view.getByTestId('composer-preview')).toBeTruthy();
  await save(view);
  expect(mockApi.createAnnouncement).toHaveBeenCalledWith(expect.objectContaining({ body: '**Hello**' }));
});
