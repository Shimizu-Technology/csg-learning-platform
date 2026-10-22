import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { BellOff, ChevronRight, Hash } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { messagePreview } from '@/lib/message-format';
import { conversationActivityTime } from '@/lib/recent-conversations';
import type { ChannelSummary, DirectConversationSummary } from '@/lib/types';
import { Avatar } from './avatar';

export function ConversationRow({ kind, item, onPress }: { kind: 'channel' | 'dm'; item: ChannelSummary | DirectConversationSummary; onPress: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const channel = kind === 'channel' ? item as ChannelSummary : null;
  const title = channel ? channel.name : (item as DirectConversationSummary).title;
  const preview = item.latest_message ? `${item.latest_message.author_name}: ${messagePreview(item.latest_message.body)}` : 'No messages yet';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}`} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {channel ? <View style={styles.channelIcon}><Hash color={c.text.body} size={20} /></View> : <Avatar name={title} />}
      <View style={styles.copy}>
        <View style={styles.line}><Text maxFontSizeMultiplier={fontScaleLimits.content} numberOfLines={1} style={[styles.title, item.unread_count > 0 && styles.unreadTitle]}>{title}</Text>{item.muted && <BellOff color={c.text.muted} size={14} />}{item.latest_message && <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.time}>{conversationActivityTime(item.latest_message.created_at)}</Text>}</View>
        <Text maxFontSizeMultiplier={fontScaleLimits.content} numberOfLines={1} style={[styles.preview, item.unread_count > 0 && styles.unreadPreview]}>{preview}</Text>
      </View>
      {item.unread_count > 0 ? <View style={styles.badge}><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.badgeText}>{item.unread_count > 99 ? '99+' : item.unread_count}</Text></View> : <ChevronRight color={c.text.muted} size={18} />}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  row: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 13, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  pressed: { opacity: 0.72 },
  channelIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong },
  copy: { flex: 1, gap: 3 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, marginLeft: 'auto' },
  title: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 15, flexShrink: 1 },
  unreadTitle: { color: c.text.strong, fontFamily: fonts.bold },
  preview: { ...typography.support, color: c.text.body, fontFamily: fonts.regular },
  unreadPreview: { color: c.text.body },
  workspace: { ...typography.meta, color: c.text.body, fontFamily: fonts.medium, textTransform: 'uppercase', letterSpacing: 0.7 },
  badge: { minWidth: 24, minHeight: 24, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 12, backgroundColor: c.selection.bg, alignItems: 'center', justifyContent: 'center' },
  badgeText: { ...typography.label, color: c.text.strong, fontFamily: fonts.bold },
}));
