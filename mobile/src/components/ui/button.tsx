import { ActivityIndicator, StyleSheet, Text, type PressableProps, type StyleProp, type TextStyle } from 'react-native';
import { fonts, typography } from '@/constants/csg-theme';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { PressableScale } from './pressable-scale';
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonProps = Omit<PressableProps, 'children'> & { children?: React.ReactNode; label?: string; variant?: ButtonVariant; loading?: boolean; textStyle?: StyleProp<TextStyle> };
export function Button({ label, children, variant = 'primary', loading = false, disabled, style, textStyle, accessibilityState, ...props }: ButtonProps) {
  const { colors: c } = useTheme();
  const styles = useStyles();
  const foreground = variant === 'primary' ? c.text.onAction : variant === 'danger' ? c.status.danger.fg : c.text.strong;
  return <PressableScale {...props} accessibilityRole={props.accessibilityRole ?? "button"} accessibilityLabel={props.accessibilityLabel ?? label} accessibilityState={{ ...accessibilityState, disabled: disabled || loading, busy: loading }} disabled={disabled || loading}
    style={(state) => [styles.base, variant === 'primary' ? styles.primary : variant === 'danger' ? styles.danger : variant === 'secondary' ? styles.secondary : styles.quiet, typeof style === 'function' ? style(state) : style]}>
    {loading && <ActivityIndicator accessibilityLabel="Working" color={foreground} />}
    {label !== undefined ? <Text style={[styles.label, textStyle, { color: foreground }]}>{label}</Text> : typeof children === 'string' || typeof children === 'number' ? <Text style={[styles.label, textStyle, { color: foreground }]}>{children}</Text> : children}
  </PressableScale>;
}
const useStyles = makeStyles(({ colors: c, radius }) => StyleSheet.create({
  base: { minHeight: 48, minWidth: 44, borderRadius: radius.control, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1 },
  label: { ...typography.body, fontFamily: fonts.bold, textAlign: 'center', flexShrink: 1 },
  primary: { backgroundColor: c.action.primary, borderColor: c.action.primary },
  secondary: { backgroundColor: c.surface.raised, borderColor: c.border.strong },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: c.status.danger.bg, borderColor: c.status.danger.border },
}));
