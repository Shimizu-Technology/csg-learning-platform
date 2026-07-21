import { FileText, MessageSquare, Pin, RefreshCw, TriangleAlert } from 'lucide-react-native';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { fonts, palette } from '@/constants/csg-theme';
import { formatFileSize } from '@/lib/attachments';
import { messageSegments } from '@/lib/mentions';
import { reactionOption } from '@/lib/reactions';
import type { Message, UserSummary } from '@/lib/types';

type Props = {
  message: Message;
  showAuthor: boolean;
  mentionUsers: UserSummary[];
  onLongPress?: (message: Message) => void;
  onReact?: (message: Message, value: string) => void;
  onThread?: (message: Message) => void;
  onRetry?: (message: Message) => void;
};

export function MessageBubble({ message, showAuthor, mentionUsers, onLongPress, onReact, onThread, onRetry }: Props) {
  const deleted = Boolean(message.deleted_at);
  const segments = deleted ? [{ text: 'Message removed', mention: false }] : messageSegments(message.body, mentionUsers);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Message from ${message.author.full_name}. Hold for actions.`}
      delayLongPress={260}
      onLongPress={() => onLongPress?.(message)}
      style={[styles.messageRow, message.mine && styles.mineRow]}
    >
      {!message.mine && showAuthor && <Avatar name={message.author.full_name} size={30} />}
      {!message.mine && !showAuthor && <View style={styles.avatarSpacer} />}
      <View style={[styles.bubbleWrap, message.mine && styles.mineWrap]}>
        {showAuthor && !message.mine && <Text style={styles.author}>{message.author.full_name}</Text>}
        <View style={[styles.bubble, message.mine && styles.mineBubble, message.client_status === 'failed' && styles.failedBubble]}>
          {message.pinned_at && <View style={styles.pinLabel}><Pin color={message.mine ? '#FFE4E8' : palette.rubySoft} size={11} /><Text style={[styles.pinText, message.mine && styles.mineMeta]}>Pinned</Text></View>}
          {!!message.body && <Text style={[styles.body, deleted && styles.deleted]}>{segments.map((segment, index) => <Text key={`${segment.text}-${index}`} style={segment.mention && styles.mention}>{segment.text}</Text>)}</Text>}
          {!deleted && message.attachments.map((attachment) => (
            <Pressable key={attachment.id} accessibilityRole="link" onPress={() => attachment.url && void Linking.openURL(attachment.url)} style={styles.attachment}>
              {attachment.image && attachment.url ? <Image source={{ uri: attachment.url }} resizeMode="cover" style={styles.attachmentImage} /> : <View style={styles.fileIcon}><FileText color={palette.rubySoft} size={19} /></View>}
              <View style={styles.attachmentCopy}><Text numberOfLines={1} style={styles.attachmentName}>{attachment.filename}</Text><Text style={styles.attachmentSize}>{formatFileSize(attachment.byte_size)}</Text></View>
            </Pressable>
          ))}
        </View>
        {!!message.reactions.length && <View style={[styles.reactions, message.mine && styles.mineReactions]}>{message.reactions.map((reaction) => {
          const option = reactionOption(reaction.emoji);
          const Icon = option?.Icon;
          return <Pressable key={reaction.emoji} accessibilityRole="button" accessibilityLabel={`${option?.label || 'Reaction'}, ${reaction.count}`} onPress={() => onReact?.(message, reaction.emoji)} style={[styles.reaction, reaction.reacted && styles.reacted]}>{Icon ? <Icon color={reaction.reacted ? palette.rubySoft : palette.muted} size={13} /> : <Text style={styles.fallbackReaction}>{reaction.emoji}</Text>}<Text style={[styles.reactionCount, reaction.reacted && styles.reactedCount]}>{reaction.count}</Text></Pressable>;
        })}</View>}
        {!!message.reply_count && !message.parent_message_id && <Pressable accessibilityRole="button" accessibilityLabel={`Open ${message.reply_count} replies`} onPress={() => onThread?.(message)} style={[styles.threadButton, message.mine && styles.mineThread]}><MessageSquare color={palette.rubySoft} size={13} /><Text style={styles.threadText}>{message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}</Text></Pressable>}
        <View style={[styles.messageMeta, message.mine && styles.mineMessageMeta]}>
          {message.client_status === 'failed' && <TriangleAlert color={palette.warning} size={11} />}
          <Text style={[styles.time, message.mine && styles.mineTime, message.client_status === 'failed' && styles.failedText]}>{message.client_status === 'sending' ? 'Sending…' : message.client_status === 'failed' ? 'Not sent' : formatTime(message.created_at)}{message.edited_at ? ' · edited' : ''}{message.mine && message.read_receipts?.count ? ` · read by ${message.read_receipts.count}` : ''}</Text>
          {message.client_status === 'failed' && <Pressable accessibilityRole="button" accessibilityLabel="Retry message" onPress={() => onRetry?.(message)} hitSlop={8}><RefreshCw color={palette.warning} size={12} /></Pressable>}
        </View>
      </View>
    </Pressable>
  );
}

function formatTime(value: string) { return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

const styles = StyleSheet.create({
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10, paddingRight: 54 },
  mineRow: { justifyContent: 'flex-end', paddingRight: 0, paddingLeft: 54 },
  avatarSpacer: { width: 30 }, bubbleWrap: { maxWidth: '92%' }, mineWrap: { alignItems: 'flex-end' },
  author: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 11, marginBottom: 4, marginLeft: 2 },
  bubble: { minWidth: 44, backgroundColor: palette.panelRaised, borderWidth: 1, borderColor: palette.line, borderRadius: 18, borderTopLeftRadius: 5, paddingHorizontal: 14, paddingVertical: 10, overflow: 'hidden' },
  mineBubble: { backgroundColor: palette.ruby, borderColor: palette.ruby, borderTopLeftRadius: 18, borderTopRightRadius: 5 },
  failedBubble: { borderColor: palette.warning, backgroundColor: '#2A1D16' },
  body: { color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 }, deleted: { color: palette.quiet, fontStyle: 'italic' }, mention: { color: '#FFD1D7', fontFamily: fonts.bold },
  pinLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 5 }, pinText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5 }, mineMeta: { color: '#FFE4E8' },
  attachment: { minWidth: 190, minHeight: 54, marginTop: 9, borderRadius: 13, backgroundColor: 'rgba(4,7,12,0.2)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.13)', flexDirection: 'row', alignItems: 'center', overflow: 'hidden' },
  attachmentImage: { width: 70, height: 70 }, fileIcon: { width: 50, height: 50, margin: 2, borderRadius: 11, backgroundColor: '#251A20', alignItems: 'center', justifyContent: 'center' }, attachmentCopy: { flex: 1, paddingHorizontal: 10 }, attachmentName: { color: palette.text, fontFamily: fonts.semibold, fontSize: 11 }, attachmentSize: { color: '#C9CDD6', fontFamily: fonts.medium, fontSize: 9, marginTop: 3 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 6 }, mineReactions: { justifyContent: 'flex-end' }, reaction: { minHeight: 30, minWidth: 38, paddingHorizontal: 8, borderRadius: 15, backgroundColor: palette.panelRaised, borderWidth: 1, borderColor: palette.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 }, reacted: { borderColor: '#6A2A36', backgroundColor: '#2A151B' }, fallbackReaction: { color: palette.text, fontSize: 12 }, reactionCount: { color: palette.muted, fontFamily: fonts.bold, fontSize: 9 }, reactedCount: { color: palette.rubySoft },
  threadButton: { minHeight: 30, flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start', paddingHorizontal: 3, marginTop: 3 }, mineThread: { alignSelf: 'flex-end' }, threadText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10 },
  messageMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4, marginHorizontal: 2 }, mineMessageMeta: { justifyContent: 'flex-end' }, time: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 9 }, mineTime: { textAlign: 'right' }, failedText: { color: palette.warning },
});
