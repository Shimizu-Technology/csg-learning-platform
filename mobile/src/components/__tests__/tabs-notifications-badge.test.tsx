import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import TabsLayout from '@/app/(app)/(tabs)/_layout';

import { readAllNotifications, updatesKeys, type NotificationListPayload, type PagedUpdates } from '@/lib/updates-cache';

const capturedScreens: Record<string, Record<string, unknown>> = {};
const mockApi = {
  channels: jest.fn(),
  directConversations: jest.fn(),
  notifications: jest.fn(),
};
const mockState = {
  user: { id: 12, role: 'student', is_staff: false } as { id: number; role: string; is_staff: boolean } | null,
  selectedCohort: { id: 4, features: { announcements: true } } as { id: number; features?: Record<string, boolean> } | null,
  demo: false,
};

jest.mock('expo-router', () => {
  function Tabs({ children }: { children: React.ReactNode }) { return <>{children}</>; }
  function TabsScreen({ name, options }: { name: string; options: Record<string, unknown> }) {
    capturedScreens[name] = options;
    return null;
  }
  Tabs.Screen = TabsScreen;
  return { Tabs };
});
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: mockState.demo }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: mockState.user }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ selectedCohort: mockState.selectedCohort }) }));

function notificationsPage(unreadCount: number): NotificationListPayload {
  return {
    notifications: [],
    unread_count: unreadCount,
    meta: { page: 1, per_page: 50, total_count: unreadCount, total_pages: 1, has_next_page: false, has_prev_page: false },
  };
}

describe('TabsLayout unread notifications badge', () => {
  let appStateListener: ((state: AppStateStatus) => void) | null = null;
  let client: QueryClient;

  beforeEach(() => {
    Object.keys(capturedScreens).forEach((key) => delete capturedScreens[key]);
    mockState.user = { id: 12, role: 'student', is_staff: false };
    mockState.selectedCohort = { id: 4, features: { announcements: true } };
    mockState.demo = false;
    mockApi.channels.mockResolvedValue({ channels: [] });
    mockApi.directConversations.mockResolvedValue({ direct_conversations: [] });
    mockApi.notifications.mockResolvedValue(notificationsPage(3));
    appStateListener = null;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateListener = handler;
      return { remove: jest.fn() };
    });
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  });

  afterEach(() => {
    client.clear();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('shows unread badge for students, updates singular/zero labels when read, and refreshes stale state on foreground return', async () => {
    render(<QueryClientProvider client={client}><TabsLayout /></QueryClientProvider>);

    await waitFor(() => {
      expect(capturedScreens.updates?.tabBarBadge).toBe('3');
    });
    expect(capturedScreens.updates?.tabBarAccessibilityLabel).toBe('Updates, 3 unread notifications');
    expect(capturedScreens.updates?.href).toBeUndefined();

    // Update cache to 1 unread -> singular accessible label
    act(() => {
      client.setQueryData<PagedUpdates<NotificationListPayload>>(updatesKeys.notifications(12), {
        pages: [notificationsPage(1)],
        pageParams: [1],
      });
    });
    await waitFor(() => {
      expect(capturedScreens.updates?.tabBarBadge).toBe('1');
      expect(capturedScreens.updates?.tabBarAccessibilityLabel).toBe('Updates, 1 unread notification');
    });

    // Mark all read clears the badge to undefined
    act(() => {
      client.setQueryData<PagedUpdates<NotificationListPayload>>(updatesKeys.notifications(12), (current) => (
        current ? { ...current, pages: current.pages.map((page) => readAllNotifications(page, '2026-11-23T00:00:00Z')!) } : current
      ));
    });
    await waitFor(() => {
      expect(capturedScreens.updates?.tabBarBadge).toBeUndefined();
      expect(capturedScreens.updates?.tabBarAccessibilityLabel).toBe('Updates');
    });

    // Returning to foreground refetches stale notifications and shows updated badge
    mockApi.notifications.mockResolvedValueOnce(notificationsPage(105));
    await act(async () => {
      await client.invalidateQueries({ queryKey: updatesKeys.notifications(12), refetchType: 'none' });
      appStateListener?.('active');
    });
    await waitFor(() => {
      expect(capturedScreens.updates?.tabBarBadge).toBe('99+');
      expect(capturedScreens.updates?.tabBarAccessibilityLabel).toBe('Updates, 105 unread notifications');
    });
  });

  it('hides the student Updates tab when cohort announcements are off while keeping staff access', async () => {
    mockState.selectedCohort = { id: 4, features: { announcements: false } };
    const { rerender } = render(<QueryClientProvider client={client}><TabsLayout /></QueryClientProvider>);
    await waitFor(() => {
      expect(capturedScreens.updates?.href).toBeNull();
    });

    mockState.user = { id: 1, role: 'instructor', is_staff: true };
    rerender(<QueryClientProvider client={client}><TabsLayout /></QueryClientProvider>);
    await waitFor(() => {
      expect(capturedScreens.updates?.href).toBeUndefined();
      expect(capturedScreens.updates?.tabBarBadge).toBe('3');
    });
  });
});
