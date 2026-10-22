import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { demoHelpRequests, demoStaffDashboardForCohort } from '@/lib/demo-staff';
import TodayScreen from '@/app/(app)/(tabs)/index';
import CohortHomeScreen from '@/app/(app)/cohort/[id]';

const mockPush = jest.fn();
let mockCohortId = 4;
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }), useLocalSearchParams: () => ({ id: String(mockCohortId) }) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: true }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: {}, user: { id: 7, is_staff: true } }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ selectedCohortId: mockCohortId, cohorts: [], selectCohort: jest.fn() }) }));
jest.mock('@/providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: [], selectWorkspace: jest.fn() }) }));
jest.mock('@/components/cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('@/components/weekly-plan', () => ({ WeeklyPlanCard: () => null }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));

beforeEach(() => { mockCohortId = 4; mockPush.mockClear(); });
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}>{children}</QueryClientProvider>;
}
it('Today removes attention rows and summary counts when selecting the empty cohort', async () => {
  const screen = render(<TodayScreen />, { wrapper });
  await waitFor(() => expect(screen.getByText('1 help request awaiting a staff response')).toBeTruthy());
  expect(demoStaffDashboardForCohort(4).attention?.summary).toMatchObject({ student_count: 3, checked_enrollment_count: 3, ungraded_count: 3, redo_count: 1 });
  mockCohortId = 5;
  screen.rerender(<TodayScreen />);
  await waitFor(() => expect(screen.getByText('Everyone’s on track')).toBeTruthy());
  expect(screen.queryByText('1 help request awaiting a staff response')).toBeNull();
  expect(demoStaffDashboardForCohort(5).attention?.summary).toEqual({ student_count: 0, checked_enrollment_count: 0, ungraded_count: 0, redo_count: 0, reason_counts: {} });
});
it('cohort home renders demo reasons and opens the existing help request with enrollment context', async () => {
  const screen = render(<CohortHomeScreen />, { wrapper });
  await waitFor(() => expect(screen.getByText('1 help request awaiting a staff response')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Respond to help · Maya Santos · Web Dev Cohort 4'));
  expect(demoHelpRequests.some((request) => request.id === 41)).toBe(true);
  expect(mockPush).toHaveBeenLastCalledWith('/staff/support/41?cohort_id=4&student_id=18&enrollment_id=1');
  expect(demoStaffDashboardForCohort(4).attention?.students[0].reasons?.[0].source_ids).toEqual([41]);
  mockCohortId = 5;
  screen.rerender(<CohortHomeScreen />);
  await waitFor(() => expect(screen.getByText('Everyone’s on track')).toBeTruthy());
  expect(screen.queryByText('1 help request awaiting a staff response')).toBeNull();
});
