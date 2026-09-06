import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert, Linking } from 'react-native';

import ProfileScreen from '../../app/(app)/(tabs)/profile';
import { attemptPushRegistration, getPushPermissionStatus, requestPushPermission } from '../../lib/push-notifications';

const mockRouter = { push: jest.fn() };
const mockQueryClient = { invalidateQueries: jest.fn().mockResolvedValue(undefined) };
const mockUser = { id: 7, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', is_staff: false, github_username: null, community_policy: null };
let mockApi: Record<string, jest.Mock>;

jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0' }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react') as typeof import('react');
  return {
    useRouter: () => mockRouter,
    useFocusEffect: (callback: () => void | (() => void)) => React.useEffect(callback, [callback]),
  };
});
jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined }),
  useQueryClient: () => mockQueryClient,
  useMutation: () => ({ isPending: false, mutate: jest.fn() }),
}));
jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    Bell: Icon, Check: Icon, ChevronRight: Icon, FileText: Icon, GitBranch: Icon,
    GraduationCap: Icon, LogOut: Icon, Mail: Icon, RefreshCw: Icon, Save: Icon,
    Settings2: Icon, ShieldCheck: Icon, Trash2: Icon, UserX: Icon,
  };
});
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('../../lib/push-notifications', () => ({
  attemptPushRegistration: jest.fn(),
  getPushPermissionStatus: jest.fn(),
  pushPermissionAllowsDelivery: (status: string) => ['granted', 'provisional', 'ephemeral'].includes(status),
  requestPushPermission: jest.fn(),
}));
jest.mock('../../providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('../../providers/session-provider', () => ({
  useSession: () => ({ api: mockApi, user: mockUser, refresh: jest.fn().mockResolvedValue(undefined), signOut: jest.fn() }),
}));

function continueThroughPrimer() {
  const primer = jest.mocked(Alert.alert).mock.calls.find(([title]) => title === 'Turn on device notifications?');
  const continueAction = primer?.[2]?.find((action) => action.text === 'Continue');
  if (!continueAction?.onPress) throw new Error('Notification primer did not expose Continue');
  act(() => { continueAction.onPress?.(); });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockApi = {
    profile: jest.fn(),
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
    expect(Alert.alert).toHaveBeenCalledWith('Notifications are off', expect.any(String), expect.any(Array));
    expect(screen.getByLabelText('Message emails')).toBeTruthy();
  });

  it('restores the device control after an enable preference request fails', async () => {
    mockApi.updateMobilePushPreference.mockRejectedValueOnce(new Error('Preference unavailable'));
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);
    continueThroughPrimer();

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Could not turn on device notifications', 'Preference unavailable'));
    expect(screen.getByLabelText('Device notifications').props.value).toBe(false);
    expect(screen.getByLabelText('Message emails')).toBeTruthy();
  });

  it('rolls the account preference back when device registration fails', async () => {
    jest.mocked(attemptPushRegistration).mockResolvedValueOnce({ ok: false, message: 'Registration unavailable' });
    const screen = render(<ProfileScreen />);

    fireEvent(await screen.findByLabelText('Device notifications'), 'valueChange', true);
    continueThroughPrimer();

    await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Could not turn on device notifications', 'Registration unavailable'));
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
});
