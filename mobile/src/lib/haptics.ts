import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
export type HapticMoment = 'success' | 'error' | 'selection' | 'destructive';
/** Call at the acknowledged outcome, once, alongside the visible result. */
export function haptic(moment: HapticMoment) {
  if (Platform.OS === 'web' || process.env.NODE_ENV === 'test') return;
  const effect = moment === 'selection' ? Haptics.selectionAsync()
    : moment === 'destructive' ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    : Haptics.notificationAsync(moment === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error);
  void effect.catch(() => undefined);
}
