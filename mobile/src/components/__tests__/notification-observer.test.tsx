import { act, render } from '@testing-library/react-native';

import { NotificationObserver } from '../notification-observer';

const mockPush = jest.fn();
const mockDismissTo = jest.fn();
let receive: ((response: unknown) => void) | undefined;

jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, dismissTo: mockDismissTo }) }));
jest.mock('expo-notifications', () => ({
  getLastNotificationResponseAsync: () => Promise.resolve(null),
  addNotificationResponseReceivedListener: (listener: (response: unknown) => void) => { receive = listener; return { remove: jest.fn() }; },
  clearLastNotificationResponseAsync: () => Promise.resolve(),
}));

it('puts Messages behind an anchored notification conversation and ignores a duplicate response', () => {
  const frame = jest.spyOn(global, 'requestAnimationFrame').mockImplementation((callback) => { callback(0); return 1; });
  render(<NotificationObserver />);
  const response = { notification: { request: { identifier: 'push-1', content: { data: { path: '/messages/dm/12', message_id: 45 } } } } };
  act(() => { receive?.(response); receive?.(response); });
  expect(mockDismissTo).toHaveBeenCalledTimes(1);
  expect(mockDismissTo).toHaveBeenCalledWith('/messages');
  expect(mockPush).toHaveBeenCalledWith('/conversation/dm/12?messageId=45');
  frame.mockRestore();
});
