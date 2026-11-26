import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { CheckCheck, ChevronRight, Download, FileText, MessageSquare, MoreHorizontal, Pin, RefreshCw, TriangleAlert, Users } from 'lucide-react-native';
import { useState } from 'react';
import { Image, Linking, StyleSheet, Text, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { FormattedMessage } from '@/components/formatted-message';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { formatFileSize } from '@/lib/attachments';
import { haptic } from '@/lib/haptics';
import { reactionOption } from '@/lib/reactions';
import type { Message, UserSummary } from '@/lib/types';

type Attachment = Message['attachments'][number];

type Props = {
  message: Message;
  cohortId?: number | null;
  workspaceId?: number | null;
  showAuthor: boolean;
  mentionUsers: UserSummary[];
  onOpenAuthor?: (author: Message['author']) => void;
  onLongPress?: (message: Message) => void;
  onToggleReaction?: (message: Message, value: string) => void;
  onOpenReaction?: (message: Message, value: string) => void;
  onOpenImage?: (attachment: Attachment, images: Attachment[]) => void;
  onThread?: (message: Message) => void;
  onRetry?: (message: Message) => void;
  receiptLabel?: string;
};

function SingleImageAttachment({
  attachment,
  onPress,
}: {
  attachment: Attachment;
  onPress: () => void;
}) {
  const styles = useStyles();
  const [aspectRatio, setAspectRatio] = useState(1.45);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Preview ${attachment.filename}`}
      onPress={onPress}
      style={styles.singleImageCard}
    >
      <View style={styles.singleImageFrame}>
        <Image
          source={{ uri: attachment.url! }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          onLoad={(event) => {
            const { width, height } = event.nativeEvent.source || {};
            if (width && height) {
              const natural = width / height;
              setAspectRatio(Math.max(0.68, Math.min(1.85, natural)));
            }
          }}
          style={[styles.singleImage, { aspectRatio }]}
        />
      </View>
      <View style={styles.imageFooter}>
        <Text numberOfLines={1} style={styles.imageFooterName}>{attachment.filename}</Text>
        <Text style={styles.imageFooterSize}>{formatFileSize(attachment.byte_size)}</Text>
      </View>
    </Pressable>
  );
}

export function MessageBubble({
  message,
  cohortId,
  workspaceId,
  showAuthor,
  mentionUsers,
  onOpenAuthor,
  onLongPress,
  onToggleReaction,
  onOpenReaction,
  onOpenImage,
  onThread,
  onRetry,
  receiptLabel,
}: Props) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const deleted = Boolean(message.deleted_at);
  const blocked = Boolean(message.blocked);
  const images = blocked || deleted ? [] : message.attachments.filter((attachment) => attachment.image && attachment.url);
  const files = blocked || deleted ? [] : message.attachments.filter((attachment) => !(attachment.image && attachment.url));

  return (
    <View
      accessible={false}
      style={[styles.messageRow, message.mine && styles.mineRow]}
      testID={`message-row-${message.id}`}
    >
      {!message.mine && showAuthor && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${message.author.full_name}`}
          onPress={() => onOpenAuthor?.(message.author)}
          disabled={!onOpenAuthor}
          style={styles.authorAvatar}
        >
          <Avatar name={message.author.full_name} uri={message.author.avatar_url} size={32} />
        </Pressable>
      )}
      {!message.mine && !showAuthor && <View style={styles.avatarSpacer} />}
      <View style={[styles.bubbleWrap, message.mine && styles.mineWrap]}>
        {showAuthor && !message.mine && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View profile for ${message.author.full_name}`}
            onPress={() => onOpenAuthor?.(message.author)}
            disabled={!onOpenAuthor}
            style={styles.authorButton}
          >
            <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.author}>{message.author.full_name}</Text>
          </Pressable>
        )}
        <Pressable
          accessible={false}
          delayLongPress={350}
          onLongPress={onLongPress ? () => { haptic('selection'); onLongPress(message); } : undefined}
          style={[styles.bubble, message.mine && styles.mineBubble, message.client_status === 'failed' && styles.failedBubble]}
          testID={`message-bubble-${message.id}`}
        >
          {message.pinned_at && (
            <View style={styles.pinLabel}>
              <Pin color={c.action.primary} size={11} />
              <Text style={[styles.pinText, message.mine && styles.mineMeta]}>Pinned</Text>
            </View>
          )}
          {blocked ? (
            <Text style={[styles.body, styles.deleted]}>Message hidden — you blocked this user</Text>
          ) : !!message.body && (
            deleted ? (
              <Text style={[styles.body, styles.deleted]}>Message removed</Text>
            ) : (
              <FormattedMessage
                cohortId={cohortId}
                workspaceId={workspaceId}
                body={message.body}
                mentionUsers={mentionUsers}
                mentionUserIds={message.mention_user_ids}
                mine={message.mine}
              />
            )
          )}
          {images.length === 1 && (
            <SingleImageAttachment
              attachment={images[0]}
              onPress={() => onOpenImage?.(images[0], images)}
            />
          )}
          {images.length > 1 && (
            <View style={styles.imageGrid}>
              {images.map((attachment) => (
                <Pressable
                  key={attachment.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Preview ${attachment.filename}`}
                  onPress={() => onOpenImage?.(attachment, images)}
                  style={styles.gridImageCard}
                >
                  <Image
                    source={{ uri: attachment.url! }}
                    resizeMode="cover"
                    accessibilityIgnoresInvertColors
                    style={styles.gridImage}
                  />
                </Pressable>
              ))}
            </View>
          )}
          {files.map((attachment) => (
            <Pressable
              key={attachment.id}
              accessibilityRole="link"
              accessibilityLabel={`Open ${attachment.filename}`}
              onPress={() => attachment.url && void Linking.openURL(attachment.url)}
              style={styles.attachment}
            >
              <View style={styles.fileIcon}><FileText color={c.text.body} size={18} /></View>
              <View style={styles.attachmentCopy}>
                <Text numberOfLines={1} style={styles.attachmentName}>{attachment.filename}</Text>
                <Text style={styles.attachmentSize}>{formatFileSize(attachment.byte_size)}</Text>
              </View>
              <View style={styles.fileDownloadIcon}><Download color={c.text.muted} size={16} /></View>
            </Pressable>
          ))}
        </Pressable>
        {!blocked && !!message.reactions.length && (
          <View style={[styles.reactions, message.mine && styles.mineReactions]}>
            {message.reactions.map((reaction) => {
              const option = reactionOption(reaction.emoji);
              const Icon = option?.Icon;
              const handlePress = () => {
                if (onToggleReaction) {
                  haptic('selection');
                  onToggleReaction(message, reaction.emoji);
                } else {
                  onOpenReaction?.(message, reaction.emoji);
                }
              };
              return (
                <Pressable
                  key={reaction.emoji}
                  accessibilityRole="button"
                  accessibilityState={{ selected: reaction.reacted }}
                  accessibilityHint={onToggleReaction ? 'Tap to toggle your reaction, or press and hold to see who reacted' : 'Shows everyone who reacted and lets you manage your reaction'}
                  accessibilityLabel={`${option?.label || 'Reaction'}, ${reaction.count}`}
                  onPress={handlePress}
                  onLongPress={onOpenReaction ? () => { haptic('selection'); onOpenReaction(message, reaction.emoji); } : undefined}
                  style={[styles.reaction, reaction.reacted && styles.reacted]}
                >
                  {Icon
                    ? <Icon color={reaction.reacted ? c.status.info.fg : c.text.body} size={14} />
                    : <Text style={styles.fallbackReaction}>{reaction.emoji}</Text>}
                  <Text style={[styles.reactionCount, reaction.reacted && styles.reactedCount]}>{reaction.count}</Text>
                </Pressable>
              );
            })}
            {onToggleReaction && onOpenReaction && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Who reacted"
                onPress={() => onOpenReaction(message, message.reactions[0].emoji)}
                style={styles.whoReactedButton}
              >
                <Users color={c.text.muted} size={14} />
              </Pressable>
            )}
          </View>
        )}
        {Boolean(onThread) && !!message.reply_count && !message.parent_message_id && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Open ${message.reply_count} ${message.reply_count === 1 ? 'reply' : 'replies'}`}
            onPress={() => onThread?.(message)}
            style={[styles.threadButton, message.mine && styles.mineThread]}
          >
            <MessageSquare color={c.action.primary} size={14} />
            <Text style={styles.threadCount}>
              {message.reply_count} {message.reply_count === 1 ? 'reply' : 'replies'}
            </Text>
            <Text style={styles.threadHint}>View thread</Text>
            <ChevronRight color={c.text.muted} size={14} />
          </Pressable>
        )}
        <View style={[styles.messageMeta, message.mine && styles.mineMessageMeta]}>
          {message.client_status === 'failed' && <TriangleAlert color={c.status.danger.fg} size={11} />}
          {message.mine && receiptLabel && !message.client_status && <CheckCheck color={c.status.info.fg} size={13} />}
          <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={[styles.time, message.mine && styles.mineTime, message.client_status === 'failed' && styles.failedText]}>
            {message.client_status === 'sending'
              ? message.client_upload_progress !== undefined
                ? `Uploading ${Math.round(message.client_upload_progress * 100)}%`
                : 'Sending…'
              : message.client_status === 'failed'
                ? 'Not sent'
                : formatTime(message.created_at)}
            {message.edited_at ? ' · edited' : ''}
            {receiptLabel ? ` · ${receiptLabel}` : ''}
          </Text>
          {message.client_status === 'failed' && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry message"
              onPress={() => onRetry?.(message)}
              style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              hitSlop={8}
            >
              <RefreshCw color={c.status.danger.fg} size={12} />
            </Pressable>
          )}
          {onLongPress && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Actions for message from ${message.author.full_name}`}
              accessibilityHint="Opens reply, reaction, and message management actions"
              onPress={() => onLongPress(message)}
              style={({ pressed }) => [styles.messageActions, pressed && styles.messageActionsPressed]}
            >
              <MoreHorizontal color={c.text.muted} size={17} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

