import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

const mockOpenWeb = jest.fn().mockResolvedValue(undefined);
const mockOpenExternal = jest.fn().mockResolvedValue(undefined);
const mockDashboard = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
const mockRouterNavigate = jest.fn();
const mockCohortRefresh = jest.fn().mockResolvedValue(undefined);
const mockSignOut = jest.fn().mockResolvedValue(undefined);
const mockAuthState = { demo: false, loaded: true, signedIn: true };
const mockSessionState = { loading: false, accessDenied: true };
let mockPathname = '/access-denied';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('@clerk/expo', () => ({ useUser: () => ({ user: { primaryEmailAddress: { emailAddress: 'locked@example.com' } } }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush, navigate: mockRouterNavigate, replace: mockRouterReplace }),
  usePathname: () => mockPathname,
  Redirect: ({ href }: { href: string }) => {
    const { Text: RNText } = jest.requireActual('react-native');
    return <RNText testID="redirect">{String(href)}</RNText>;
  },
  Stack: () => {
    const { Text: RNText } = jest.requireActual('react-native');
    return <RNText testID="auth-stack">stack</RNText>;
  },
}));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('@/components/cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => mockAuthState }));
jest.mock('@/providers/cohort-provider', () => ({
  useCohort: () => ({
    selectedCohortId: null,
    selectedCohort: null,
    loading: false,
    error: null,
    stale: false,
    refresh: mockCohortRefresh,
  }),
}));
jest.mock('@/providers/session-provider', () => ({
  useSession: () => ({
    api: { dashboard: mockDashboard, weeklyPlan: jest.fn().mockResolvedValue({ weekly_plan: null }) },
    user: { id: 7, full_name: 'Maria', email: 'maria@example.com', role: 'student', is_staff: false, is_admin: false },
    enrollments: [],
    error: 'Your verified email could not be confirmed.',
    loading: mockSessionState.loading,
    accessDenied: mockSessionState.accessDenied,
    refresh: jest.fn(),
    signOut: mockSignOut,
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
import AuthLayout from '../../app/(auth)/_layout';
// eslint-disable-next-line import/first
import TodayScreen from '../../app/(app)/(tabs)/index';
// eslint-disable-next-line import/first
import LearnScreen from '../../app/(app)/(tabs)/learn';

describe('AccessDeniedScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.loaded = true;
    mockAuthState.signedIn = true;
    mockSessionState.loading = false;
    mockSessionState.accessDenied = true;
    mockPathname = '/access-denied';
  });

  it('shows the support email contact and handles fallback when no mail app opens', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('No mail app'));
    const screen = render(<AccessDeniedScreen />);

    expect(screen.getByText('locked@example.com')).toBeTruthy();
    const supportBtn = screen.getByText(/Contact support \(codeschoolofguam@gmail\.com\)/);
    fireEvent.press(supportBtn);

    await waitFor(() => expect(screen.getByText(/No email app opened\. Email codeschoolofguam@gmail\.com/)).toBeTruthy());
  });

  it('routes directly back to sign-in after signing out to switch accounts', async () => {
    const screen = render(<AccessDeniedScreen />);
    fireEvent.press(screen.getByText('Use a different account'));

    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(mockRouterReplace).toHaveBeenCalledWith('/(auth)/sign-in');
  });

  it('redirects away from /access-denied to sign-in when signed out', () => {
    mockAuthState.signedIn = false;
    mockSessionState.accessDenied = false;

    const screen = render(<AccessDeniedScreen />);
    expect(screen.getByTestId('redirect').props.children).toBe('/(auth)/sign-in');

    const layout = render(<AuthLayout />);
    expect(layout.getByTestId('redirect').props.children).toBe('/(auth)/sign-in');
  });
});

describe('TodayScreen and LearnScreen unenrolled and pending purchases', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthState.loaded = true;
    mockAuthState.signedIn = true;
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

  function renderLearn() {
    return render(
      <QueryClientProvider client={queryClient}>
        <LearnScreen />
      </QueryClientProvider>,
    );
  }

  it('shows pending-purchase confirmation state with authenticated web handoff and refreshes cohorts on Refresh status', async () => {
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

    fireEvent.press(screen.getByText('Refresh status'));
    await waitFor(() => expect(mockCohortRefresh).toHaveBeenCalledTimes(1));
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

  it('refreshes accessible cohorts when tapping Refresh status on unenrolled Learn', async () => {
    const screen = renderLearn();
    expect(screen.getByText('No course yet')).toBeTruthy();
    fireEvent.press(screen.getByText('Refresh status'));
    await waitFor(() => expect(mockCohortRefresh).toHaveBeenCalledTimes(1));
  });
});
