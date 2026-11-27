import { Platform } from 'react-native';

export type HapticMoment = 'success' | 'error' | 'selection' | 'destructive';
/** Call at the acknowledged outcome, once, alongside the visible result. */
export function haptic(moment: HapticMoment) {
  if (Platform.OS === 'web' || process.env.NODE_ENV === 'test') return;
  void import('expo-haptics')
    .then((Haptics) => {
      if (moment === 'selection') return Haptics.selectionAsync();
      if (moment === 'destructive') return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return Haptics.notificationAsync(
        moment === 'success' ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Error,
      );
    })
    .catch(() => undefined);
}
