import { StyleSheet, Text, View, type ViewProps } from 'react-native';
import { fonts, typography } from '@/constants/csg-theme';
import { makeStyles, useTheme } from '@/providers/theme-provider';
export type BadgeTone = 'neutral' | 'pending' | 'success' | 'warning' | 'danger' | 'brand';
export function Badge({ label, tone = 'neutral', children, style, ...props }: ViewProps & { label: string; tone?: BadgeTone }) {
  const { colors: c } = useTheme(); const styles = useStyles();
  const pair = tone === 'brand' ? { fg: c.text.onAction, bg: c.action.primary, border: c.action.primary } : tone === 'neutral' ? c.status.pending : c.status[tone];
  return <View {...props} style={[styles.base, { backgroundColor: pair.bg, borderColor: pair.border }, style]}>{children}<Text style={[styles.label, { color: pair.fg }]}>{label}</Text></View>;
}
const useStyles = makeStyles(() => StyleSheet.create({ base: { alignSelf: 'flex-start', maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5 }, label: { ...typography.label, fontFamily: fonts.bold, flexShrink: 1 } }));
