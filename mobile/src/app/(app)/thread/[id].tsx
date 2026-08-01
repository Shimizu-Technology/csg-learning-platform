import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Send } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MessageBubble } from '@/components/message-bubble';
import { ImagePreview } from '@/components/image-preview';
import { ReactionDetailsSheet } from '@/components/reaction-details-sheet';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { subscribeToMessages } from '@/lib/cable';
import { demoDms, demoMessages, demoUser } from '@/lib/demo-data';
import { resolveMentionUserIds } from '@/lib/mentions';
import { mergeMessageEvent, sortMessages } from '@/lib/message-state';
import { loadThreadDraft, saveThreadDraft } from '@/lib/conversation-storage';
import type { Message, MessageEvent, UserSummary } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string; kind: string; conversationId: string; workspaceId: string }>();
  const rootId = Number(params.id);
  const kind = params.kind === 'dm' ? 'dm' : 'channel';
  const conversationId = Number(params.conversationId);
  const workspaceId = Number(params.workspaceId);
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const userId = user?.id ?? null;
  const listRef = useRef<FlatList<Message>>(null);
  const [root, setRoot] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactionDetails, setReactionDetails] = useState<{ messageId: number; emoji: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<{ attachments: Message['attachments']; attachmentId: number } | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (userId && !auth.demo) setDraft(await loadThreadDraft(userId, rootId));
      if (!Number.isInteger(workspaceId) || workspaceId <= 0) throw new Error('This thread link is incomplete. Open it again from the conversation.');
      if (auth.demo) {
        const conversationMessages = demoMessages[`${kind}:${conversationId}`] || [];
        const demoRoot = conversationMessages.find((message) => message.id === rootId) || conversationMessages[0];
        if (!demoRoot) throw new Error('This demo conversation has no message to open as a thread.');
        const demoReply: Message = {
          ...demoRoot,
          id: 9_001,
          parent_message_id: demoRoot.id,
          body: 'That makes sense. I added the question to my notes for class.',
          mine: false,
          reactions: [],
          read_receipts: undefined,
          author: demoDms[0]?.users.find((member) => member.id !== demoUser.id) || demoRoot.author,
          created_at: new Date(Date.now() - 4 * 60_000).toISOString(),
          updated_at: new Date(Date.now() - 4 * 60_000).toISOString(),
        };
        setRoot(demoRoot);
        setReplies([demoReply]);
        setUsers(demoDms[0]?.users || [demoUser]);
        setError(null);
        return;
      }
      const [result, workspace] = await Promise.all([api.messageThread(rootId), api.workspace(workspaceId)]);
      setRoot(result.root_message);
      setReplies(result.replies);
      setUsers(workspace.workspace.members);
      setError(null);
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setLoading(false); }
  }, [api, auth.demo, conversationId, kind, rootId, userId, workspaceId]);

  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  useEffect(() => auth.demo || loading || error ? undefined : subscribeToMessages(api, kind, conversationId, (event: MessageEvent) => {
    if (event.message.id === rootId) setRoot(event.event === 'deleted' ? null : event.message);
    else if (event.message.parent_message_id === rootId) setReplies((current) => mergeMessageEvent(current, event));
  }, () => undefined), [api, auth.demo, conversationId, error, kind, loading, rootId]);

  useEffect(() => {
    if (!userId || loading) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => void saveThreadDraft(userId, rootId, draft), 300);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [draft, loading, rootId, userId]);

  const visible = useMemo(() => sortMessages(replies), [replies]);
  const reactionDetailsMessage = reactionDetails
    ? reactionDetails.messageId === root?.id ? root : replies.find((message) => message.id === reactionDetails.messageId) || null
    : null;
  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setDraft('');
    try {
      if (auth.demo) {
        const demoReply: Message = {
          ...(root as Message),
          id: -Date.now(),
          parent_message_id: rootId,
          body,
          mine: true,
          reactions: [],
          read_receipts: undefined,
          author: demoUser,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setReplies((current) => sortMessages([...current, demoReply]));
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
        return;
      }
      const result = await api.sendMessage(kind, conversationId, { body, parent_message_id: rootId, mention_user_ids: resolveMentionUserIds(body, users), send_push: true });
      setReplies((current) => sortMessages([...current.filter((message) => message.id !== result.message.id), result.message]));
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
      if (userId) await saveThreadDraft(userId, rootId, '');
    } catch (requestError) { setDraft(body); Alert.alert('Reply not sent', (requestError as Error).message); }
    finally { setSending(false); }
  };

  const toggleReaction = async (message: Message, value: string) => {
    if (auth.demo) return;
    try { const remove = Boolean(message.reactions.find((reaction) => reaction.emoji === value)?.reacted); const result = await api.react(message.id, value, remove); if (message.id === rootId) setRoot(result.message); else setReplies((current) => current.map((item) => item.id === message.id ? result.message : item)); }
    catch (requestError) { Alert.alert('Could not update reaction', (requestError as Error).message); }
  };

  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View><Text style={styles.title}>Thread</Text><Text style={styles.subtitle}>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</Text></View></View>
    {loading ? <LoadingState label="Loading thread" /> : error || !root ? <ErrorState message={error || 'This thread is no longer available.'} retry={() => void load()} /> : <>
      <View style={styles.root}><MessageBubble message={root} showAuthor mentionUsers={users} onOpenReaction={(message, value) => setReactionDetails({ messageId: message.id, emoji: value })} onOpenImage={(attachment, images) => setImagePreview({ attachments: images, attachmentId: attachment.id })} /></View>
      <View style={styles.divider}><Text style={styles.dividerText}>REPLIES</Text><View style={styles.line} /></View>
      <FlatList ref={listRef} data={visible} keyExtractor={(message) => String(message.id)} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list} renderItem={({ item, index }) => <MessageBubble message={item} showAuthor={!visible[index - 1] || visible[index - 1].author.id !== item.author.id} mentionUsers={users} onOpenReaction={(message, value) => setReactionDetails({ messageId: message.id, emoji: value })} onOpenImage={(attachment, images) => setImagePreview({ attachments: images, attachmentId: attachment.id })} />} ListEmptyComponent={<Text style={styles.empty}>Start a focused conversation about this message.</Text>} />
    </>}
    <View style={styles.composer}><TextInput accessibilityLabel="Reply to thread" value={draft} onChangeText={setDraft} placeholder="Reply to thread" placeholderTextColor={palette.quiet} multiline maxLength={10_000} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel="Send reply" disabled={!draft.trim() || sending} onPress={() => void send()} style={[styles.send, (!draft.trim() || sending) && styles.disabled]}><Send color={palette.text} size={19} /></Pressable></View>
    <ReactionDetailsSheet key={reactionDetails ? `${reactionDetails.messageId}-${reactionDetails.emoji}` : 'closed-reactions'} initialEmoji={reactionDetails?.emoji || null} message={reactionDetailsMessage} onClose={() => setReactionDetails(null)} onToggle={async (message, value) => { await toggleReaction(message, value); }} />
    <ImagePreview key={imagePreview?.attachmentId ?? 'closed-preview'} attachments={imagePreview?.attachments || []} initialAttachmentId={imagePreview?.attachmentId || null} onClose={() => setImagePreview(null)} />
  </KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 17 }, subtitle: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 2 }, root: { paddingHorizontal: 14, paddingTop: 18 }, divider: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginVertical: 12 }, dividerText: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2 }, line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.line }, list: { paddingHorizontal: 14, paddingBottom: 24, flexGrow: 1 }, empty: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', paddingHorizontal: 40, paddingTop: 50 }, composer: { paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 9, backgroundColor: palette.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line }, input: { flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 17, backgroundColor: palette.ink, borderWidth: 1, borderColor: palette.line, color: palette.text, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 11 }, send: { width: 46, height: 46, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.38 },
});
