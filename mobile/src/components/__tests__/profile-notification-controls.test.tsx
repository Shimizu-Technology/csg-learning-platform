import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import ProfileScreen from '../../app/(app)/(tabs)/profile';
import { attemptPushRegistration, getPushPermissionStatus, requestPushPermission } from '../../lib/push-notifications';

const mockRouter = { push: jest.fn() };
const mockQueryClient = { invalidateQueries: jest.fn().mockResolvedValue(undefined), setQueryData: jest.fn() };
const mockUser = { id: 7, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', is_staff: false, github_username: null, community_policy: null };
let mockApi: Record<string, jest.Mock>;
let mockFocusEffectCallback: (() => void | (() => void)) | null = null;
let mockFocusEffectCleanup: (() => void) | null = null;

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockFocusEffectCallback = callback;
      React.useEffect(() => {
        const cleanup = callback();
        mockFocusEffectCleanup = typeof cleanup === 'function' ? cleanup : null;
        return () => {
          if (typeof cleanup === 'function') cleanup();
          if (mockFocusEffectCleanup === cleanup) mockFocusEffectCleanup = null;
        };
      }, [callback]);
    },
  };
});
let mockDashboard: unknown;
let mockGithubApp = false;
const mockReloadBindings = jest.fn();
let mockDashboardError = false;
let mockProfile: unknown;
let mockReminder: { data?: { learner_nudges_enabled: boolean }; isError: boolean; refetch: jest.Mock } = { data: undefined, isError: false, refetch: jest.fn() };
const mockReminderQueries: unknown[] = [];
jest.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey, enabled }: { queryKey: unknown[]; enabled?: boolean }) => {
    if (queryKey[2] === 'dashboard') return { data: mockDashboard ? { dashboard: mockDashboard } : undefined, isError: mockDashboardError };
    if (queryKey[2] === 'profile') return { data: mockProfile, isError: false };
    if (queryKey[0] === 'github-bindings' && enabled) return { data: { bindings: [{ id: 1, full_name: 'school/practice', verification_state: 'verified' }] }, refetch: mockReloadBindings };
    if (queryKey[0] === 'nudge-preference') { mockReminderQueries.push(enabled); return enabled ? mockReminder : { data: undefined, isError: false, refetch: jest.fn() }; }
    return { data: undefined, isError: false };
  },
  useQueryClient: () => mockQueryClient,
  useMutation: (options: { mutationFn: (value?: unknown) => Promise<unknown>; onSuccess?: (data: unknown) => void; onError?: (error: Error) => void }) => ({
    isPending: false,
    mutate: (value?: unknown) => { void Promise.resolve(value).then(options.mutationFn).then((data) => options.onSuccess?.(data)).catch((error: Error) => options.onError?.(error)); },
  }),
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('../../lib/push-notifications', () => ({
  attemptPushRegistration: jest.fn(),
  getPushPermissionStatus: jest.fn(),
  pushPermissionAllowsDelivery: (status: string) => ['granted', 'provisional', 'ephemeral'].includes(status),
  requestPushPermission: jest.fn(),
}));
jest.mock('../../providers/cohort-provider', () => ({ useCohort: () => ({ selectedCohortId: 1, selectedCohort: { features: { github_app: mockGithubApp } } }) }));
const mockOpenWebPage = jest.fn();
jest.mock('../../lib/external-links', () => ({ openWebTask: (...args: unknown[]) => mockOpenWebPage(...args), openAuthenticatedWebPage: (...args: unknown[]) => mockOpenWebPage(...args) }));
jest.mock('../../providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('../../providers/session-provider', () => ({
  useSession: () => ({ api: mockApi, user: mockUser, enrollments: [{ id: 2, cohort: { id: 1 } }], refresh: jest.fn().mockResolvedValue(undefined), signOut: jest.fn() }),
}));

