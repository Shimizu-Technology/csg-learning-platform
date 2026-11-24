import { fireEvent, render } from '@testing-library/react-native';
import { InstructorToday } from '../instructor-today';
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: {} }) }));
it('renders server inbox text and opens the exact native action', () => {
  const screen = render(<InstructorToday today={{ items: [{ id: 1, kind: 'help', urgent: false, student_record: true, user_id: 3, full_name: 'Alex Example', cohort_id: 4, cohort_name: 'Loops', text: 'How does this loop stop?', since: null, action_label: 'Reply', web_path: '/admin/help-requests/1', native_path: '/staff/support/1' }], counts: { help: 1 }, attention_remaining: 0, upcoming: [] }} />);
  expect(screen.getByText('How does this loop stop?')).toBeTruthy();
  fireEvent.press(screen.getByText('Reply'));
  expect(mockPush).toHaveBeenLastCalledWith('/staff/support/1');
  fireEvent.press(screen.getByText('Alex Example'));
  expect(mockPush).toHaveBeenLastCalledWith('/staff/student/3?cohort_id=4');
});
it('shows remaining attention instead of caught up', () => {
  const screen = render(<InstructorToday today={{ items: [], counts: {}, attention_remaining: 2, upcoming: [] }} />);
  expect(screen.queryByText("You're caught up")).toBeNull();
  expect(screen.getByText('2 more learners need attention → Support')).toBeTruthy();
});
it('uses singular copy, full counts and minute precision for upcoming meetings', () => {
  const time = jest.spyOn(Date.prototype, 'toLocaleTimeString').mockReturnValue('10:30 AM');
  const screen = render(<InstructorToday today={{ items: [], counts: { help: 1 }, attention_remaining: 0, upcoming: [{ title: 'Meeting · Alex · Loops', starts_at: '2026-11-17T00:30:00Z', web_path: '/admin/meetings' }] }} />);
  expect(screen.getByText('1 thing needs you')).toBeTruthy();
  expect(screen.getByText('Open help requests · 1')).toBeTruthy();
  expect(screen.getByText('10:30 AM · Meeting · Alex · Loops')).toBeTruthy();
  expect(time).toHaveBeenCalledWith(undefined, { hour: 'numeric', minute: '2-digit' });
  time.mockRestore();
});
it('uses singular remaining-attention copy', () => {
  const screen = render(<InstructorToday today={{ items: [], counts: {}, attention_remaining: 1, upcoming: [] }} />);
  expect(screen.getByText('1 more learner needs attention → Support')).toBeTruthy();
});
it('omits a cohort link when the message has no cohort name', () => {
  const screen = render(<InstructorToday today={{ items: [{ id: 1, kind: 'message', urgent: false, student_record: false, user_id: 3, full_name: 'Alex', cohort_id: 4, cohort_name: null, text: 'Hello', since: null, action_label: 'Open message', web_path: '/messages/dm/1', native_path: '/conversation/dm/1' }], counts: { message: 1 }, attention_remaining: 0, upcoming: [] }} />);
  expect(screen.queryByRole('link', { name: 'Alex' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Unread conversations · 1' })).toBeTruthy();
});
