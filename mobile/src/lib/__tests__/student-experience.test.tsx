import { render } from '@testing-library/react-native';
import type { StudentDashboard } from '@/lib/types';
import { demoDashboard } from '@/lib/demo-learning';
import { lessonTypeLabel, studentExperienceV2 } from '@/lib/student-experience';

// W8 PR 8.1: with the "New student experience" switch on, native screens read
// the lesson kind the server derives from its blocks; off, they stay as they were.
let mockFeatures: Record<string, boolean> = {};
const mockDashboard: StudentDashboard = {
  ...demoDashboard,
  modules: [{
    ...demoDashboard.modules![0], id: 901, name: 'Prework',
    lessons: [{ ...demoDashboard.modules![0].lessons[0], id: 902, title: 'Week 1 Overview: Debugging', lesson_type: 'exercise', kind: 'video', available: true }],
  }],
};
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return Object.fromEntries('ArrowLeft ArrowRight BookOpen CheckCircle2 Lock Clock3 RotateCcw Circle CircleDot CalendarClock LockKeyhole Check ChevronLeft'.split(' ').map((name) => [name, Icon]));
});
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false }), useLocalSearchParams: () => ({ id: '901', cohort_id: '1' }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: ({ queryKey }: { queryKey: unknown[] }) => ({ data: queryKey[2] === 'dashboard' ? { dashboard: mockDashboard } : undefined, refetch: jest.fn(), isPending: false, isRefetching: false, isFetching: false, error: null }) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: {}, user: { id: 1, is_staff: false }, enrollments: [] }) }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ cohorts: [{ id: 1, name: 'Cohort 3', features: mockFeatures }], selectedCohortId: 1, loading: false, error: null, stale: false, refresh: jest.fn() }) }));
jest.mock('@/components/back-button', () => ({ BackButton: () => null }));

// eslint-disable-next-line import/first
import ModuleScreen from '../../app/(app)/module/[id]';

it('reads the switch from resolved features, defaulting on', () => {
  expect(studentExperienceV2(undefined)).toBe(true);
  expect(studentExperienceV2({ student_experience_v2: false })).toBe(false);
  expect(lessonTypeLabel({ lesson_type: 'exercise', kind: 'reading' }, true)).toBe('Reading');
  expect(lessonTypeLabel({ lesson_type: 'exercise', kind: 'reading' }, false)).toBe('exercise');
  expect(lessonTypeLabel({ lesson_type: 'exercise' }, true)).toBe('exercise');
});

it('a module shows the real lesson kind with the switch on and the stored type when off', () => {
  mockFeatures = { student_experience_v2: true };
  const on = render(<ModuleScreen />);
  expect(on.getByText('Video · Required')).toBeTruthy();
  on.unmount();
  mockFeatures = { student_experience_v2: false };
  const off = render(<ModuleScreen />);
  expect(off.getByText('exercise · Required')).toBeTruthy();
  expect(off.queryByText('Video · Required')).toBeNull();
});
