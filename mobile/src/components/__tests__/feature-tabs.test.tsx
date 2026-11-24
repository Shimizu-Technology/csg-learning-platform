import { StyleSheet, type ViewProps } from 'react-native';
import { render } from '@testing-library/react-native';
import TabsLayout from '../../app/(app)/(tabs)/_layout';
let mockRole = 'student';
type ScreenOptions = { href?: string | null; tabBarIcon?: (props: { color: string; focused: boolean }) => React.ReactElement<{ children: React.ReactElement<ViewProps>[] }> };
const mockScreens: Record<string, ScreenOptions> = {};
const mockQueryClient = { refetchQueries: jest.fn() };
jest.mock('expo-router', () => {
  const Tabs = ({ children }: { children: React.ReactNode }) => children;
  const Screen = ({ name, options }: { name: string; options: ScreenOptions }) => { mockScreens[name] = options; return null; };
  Screen.displayName = 'MockTabsScreen';
  Tabs.Screen = Screen;
  return { Tabs };
});
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockQueryClient }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ user: { role: mockRole, is_staff: mockRole !== 'student' } }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ selectedCohort: { features: { announcements: false } } }) }));
jest.mock('@/hooks/use-inbox', () => ({ useInboxQuery: () => ({}), inboxUnreadCount: () => 0, tabBadgeLabel: () => undefined }));
jest.mock('@/hooks/use-notifications', () => ({ useNotificationsQuery: () => ({}), notificationsUnreadCount: () => 0 }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
it.each(['student', 'instructor', 'admin'])('shows the correct work tabs for %s', (role) => {
  mockRole = role;
  render(<TabsLayout />);
  expect(mockScreens.updates.href).toBe(role === 'student' ? null : undefined);
  expect(mockScreens.learn.href).toBe(role === 'student' ? undefined : null);
  expect(mockScreens.grading.href).toBe(role === 'student' ? null : undefined);
  expect(mockScreens.support.href).toBe(role === 'student' ? null : undefined);
});

it.each(['grading', 'support'])('shows the same focus indicator on the %s tab as on Today', (tab) => {
  mockRole = 'instructor';
  render(<TabsLayout />);
  const indicator = (name: string, focused: boolean) => {
    const icon = mockScreens[name].tabBarIcon!({ color: '#fff', focused });
    const [bar] = icon.props.children;
    return StyleSheet.flatten(bar.props.style);
  };
  expect(indicator(tab, true)).toEqual(indicator('index', true));
  expect(indicator(tab, true).backgroundColor).not.toBe('transparent');
  expect(indicator(tab, false).backgroundColor).toBe('transparent');
});