function continueThroughPrimer() {
  const primer = jest.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Turn on device notifications?');
  const continueAction = primer?.[2]?.find((action) => action.text === 'Continue');
  if (!continueAction?.onPress) throw new Error('Notification primer did not expose Continue');
  act(() => { continueAction.onPress?.(); });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusEffectCallback = null;
  mockFocusEffectCleanup = null;
  mockProfile = undefined;
  mockGithubApp = false;
  mockReminder = { data: undefined, isError: false, refetch: jest.fn() };
  mockReminderQueries.length = 0;
  mockApi = {
    profile: jest.fn(),
    updateNudgePreference: jest.fn().mockResolvedValue({ learner_nudges_enabled: false }),
    mobilePushConfig: jest.fn().mockResolvedValue({ notifications_enabled: false, active_device_count: 0 }),
    pushConfig: jest.fn().mockResolvedValue({ notifications_enabled: true }),
    updateMobilePushPreference: jest.fn().mockResolvedValue({ notifications_enabled: true }),
    updateGlobalNotifications: jest.fn().mockResolvedValue({ notifications_enabled: true }),
  };
  jest.mocked(getPushPermissionStatus).mockResolvedValue('undetermined');
  jest.mocked(requestPushPermission).mockResolvedValue('granted');
  jest.mocked(attemptPushRegistration).mockResolvedValue({ ok: true });
  jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());
  jest.spyOn(Linking, 'openSettings').mockResolvedValue();
});

describe('ProfileScreen course reminders', () => {
  const enrollment = { id: 1, cohort_id: 1, cohort_name: 'Python pilot', curriculum_name: 'Python', status: 'active', enrolled_at: null, can_open: true };

  it('stays hidden, without a request, unless an active enrollment sends reminders', async () => {
    mockProfile = { user: mockUser, enrollments: [enrollment, { ...enrollment, id: 2, status: 'dropped', learner_nudges_enabled: true }] };
    const screen = render(<ProfileScreen />);
    await screen.findByLabelText('Device notifications');
    expect(screen.queryByLabelText('Course reminders')).toBeNull();
    expect(mockReminderQueries.every((enabled) => enabled === false)).toBe(true);
  });

  it('turns optional reminders off and keeps the saved value', async () => {
    mockProfile = { user: mockUser, enrollments: [{ ...enrollment, learner_nudges_enabled: true }] };
    mockReminder = { data: { learner_nudges_enabled: true }, isError: false, refetch: jest.fn() };
    const screen = render(<ProfileScreen />);
    expect(screen.getByText('Before due dates, after a week away, and before your help period ends. Access-ending reminders always arrive.')).toBeTruthy();
    fireEvent(await screen.findByLabelText('Course reminders'), 'valueChange', false);
    await waitFor(() => expect(mockQueryClient.setQueryData).toHaveBeenCalledWith(['nudge-preference', 7], { learner_nudges_enabled: false }));
    expect(mockApi.updateNudgePreference).toHaveBeenCalledWith(false);
  });

  it('offers a retry when the setting cannot load and explains a failed save', async () => {
    mockProfile = { user: mockUser, enrollments: [{ ...enrollment, learner_nudges_enabled: true }] };
    mockReminder = { data: undefined, isError: true, refetch: jest.fn() };
    const screen = render(<ProfileScreen />);
    fireEvent.press(await screen.findByLabelText('Retry course reminders'));
    expect(mockReminder.refetch).toHaveBeenCalledTimes(1);
    screen.unmount();

    mockReminder = { data: { learner_nudges_enabled: true }, isError: false, refetch: jest.fn() };
    mockApi.updateNudgePreference.mockRejectedValueOnce(new Error('Offline'));
    const again = render(<ProfileScreen />);
    fireEvent(await again.findByLabelText('Course reminders'), 'valueChange', false);
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Could not update course reminders', 'Offline', undefined, expect.anything()));
  });
});

