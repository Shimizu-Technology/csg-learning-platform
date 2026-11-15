import { render } from '@testing-library/react-native';
import TabsLayout from '../../app/(app)/(tabs)/_layout';
let mockRole = 'student';
const mockScreens: Record<string, { href?: string | null }> = {};
jest.mock('expo-router', () => {
  const Tabs = ({ children }: { children: React.ReactNode }) => children;
  const Screen = ({ name, options }: { name: string; options: { href?: string | null } }) => { mockScreens[name] = options; return null; };
  Screen.displayName = 'MockTabsScreen';
  Tabs.Screen = Screen;
  return { Tabs };
});
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ user: { role: mockRole } }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ selectedCohort: { features: { announcements: false } } }) }));
jest.mock('@/hooks/use-inbox', () => ({ useInboxQuery: () => ({}), inboxUnreadCount: () => 0, tabBadgeLabel: () => undefined }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
it.each(['student', 'instructor', 'admin'])('applies learner announcement switch for %s tabs', (role) => {
  mockRole = role;
  render(<TabsLayout />);
  expect(mockScreens.updates.href).toBe(role === 'student' ? null : undefined);
});
