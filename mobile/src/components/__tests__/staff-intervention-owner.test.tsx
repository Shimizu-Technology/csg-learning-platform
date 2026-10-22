import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { demoInterventions } from '@/lib/demo-staff';
import type { Intervention } from '@/lib/types';
import StaffInterventionScreen from '../../app/(app)/staff/intervention/[id]';

const mockApi = { intervention: jest.fn(), updateIntervention: jest.fn() };
jest.mock('@/components/ui/pressable-scale', () => ({ PressableScale: jest.requireActual('react-native').Pressable }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: '41' }), useRouter: () => ({ push: jest.fn(), back: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: { id: 7, is_staff: true } }) }));
jest.mock('@/lib/analytics', () => ({ captureProductEvent: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: jest.fn() }));
jest.mock('@/lib/alerts', () => ({ themedAlert: { alert: jest.fn() } }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => { resolve = resolvePromise; reject = rejectPromise; });
  return { promise, resolve, reject };
}

async function show(overrides: Partial<Intervention> = {}) {
  const intervention: Intervention = { ...demoInterventions[0], id: 41, status: 'open', owner_valid: false, owner: { id: 99, full_name: 'Former Owner' }, ...overrides };
  const response = deferred<{ intervention: Intervention }>();
  mockApi.intervention.mockReturnValue(response.promise);
  // Disable GC timers and deliver notifications inside explicit act boundaries.
  // No polling or wall-clock timeout is needed for fetch/mutation completion.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const screen = render(<QueryClientProvider client={client}><StaffInterventionScreen /></QueryClientProvider>);
  await act(async () => { response.resolve({ intervention }); });
  return { screen, intervention };
}

const clients: QueryClient[] = [];
beforeEach(() => { jest.resetAllMocks(); notifyManager.setScheduler((callback) => callback()); });
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; notifyManager.setScheduler((callback) => setTimeout(callback, 0)); });

it('shows invalid ownership and saves reassignment before clearing the warning', async () => {
  const { screen, intervention } = await show();
  expect(screen.getByText('Owner can no longer access this cohort — reassign')).toBeTruthy();
  const response = deferred<{ intervention: Intervention }>();
  mockApi.updateIntervention.mockReturnValue(response.promise);
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Assign intervention to me' })); });
  expect(mockApi.updateIntervention).toHaveBeenCalledWith(41, { owner_id: 7 });
  expect(screen.getByText('Assigning…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Assign intervention to me' })).toBeDisabled();
  await act(async () => { response.resolve({ intervention: { ...intervention, owner_valid: true, owner: { id: 7, full_name: 'Current Staff' } } }); });
  expect(screen.queryByText('Owner can no longer access this cohort — reassign')).toBeNull();
  expect(screen.getByText(/owned by Current Staff/)).toBeTruthy();
});

it('keeps the warning and permits a successful retry after reassignment fails', async () => {
  const { screen, intervention } = await show();
  const response = deferred<{ intervention: Intervention }>();
  mockApi.updateIntervention.mockReturnValueOnce(response.promise);
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Assign intervention to me' })); });
  await act(async () => { response.reject(new Error('Owner must be an active cohort teacher')); });
  expect(screen.getByRole('button', { name: 'Assign intervention to me' })).toBeEnabled();
  expect(screen.getByText('Owner can no longer access this cohort — reassign')).toBeTruthy();
  expect(screen.getByText(/owned by Former Owner/)).toBeTruthy();
  mockApi.updateIntervention.mockResolvedValueOnce({ intervention: { ...intervention, owner_valid: true, owner: { id: 7, full_name: 'Current Staff' } } });
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Assign intervention to me' })); });
  expect(mockApi.updateIntervention).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('button', { name: 'Assign intervention to me' })).toBeNull();
  expect(screen.getByText(/owned by Current Staff/)).toBeTruthy();
});

it('keeps a valid owner free of reassignment warnings', async () => {
  const { screen } = await show({ owner_valid: true });
  expect(screen.getByText(/owned by Former Owner/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign intervention to me' })).toBeNull();
});

it.each(['resolved', 'canceled'] as const)('keeps a %s intervention with an invalid owner read-only', async (status) => {
  const { screen } = await show({ status, resolution_summary: 'Historical outcome remains visible.' });
  expect(screen.getByText(status.toUpperCase())).toBeTruthy();
  expect(screen.getByText('Historical outcome remains visible.')).toBeTruthy();
  expect(screen.getByText(/owned by Former Owner/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Assign intervention to me' })).toBeNull();
  expect(screen.queryByText('Owner can no longer access this cohort — reassign')).toBeNull();
  expect(screen.queryByText('QUICK UPDATE')).toBeNull();
  expect(mockApi.updateIntervention).not.toHaveBeenCalled();
});
