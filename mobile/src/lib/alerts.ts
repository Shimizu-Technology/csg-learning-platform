import { haptic } from './haptics';
import { Alert, ActionSheetIOS, Appearance, type AlertButton, type AlertOptions, type ActionSheetIOSOptions } from 'react-native';
/** Read at invocation so native alerts track a live system appearance change. */
export const themedAlert = {
  alert(title: string, message?: string, buttons?: AlertButton[], options?: AlertOptions) {
    Alert.alert(title, message, buttons?.map((button) => button.style === 'destructive' ? { ...button, onPress: () => { haptic('destructive'); button.onPress?.(); } } : button), { ...options, userInterfaceStyle: Appearance.getColorScheme() === 'dark' ? 'dark' : 'light' });
  },
};
export function showThemedActionSheet(options: ActionSheetIOSOptions, callback: (index: number) => void) {
  ActionSheetIOS.showActionSheetWithOptions({ ...options, userInterfaceStyle: Appearance.getColorScheme() === 'dark' ? 'dark' : 'light' }, callback);
}