function formatTime(value: string) { return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  authorAvatar: { minWidth: 44, minHeight: 44, alignItems: 'center', paddingTop: 6 },
  authorButton: { minWidth: 44, minHeight: 36, justifyContent: 'center', alignSelf: 'flex-start' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 8, paddingRight: 44 },
  mineRow: { justifyContent: 'flex-end', paddingRight: 0, paddingLeft: 44 },
  avatarSpacer: { width: 44 },
  bubbleWrap: { maxWidth: '90%', flexShrink: 1 },
  mineWrap: { alignItems: 'flex-end' },
  author: { ...typography.label, color: c.text.body, fontFamily: fonts.semibold, marginBottom: 2, marginLeft: 2 },
  bubble: {
    minWidth: 48,
    backgroundColor: c.surface.raised,
    borderWidth: 1,
    borderColor: c.border.subtle,
    borderRadius: 18,
    borderTopLeftRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    overflow: 'hidden',
  },
  mineBubble: {
    backgroundColor: c.selection.bg,
    borderColor: c.border.strong,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 6,
  },
  failedBubble: { borderColor: c.status.danger.border, backgroundColor: c.status.danger.bg },
  body: { ...typography.body, color: c.text.strong, fontFamily: fonts.regular },
  deleted: { color: c.status.danger.fg, fontStyle: 'italic' },
  pinLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 5 },
  pinText: { color: c.action.primary, fontFamily: fonts.bold, fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5 },
  mineMeta: { color: c.action.primary },
  singleImageCard: {
    marginTop: 8,
    width: 248,
    maxWidth: '100%',
    borderRadius: 13,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: c.border.subtle,
    backgroundColor: c.surface.sunken,
  },
  singleImageFrame: { width: '100%', maxHeight: 260, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  singleImage: { width: '100%', maxHeight: 260 },
  imageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: c.surface.raised,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: c.border.subtle,
  },
  imageFooterName: { flex: 1, color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 },
  imageFooterSize: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 12 },
  imageGrid: { marginTop: 8, width: 248, maxWidth: '100%', flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  gridImageCard: { width: '48.5%', aspectRatio: 4 / 3, borderRadius: 11, overflow: 'hidden', borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken },
  gridImage: { width: '100%', height: '100%' },
  attachment: {
    minWidth: 200,
    minHeight: 54,
    marginTop: 8,
    borderRadius: 13,
    backgroundColor: c.surface.sunken,
    borderWidth: 1,
    borderColor: c.border.subtle,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 8,
  },
  fileIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: c.surface.raised, alignItems: 'center', justifyContent: 'center' },
  attachmentCopy: { flex: 1, minWidth: 0 },
  attachmentName: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 12 },
  attachmentSize: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 },
  fileDownloadIcon: { paddingHorizontal: 4 },
  reactions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 6 },
  mineReactions: { justifyContent: 'flex-end' },
  reaction: {
    minHeight: 44,
    minWidth: 54,
    paddingHorizontal: 12,
    borderRadius: 22,
    backgroundColor: c.surface.raised,
    borderWidth: 1,
    borderColor: c.border.subtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  reacted: {
    borderColor: c.status.info.border,
    backgroundColor: c.status.info.bg,
  },
  fallbackReaction: { color: c.text.strong, fontSize: 13 },
  reactionCount: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  reactedCount: { color: c.status.info.fg, fontFamily: fonts.extraBold },
  whoReactedButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  threadButton: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 5,
    borderRadius: 12,
    backgroundColor: c.surface.raised,
    borderWidth: 1,
    borderColor: c.border.subtle,
  },
  mineThread: { alignSelf: 'flex-end' },
  threadCount: { color: c.action.primary, fontFamily: fonts.bold, fontSize: 12 },
  threadHint: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 12 },
  messageMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, marginHorizontal: 2 },
  mineMessageMeta: { justifyContent: 'flex-end' },
  time: { ...typography.meta, color: c.text.muted, fontFamily: fonts.medium },
  mineTime: { textAlign: 'right' },
  failedText: { color: c.status.danger.fg },
  messageActions: { width: 44, height: 44, marginVertical: -14, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  messageActionsPressed: { backgroundColor: c.surface.sunken, opacity: 0.72 },
}));
