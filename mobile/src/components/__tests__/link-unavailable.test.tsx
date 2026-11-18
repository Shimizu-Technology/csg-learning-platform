import { fireEvent, render, waitFor } from '@testing-library/react-native';
import LinkUnavailable from '../../app/(app)/link-unavailable';
import cases from '@/lib/fixtures/web-handoff-contract.json';
import { canHandoff } from '@/lib/web-handoff-policy';
let mockPath = '';
let mockRole = 'student';
const mockHandoff = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ path: mockPath }), useRouter: () => ({ back: jest.fn(), canGoBack: () => false }), usePathname: () => '/link-unavailable' }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: {}, user: { is_staff: mockRole !== 'student', is_admin: mockRole === 'admin' } }) }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: (...args: unknown[]) => mockHandoff(...args) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
it.each(cases)('matches server eligibility for $role $path ($status)', ({ path, role, status }) => {
  mockPath = path; mockRole = role;
  const user = { is_staff: role !== 'student', is_admin: role === 'admin' };
  expect(canHandoff(path, user)).toBe(status === 200);
  const screen = render(<LinkUnavailable />);
  expect(Boolean(screen.queryByLabelText('Open on the web'))).toBe(status === 200);
});
it('opens the accepted exact destination', async () => {
  mockPath = '/admin/cohorts/4/settings'; mockRole = 'instructor';
  const screen = render(<LinkUnavailable />);
  fireEvent.press(screen.getByLabelText('Open on the web'));
  await waitFor(() => expect(mockHandoff).toHaveBeenCalledWith({}, mockPath));
});
it('shows one Back control and a readable heading', () => {
  mockPath = '/staff/student/3?cohort_id=1'; mockRole = 'student';
  const screen = render(<LinkUnavailable />);
  expect(screen.getAllByRole('button').map((button) => button.props.accessibilityLabel)).toEqual(['Back to Today']);
  expect(screen.getByRole('header')).toHaveTextContent('This link needs the web app');
});
