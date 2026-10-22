import { fireEvent, render } from '@testing-library/react-native';
import type { StudentDashboard, WeeklyPlan } from '@/lib/types';
import { demoDashboard } from '@/lib/demo-learning';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockPush = jest.fn();
let mockWeeklyPlan: WeeklyPlan | null = null;
const mockDashboard: StudentDashboard = {
  ...demoDashboard,
  overall_progress: { completed: 0, total: 1, percentage: 0 },
  modules: [{
    ...demoDashboard.modules![0], id: 901, name: 'Individual assignments',
    assigned: false, unlocked: false, available: true,
    total_blocks: 1, completed_blocks: 0, progress_percentage: 0,
    lessons: [{ ...demoDashboard.modules![0].lessons[0], id: 902, title: 'Individually assigned lesson', available: true, total_blocks: 1, completed_blocks: 0, completed: false }],
  }],
  continue_lesson: { id: 902, title: 'Individually assigned lesson' },
  action_items: [], recently_graded: [],
};
jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return Object.fromEntries('AlertTriangle ArrowRight BadgeCheck BookOpen CalendarCheck CalendarClock CalendarDays ClipboardCheck Clock3 ExternalLink Hourglass LifeBuoy Megaphone MessageSquare RotateCcw Users BookMarked Film FolderOpen Lock LockKeyhole Search Check CheckCircle2 Circle CircleDot ClipboardList Sparkles'.split(' ').map((name) => [name, Icon]));
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryKey[2] === 'dashboard' ? { dashboard: mockDashboard } : mockWeeklyPlan ? { weekly_plan: mockWeeklyPlan } : undefined, refetch: jest.fn(), isPending: false, isRefetching: false }) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: {}, user: { id: 1, is_staff: false }, enrollments: [] }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ selectedCohortId: 1 }) }));
jest.mock('@/components/cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('@/components/staff-curriculum', () => ({ StaffCurriculumLibrary: () => null }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: jest.fn(), openExternalPage: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ captureProductEvent: jest.fn() }));

// eslint-disable-next-line import/first
import LearnScreen from '../../app/(app)/(tabs)/learn';
// eslint-disable-next-line import/first
import TodayScreen from '../../app/(app)/(tabs)/index';

beforeEach(() => { mockPush.mockClear(); mockWeeklyPlan = null; mockDashboard.action_items = []; });
it('native Learn renders and opens a lesson-only parent module using projected counts', () => {
  const screen = render(<LearnScreen />);
  expect(screen.getByText('0 of 1 learning steps · 1 lessons')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Open Individual assignments'));
  expect(mockPush).toHaveBeenCalledWith({ pathname: '/module/[id]', params: { id: '901', cohort_id: '1' } });
});
it('native Today offers the individually assigned next lesson instead of an empty-course state', () => {
  const screen = render(<TodayScreen />);
  expect(screen.queryByText('Your course is getting ready')).toBeNull();
  fireEvent.press(screen.getByLabelText('Continue Individually assigned lesson'));
  expect(mockPush).toHaveBeenCalledWith('/lesson/902');
});

it('keeps dashboard redos visible when a self-paced overview has no redo projection', () => {
  mockWeeklyPlan = { enrolled: true, mode: 'self_paced', course_name: 'Python Course', cohort: { id: 1, name: 'Python' }, timezone: 'Pacific/Guam', redos: [] };
  mockDashboard.action_items = [{ type: 'redo', submission_id: 7, content_block_id: 5, cohort_id: 1, lesson_id: 902, lesson_title: 'Revisit decisions', content_block_title: 'Fix the zero case', feedback: 'Include zero.' }];
  const screen = render(<TodayScreen />);
  expect(screen.getByText('Python Course')).toBeTruthy();
  expect(screen.getByText('Redo work')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Open redo for Revisit decisions'));
  expect(mockPush).toHaveBeenCalledWith('/lesson/902?cohort_id=1&block_id=5');
});
