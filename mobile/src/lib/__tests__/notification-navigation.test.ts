import { notificationArrived, notificationStack, type NavigationState } from '../notification-navigation';
function root(stack: NavigationState): NavigationState { return { routeNames: ['(app)'], routes: [{ name: '(app)', state: stack }] }; }
it('acknowledges Updates after the screen removes its announcement query', () => {
  const stack = notificationStack('/updates?announcement_id=12');
  stack.routes[0].state!.routes[0].params = {};
  expect(notificationArrived(root(stack), '/updates?announcement_id=12')).toBe(true);
});
it('requires the record id but not consumed anchor params', () => {
  const stack = notificationStack('/lesson/42?block_id=8');
  stack.routes[1].params = { id: '42' };
  expect(notificationArrived(root(stack), '/lesson/42?block_id=8')).toBe(true);
  expect(notificationArrived(root(stack), '/lesson/43?block_id=8')).toBe(false);
});
