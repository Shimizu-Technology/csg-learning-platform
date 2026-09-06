import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MessageBubble } from '@/components/message-bubble';
import { ComposerLimitNotice } from '@/components/composer-limit-notice';
import { ImagePreview } from '@/components/image-preview';
import { FormattingToggleButton, MessageFormattingToolbar } from '@/components/message-formatting-toolbar';
import { ReactionDetailsSheet } from '@/components/reaction-details-sheet';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { TypingIndicator } from '@/components/typing-indicator';
import { VoiceDraftButton, VoiceDraftPanel } from '@/components/voice-draft-controls';
import { fonts, palette } from '@/constants/csg-theme';
import { useVoiceDraft } from '@/hooks/use-voice-draft';
import { subscribeToMessages, type CableSubscription } from '@/lib/cable';
import { demoDms, demoMessages, demoUser } from '@/lib/demo-data';
import { resolveMentionUserIds } from '@/lib/mentions';
import { clientMessageIdForSend, draftAfterSendConfirmation, draftAfterStoredLoad, type FailedSendIntent, messageBodyChangeAllowed, messageBodyWithinLimit, MESSAGE_BODY_LIMIT } from '@/lib/message-compose';
import { markOptimisticFailed, mergeMessageEvent, reconcileOptimistic, sortMessages, toggleOwnReaction } from '@/lib/message-state';
import { messagingKeys, syncThreadSnapshot, type ThreadSnapshot } from '@/lib/messaging-cache';
import { clearThreadDraftAfterSend, loadStoredThreadDraft, saveThreadDraftState } from '@/lib/conversation-storage';
import type { TypingUser } from '@/lib/typing';
import type { Message, MessageEvent, MessageTypingEvent, UserSummary } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

function pendingReplyMessage(root: Message, author: Message['author'], id: number, intent: FailedSendIntent): Message {
  const now = new Date().toISOString();
  return {
    id,
    channel_id: root.channel_id,
    direct_conversation_id: root.direct_conversation_id,
    parent_message_id: root.id,
    client_message_id: intent.clientMessageId,
    body: intent.body,
    mention_user_ids: [],
    edited_at: null,
    deleted_at: null,
    pinned_at: null,
    pinned_by_id: null,
    created_at: now,
    updated_at: now,
    mine: true,
    reactions: [],
    attachments: [],
    reply_count: 0,
    author,
  };
}