describe('ProfileScreen notification controls', () => {
  it('turns on the device switch only after permission and registration succeed', async () => {
    const screen = render(<ProfileScreen />);
    const deviceSwitch = await screen.findByLabelText('Device notifications');

    fireEvent(deviceSwitch, 'valueChange', true);
    continueThroughPrimer();

    await waitFor(() => expect(screen.getByLabelText('Device notifications').props.value).toBe(true));
    expect(mockApi.updateMobilePushPreference).toHaveBeenCalledWith(true);
    expect(attemptPushRegistration).toHaveBeenCalledTimes(1);
  });

  it('keeps device notifications off when permission is denied', async () => {
    jest.mocked(requestPushPermission).mockResolvedValueOnce('denied');
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);
    continueThroughPrimer();

    await waitFor(() => expect(screen.getByLabelText('Device notifications').props.value).toBe(false));
    expect(mockApi.updateMobilePushPreference).toHaveBeenCalledWith(false);
    expect(attemptPushRegistration).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Notifications are off', expect.any(String), expect.any(Array), expect.objectContaining({ userInterfaceStyle: expect.any(String) }));
    expect(screen.getByLabelText('Message emails')).toBeTruthy();
  });

  it('opens the settings recovery directly when permission was already denied', async () => {
    jest.mocked(getPushPermissionStatus).mockResolvedValueOnce('denied');
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);

    expect(Alert.alert).toHaveBeenCalledWith('Notifications are off', expect.any(String), expect.any(Array), expect.objectContaining({ userInterfaceStyle: expect.any(String) }));
    const recovery = jest.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Notifications are off');
    const openSettings = recovery?.[2]?.find((action) => action.text === 'Open Settings');
    act(() => { openSettings?.onPress?.(); });

    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
    expect(requestPushPermission).not.toHaveBeenCalled();
    expect(mockApi.updateMobilePushPreference).not.toHaveBeenCalled();
  });

  it('reloads the persisted device preference when denial cannot be saved', async () => {
    mockApi.mobilePushConfig.mockResolvedValue({ notifications_enabled: true, active_device_count: 1 });
    mockApi.updateMobilePushPreference.mockRejectedValueOnce(new Error('Preference unavailable'));
    jest.mocked(getPushPermissionStatus)
      .mockResolvedValueOnce('undetermined')
      .mockResolvedValueOnce('denied');
    jest.mocked(requestPushPermission).mockResolvedValueOnce('denied');
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);
    continueThroughPrimer();

    await waitFor(() => expect(mockApi.mobilePushConfig).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Device notifications').props.value).toBe(false);
    expect(screen.getByText('Off in device settings. Turn on to open Settings.')).toBeTruthy();
    expect(Alert.alert).toHaveBeenCalledWith('Notifications are off', expect.any(String), expect.any(Array), expect.objectContaining({ userInterfaceStyle: expect.any(String) }));
  });

  it('shows retry instead of guessing when denial recovery cannot reload the server preference', async () => {
    mockApi.mobilePushConfig
      .mockResolvedValueOnce({ notifications_enabled: true, active_device_count: 1 })
      .mockRejectedValueOnce(new Error('Config unavailable'));
    mockApi.updateMobilePushPreference.mockRejectedValueOnce(new Error('Preference unavailable'));
    jest.mocked(requestPushPermission).mockResolvedValueOnce('denied');
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);
    continueThroughPrimer();

    expect(await screen.findByText('Notifications unavailable')).toBeTruthy();
    expect(screen.getByLabelText('Retry notification preferences')).toBeTruthy();
    expect(screen.queryByLabelText('Device notifications')).toBeNull();
  });

  it('restores the device control after an enable preference request fails', async () => {
    mockApi.updateMobilePushPreference.mockRejectedValueOnce(new Error('Preference unavailable'));
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);
    continueThroughPrimer();

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Could not turn on device notifications', 'Preference unavailable', undefined, expect.objectContaining({ userInterfaceStyle: 'light' })));
    expect(screen.getByLabelText('Device notifications').props.value).toBe(false);
    expect(screen.getByLabelText('Message emails')).toBeTruthy();
  });

  it('restores the device control when an in-flight enable is superseded by navigation', async () => {
    let resolvePermission!: (status: 'granted') => void;
    jest.mocked(requestPushPermission).mockReturnValueOnce(new Promise((resolve) => { resolvePermission = resolve; }));
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);
    continueThroughPrimer();
    await waitFor(() => expect(screen.queryByLabelText('Device notifications')).toBeNull());

    act(() => { mockFocusEffectCleanup?.(); });
    await waitFor(() => expect(screen.getByLabelText('Device notifications').props.value).toBe(false));

    act(() => { resolvePermission('granted'); });
    await waitFor(() => expect(mockApi.updateMobilePushPreference).not.toHaveBeenCalled());
    expect(attemptPushRegistration).not.toHaveBeenCalled();

    act(() => { mockFocusEffectCallback?.(); });
    await waitFor(() => expect(mockApi.mobilePushConfig).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText('Device notifications').props.value).toBe(false);
  });

  it('rolls the account preference back when device registration fails', async () => {
    jest.mocked(attemptPushRegistration).mockResolvedValueOnce({ ok: false, message: 'Registration unavailable' });
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);
    continueThroughPrimer();

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Could not turn on device notifications', 'Registration unavailable', undefined, expect.objectContaining({ userInterfaceStyle: 'light' })));
    expect(screen.getByLabelText('Device notifications').props.value).toBe(false);
    expect(mockApi.updateMobilePushPreference.mock.calls).toEqual([[true], [false]]);
  });

  it('keeps the account state visible when registration and rollback both fail', async () => {
    jest.mocked(attemptPushRegistration).mockResolvedValueOnce({ ok: false, message: 'Registration unavailable' });
    mockApi.updateMobilePushPreference
      .mockResolvedValueOnce({ notifications_enabled: true })
      .mockRejectedValueOnce(new Error('Rollback unavailable'));
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);
    continueThroughPrimer();

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith(
      'Device notifications need attention',
      expect.stringContaining('Notifications remain on for your account'),
      undefined, expect.objectContaining({ userInterfaceStyle: 'light' }),
    ));
    expect(screen.getByLabelText('Device notifications').props.value).toBe(true);
    expect(screen.getByText('Reconnect this device')).toBeTruthy();
    expect(screen.getByLabelText('Retry device notification registration')).toBeTruthy();
    expect(mockApi.updateMobilePushPreference.mock.calls).toEqual([[true], [false]]);
  });

  it('prevents another message-email update while one is pending', async () => {
    let resolveUpdate!: (value: { notifications_enabled: boolean }) => void;
    mockApi.updateGlobalNotifications.mockReturnValueOnce(new Promise((resolve) => { resolveUpdate = resolve; }));
    const screen = render(<ProfileScreen />);
    const emailSwitch = await screen.findByLabelText('Message emails');

    fireEvent(emailSwitch, 'valueChange', false);

    await waitFor(() => expect(screen.queryByLabelText('Message emails')).toBeNull());
    expect(mockApi.updateGlobalNotifications).toHaveBeenCalledTimes(1);
    act(() => { resolveUpdate({ notifications_enabled: false }); });
    await waitFor(() => expect(screen.getByLabelText('Message emails').props.value).toBe(false));
  });

  it('does not let an older focus refresh overwrite a newer email choice', async () => {
    let resolveRefresh!: (value: { notifications_enabled: boolean }) => void;
    mockApi.pushConfig
      .mockResolvedValueOnce({ notifications_enabled: true })
      .mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    mockApi.updateGlobalNotifications.mockResolvedValueOnce({ notifications_enabled: false });
    const screen = render(<ProfileScreen />);
    const emailSwitch = await screen.findByLabelText('Message emails');

    act(() => {
      mockFocusEffectCallback?.();
      fireEvent(emailSwitch, 'valueChange', false);
    });
    await waitFor(() => expect(mockApi.updateGlobalNotifications).toHaveBeenCalledWith(false));
    act(() => { resolveRefresh({ notifications_enabled: true }); });

    await waitFor(() => expect(screen.getByLabelText('Message emails').props.value).toBe(false));
  });

  it('does not let a refresh started during an email update overwrite that update', async () => {
    let resolveUpdate!: (value: { notifications_enabled: boolean }) => void;
    let resolveRefresh!: (value: { notifications_enabled: boolean }) => void;
    mockApi.updateGlobalNotifications.mockReturnValueOnce(new Promise((resolve) => { resolveUpdate = resolve; }));
    mockApi.pushConfig
      .mockResolvedValueOnce({ notifications_enabled: true })
      .mockReturnValueOnce(new Promise((resolve) => { resolveRefresh = resolve; }));
    const screen = render(<ProfileScreen />);
    const emailSwitch = await screen.findByLabelText('Message emails');

    fireEvent(emailSwitch, 'valueChange', false);
    act(() => { mockFocusEffectCallback?.(); });
    await waitFor(() => expect(mockApi.pushConfig).toHaveBeenCalledTimes(2));

    await act(async () => { resolveUpdate({ notifications_enabled: false }); });
    act(() => { resolveRefresh({ notifications_enabled: true }); });

    await waitFor(() => expect(screen.getByLabelText('Message emails').props.value).toBe(false));
  });
});

