import { fireEvent, render } from '@testing-library/react-native';
import { BackButton } from '../back-button';
jest.mock('lucide-react-native', () => ({ ArrowLeft: () => null }));
let mockPath = '/staff/submission/31';
const mockRouter = { canGoBack: jest.fn(), back: jest.fn(), replace: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, usePathname: () => mockPath }));
beforeEach(() => { jest.clearAllMocks(); mockPath = '/staff/submission/31'; });
it('uses real history before the parent fallback', () => {
  mockRouter.canGoBack.mockReturnValue(true);
  const screen = render(<BackButton />);
  fireEvent.press(screen.getByRole('button', { name: 'Back to Grading' }));
  expect(mockRouter.back).toHaveBeenCalled(); expect(mockRouter.replace).not.toHaveBeenCalled();
});
it.each([['/staff/submission/31', '/staff/grading', 'Grading'], ['/staff/intervention/3', '/staff/support', 'Support'], ['/lesson/42', '/learn', 'Learn'], ['/conversation/dm/3', '/messages', 'Messages'], ['/cohort/2/schedule', '/cohort/2', 'Cohort'], ['/recording/3', '/recordings', 'Recordings'], ['/cohort/2', '/', 'Today']])('falls back from %s to %s', (path, href, label) => {
  mockPath = path; mockRouter.canGoBack.mockReturnValue(false);
  const screen = render(<BackButton />);
  const button = screen.getByRole('button', { name: `Back to ${label}` });
  expect(button).toHaveStyle({ minWidth: 44, minHeight: 44 });
  fireEvent.press(button); expect(mockRouter.replace).toHaveBeenCalledWith(href);
});
it('preserves an editor unsaved-changes guard', () => {
  const guard = jest.fn(); const screen = render(<BackButton onPress={guard} />);
  fireEvent.press(screen.getByRole('button')); expect(guard).toHaveBeenCalled(); expect(mockRouter.back).not.toHaveBeenCalled();
});
