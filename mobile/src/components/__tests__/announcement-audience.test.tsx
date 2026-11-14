import { act, fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Modal } from 'react-native';
import { themedAlert } from '@/lib/alerts';
import UpdatesScreen from '../../app/(app)/(tabs)/updates';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockApi = { announcements: jest.fn(), notifications: jest.fn(), announcement: jest.fn(), createAnnouncement: jest.fn() };
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

async function openComposer() {
  const view = render(<QueryClientProvider client={client}><UpdatesScreen /></QueryClientProvider>);
  await act(async () => {});
  fireEvent.press(view.getByLabelText('Write an announcement'));
  await act(async () => { view.UNSAFE_getAllByType(Modal).find((modal) => modal.props.onShow)!.props.onShow(); });
  return view;
}
async function post(view: ReturnType<typeof render>) {
  fireEvent.changeText(view.getByLabelText('Announcement title'), 'Class moved');
  fireEvent.changeText(view.getByLabelText('Announcement message'), 'Room 4 today');
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
  fireEvent.changeText(view.getByLabelText('Announcement title'), 'Class moved');
  fireEvent.changeText(view.getByLabelText('Announcement message'), 'Room 4 today');
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
