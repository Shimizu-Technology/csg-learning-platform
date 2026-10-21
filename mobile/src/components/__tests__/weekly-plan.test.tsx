import { render } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/lib/analytics', () => ({ captureProductEvent: jest.fn() }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));

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
    expect(screen.getByLabelText('Open Required lesson, to do')).toBeTruthy();
  });

  it('shows truthful statuses: submitted work awaits review and a redo is open work', () => {
    const base = { kind: 'lesson' as const, module_id: 2, module_title: 'Python', lesson_type: 'exercise', required: true, scheduled_for: '2026-07-20', carried_forward: false, submission_close_at: null, submissions_closed: false };
    const screen = render(<WeeklyPlanCard plan={{
      enrolled: true, cohort: { id: 4, name: 'Pilot' }, week_number: 1, starts_on: '2026-07-20', ends_on: '2026-07-26', timezone: 'Pacific/Guam',
      summary: { required_count: 3, required_completed_count: 2, open_redo_count: 0, optional_count: 0 },
      required: [
        { ...base, id: 'lesson-1', lesson_id: 1, title: 'Checkpoint 1', state: 'completed', review_status: 'awaiting_review' },
        { ...base, id: 'lesson-2', lesson_id: 2, title: 'E1', state: 'completed', review_status: 'reviewed' },
        { ...base, id: 'lesson-3', lesson_id: 3, title: 'E2', state: 'open', review_status: 'redo_requested' },
      ],
      optional: [], redos: [], events: [], upcoming_unlocks: [], recording_catch_up: [],
    }} />);

    expect(screen.getByText('Awaiting review')).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.getByText('Redo')).toBeTruthy();
    expect(screen.getByText('2 of 3 required submitted or done')).toBeTruthy();
    expect(screen.getByText('1 awaiting your instructor’s review')).toBeTruthy();
    expect(screen.queryByText('open')).toBeNull();
  });

  it('never shows 100% when there is no required work this week', () => {
    const screen = render(<WeeklyPlanCard plan={{
      enrolled: true, cohort: { id: 4, name: 'Pilot' }, week_number: 1, starts_on: '2026-07-20', ends_on: '2026-07-26', timezone: 'Pacific/Guam',
      summary: { required_count: 0, required_completed_count: 0, open_redo_count: 0, optional_count: 0 },
      required: [], optional: [], redos: [], events: [], upcoming_unlocks: [], recording_catch_up: [],
    }} />);

    expect(screen.getByText('No required work is scheduled this week.')).toBeTruthy();
    expect(screen.queryByText('100%')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows live session times in ChST', () => {
    const screen = render(<WeeklyPlanCard plan={{
      enrolled: true, cohort: { id: 4, name: 'Pilot' }, week_number: 1, starts_on: '2026-07-20', ends_on: '2026-07-26', timezone: 'Pacific/Guam',
      summary: { required_count: 0, required_completed_count: 0, open_redo_count: 0, optional_count: 0 },
      required: [], optional: [], redos: [], upcoming_unlocks: [], recording_catch_up: [],
      events: [{ id: 'event-1', kind: 'live_class', office_hour_id: 1, title: 'Live class', description: null, starts_at: '2026-07-21T08:00:00Z', ends_at: '2026-07-21T09:30:00Z', meeting_url: 'https://zoom.us/j/1', timezone: 'Pacific/Guam', recurrence: 'once', event_kind: 'live_class' }],
    }} />);

    expect(screen.getByText('Live class · Tue 6:00 PM ChST')).toBeTruthy();
  });

  it('presents alumni enrollment as an open library without weekly requirements', () => {
    const screen = render(<WeeklyPlanCard plan={{
      enrolled: true,
      mode: 'library',
      cohort: { id: 9, name: 'CSG Alumni' },
      timezone: 'Pacific/Guam',
      library_summary: { module_count: 9, lesson_count: 79, recording_count: 79 },
      events: [],
      recording_catch_up: [],
    }} />);

    expect(screen.getByText('Alumni Learning Library')).toBeTruthy();
    expect(screen.getByLabelText('Browse the alumni learning library')).toBeTruthy();
    expect(screen.queryByText('Required work')).toBeNull();
    expect(screen.queryByText('This Week')).toBeNull();
  });
});
