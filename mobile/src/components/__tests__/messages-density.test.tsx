import { act, fireEvent, render } from '@testing-library/react-native';
import MessagesScreen from '../../app/(app)/(tabs)/messages';
import { demoDms } from '@/lib/demo-data';
import type { DirectConversationSummary } from '@/lib/types';

const mockPush = jest.fn();
const workspaces = [{ id: 1, name: 'Python Pilot', workspace_type: 'cohort', member_count: 2 }];
let mockFocusCleanups: (() => void)[] = [];
let mockFocusEffects: (() => void | (() => void))[] = [];
let mockDemo = true;
let mockUser: { id: number; is_staff?: boolean } = { id: 9 };
let mockDms: DirectConversationSummary[] = [];
let mockPresenceListener: ((event: { user_id: number; last_seen_at: string }) => void) | null = null;

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => void | (() => void)) => {
    mockFocusEffects.push(effect);
  },
}));
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ setQueryData: jest.fn() }) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: mockDemo }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: {}, user: mockUser }) }));
jest.mock('@/providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces, activeWorkspaceId: 1, activeWorkspace: workspaces[0], loading: false, selectWorkspace: jest.fn() }) }));
jest.mock('@/hooks/use-inbox', () => ({ useInboxQuery: () => ({ data: { channels: [], dms: mockDms }, isPending: false, isFetching: false, isStale: false, refetch: jest.fn() }) }));
jest.mock('@/lib/cable', () => ({
  subscribeToUserMessages: jest.fn(() => () => {}),
  subscribeToStaffPresence: jest.fn((_api: unknown, onEvent: (event: { user_id: number; last_seen_at: string }) => void) => {
    mockPresenceListener = onEvent;
    return () => { mockPresenceListener = null; };
  }),
}));
jest.mock('@/lib/conversation-storage', () => ({
  loadConversationDrafts: jest.fn(async () => new Map()),
  subscribeDraftChanges: jest.fn(() => () => {}),
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));

function triggerFocus() {
  const toRun = mockFocusEffects;
  mockFocusEffects = [];
  mockFocusCleanups = [];
  for (const effect of toRun) {
    const cleanup = effect();
    if (typeof cleanup === 'function') mockFocusCleanups.push(cleanup);
  }
}

function triggerBlur() {
  for (const cleanup of mockFocusCleanups) cleanup();
  mockFocusCleanups = [];
}

beforeEach(() => {
  mockDemo = true;
  mockUser = { id: 9 };
  mockDms = [];
  mockFocusEffects = [];
  mockFocusCleanups = [];
  mockPresenceListener = null;
});

afterEach(() => {
  triggerBlur();
  jest.restoreAllMocks();
});

it('keeps title, workspace and search in one header and expands search only on demand', () => {
  const screen = render(<MessagesScreen />);
  expect(screen.getByTestId('compact-inbox-header')).toBeTruthy();
  expect(screen.getAllByText('Messages')).toHaveLength(1);
  expect(screen.queryByLabelText('Filter conversations')).toBeNull();
  fireEvent.press(screen.getByLabelText('Search conversations'));
  expect(screen.getByLabelText('Filter conversations')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Search people and messages'));
  expect(mockPush).toHaveBeenCalledWith('/search');
  fireEvent.press(screen.getByLabelText('Close search'));
  expect(screen.queryByLabelText('Filter conversations')).toBeNull();
});

it('refreshes the presence clock immediately on refocus without waiting for an interval tick', () => {
  const baseNow = Date.parse('2026-11-26T12:00:00.000Z');
  let fakeNow = baseNow;
  jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);

  mockDemo = false;
  mockUser = { id: 9, is_staff: true };
  mockDms = [{
    ...demoDms[0],
    id: 31,
    workspace_id: 1,
    title: 'Maya Santos',
    unread_count: 0,
    muted: false,
    users: [
      { id: 9, full_name: 'Leon Shimizu', role: 'admin', avatar_url: null },
      { id: 18, full_name: 'Maya Santos', role: 'student', avatar_url: null },
    ],
    latest_message: {
      id: 201,
      author_id: 18,
      author_name: 'Maya Santos',
      created_at: '2026-11-26T11:55:00.000Z',
      body: 'Ready for review',
    },
  }];

  const screen = render(<MessagesScreen />);
  act(() => { triggerFocus(); });
  act(() => {
    mockPresenceListener?.({ user_id: 18, last_seen_at: new Date(baseNow).toISOString() });
  });
  expect(screen.getByLabelText(/Active now/)).toBeTruthy();

  // Blur for 3 minutes (past the 2-minute online window), then refocus with no new presence event.
  act(() => { triggerBlur(); });
  fakeNow = baseNow + 3 * 60_000;
  screen.rerender(<MessagesScreen />);
  act(() => { triggerFocus(); });
  expect(screen.queryByLabelText(/Active now/)).toBeNull();
});
