import { Linking } from 'react-native';
import { SUPPORT_EMAIL } from '@/lib/config';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import type { StudentDashboard, WeeklyPlan } from '@/lib/types';
import { demoDashboard } from '@/lib/demo-learning';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockPush = jest.fn();
const mockCreateDm = jest.fn();
const mockAlert = jest.fn();
jest.mock('@/lib/alerts', () => ({ themedAlert: { alert: (...args: unknown[]) => mockAlert(...args) } }));
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
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: { createCohortDm: mockCreateDm }, user: { id: 1, is_staff: false }, enrollments: [] }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ selectedCohortId: 1 }) }));
jest.mock('@/components/cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('@/components/staff-curriculum', () => ({ StaffCurriculumLibrary: () => null }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: jest.fn(), openExternalPage: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ captureProductEvent: jest.fn() }));

// eslint-disable-next-line import/first
import LearnScreen from '../../app/(app)/(tabs)/learn';
// eslint-disable-next-line import/first
import TodayScreen from '../../app/(app)/(tabs)/index';

const initialCohort = mockDashboard.cohort;
const initialModules = mockDashboard.modules;
beforeEach(() => { mockPush.mockClear(); mockCreateDm.mockReset(); mockAlert.mockClear(); mockWeeklyPlan = null; mockDashboard.action_items = []; mockDashboard.modules = initialModules; mockDashboard.enrollment_status = 'active'; mockDashboard.personal_plan = null; mockDashboard.cohort = initialCohort; });
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
  mockWeeklyPlan = { enrolled: true, mode: 'library', plan_kind: 'self_paced', course_overview: { course_name: 'Python Course', next_lesson: null }, cohort: { id: 1, name: 'Python' }, timezone: 'Pacific/Guam', redos: [] };
  mockDashboard.action_items = [{ type: 'redo', submission_id: 7, content_block_id: 5, cohort_id: 1, lesson_id: 902, lesson_title: 'Revisit decisions', content_block_title: 'Fix the zero case', feedback: 'Include zero.' }];
  const screen = render(<TodayScreen />);
  expect(screen.getByText('Python Course')).toBeTruthy();
  expect(screen.getByText('Redo work')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Open redo for Revisit decisions'));
  expect(mockPush).toHaveBeenCalledWith('/lesson/902?cohort_id=1&block_id=5');
});

it('keeps the self-paced course overview available before lessons are assigned', () => {
  const previousModules = mockDashboard.modules;
  mockDashboard.modules = [];
  mockWeeklyPlan = { enrolled: true, mode: 'library', plan_kind: 'self_paced', course_overview: { course_name: 'Python Course', next_lesson: null }, cohort: { id: 1, name: 'Python' }, timezone: 'Pacific/Guam', redos: [] };
  const screen = render(<TodayScreen />);
  expect(screen.getByText('Python Course')).toBeTruthy();
  expect(screen.queryByText('Message your instructor')).toBeNull();
  expect(screen.queryByText('Alumni Learning Library')).toBeNull();
  mockDashboard.modules = previousModules;
});

it('shows paused enrollment and saved work instead of an active next task', () => {
  mockDashboard.enrollment_status = 'paused';
  mockDashboard.paused_since = '2026-11-14';
  const screen = render(<TodayScreen />);
  expect(screen.getByText(/Your enrollment is paused/)).toBeTruthy();
  expect(screen.getByText('Message staff')).toBeTruthy();
  expect(screen.queryByText('Course progress')).toBeNull();
  mockDashboard.enrollment_status = 'active';
});

it('starts an alumni library without a course progress percentage', () => {
  mockDashboard.cohort = { ...mockDashboard.cohort!, cohort_type: 'alumni' };
  const screen = render(<TodayScreen />);
  expect(screen.getByText('Continue Individually assigned lesson')).toBeTruthy();
  expect(screen.queryByText('Course progress')).toBeNull();
});

