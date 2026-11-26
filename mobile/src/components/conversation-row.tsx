import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { BellOff, ChevronRight, Hash, Lock, Users } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { conversationSubtitle, directConversationPeer } from '@/lib/chat-helpers';
import { messagePreview } from '@/lib/message-format';
import { conversationActivityTime } from '@/lib/recent-conversations';
import type { ChannelSummary, DirectConversationSummary } from '@/lib/types';
import { Avatar } from './avatar';

export function ConversationRow({
  kind,
  item,
  currentUserId,
  draftPreview,
  online = false,
  onPress,
}: {
  kind: 'channel' | 'dm';
  item: ChannelSummary | DirectConversationSummary;
  currentUserId?: number | null;
  draftPreview?: string | null;
  online?: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const channel = kind === 'channel' ? item as ChannelSummary : null;
  const dm = kind === 'dm' ? item as DirectConversationSummary : null;
  const peer = dm ? directConversationPeer(dm, currentUserId) : null;
  const title = channel ? channel.name : (dm?.title || '');
  const subtitle = conversationSubtitle(kind, item, currentUserId);
  const formattedDraft = draftPreview?.trim() ? messagePreview(draftPreview) : null;
  const hasUnread = item.unread_count > 0;

  const accessibilityLabelParts = [`Open ${title}`];
  if (hasUnread) accessibilityLabelParts.push(`${item.unread_count} unread`);
  if (formattedDraft) accessibilityLabelParts.push(`Draft: ${formattedDraft}`);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelParts.join(', ')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {channel ? (
        <View style={styles.circleBadge}>
          {channel.visibility === 'staff_only'
            ? <Lock color={c.text.body} size={18} />
            : <Hash color={c.text.body} size={19} />}
        </View>
      ) : peer ? (
        <Avatar name={peer.full_name} uri={peer.avatar_url} online={online} size={44} />
      ) : (
        <View style={styles.circleBadge}>
          <Users color={c.text.body} size={19} />
        </View>
      )}
      <View style={styles.copy}>
        <View style={styles.line}>
          <Text
            maxFontSizeMultiplier={fontScaleLimits.content}
            numberOfLines={1}
            style={[styles.title, hasUnread && styles.unreadTitle]}
          >
            {title}
          </Text>
          {item.muted && <BellOff color={c.text.muted} size={14} />}
          {item.latest_message && (
            <Text
              maxFontSizeMultiplier={fontScaleLimits.utility}
              style={[styles.time, hasUnread && styles.unreadTime]}
            >
              {conversationActivityTime(item.latest_message.created_at)}
            </Text>
          )}
        </View>
        {formattedDraft ? (
          <Text maxFontSizeMultiplier={fontScaleLimits.content} numberOfLines={1} style={styles.preview}>
            <Text style={styles.draftLabel}>Draft: </Text>
            {formattedDraft}
          </Text>
        ) : (
          <Text
            maxFontSizeMultiplier={fontScaleLimits.content}
            numberOfLines={1}
            style={[styles.preview, hasUnread && styles.unreadPreview]}
          >
            {subtitle}
          </Text>
        )}
      </View>
      {hasUnread ? (
        <View style={styles.badge}>
          <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.badgeText}>
            {item.unread_count > 99 ? '99+' : item.unread_count}
          </Text>
        </View>
      ) : (
        <ChevronRight color={c.text.muted} size={18} />
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  row: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.border.subtle,
  },
  pressed: { opacity: 0.72 },
  circleBadge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.surface.sunken,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  copy: { flex: 1, gap: 3, minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 12, marginLeft: 'auto' },
  unreadTime: { color: c.text.strong, fontFamily: fonts.semibold },
  title: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 15, flexShrink: 1 },
  unreadTitle: { color: c.text.strong, fontFamily: fonts.bold },
  preview: { ...typography.support, color: c.text.muted, fontFamily: fonts.regular },
  unreadPreview: { color: c.text.strong, fontFamily: fonts.semibold },
  draftLabel: { color: c.action.primary, fontFamily: fonts.bold },
  badge: {
    minWidth: 24,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 12,
    backgroundColor: c.action.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: c.text.onAction, fontFamily: fonts.bold, fontSize: 12 },
}));
