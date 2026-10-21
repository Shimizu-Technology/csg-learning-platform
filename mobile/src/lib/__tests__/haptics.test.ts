import * as Haptics from 'expo-haptics';
import { haptic } from '../haptics';
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(), selectionAsync: jest.fn(), impactAsync: jest.fn() }));
it('never calls native vibration in tests', () => {
  for (const moment of ['success', 'error', 'selection', 'destructive'] as const) haptic(moment);
  expect(Haptics.notificationAsync).not.toHaveBeenCalled();
  expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  expect(Haptics.impactAsync).not.toHaveBeenCalled();
});
