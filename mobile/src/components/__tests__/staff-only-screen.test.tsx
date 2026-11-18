import { fireEvent, render } from '@testing-library/react-native';
import { StaffOnlyScreen } from '../staff-only-screen';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), canGoBack: () => false, replace: mockReplace }), usePathname: () => '/cohort/1/schedule' }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));

it('gives a learner Back and a way to the tabs from a staff-only screen', () => {
  const screen = render(<StaffOnlyScreen message="An instructor or admin manages the cohort schedule." />);
  expect(screen.getByLabelText('Back to Cohort')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Go to Today'));
  expect(mockReplace).toHaveBeenCalledWith('/');
});
