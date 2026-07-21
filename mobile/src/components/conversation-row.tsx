import { BellOff, ChevronRight, Hash } from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, palette } from '@/constants/csg-theme';
import type { ChannelSummary, DirectConversationSummary } from '@/lib/types';
import { Avatar } from './avatar';

export function ConversationRow({ kind, item, onPress }: { kind: 'channel' | 'dm'; item: ChannelSummary | DirectConversationSummary; onPress: () => void }) {
  const channel = kind === 'channel' ? item as ChannelSummary : null;
  const title = channel ? channel.name : (item as DirectConversationSummary).title;
  const preview = item.latest_message ? `${item.latest_message.author_name}: ${item.latest_message.body}` : 'No messages yet';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {channel ? <View style={styles.channelIcon}><Hash color={palette.rubySoft} size={20} /></View> : <Avatar name={title} />}
      <View style={styles.copy}>
        <View style={styles.line}><Text numberOfLines={1} style={[styles.title, item.unread_count > 0 && styles.unreadTitle]}>{title}</Text>{item.muted && <BellOff color={palette.quiet} size={14} />}</View>
        <Text numberOfLines={1} style={[styles.preview, item.unread_count > 0 && styles.unreadPreview]}>{preview}</Text>
        <Text numberOfLines={1} style={styles.workspace}>{item.workspace_name}</Text>
      </View>
      {item.unread_count > 0 ? <View style={styles.badge}><Text style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text></View> : <ChevronRight color={palette.quiet} size={18} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  pressed: { opacity: 0.72 },
  channelIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A151B', borderWidth: 1, borderColor: '#4A2029' },
  copy: { flex: 1, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: '#C9CED8', fontFamily: fonts.semibold, fontSize: 15, flexShrink: 1 },
  unreadTitle: { color: palette.text, fontFamily: fonts.bold },
  preview: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 13 },
  unreadPreview: { color: palette.muted },
  workspace: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.7 },
  badge: { minWidth: 24, height: 24, paddingHorizontal: 7, borderRadius: 12, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: 'white', fontFamily: fonts.bold, fontSize: 11 },
});
