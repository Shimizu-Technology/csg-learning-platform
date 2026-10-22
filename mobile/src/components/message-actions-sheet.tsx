import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { fonts } from '@/constants/csg-theme';
import { REACTION_OPTIONS } from '@/lib/reactions';
import type { Message } from '@/lib/types';
import { makeStyles, useTheme } from '@/providers/theme-provider';

type Props = {
  message: Message | null; onClose: () => void; onReact: (message: Message, value: string) => void;
  error?: string | null; busy?: boolean;
  actions: { label: string; onPress: () => void; destructive?: boolean }[];
};

export function MessageActionsSheet({ message, onClose, onReact, actions, error, busy }: Props) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  return <Modal visible={Boolean(message)} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}><View style={styles.overlay}>
    <Pressable accessibilityRole="button" accessibilityLabel="Close message actions" disabled={busy} onPress={onClose} style={StyleSheet.absoluteFill} />
    <View accessibilityViewIsModal style={styles.sheet}><ScrollView contentContainerStyle={styles.content}>
      <Text accessibilityRole="header" style={styles.title}>Message actions</Text>
      {error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
      {busy && <Text style={styles.label}>Saving…</Text>}
      {message && !message.blocked && !message.deleted_at && <View style={styles.reactions}>{REACTION_OPTIONS.map(({ value, label, Icon }) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`React with ${label.toLowerCase()}`} disabled={busy} onPress={() => { onReact(message, value); onClose(); }} style={styles.reaction}><Icon color={c.text.strong} size={20} /><Text style={styles.label}>{label}</Text></Pressable>)}</View>}
      {actions.map((action) => <Button key={action.label} disabled={busy} variant={action.destructive ? 'danger' : 'secondary'} onPress={action.onPress}>{action.label}</Button>)}
      <Button variant="secondary" disabled={busy} onPress={onClose}>Cancel</Button>
    </ScrollView></View>
  </View></Modal>;
}
const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
  sheet: { maxHeight: '85%', backgroundColor: c.surface.raised, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  content: { padding: 20, paddingBottom: 36, gap: 8 },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 14 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 18, marginBottom: 8 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reaction: { minWidth: 60, minHeight: 60, flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8, borderRadius: 12, backgroundColor: c.surface.sunken },
  label: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12 },
}));
