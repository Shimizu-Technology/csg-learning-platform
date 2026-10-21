import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { fonts, typography } from '@/constants/csg-theme';
import { makeStyles, useTheme } from '@/providers/theme-provider';
export function LoadingState({ label = 'Loading conversations' }: { label?: string }) {
  const styles = useStyles(); const { colors: c } = useTheme();
  return <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={styles.root}><ActivityIndicator color={c.text.body} /><Text style={styles.label}>{label}</Text></View>;
}
const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({ root: { paddingVertical: 64, paddingHorizontal: 24, alignItems: 'center', gap: 12 }, label: { ...typography.body, color: c.text.body, fontFamily: fonts.regular, textAlign: 'center' } }));