it('reports staff DM failure and offers configured email support', async () => {
  mockDashboard.enrollment_status = 'paused';
  mockDashboard.support_instructor_id = 7;
  mockCreateDm.mockRejectedValueOnce(new Error('offline'));
  const screen = render(<TodayScreen />);
  fireEvent.press(screen.getByText('Message staff'));
  await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Could not message staff', expect.stringContaining('email'), expect.arrayContaining([expect.objectContaining({ text: 'Email support' })])));
  expect(mockCreateDm).toHaveBeenCalledWith(initialCohort!.id, [7]);
  expect(mockPush).not.toHaveBeenCalled();
});

it('keeps alumni with a personal plan in the learning flow', () => {
  mockDashboard.cohort = { ...initialCohort!, cohort_type: 'alumni' };
  mockDashboard.personal_plan = { title: 'Personal plan', description: null, target_date: null, next_check_in_on: null, updated_at: '2026-11-14', required_count: 1, completed_count: 0, awaiting_review_count: 0, milestones: [], next_lesson: null, requirement_changes: [] };
  const screen = render(<TodayScreen />);
  expect(screen.queryByText('Recently added')).toBeNull();
  expect(screen.getByLabelText('Continue Individually assigned lesson')).toBeTruthy();
});

it('launches configured staff email with the native mail handler', async () => {
  const openEmail = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  mockDashboard.enrollment_status = 'paused';
  mockDashboard.support_instructor_id = null;
  try {
    const screen = render(<TodayScreen />);
    fireEvent.press(screen.getByText('Message staff'));
    await waitFor(() => expect(openEmail).toHaveBeenCalledWith(`mailto:${SUPPORT_EMAIL}`));
    expect(mockAlert).not.toHaveBeenCalled();
  } finally { openEmail.mockRestore(); }
});

it('shows an empty learning path when every assigned module has no lessons', () => {
  mockDashboard.modules = [{ ...initialModules![0], lessons: [] }];
  const screen = render(<LearnScreen />);
  expect(screen.getByText('0 modules')).toBeTruthy();
  expect(screen.getByText('No modules are assigned yet.')).toBeTruthy();
});

it('reports a rejected native email launch when no support instructor is available', async () => {
  const openEmail = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('No mail app'));
  mockDashboard.enrollment_status = 'paused';
  mockDashboard.support_instructor_id = null;
  try {
    const screen = render(<TodayScreen />);
    fireEvent.press(screen.getByText('Message staff'));
    await waitFor(() => expect(mockAlert).toHaveBeenCalledWith('Could not message staff', expect.stringContaining(SUPPORT_EMAIL), expect.any(Array)));
    expect(openEmail).toHaveBeenCalledWith(`mailto:${SUPPORT_EMAIL}`);
    expect(mockCreateDm).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  } finally { openEmail.mockRestore(); }
});

it('explains the pause cutoff when all remaining module lessons are hidden', () => {
  mockDashboard.enrollment_status = 'paused';
  mockDashboard.modules = [{ ...initialModules![0], lessons: [] }];
  const screen = render(<LearnScreen />);
  expect(screen.getByText('0 modules')).toBeTruthy();
  expect(screen.queryByLabelText('Open Individual assignments')).toBeNull();
  expect(screen.getByText('Only content from before your pause is shown here. Newer content opens when your enrollment resumes.')).toBeTruthy();
  expect(screen.queryByText('No modules are assigned yet.')).toBeNull();
});

it('opens the registered conversation route after creating the paused staff DM', async () => {
  mockDashboard.enrollment_status = 'paused';
  mockDashboard.support_instructor_id = 7;
  mockCreateDm.mockResolvedValueOnce({ direct_conversation: { id: 42 } });
  const screen = render(<TodayScreen />);
  fireEvent.press(screen.getByText('Message staff'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/conversation/dm/42'));
  expect(mockCreateDm).toHaveBeenCalledWith(initialCohort!.id, [7]);
  expect(mockAlert).not.toHaveBeenCalled();
});

it('omits the pause date for a historical pause with no known timestamp', () => {
  mockDashboard.enrollment_status = 'paused';
  mockDashboard.paused_since = null;
  const screen = render(<TodayScreen />);
  expect(screen.getByText('Your enrollment is paused. Your work is saved.')).toBeTruthy();
});
