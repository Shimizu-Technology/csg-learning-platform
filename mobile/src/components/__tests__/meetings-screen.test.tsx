import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';
import { ApiError } from '@/lib/api';
import { booking, cohort, now } from '@/lib/meeting-test-fixtures';
import type { PrivateMeetingCohort } from '@/lib/private-meetings';
import MeetingsScreen from '../../app/(app)/meetings';

const mockRouter = { push: jest.fn(), back: jest.fn(), canGoBack: () => true };
let mockConnected = true;
let mockStaff = false;
let mockParams = {};
const mockHandoff = jest.fn();
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: (...args: unknown[]) => mockHandoff(...args) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ selectedCohortId: 2 }) }));
let mockCohorts: PrivateMeetingCohort[];
const mockApi = { privateMeetings: jest.fn(), bookPrivateMeeting: jest.fn(), reschedulePrivateMeeting: jest.fn(), cancelPrivateMeeting: jest.fn(), createCohortDm: jest.fn() };
jest.mock('expo/fetch', () => ({ fetch: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: class {} }));
jest.mock('expo-network', () => ({ useNetworkState: () => ({ isConnected: mockConnected, isInternetReachable: mockConnected }), getNetworkStateAsync: async () => ({ isConnected: mockConnected }) }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useRouter: () => mockRouter, useFocusEffect: () => {} }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: { id: 9, is_staff: mockStaff } }) }));

beforeEach(() => {
  jest.clearAllMocks(); mockConnected = true; mockStaff = false; mockParams = {}; mockHandoff.mockResolvedValue(undefined); mockCohorts = [{ ...cohort }];
  jest.spyOn(Date, 'now').mockReturnValue(now);
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  mockApi.privateMeetings.mockImplementation(async () => ({ cohorts: mockCohorts }));
});
const clients: QueryClient[] = [];
afterEach(() => { jest.restoreAllMocks(); clients.forEach(client => client.clear()); clients.length = 0; });
function show(cached = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  clients.push(client);
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
it('moves once, keeps a meeting on dismissal, then cancels without allowing another self-booking', async () => {
  mockCohorts = [{ ...cohort, slots: [cohort.slots[0]], bookings: [booking] }];
  mockApi.reschedulePrivateMeeting.mockImplementation(async () => {
    const moved = { ...booking, starts_at: cohort.slots[0].starts_at, ends_at: cohort.slots[0].ends_at, reschedule_count: 1 };
    mockCohorts = [{ ...cohort, slots: [], bookings: [moved], bookable_week_numbers: [3] }];
    return { booking: moved };
  });
  const { screen } = show();
  await waitFor(() => expect(screen.getByTestId('reschedule-week-2')).toBeEnabled());
  fireEvent.press(screen.getByTestId('reschedule-week-2'));
  fireEvent.press(screen.getByTestId('meeting-slot-2-0'));
  expect(screen.getByText(/only remaining schedule change/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('meeting-confirm-submit'));
  await waitFor(() => expect(screen.getByText('Your meeting was moved.')).toBeTruthy());
  expect(mockApi.reschedulePrivateMeeting).toHaveBeenCalledWith(4, 12);
  await waitFor(() => expect(screen.getByTestId('cancel-week-2')).toBeEnabled());
  expect(screen.queryByTestId('reschedule-week-2')).toBeNull();
  fireEvent.press(screen.getByTestId('cancel-week-2'));
  fireEvent.press(screen.getByText('Keep meeting'));
  expect(mockApi.cancelPrivateMeeting).not.toHaveBeenCalled();
  expect(screen.getByText('Booked')).toBeTruthy();
  mockApi.cancelPrivateMeeting.mockImplementation(async () => {
    const cancelled = { ...mockCohorts[0].bookings[0], status: 'canceled' };
    mockCohorts = [{ ...mockCohorts[0], bookings: [cancelled] }];
    return { booking: cancelled };
  });
  fireEvent.press(screen.getByTestId('cancel-week-2'));
  expect(screen.getByText(/cannot book another time yourself/)).toBeTruthy();
  fireEvent.press(screen.getByTestId('meeting-confirm-submit'));
  await waitFor(() => expect(screen.getByText('Your meeting was cancelled.')).toBeTruthy());
  expect(mockApi.cancelPrivateMeeting).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/You have used your schedule change for Week 2/)).toBeTruthy();
});

it('preserves exact staff meeting context in authenticated web handoff', async () => {
  mockStaff = true; mockParams = { cohort_id: '4', booking_id: '81', week: '3' };
  const { screen } = show();
  fireEvent.press(screen.getByText('Manage on web'));
  await waitFor(() => expect(mockHandoff).toHaveBeenCalledWith(mockApi, '/admin/meetings?cohort_id=4&booking_id=81&week=3'));
});
it('opens the notified past week and identifies the booking', async () => {
  mockParams = { cohort_id: '2', booking_id: String(booking.id), week: String(booking.week_number) };
  mockCohorts = [{ ...cohort, bookings: [booking] }];
  const { screen } = show();
  await waitFor(() => expect(screen.getByText(`Meeting from your update · Booking ${booking.id}`)).toBeTruthy());
});

it('shows the canceled target without hiding the learner’s current scheduling actions', async () => {
  mockParams = { cohort_id: '2', booking_id: String(booking.id), week: String(booking.week_number) };
  mockCohorts = [{ ...cohort, bookings: [{ ...booking, status: 'canceled' }] }];
  const { screen } = show(); await ready(screen);
  expect(screen.getByText(`Meeting from your update · Booking ${booking.id}`)).toBeTruthy();
  expect(screen.getByText(/Canceled ·/)).toBeTruthy();
  expect(screen.getByTestId('meeting-slot-2-0')).toBeEnabled();
  expect(screen.queryByTestId('cancel-week-2')).toBeNull();
});
