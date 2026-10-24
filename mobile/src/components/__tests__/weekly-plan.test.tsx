import { OldWeeklyPlanCard } from '../test-fixtures/old-weekly-plan';
import { fireEvent, render } from '@testing-library/react-native';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('../course-support-action', () => ({ CourseSupportAction: () => null }));
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

it('opens the named redo and catch-up recording in the plan source cohort', () => {
  const screen = render(<WeeklyPlanCard plan={{ enrolled: true, cohort: { id: 4, name: 'Pilot' }, week_number: 1, starts_on: '2026-07-20', ends_on: '2026-07-26', timezone: 'Pacific/Guam', summary: { required_count: 0, required_completed_count: 0, open_redo_count: 1, optional_count: 0 }, required: [], optional: [], redos: [{ id: 'redo-1', kind: 'redo', submission_id: 1, content_block_id: 8, lesson_id: 42, title: 'Exact redo', lesson_title: 'Lesson', feedback: null, state: 'open', submission_close_at: null }], recording_catch_up: [{ id: 'recording-9', recording_id: 9, cohort_id: 4, kind: 'recording', title: 'Exact replay', progress_percentage: 20, recorded_on: null }] }} />);
  fireEvent.press(screen.getByText('Exact redo'));
  expect(mockPush).toHaveBeenCalledWith('/lesson/42?cohort_id=4&block_id=8');
  fireEvent.press(screen.getByText('Exact replay'));
  expect(mockPush).toHaveBeenCalledWith('/recording/9?cohort_id=4');
});

it('presents self-paced course dates, next lesson and redos without alumni claims', () => {
  const screen = render(<WeeklyPlanCard plan={{ enrolled: true, mode: 'library', plan_kind: 'self_paced', course_overview: { course_name: 'Python Fundamentals', next_lesson: { lesson_id: 42, module_id: 2, title: 'Loops' } }, cohort: { id: 8, name: 'Python' }, timezone: 'Pacific/Guam', capabilities: { can_submit: true, read_only: false, support_mode: 'course_question', support_instructor_id: 9, access_expires_at: '2027-01-01T00:00:00Z', support_expires_at: '2026-12-01T00:00:00Z' }, redos: [{ id: 'redo-1', kind: 'redo', submission_id: 1, lesson_id: 40, content_block_id: 3, title: 'Try again', lesson_title: 'Branches', feedback: 'Handle zero', state: 'open', submission_close_at: null }] }} />);
  expect(screen.getByText('Python Fundamentals')).toBeTruthy();
  expect(screen.getByText(/Course access ends/)).toBeTruthy();
  expect(screen.getByText(/Instructor support through/)).toBeTruthy();
  expect(screen.queryByText('Alumni Learning Library')).toBeNull();
  expect(screen.getByText('Redo first')).toBeTruthy();
  fireEvent.press(screen.getByText('Loops'));
  expect(mockPush).toHaveBeenCalledWith('/lesson/42?cohort_id=8');
  fireEvent.press(screen.getByText('Try again'));
  expect(mockPush).toHaveBeenCalledWith('/lesson/40?cohort_id=8&block_id=3');
});

it('keeps the installed main card visible while updated clients prefer the course overview', () => {
  const plan = {
    enrolled: true, mode: 'library' as const, plan_kind: 'self_paced' as const,
    cohort: { id: 4, name: 'Pilot' }, timezone: 'Pacific/Guam',
    library_summary: { module_count: 1, lesson_count: 4, recording_count: 1 },
    course_overview: { course_name: 'Python Fundamentals', next_lesson: { lesson_id: 12, title: 'Python lists', module_id: 2 } },
  };
  const old = render(<OldWeeklyPlanCard plan={plan} />);
  expect(old.getByText('Alumni Learning Library · 1 modules · 4 lessons · 1 recordings')).toBeTruthy();
  old.unmount();
  const current = render(<WeeklyPlanCard plan={plan} />);
  expect(current.getByText('Python Fundamentals')).toBeTruthy();
  expect(current.getByText('Python lists')).toBeTruthy();
  expect(current.queryByText('Alumni Learning Library')).toBeNull();
});


it('shows a personal milestone and opens its next task in the source cohort', () => {
  const task = { lesson_id: 12, module_id: 2, title: 'Organizer frontend', required: true, available: true, completed: false };
  const screen = render(<WeeklyPlanCard plan={{ enrolled: true, plan_kind: 'self_paced', capabilities: { can_submit: true, read_only: false, support_mode: 'course_question', support_instructor_id: null, access_expires_at: '2026-12-05T00:00:00Z', support_expires_at: '2026-11-28T00:00:00Z' }, timezone: 'Pacific/Guam', cohort: { id: 9, name: 'Personal course' }, personal_plan: { title: 'Finish the organizer', description: 'One milestone at a time.', target_date: '2026-12-05', next_check_in_on: '2026-10-31', updated_at: '2026-10-24T10:00:00Z', required_count: 2, completed_count: 1, awaiting_review_count: 1, milestones: [{ title: 'React milestone', due_on: '2026-11-14', required_count: 1, completed_count: 0, lessons: [task] }], submission_deadlines: [{ lesson_id: 12, title: 'Backend deadline', closes_at: '2026-10-30T08:00:00Z', closed: true }], next_lesson: task, requirement_changes: [] } }} />);
  expect(screen.getByText('Finish the organizer')).toBeTruthy();
  expect(screen.getByText('React milestone')).toBeTruthy();
  expect(screen.getByText(/Course access ends/)).toBeTruthy();
  expect(screen.getByText(/Instructor support through/)).toBeTruthy();
  expect(screen.getByText(/Submissions closed/)).toBeTruthy();
  expect(screen.getByText('Milestone targets do not extend submission windows.')).toBeTruthy();
  expect(screen.getByText(/1 awaiting instructor review/)).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Open Organizer frontend, to do'));
  expect(mockPush).toHaveBeenCalledWith('/lesson/12?cohort_id=9');
  fireEvent.press(screen.getByText('Show all milestones'));
  expect(screen.getByText('Show current milestone')).toBeTruthy();
});
