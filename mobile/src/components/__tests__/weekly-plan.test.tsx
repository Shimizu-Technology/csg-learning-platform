import { render } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/analytics', () => ({ captureProductEvent: jest.fn() }));
jest.mock('lucide-react-native', () => {
  const Icon = () => null;
  return {
    ArrowRight: Icon,
    CalendarClock: Icon,
    Check: Icon,
    CircleAlert: Icon,
    Clock3: Icon,
    Film: Icon,
    LockKeyhole: Icon,
    RotateCcw: Icon,
    Sparkles: Icon,
  };
});

// Native dependencies must be mocked before loading the component.
// eslint-disable-next-line import/first
import { WeeklyPlanCard } from '../weekly-plan';

describe('WeeklyPlanCard', () => {
  it('presents required and optional work as separate accessible sections', () => {
    const screen = render(<WeeklyPlanCard plan={{
      enrolled: true,
      cohort: { id: 4, name: 'Cohort 4' },
      week_number: 3,
      starts_on: '2026-07-20',
      ends_on: '2026-07-26',
      timezone: 'Pacific/Guam',
      summary: { required_count: 1, required_completed_count: 0, open_redo_count: 0, optional_count: 1 },
      required: [{ id: 'lesson-1', kind: 'lesson', lesson_id: 1, module_id: 2, title: 'Required lesson', module_title: 'Foundations', lesson_type: 'exercise', required: true, scheduled_for: '2026-07-20', carried_forward: false, state: 'open', submission_close_at: null, submissions_closed: false }],
      optional: [{ id: 'lesson-2', kind: 'lesson', lesson_id: 2, module_id: 2, title: 'Stretch lesson', module_title: 'Foundations', lesson_type: 'reading', required: false, scheduled_for: '2026-07-22', carried_forward: false, state: 'upcoming', submission_close_at: null, submissions_closed: false }],
      redos: [], events: [], upcoming_unlocks: [], recording_catch_up: [],
    }} />);

    expect(screen.getByText('This Week')).toBeTruthy();
    expect(screen.getByText('Required work')).toBeTruthy();
    expect(screen.getByText('Optional stretch')).toBeTruthy();
    expect(screen.getByLabelText('Open Required lesson')).toBeTruthy();
  });
});