function failedReplyMessage(root: Message, author: Message['author'], intent: FailedSendIntent): Message {
  return {
    ...pendingReplyMessage(root, author, -Date.now(), intent),
    client_status: 'failed',
    client_error: 'Message not sent',
  };
}

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string; kind: string; conversationId: string; workspaceId: string }>();
  const rootId = Number(params.id);
  const kind = params.kind === 'dm' ? 'dm' : 'channel';
  const conversationId = Number(params.conversationId);
  const workspaceId = Number(params.workspaceId);
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const threadCacheKey = useMemo(() => messagingKeys.thread(userId ?? 0, rootId), [rootId, userId]);
  const initialSnapshot = useMemo(() => queryClient.getQueryData<ThreadSnapshot>(threadCacheKey), [queryClient, threadCacheKey]);
  const listRef = useRef<FlatList<Message>>(null);
  const inputRef = useRef<TextInput>(null);
  const [root, setRoot] = useState<Message | null>(initialSnapshot?.root ?? null);
  const [replies, setReplies] = useState<Message[]>(initialSnapshot?.replies ?? []);
  const [users, setUsers] = useState<UserSummary[]>(initialSnapshot?.users ?? []);
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [loading, setLoading] = useState(!initialSnapshot);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reactionDetails, setReactionDetails] = useState<{ messageId: number; emoji: string } | null>(null);
  const [formattingExpanded, setFormattingExpanded] = useState(false);
  const [imagePreview, setImagePreview] = useState<{ attachments: Message['attachments']; attachmentId: number } | null>(null);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [realtimeSubscriptionVersion, setRealtimeSubscriptionVersion] = useState(0);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<{ userId: number; rootId: number; body: string; failedSend: FailedSendIntent | null } | null>(null);
  const loadRequestRef = useRef(0);
  const tempMessageIdRef = useRef(0);
  const failedSendRef = useRef<FailedSendIntent | null>(null);
  const draftRef = useRef(draft);
  const userRef = useRef(user);
  const realtimeSubscriptionRef = useRef<CableSubscription | null>(null);
  const typingExpiryTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outboundTypingRef = useRef<{ active: boolean; lastSentAt: number } | null>(null);
  useEffect(() => { userRef.current = user; }, [user]);
  const voiceDraft = useVoiceDraft({
    api,
    demo: auth.demo,
    surface: 'thread',
    draft,
    selection,
    disabled: sending,
    maxDraftLength: MESSAGE_BODY_LIMIT,
    onDraftChange: (value) => { draftRef.current = value; setDraft(value); },
    onSelectionChange: setSelection,
  });

  const acknowledgeSentReply = useCallback((message: Message) => {
    const intent = failedSendRef.current;
    if (!userId) return false;
    const nextDraft = draftAfterSendConfirmation(draftRef.current, intent, message.client_message_id, message.author.id, userId);
    if (nextDraft === null) return false;

    failedSendRef.current = null;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    pendingDraftRef.current = null;
    if (!nextDraft) {
      draftRef.current = '';
      setDraft('');
      void clearThreadDraftAfterSend(userId, rootId);
    } else {
      void saveThreadDraftState(userId, rootId, nextDraft, null).catch(() => undefined);
    }
    return true;
  }, [rootId, userId]);

  const flushPendingDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const pending = pendingDraftRef.current;
    pendingDraftRef.current = null;
    if (pending) void saveThreadDraftState(pending.userId, pending.rootId, pending.body, pending.failedSend).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    let storedFailedSend: FailedSendIntent | null = null;
    const cached = queryClient.getQueryData<ThreadSnapshot>(threadCacheKey);
    if (!cached) setLoading(true);
    try {
      if (userId && !auth.demo) {
        const storedDraft = await loadStoredThreadDraft(userId, rootId);
        if (requestId !== loadRequestRef.current) return;
        const nextDraft = draftAfterStoredLoad(draftRef.current, storedDraft.body);
        if (nextDraft !== draftRef.current) {
          draftRef.current = nextDraft;
          setDraft(nextDraft);
        }
        storedFailedSend = storedDraft.failedSend;
        failedSendRef.current = storedFailedSend;
      }
      if (!Number.isInteger(workspaceId) || workspaceId <= 0) throw new Error('This thread link is incomplete. Open it again from the conversation.');
      if (auth.demo) {
        if (cached) {
          setRoot(cached.root);
          setReplies(cached.replies);
          setUsers(cached.users);
          setError(null);
          return;
        }
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
      const result = await api.messageThread(rootId);
      if (requestId !== loadRequestRef.current) return;
      setRoot(result.root_message);
      const failedClientMessageId = storedFailedSend?.clientMessageId;
      const confirmedReply = failedClientMessageId
        ? result.replies.find((reply) => reply.client_message_id === failedClientMessageId)
        : undefined;
      if (confirmedReply) acknowledgeSentReply(confirmedReply);
      const currentUser = userRef.current;
      const restoredFailure = !confirmedReply && storedFailedSend && currentUser
        ? failedReplyMessage(result.root_message, currentUser, storedFailedSend)
        : null;
      setReplies(restoredFailure ? sortMessages([...result.replies, restoredFailure]) : result.replies);
      setError(null);
      void api.workspace(workspaceId).then((workspace) => {
        if (requestId === loadRequestRef.current) setUsers(workspace.workspace.members);
      }).catch(() => undefined);
    } catch (requestError) {
      if (requestId === loadRequestRef.current) setError(cached ? null : (requestError as Error).message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [acknowledgeSentReply, api, auth.demo, conversationId, kind, queryClient, rootId, threadCacheKey, userId, workspaceId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => {
      cancelAnimationFrame(frame);
      loadRequestRef.current += 1;
      flushPendingDraft();
    };
  }, [flushPendingDraft, load]);
  useEffect(() => {
    syncThreadSnapshot(queryClient, threadCacheKey, root, replies, users);
  }, [queryClient, replies, root, threadCacheKey, users]);
  useEffect(() => {
    if (auth.demo || loading || error) return undefined;
    const typingTimers = typingExpiryTimersRef.current;
    setTypingUsers([]);
    const subscription = subscribeToMessages(api, kind, conversationId, (event: MessageEvent) => {
      if (event.message.id === rootId) setRoot(event.event === 'deleted' ? null : event.message);
      else if (event.message.parent_message_id === rootId) {
        const timer = typingTimers.get(event.message.author.id);
        if (timer) clearTimeout(timer);
        typingTimers.delete(event.message.author.id);
        setTypingUsers((current) => current.filter((typingUser) => typingUser.id !== event.message.author.id));
        setReplies((current) => mergeMessageEvent(current, event));
        if (event.event === 'created') acknowledgeSentReply(event.message);
      }
    }, (nextStatus) => {
      if (nextStatus === 'connected') {
        outboundTypingRef.current = null;
        setRealtimeSubscriptionVersion((current) => current + 1);
      }
    }, (event: MessageTypingEvent) => {
      if (event.user.id === userId || event.thread_root_id !== rootId) return;
      const existingTimer = typingTimers.get(event.user.id);
      if (existingTimer) clearTimeout(existingTimer);
      typingTimers.delete(event.user.id);
      setTypingUsers((current) => event.active
        ? [...current.filter((typingUser) => typingUser.id !== event.user.id), event.user]
        : current.filter((typingUser) => typingUser.id !== event.user.id));
      if (event.active) {
        typingTimers.set(event.user.id, setTimeout(() => {
          typingTimers.delete(event.user.id);
          setTypingUsers((current) => current.filter((typingUser) => typingUser.id !== event.user.id));
        }, 5_000));
      }
    });
    realtimeSubscriptionRef.current = subscription;
    return () => {
      if (outboundTypingRef.current?.active) subscription.perform('typing', { target_type: kind, target_id: conversationId, thread_root_id: rootId, active: false });
      outboundTypingRef.current = null;
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
      typingTimers.forEach((timer) => clearTimeout(timer));
      typingTimers.clear();
      realtimeSubscriptionRef.current = null;
      subscription();
    };
  }, [acknowledgeSentReply, api, auth.demo, conversationId, error, kind, loading, rootId, userId]);

  useEffect(() => {
    const subscription = realtimeSubscriptionRef.current;
    const active = Boolean(draft.trim());
    const previous = outboundTypingRef.current;
    const send = (nextActive: boolean) => subscription?.perform('typing', { target_type: kind, target_id: conversationId, thread_root_id: rootId, active: nextActive }) ?? false;
    if (previous?.active && !active) {
      send(false);
      outboundTypingRef.current = null;
    }
    if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
    typingStopTimerRef.current = null;
    if (!subscription || !active) return;
    const now = Date.now();
    if (!previous?.active || now - previous.lastSentAt >= 2_000) {
      if (send(true)) outboundTypingRef.current = { active: true, lastSentAt: now };
    }
    typingStopTimerRef.current = setTimeout(() => {
      if (outboundTypingRef.current?.active) send(false);
      outboundTypingRef.current = null;
      typingStopTimerRef.current = null;
    }, 4_000);
  }, [conversationId, draft, kind, realtimeSubscriptionVersion, rootId]);

  useEffect(() => {
    typingExpiryTimersRef.current.forEach((timer) => clearTimeout(timer));
    typingExpiryTimersRef.current.clear();
    setTypingUsers([]);
  }, [conversationId, kind, rootId]);

  useEffect(() => {
    if (auth.demo || !userId || loading || sending) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const pending = { userId, rootId, body: draft, failedSend: failedSendRef.current };
    pendingDraftRef.current = pending;
    draftTimerRef.current = setTimeout(() => void saveThreadDraftState(pending.userId, pending.rootId, pending.body, pending.failedSend).then(() => { if (pendingDraftRef.current === pending) pendingDraftRef.current = null; }).catch(() => undefined), 300);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [auth.demo, draft, loading, rootId, sending, userId]);

  const visible = useMemo(() => sortMessages(replies), [replies]);
  const draftWithinLimit = messageBodyWithinLimit(draft);
  const reactionDetailsMessage = reactionDetails
    ? reactionDetails.messageId === root?.id ? root : replies.find((message) => message.id === reactionDetails.messageId) || null
    : null;
  const send = async (retryMessage?: Message) => {
    const body = (retryMessage?.body || draft).trim();
    if (!root || !user || !body || sending) return;
    if (!messageBodyWithinLimit(body)) {
      if (retryMessage) Alert.alert('Reply is too long to send', `Shorten this reply to ${MESSAGE_BODY_LIMIT.toLocaleString()} characters, then send it again.`);
      return;
    }
    const retryIntent = retryMessage?.client_message_id
      ? { body, clientMessageId: retryMessage.client_message_id }
      : null;
    const clientMessageId = clientMessageIdForSend(body, retryIntent);
    const intent = { body, clientMessageId };
    const optimisticId = retryMessage?.id || --tempMessageIdRef.current;
    const optimistic = retryMessage || pendingReplyMessage(root, user, optimisticId, intent);
    setSending(true);
    failedSendRef.current = intent;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    pendingDraftRef.current = null;
    if (!retryMessage) {
      draftRef.current = '';
      setDraft('');
    }
    if (userId && !auth.demo) void saveThreadDraftState(userId, rootId, draftRef.current, intent).catch(() => undefined);
    setReplies((current) => sortMessages([
      ...current.filter((message) => message.id !== optimisticId),
      { ...optimistic, client_message_id: clientMessageId, client_status: 'sending', client_error: undefined },
    ]));
    try {
      if (auth.demo) {
        setReplies((current) => current.map((message) => message.id === optimisticId ? { ...message, client_status: undefined } : message));
        failedSendRef.current = null;
        requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
        if (!retryMessage) voiceDraft.markSent(body);
        return;
      }
      const result = await api.sendMessage(kind, conversationId, { body, parent_message_id: rootId, client_message_id: clientMessageId, mention_user_ids: resolveMentionUserIds(body, users), send_push: true });
      setReplies((current) => reconcileOptimistic(current, optimisticId, result.message));
      acknowledgeSentReply(result.message);
      if (!retryMessage) voiceDraft.markSent(body);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (requestError) {
      if (failedSendRef.current?.clientMessageId !== clientMessageId) return;
      setReplies((current) => markOptimisticFailed(current, optimistic, (requestError as Error).message));
      if (userId && !auth.demo) await saveThreadDraftState(userId, rootId, draftRef.current, intent).catch(() => undefined);
      Alert.alert('Reply not sent', (requestError as Error).message, [{ text: 'Keep for retry' }]);
    }
    finally { setSending(false); }
  };

  const toggleReaction = async (message: Message, value: string) => {
    if (auth.demo) {
      const actor = user || demoUser;
      if (message.id === rootId) setRoot((current) => current ? toggleOwnReaction(current, value, actor) : current);
      else setReplies((current) => current.map((item) => item.id === message.id ? toggleOwnReaction(item, value, actor) : item));
      return;
    }
    try { const remove = Boolean(message.reactions.find((reaction) => reaction.emoji === value)?.reacted); const result = await api.react(message.id, value, remove); if (message.id === rootId) setRoot(result.message); else setReplies((current) => current.map((item) => item.id === message.id ? result.message : item)); }
    catch (requestError) { Alert.alert('Could not update reaction', (requestError as Error).message); }
  };

  const reportMessage = async (message: Message) => {
    try { if (!auth.demo) await api.reportContent({ message_id: message.id, reason: 'inappropriate_content' }); Alert.alert('Report received', 'Thank you. Code School staff will review it.'); }
    catch (requestError) { Alert.alert('Could not send report', (requestError as Error).message); }
  };

  const blockUser = async (message: Message) => {
    try { if (!auth.demo) await api.blockUser(message.author.id); Alert.alert('User blocked', `You can unblock ${message.author.full_name} from your profile.`); router.back(); }
    catch (requestError) { Alert.alert('Could not block user', (requestError as Error).message); }
  };

  const openSafetyActions = (message: Message) => {
    if (message.mine || message.id <= 0) return;
    Alert.alert(`Actions for ${message.author.full_name}`, 'Report inappropriate content or block this person.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report message', onPress: () => void reportMessage(message) },
      { text: 'Block user', style: 'destructive', onPress: () => void blockUser(message) },
    ]);
  };

  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View><Text style={styles.title}>Thread</Text><Text style={styles.subtitle}>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</Text></View></View>
    {loading && !root ? <LoadingState label="Loading thread" /> : !root ? <ErrorState message={error || 'This thread is no longer available.'} retry={() => void load()} /> : <>
      <View style={styles.root}><MessageBubble message={root} showAuthor mentionUsers={users} onLongPress={openSafetyActions} onOpenReaction={(message, value) => setReactionDetails({ messageId: message.id, emoji: value })} onOpenImage={(attachment, images) => setImagePreview({ attachments: images, attachmentId: attachment.id })} /></View>
      <View style={styles.divider}><Text style={styles.dividerText}>REPLIES</Text><View style={styles.line} /></View>
      <FlatList ref={listRef} data={visible} keyExtractor={(message) => String(message.id)} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list} renderItem={({ item, index }) => <MessageBubble message={item} showAuthor={!visible[index - 1] || visible[index - 1].author.id !== item.author.id} mentionUsers={users} onLongPress={openSafetyActions} onOpenReaction={(message, value) => setReactionDetails({ messageId: message.id, emoji: value })} onOpenImage={(attachment, images) => setImagePreview({ attachments: images, attachmentId: attachment.id })} onRetry={(message) => void send(message)} />} ListEmptyComponent={<Text style={styles.empty}>Start a focused conversation about this message.</Text>} />
    </>}
    <VoiceDraftPanel state={voiceDraft.state} durationMillis={voiceDraft.durationMillis} maxDurationSeconds={voiceDraft.maxDurationSeconds} metering={voiceDraft.metering} error={voiceDraft.error} notice={voiceDraft.notice} hasReview={Boolean(voiceDraft.review)} hasRecording={voiceDraft.hasRecording} onStop={() => void voiceDraft.stop()} onCancel={() => void voiceDraft.cancel()} onRetry={voiceDraft.retry} onRecordAgain={() => void voiceDraft.recordAgain()} onRestore={voiceDraft.restore} onDismiss={voiceDraft.dismissReview} />
    <TypingIndicator users={typingUsers} />
    <ComposerLimitNotice value={draft} />
    <MessageFormattingToolbar value={draft} selection={selection} visible={formattingExpanded} disabled={sending} onChange={(value) => { draftRef.current = value; setDraft(value); }} onSelectionChange={setSelection} onComposerFocus={() => inputRef.current?.focus()} onLimitExceeded={() => Alert.alert('Draft is too long', `This formatting would exceed the ${MESSAGE_BODY_LIMIT.toLocaleString()}-character limit.`)} />
    <View style={styles.composer}>
      <TextInput ref={inputRef} accessibilityLabel="Reply to thread" value={draft} selection={selection} onSelectionChange={(event) => setSelection(event.nativeEvent.selection)} onChangeText={(value) => { if (messageBodyChangeAllowed(draftRef.current, value)) { draftRef.current = value; setDraft(value); } }} placeholder="Reply to thread" placeholderTextColor={palette.quiet} multiline style={styles.input} />
      <View style={styles.composerActions}><FormattingToggleButton expanded={formattingExpanded} disabled={sending} onPress={() => setFormattingExpanded((current) => !current)} /><VoiceDraftButton state={voiceDraft.state} disabled={sending} onPress={() => void voiceDraft.start()} /><View style={styles.composerSpacer} /><Pressable accessibilityRole="button" accessibilityLabel="Send reply" disabled={!draft.trim() || !draftWithinLimit || sending} onPress={() => void send()} style={[styles.send, (!draft.trim() || !draftWithinLimit || sending) && styles.disabled]}><Send color={palette.text} size={19} /></Pressable></View>
    </View>
    <ReactionDetailsSheet key={reactionDetails ? `${reactionDetails.messageId}-${reactionDetails.emoji}` : 'closed-reactions'} initialEmoji={reactionDetails?.emoji || null} message={reactionDetailsMessage} onClose={() => setReactionDetails(null)} onToggle={async (message, value) => { await toggleReaction(message, value); }} />
    <ImagePreview key={imagePreview?.attachmentId ?? 'closed-preview'} attachments={imagePreview?.attachments || []} initialAttachmentId={imagePreview?.attachmentId || null} onClose={() => setImagePreview(null)} />
  </KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 17 }, subtitle: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 2 }, root: { paddingHorizontal: 14, paddingTop: 18 }, divider: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginVertical: 12 }, dividerText: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1.2 }, line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.line }, list: { paddingHorizontal: 14, paddingBottom: 24, flexGrow: 1 }, empty: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', paddingHorizontal: 40, paddingTop: 50 }, composer: { paddingHorizontal: 14, paddingVertical: 9, gap: 4, backgroundColor: palette.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line }, composerActions: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 4 }, composerSpacer: { flex: 1 }, input: { width: '100%', minHeight: 46, maxHeight: 120, borderRadius: 17, backgroundColor: palette.ink, borderWidth: 1, borderColor: palette.line, color: palette.text, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 11 }, send: { width: 46, height: 46, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.38 },
});
