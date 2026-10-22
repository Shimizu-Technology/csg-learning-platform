import { notifyManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
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

function show(ownerValid = false) {
  const intervention: Intervention = { ...demoInterventions[0], id: 41, owner_valid: ownerValid, owner: { id: 99, full_name: 'Former Owner' } };
  mockApi.intervention.mockResolvedValue({ intervention });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
  clients.push(client);
  const screen = render(<QueryClientProvider client={client}><StaffInterventionScreen /></QueryClientProvider>);
  return { screen, intervention, client };
}

const clients: QueryClient[] = [];
beforeEach(() => { jest.clearAllMocks(); notifyManager.setScheduler((callback) => callback()); });
afterEach(() => { cleanup(); clients.forEach((client) => client.clear()); clients.length = 0; notifyManager.setScheduler((callback) => setTimeout(callback, 0)); });

it('shows invalid ownership and saves reassignment before clearing the warning', async () => {
  const { screen, intervention } = show();
  await screen.findByText('Owner can no longer access this cohort — reassign');
  let finish!: (value: { intervention: Intervention }) => void;
  mockApi.updateIntervention.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.press(screen.getByRole('button', { name: 'Assign intervention to me' }));
  await waitFor(() => expect(mockApi.updateIntervention).toHaveBeenCalledWith(41, { owner_id: 7 }));
  expect(screen.getByText('Assigning…')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Assign intervention to me' })).toBeDisabled();
  await act(async () => { finish({ intervention: { ...intervention, owner_valid: true, owner: { id: 7, full_name: 'Current Staff' } } }); });
  await waitFor(() => expect(screen.queryByText('Owner can no longer access this cohort — reassign')).toBeNull());
  expect(screen.getByText(/owned by Current Staff/)).toBeTruthy();
});

it('keeps the warning and offers retry after reassignment fails', async () => {
  mockApi.updateIntervention.mockRejectedValue(new Error('Owner must be an active cohort teacher'));
  const { screen } = show();
  await screen.findByText('Owner can no longer access this cohort — reassign');
  fireEvent.press(screen.getByRole('button', { name: 'Assign intervention to me' }));
  await waitFor(() => expect(mockApi.updateIntervention).toHaveBeenCalled());
  await waitFor(() => expect(screen.getByRole('button', { name: 'Assign intervention to me' })).toBeEnabled());
  expect(screen.getByText('Owner can no longer access this cohort — reassign')).toBeTruthy();
  expect(screen.getByText(/owned by Former Owner/)).toBeTruthy();
});

it('keeps a valid owner free of reassignment warnings', async () => {
  const { screen } = show(true);
  await screen.findByText(/owned by Former Owner/);
  expect(screen.queryByRole('button', { name: 'Assign intervention to me' })).toBeNull();
});
