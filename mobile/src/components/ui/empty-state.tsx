import { MessageSquareText, type LucideIcon } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { fonts, typography } from '@/constants/csg-theme';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { Button } from './button';
export function EmptyState({ title, copy, icon: Icon = MessageSquareText, action }: { title: string; copy: string; icon?: LucideIcon; action?: { label: string; onPress: () => void } }) {
  const styles = useStyles(); const { colors: c } = useTheme();
  return <View style={styles.root}><Icon color={c.text.muted} size={28} /><Text accessibilityRole="header" style={styles.title}>{title}</Text><Text style={styles.copy}>{copy}</Text>{action && <Button label={action.label} onPress={action.onPress} />}</View>;
}
const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({ root: { margin: 20, padding: 24, alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle }, title: { ...typography.section, color: c.text.strong, fontFamily: fonts.bold, textAlign: 'center' }, copy: { ...typography.body, color: c.text.body, fontFamily: fonts.regular, textAlign: 'center' } }));