describe('ProfileScreen course-specific controls', () => {
  const studentDashboard = (overrides: Record<string, unknown> = {}) => ({ enrolled: true, user: { id: 1, full_name: 'Maria Santos', role: 'student' }, cohort: { id: 1, name: 'Pilot', cohort_type: 'workshop', start_date: '2026-12-01', status: 'active', requires_github: false }, private_meetings_enabled: false, ...overrides });

  beforeEach(() => {
    mockDashboard = undefined;
    mockDashboardError = false;
    mockOpenWebPage.mockReset();
  });

  it('hides the GitHub card for a course that does not use GitHub', () => {
    mockDashboard = studentDashboard();
    const screen = render(<ProfileScreen />);
    expect(screen.queryByText(/GitHub/)).toBeNull();
  });

  it('shows the GitHub card when the course uses GitHub, or when the course cannot be loaded', () => {
    mockDashboard = studentDashboard({ cohort: { id: 1, name: 'Pilot', cohort_type: 'bootcamp', start_date: '2026-12-01', status: 'active', requires_github: true } });
    expect(render(<ProfileScreen />).queryAllByText(/GitHub/).length).toBeGreaterThan(0);

    mockDashboard = undefined;
    mockDashboardError = true;
    expect(render(<ProfileScreen />).queryAllByText(/GitHub/).length).toBeGreaterThan(0);
  });

  it('opens private meeting booking in the app', () => {
    mockDashboard = studentDashboard({ private_meetings_enabled: true });
    const screen = render(<ProfileScreen />);
    fireEvent.press(screen.getByRole('button', { name: 'Book your weekly private hour' }));
    expect(mockRouter.push).toHaveBeenCalledWith('/meetings');
    expect(mockOpenWebPage).not.toHaveBeenCalled();
  });
});

it('shows the verified App repository and opens its exact settings instead of editing the username', async () => {
  mockGithubApp = true;
  mockOpenWebPage.mockResolvedValue(undefined);
  const screen = render(<ProfileScreen />);
  expect(screen.getByText('school/practice · Verified')).toBeTruthy();
  expect(screen.queryByText('GitHub username')).toBeNull();
  fireEvent.press(screen.getByText('Manage GitHub repositories on web'));
  await waitFor(() => expect(mockOpenWebPage).toHaveBeenCalledWith(mockApi, '/profile#github-repository-1'));
});
