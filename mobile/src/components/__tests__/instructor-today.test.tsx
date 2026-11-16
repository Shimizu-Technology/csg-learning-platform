import { fireEvent, render } from '@testing-library/react-native';
import { InstructorToday } from '../instructor-today';
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: {} }) }));
it('renders server inbox text and opens the exact native action', () => {
  const screen = render(<InstructorToday today={{ items: [{ id: 1, kind: 'help', user_id: 3, full_name: 'Alex Example', cohort_id: 4, cohort_name: 'Loops', text: 'How does this loop stop?', since: null, action_label: 'Reply', web_path: '/admin/help-requests/1', native_path: '/staff/support/1' }], counts: { help: 1 }, upcoming: [] }} />);
  expect(screen.getByText('How does this loop stop?')).toBeTruthy();
  fireEvent.press(screen.getByText('Reply'));
  expect(mockPush).toHaveBeenLastCalledWith('/staff/support/1');
  fireEvent.press(screen.getByText('Alex Example'));
  expect(mockPush).toHaveBeenLastCalledWith('/staff/student/3?cohort_id=4');
});
