import { StyleSheet, View, type ViewProps } from 'react-native';
import { makeStyles } from '@/providers/theme-provider';
import { PressableScale } from './pressable-scale';
export function Card({ children, style, onPress, label, ...props }: ViewProps & { onPress?: () => void; label?: string }) {
  const styles = useStyles();
  return onPress ? <PressableScale {...props} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={[styles.card, style]}>{children}</PressableScale> : <View {...props} style={[styles.card, style]}>{children}</View>;
}
const useStyles = makeStyles(({ colors: c, radius, shadow }) => StyleSheet.create({ card: { padding: 16, gap: 12, borderRadius: radius.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.border.strong, backgroundColor: c.surface.raised, ...shadow.raised } }));
