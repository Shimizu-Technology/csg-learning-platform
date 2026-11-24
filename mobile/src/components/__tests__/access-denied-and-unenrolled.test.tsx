import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

const mockOpenWeb = jest.fn().mockResolvedValue(undefined);
const mockOpenExternal = jest.fn().mockResolvedValue(undefined);
const mockDashboard = jest.fn();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('@clerk/expo', () => ({ useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'locked@example.com' } } }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('@/components/cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ selectedCohortId: null }) }));
jest.mock('@/providers/session-provider', () => ({
  useSession: () => ({
    api: { dashboard: mockDashboard, weeklyPlan: jest.fn().mockResolvedValue({ weekly_plan: null }) },
    user: { id: 7, full_name: 'Maria', email: 'maria@example.com', role: 'student', is_staff: false, is_admin: false },
    error: 'Your verified email could not be confirmed.',
    loading: false,
    refresh: jest.fn(),
    signOut: jest.fn(),
  }),
}));
jest.mock('@/lib/external-links', () => ({
  openAuthenticatedWebPage: (...args: unknown[]) => mockOpenWeb(...args),
  openExternalPage: (...args: unknown[]) => mockOpenExternal(...args),
}));

// Native dependencies must be mocked before loading the screens.
// eslint-disable-next-line import/first
import AccessDeniedScreen from '../../app/(auth)/access-denied';
// eslint-disable-next-line import/first
import TodayScreen from '../../app/(app)/(tabs)/index';

describe('AccessDeniedScreen', () => {
  it('shows the support email contact and handles fallback when no mail app opens', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('No mail app'));
    const screen = render(<AccessDeniedScreen />);

    expect(screen.getByText('locked@example.com')).toBeTruthy();
    const supportBtn = screen.getByText(/Contact support \(codeschoolofguam@gmail\.com\)/);
    fireEvent.press(supportBtn);

    await waitFor(() => expect(screen.getByText(/No email app opened\. Email codeschoolofguam@gmail\.com/)).toBeTruthy());
  });
});

describe('TodayScreen unenrolled and pending purchases', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  });

  afterEach(() => {
    queryClient.clear();
  });

  function renderToday() {
    return render(
      <QueryClientProvider client={queryClient}>
        <TodayScreen />
      </QueryClientProvider>,
    );
  }

  it('shows pending-purchase confirmation state with authenticated web handoff', async () => {
    mockDashboard.mockResolvedValue({
      dashboard: {
        enrolled: false,
        user: { id: 7, full_name: 'Maria', role: 'student' },
        catalog_enabled: true,
        pending_purchases: [{ id: 20, cohort_id: 13, course_name: 'Python Fundamentals' }],
      },
    });
    const screen = renderToday();

    await waitFor(() => expect(screen.getByText('Confirming your enrollment in Python Fundamentals')).toBeTruthy());
    fireEvent.press(screen.getByText('Check enrollment on the web'));
    await waitFor(() => expect(mockOpenWeb).toHaveBeenCalledWith(expect.anything(), '/courses?checkout=return&purchase_id=20&offering_id=13'));
  });

  it('shows clear unenrolled guidance with browse and support actions instead of cohort-picker jargon', async () => {
    mockDashboard.mockResolvedValue({
      dashboard: {
        enrolled: false,
        user: { id: 7, full_name: 'Maria', role: 'student' },
        catalog_enabled: true,
        pending_purchases: [],
      },
    });
    const screen = renderToday();

    await waitFor(() => expect(screen.getByText('No course yet')).toBeTruthy());
    expect(screen.queryByText('No active learning path')).toBeNull();
    fireEvent.press(screen.getByText('Browse courses on the web'));
    await waitFor(() => expect(mockOpenWeb).toHaveBeenCalledWith(expect.anything(), '/courses'));
    expect(screen.getByText(/Contact support \(codeschoolofguam@gmail\.com\)/)).toBeTruthy();
  });
});
