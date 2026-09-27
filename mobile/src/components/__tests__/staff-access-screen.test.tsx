import { useQuery } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react-native';

import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: jest.fn() }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return { Search: Icon, Users: Icon, AlertCircle: Icon, MessageSquareText: Icon };
});

// eslint-disable-next-line import/first
import StaffAccessScreen from '../../app/(app)/staff/access';

const cohorts = [
  { id: 4, name: 'Alumni', status: 'active', start_date: '2026-09-01' },
  { id: 5, name: 'Bootcamp', status: 'active', start_date: '2026-09-01' },
];
const students = [
  { user_id: 10, full_name: 'Joined Alum', email: 'joined@example.com', github_username: 'joined', last_sign_in_at: '2026-09-27T00:00:00Z', invite_pending: false, invite_delivery_status: 'accepted' },
  { user_id: 11, full_name: 'Invited Alum', email: 'invited@example.com', github_username: 'invited', last_sign_in_at: null, invite_pending: true, invite_delivery_status: 'sent' },
];

describe('staff access roster', () => {
  let githubError = false;
  let organization: string | null = 'Alumni-Org';

  beforeEach(() => {
    githubError = false;
    organization = 'Alumni-Org';
    jest.mocked(useCsgAuth).mockReturnValue({ demo: false } as ReturnType<typeof useCsgAuth>);
    jest.mocked(useSession).mockReturnValue({ user: { id: 1, is_staff: true }, api: {} } as ReturnType<typeof useSession>);
    jest.mocked(useQuery).mockImplementation((options) => {
      const key = options.queryKey as unknown[];
      if (key[0] === 'staff-access-cohorts') return { data: { cohorts }, isPending: false } as ReturnType<typeof useQuery>;
      if (key[0] === 'staff-access') return { data: { cohort: { id: key[1], name: key[1] === 4 ? 'Alumni' : 'Bootcamp', github_organization_name: organization, students: key[1] === 4 ? students : [] } }, isPending: false } as ReturnType<typeof useQuery>;
      return { data: { organization: 'Alumni-Org', checked_at: '2026-09-27T00:00:00Z', statuses: { '10': 'member', '11': 'invited' } }, isError: githubError, error: githubError ? new Error('GitHub unavailable') : null } as ReturnType<typeof useQuery>;
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('filters invitation states and changes cohorts without keeping old students', () => {
    const screen = render(<StaffAccessScreen />);
    expect(screen.getByText('Joined Alum')).toBeTruthy();
    fireEvent.press(screen.getByText('GitHub invited'));
    expect(screen.getByText('Invited Alum')).toBeTruthy();
    expect(screen.queryByText('Joined Alum')).toBeNull();

    fireEvent.press(screen.getByText('Bootcamp'));
    expect(screen.queryByText('Invited Alum')).toBeNull();
    expect(screen.getByText('0 of 0 enrolled')).toBeTruthy();
    expect(jest.mocked(useQuery).mock.calls.some(([options]) => (options.queryKey as unknown[])[1] === 5)).toBe(true);
    expect(jest.mocked(useQuery).mock.calls.some(([options]) => (options.queryKey as unknown[]).join(':') === 'staff-github-access:5:Alumni-Org')).toBe(true);
  });

  it('does not show verified statuses or enable GitHub filters after a failed check', () => {
    githubError = true;
    const screen = render(<StaffAccessScreen />);
    expect(screen.getByText('GitHub status could not be checked. Pull down to retry.')).toBeTruthy();
    expect(screen.getAllByText('GitHub status unavailable')).toHaveLength(2);
    expect(screen.queryByText(/GitHub checked/)).toBeNull();
    expect(screen.getByRole('button', { name: 'GitHub invited' }).props.accessibilityState.disabled).toBe(true);

    organization = null;
    screen.rerender(<StaffAccessScreen />);
    expect(screen.queryByText('GitHub status unavailable')).toBeNull();
    expect(jest.mocked(useQuery).mock.calls.some(([options]) => options.queryKey[0] === 'staff-github-access' && options.queryKey[2] === null && !options.enabled)).toBe(true);
  });
});
