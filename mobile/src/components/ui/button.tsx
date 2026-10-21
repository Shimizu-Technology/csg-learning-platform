import { Children, Fragment, cloneElement, isValidElement, type ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, Text, type PressableProps, type StyleProp, type TextStyle } from 'react-native';
import { fonts, typography } from '@/constants/csg-theme';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { PressableScale } from './pressable-scale';
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'success';
export type ButtonProps = Omit<PressableProps, 'children'> & { children?: React.ReactNode; label?: string; variant?: ButtonVariant; loading?: boolean; textStyle?: StyleProp<TextStyle>; foregroundColor?: string };
export function Button({ label, children, variant = 'primary', loading = false, disabled, style, textStyle, foregroundColor, accessibilityState, ...props }: ButtonProps) {
  const { colors: c } = useTheme();
  const styles = useStyles();
  const foreground = foregroundColor ?? (variant === 'primary' ? c.text.onAction : variant === 'danger' ? c.status.danger.fg : variant === 'success' ? c.status.success.fg : c.text.strong);
  const paint = (node: React.ReactNode): React.ReactNode => {
    const items = Children.toArray(node);
    if (items.every((item) => typeof item === 'string' || typeof item === 'number')) return <Text style={[styles.label, textStyle, { color: foreground }]}>{items.join('')}</Text>;
    return Children.map(node, (child) => {
    if (typeof child === 'string' || typeof child === 'number') return <Text style={[styles.label, textStyle, { color: foreground }]}>{child}</Text>;
    if (!isValidElement(child)) return child;
    const element = child as ReactElement<{ style?: StyleProp<TextStyle>; color?: string; children?: React.ReactNode }>;
    if (child.type === Fragment) return cloneElement(element, {}, paint(element.props.children));
    if (child.type === Text) return cloneElement(element, { style: [element.props.style, textStyle, { color: foreground }] });
    return element.props.color ? cloneElement(element, { color: foreground }) : child;
    });
  };
  return <PressableScale {...props} accessibilityRole={props.accessibilityRole ?? "button"} accessibilityLabel={props.accessibilityLabel ?? label} accessibilityState={{ ...accessibilityState, disabled: disabled || loading, busy: loading }} disabled={disabled || loading}
    style={(state) => {
      const caller = typeof style === 'function' ? style(state) : style;
      const flat = StyleSheet.flatten(caller);
      return [styles.base, caller, styles[variant], accessibilityState?.selected && variant === 'secondary' && styles.selected,
        { minHeight: Math.max(48, typeof flat?.minHeight === 'number' ? flat.minHeight : 0), minWidth: Math.max(44, typeof flat?.minWidth === 'number' ? flat.minWidth : 0) }];
    }}>
    {loading && <ActivityIndicator accessibilityLabel="Working" color={foreground} />}
    {label !== undefined ? <Text style={[styles.label, textStyle, { color: foreground }]}>{label}</Text> : typeof children === 'string' || typeof children === 'number' ? <Text style={[styles.label, textStyle, { color: foreground }]}>{children}</Text> : paint(children)}
  </PressableScale>;
}
const useStyles = makeStyles(({ colors: c, radius }) => StyleSheet.create({
  base: { minHeight: 48, minWidth: 44, borderRadius: radius.control, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1 },
  label: { ...typography.body, fontFamily: fonts.bold, textAlign: 'center', flexShrink: 1 },
  primary: { backgroundColor: c.action.primary, borderColor: c.action.primary },
  secondary: { backgroundColor: c.surface.raised, borderColor: c.border.strong },
  quiet: { backgroundColor: 'transparent', borderColor: 'transparent' },
  danger: { backgroundColor: c.status.danger.bg, borderColor: c.status.danger.border },
  success: { backgroundColor: c.status.success.bg, borderColor: c.status.success.border },
  selected: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator, borderWidth: 2 },
}));
