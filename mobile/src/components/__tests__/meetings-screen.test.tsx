import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';
import { ApiError } from '@/lib/api';
import { booking, cohort, now } from '@/lib/meeting-test-fixtures';
import type { PrivateMeetingCohort } from '@/lib/private-meetings';
import MeetingsScreen from '../../app/(app)/meetings';

const mockRouter = { push: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockConnected = true;
let mockCohorts: PrivateMeetingCohort[];
const mockApi = { privateMeetings: jest.fn(), bookPrivateMeeting: jest.fn(), reschedulePrivateMeeting: jest.fn(), cancelPrivateMeeting: jest.fn(), createCohortDm: jest.fn() };
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {} }));
jest.mock('expo-network', () => ({ useNetworkState: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }), getNetworkStateAsync: async () => ({ isConnected: mockConnected }) }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useFocusEffect: () => {} }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: { id: 9, is_staff: false } }) }));

beforeEach(() => {
  jest.clearAllMocks(); mockConnected = true; mockCohorts = [{ ...cohort }];
  jest.spyOn(Date, 'now').mockReturnValue(now);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  mockApi.privateMeetings.mockImplementation(async () => ({ cohorts: mockCohorts }));
});
afterEach(() => jest.restoreAllMocks());
function show(cached = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  if (cached) client.setQueryData(['learning', 9, 'private-meetings'], { cohorts: mockCohorts });
  const screen = render(<QueryClientProvider client={client}><MeetingsScreen /></QueryClientProvider>);
  return { screen, client };
}
async function ready(screen: ReturnType<typeof render>) { await waitFor(() => expect(screen.getByTestId('meeting-slot-2-0')).toBeEnabled()); }
it('books once under rapid taps, then displays the acknowledged booking', async () => {
  let finish: (value: unknown) => void = () => {};
  mockApi.bookPrivateMeeting.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  const { screen } = show(); await ready(screen);
  fireEvent.press(screen.getByTestId('meeting-slot-2-0'));
  fireEvent.press(screen.getByTestId('meeting-confirm-submit'));
  fireEvent.press(screen.getByTestId('meeting-confirm-submit'));
  await waitFor(() => expect(mockApi.bookPrivateMeeting).toHaveBeenCalledTimes(1));
  expect(screen.getByText('Saving your meeting…')).toBeTruthy();
  mockCohorts = [{ ...cohort, bookings: [booking] }];
  await act(async () => finish({ booking }));
  await waitFor(() => expect(screen.getByText('Your meeting is booked.')).toBeTruthy());
  expect(screen.getByText('Booked')).toBeTruthy();
});
it('refreshes a conflict and explains how to recover', async () => {
  mockApi.bookPrivateMeeting.mockImplementation(async () => { mockCohorts = [{ ...cohort, slots: [cohort.slots[0]] }]; throw new ApiError('Slot taken', 409); });
  const { screen } = show(); await ready(screen);
  fireEvent.press(screen.getByTestId('meeting-slot-2-0')); fireEvent.press(screen.getByTestId('meeting-confirm-submit'));
  await waitFor(() => expect(screen.getByText(/That time is no longer available/)).toBeTruthy());
  await waitFor(() => expect(screen.queryByLabelText(/Sat, Dec 12/)).toBeNull());
  expect(mockApi.bookPrivateMeeting).toHaveBeenCalledTimes(1);
});
it('keeps cached reads but disables writes when offline', async () => {
  mockConnected = false;
  const { screen } = show();
  await act(async () => {});
  expect(screen.getByText(/You are offline/)).toBeTruthy();
  expect(screen.getByTestId('meeting-slot-2-0')).toBeDisabled();
  fireEvent.press(screen.getByTestId('meeting-slot-2-0'));
  expect(mockApi.bookPrivateMeeting).not.toHaveBeenCalled();
  expect(mockApi.privateMeetings).not.toHaveBeenCalled();
});
it('retains saved data and disables writes after a failed refresh, then retry recovers', async () => {
  mockApi.privateMeetings.mockRejectedValueOnce(new ApiError('offline'));
  const { screen } = show();
  await waitFor(() => expect(screen.getByText(/Showing saved meetings/)).toBeTruthy());
  expect(screen.getByTestId('meeting-slot-2-0')).toBeDisabled();
  fireEvent.press(screen.getByText('Try again'));
  await ready(screen);
});
it('opens the exact course instructor conversation in the app', async () => {
  mockApi.createCohortDm.mockResolvedValue({ direct_conversation: { id: 55 } });
  const { screen } = show(); await ready(screen);
  fireEvent.press(screen.getByLabelText('Message your instructor for Python Fundamentals'));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith('/conversation/dm/55'));
  expect(mockApi.createCohortDm).toHaveBeenCalledWith(2, [7]);
});
it('shows loading, then a failed first read with retry, then a true empty state', async () => {
  let fail: (reason: unknown) => void = () => {};
  mockApi.privateMeetings.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
  const { screen } = show(false);
  expect(screen.getByLabelText('Loading your meetings')).toBeTruthy();
  await act(async () => fail(new ApiError('offline')));
  await waitFor(() => expect(screen.getByText(/Could not load your meetings/)).toBeTruthy());
  mockCohorts = []; fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(screen.getByText(/No private meetings are available/)).toBeTruthy());
});
