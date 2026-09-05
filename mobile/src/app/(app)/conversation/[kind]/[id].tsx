import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ArrowDownToLine, ArrowLeft, Bell, BellOff, BookOpen, ChevronDown, Edit3, Flag, Hash, MessageSquareReply, Paperclip, Pin, Send, Trash2, UserX, Wifi, WifiOff, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ComposerLimitNotice } from '@/components/composer-limit-notice';
import { ImagePreview } from '@/components/image-preview';
import { MessageBubble } from '@/components/message-bubble';
import { ReactionDetailsSheet } from '@/components/reaction-details-sheet';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { VoiceDraftButton, VoiceDraftPanel } from '@/components/voice-draft-controls';
import { fontScaleLimits, fonts, palette } from '@/constants/csg-theme';
import { useVoiceDraft } from '@/hooks/use-voice-draft';
import { pendingAttachment, uploadAttachment } from '@/lib/attachments';
import { subscribeToMessages } from '@/lib/cable';
import { formatConversationDay, isDifferentConversationDay, isNearConversationBottom } from '@/lib/conversation-scroll';
import { clearConversationDraftAfterSend, loadConversationDraft, loadFailedMessages, saveConversationDraft, saveFailedMessages } from '@/lib/conversation-storage';
import { demoChannels, demoDms, demoMessages, demoUser } from '@/lib/demo-data';
import { insertMention, mentionSuggestions, mentionTriggerAt, resolveMentionUserIds } from '@/lib/mentions';
import { clientMessageIdForSend, messageBodyChangeAllowed, messageBodyWithinLimit, messageInsertionWithinLimit, MESSAGE_BODY_LIMIT } from '@/lib/message-compose';
import { messagePreview } from '@/lib/message-format';
import { markOptimisticFailed, mergeMessageEvent, mergeOlderMessages, mergePinnedMessageEvent, mergeServerAndFailedMessages, reconcileOptimistic, sortMessages, toggleOwnReaction } from '@/lib/message-state';
import { REACTION_OPTIONS } from '@/lib/reactions';
import type { ChannelSummary, ConversationKind, DirectConversationSummary, Message, MessageEvent, MessageWindowMeta, PendingAttachment, UserSummary } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

type ConnectionStatus = 'connecting' | 'connected' | 'offline';
type ConversationItem = { message: Message; previous?: Message };
type PendingConversationDraft = { userId: number; kind: ConversationKind; id: number; body: string };

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ kind: string; id: string; messageId?: string; source_type?: string; source_id?: string; source_label?: string; source_cohort_id?: string; source_student_id?: string }>();
  const kind: ConversationKind = params.kind === 'dm' ? 'dm' : 'channel';
  const id = Number(params.id);
  const conversationIdentity = `${kind}:${id}`;
  const anchorMessageId = Number(params.messageId) || undefined;
  const sourceId = Number(params.source_id) || undefined;
  const sourceType = params.source_type === 'submission' || params.source_type === 'help_request' ? params.source_type : undefined;
  const sourceLabel = params.source_label?.trim();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const userId = user?.id ?? null;
  const listRef = useRef<FlatList<ConversationItem>>(null);
  const nearBottomRef = useRef(true);
  const pendingScrollRef = useRef(!anchorMessageId);
  const keyboardShouldFollowRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = useRef<PendingConversationDraft | null>(null);
  const persistedFailedRef = useRef<string | null>(null);
  const anchorScrolledRef = useRef(false);
  const loadRequestRef = useRef(0);
  const [summary, setSummary] = useState<ChannelSummary | DirectConversationSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<MessageWindowMeta>({ oldest_message_id: null, newest_message_id: null, has_older: false, has_newer: false });
  const [mentionUsers, setMentionUsers] = useState<UserSummary[]>([]);
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedConversationIdentity, setLoadedConversationIdentity] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(auth.demo ? 'connected' : 'connecting');
  const [showScrollToLatest, setShowScrollToLatest] = useState(Boolean(anchorMessageId));
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showPins, setShowPins] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editSelection, setEditSelection] = useState({ start: 0, end: 0 });
  const [reactionDetails, setReactionDetails] = useState<{ messageId: number; emoji: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<{ attachments: Message['attachments']; attachmentId: number } | null>(null);
  const voiceDraft = useVoiceDraft({
    api,
    demo: auth.demo,
    surface: 'message',
    draft,
    selection,
    disabled: sending || Boolean(editingMessage),
    maxDraftLength: MESSAGE_BODY_LIMIT,
    onDraftChange: setDraft,
    onSelectionChange: setSelection,
  });

  const composerValue = editingMessage ? editDraft : draft;
  const updateComposerValue = editingMessage ? setEditDraft : setDraft;
  const composerSelection = editingMessage ? editSelection : selection;
  const updateComposerSelection = editingMessage ? setEditSelection : setSelection;
  const composerHasContent = Boolean(composerValue.trim() || (!editingMessage && attachments.length));
  const composerWithinLimit = messageBodyWithinLimit(composerValue);
  const rootMessages = useMemo(() => messages.filter((message) => !message.parent_message_id), [messages]);
  const conversationItems = useMemo(() => rootMessages.map((message, index) => ({ message, previous: rootMessages[index - 1] })).reverse(), [rootMessages]);
  const mentionTrigger = useMemo(() => mentionTriggerAt(composerValue, composerSelection.start), [composerSelection.start, composerValue]);
  const suggestions = useMemo(() => mentionTrigger ? mentionSuggestions(mentionUsers.filter((member) => member.id !== user?.id), mentionTrigger.query) : [], [mentionTrigger, mentionUsers, user?.id]);
  const showEveryone = Boolean(kind === 'channel' && mentionTrigger && 'everyone'.startsWith(mentionTrigger.query.trim().toLowerCase()));
  const reactionDetailsMessage = reactionDetails ? messages.find((message) => message.id === reactionDetails.messageId) || null : null;

  const scrollToLatest = useCallback((animated = true) => {
    nearBottomRef.current = true;
    pendingScrollRef.current = true;
    setShowScrollToLatest(false);
    setNewMessagesBelow(0);
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ animated, offset: 0 }));
  }, []);

  const flushPendingDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const pending = pendingDraftRef.current;
    pendingDraftRef.current = null;
    if (pending) void saveConversationDraft(pending.userId, pending.kind, pending.id, pending.body).catch(() => undefined);
  }, []);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    persistedFailedRef.current = null;
    setLoading(true);
    setLoadedConversationIdentity(null);
    anchorScrolledRef.current = false;
    try {
      if (userId && !auth.demo) {
        const storedDraft = await loadConversationDraft(userId, kind, id);
        if (requestId !== loadRequestRef.current) return;
        setDraft(storedDraft);
      }
      if (auth.demo) {
        setSummary(kind === 'channel' ? demoChannels.find((item) => item.id === id) || null : demoDms.find((item) => item.id === id) || null);
        setMessages(demoMessages[`${kind}:${id}`] || []);
        setMentionUsers([demoUser]);
        setLoadedConversationIdentity(conversationIdentity);
      } else {
        const result = kind === 'channel'
          ? await api.channel(id, { message_limit: 80, around_message_id: anchorMessageId })
          : await api.directConversation(id, { message_limit: 80, around_message_id: anchorMessageId });
        if (requestId !== loadRequestRef.current) return;
        const nextSummary = 'channel' in result ? result.channel : result.direct_conversation;
        const workspaceResult = await api.workspace(nextSummary.workspace_id);
        const failed = userId ? await loadFailedMessages(userId, kind, id) : [];
        if (requestId !== loadRequestRef.current) return;
        const mergedMessages = mergeServerAndFailedMessages(result.messages, failed);
        setSummary(nextSummary);
        setMessages(mergedMessages);
        setPinnedMessages(result.pinned_messages);
        setMeta(result.meta);
        setMentionUsers(workspaceResult.workspace.members);
        setLoadedConversationIdentity(conversationIdentity);
        await api.markRead(kind, id).catch(() => undefined);
      }
      nearBottomRef.current = !anchorMessageId;
      pendingScrollRef.current = !anchorMessageId;
      setShowScrollToLatest(Boolean(anchorMessageId));
      setError(null);
    } catch (requestError) {
      if (requestId === loadRequestRef.current) setError((requestError as Error).message);
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [anchorMessageId, api, auth.demo, conversationIdentity, id, kind, userId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => { cancelAnimationFrame(frame); loadRequestRef.current += 1; flushPendingDraft(); };
  }, [flushPendingDraft, load]);

  useEffect(() => {
    if (!userId || auth.demo || loading || loadedConversationIdentity !== conversationIdentity) return;
    const failed = messages.filter((message) => message.client_status === 'failed');
    const serialized = JSON.stringify(failed);
    if (persistedFailedRef.current === serialized) return;
    persistedFailedRef.current = serialized;
    void saveFailedMessages(userId, kind, id, failed).catch(() => {
      if (persistedFailedRef.current === serialized) persistedFailedRef.current = null;
    });
  }, [auth.demo, conversationIdentity, id, kind, loadedConversationIdentity, loading, messages, userId]);

  useEffect(() => auth.demo || loading || error ? undefined : subscribeToMessages(api, kind, id, (payload: MessageEvent) => {
    if ((kind === 'channel' && payload.channel_id !== id) || (kind === 'dm' && payload.direct_conversation_id !== id)) return;
    if (payload.message.parent_message_id && payload.event === 'created') return;
    const follow = payload.message.mine || nearBottomRef.current;
    if (payload.event === 'created' && !follow) {
      setShowScrollToLatest(true);
      if (!payload.message.mine) setNewMessagesBelow((current) => current + 1);
    }
    setMessages((current) => mergeMessageEvent(current, payload));
    setPinnedMessages((current) => mergePinnedMessageEvent(current, payload));
    if (follow) scrollToLatest(false);
  }, setStatus), [api, auth.demo, error, id, kind, loading, scrollToLatest]);

  useEffect(() => {
    if (!userId || loading) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const pending = { userId, kind, id, body: draft };
    pendingDraftRef.current = pending;
    draftTimerRef.current = setTimeout(() => void saveConversationDraft(pending.userId, pending.kind, pending.id, pending.body).then(() => { if (pendingDraftRef.current === pending) pendingDraftRef.current = null; }).catch(() => undefined), 300);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [draft, id, kind, loading, userId]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const show = Keyboard.addListener(showEvent, () => { if (keyboardShouldFollowRef.current || nearBottomRef.current) scrollToLatest(false); });
    const shown = Keyboard.addListener('keyboardDidShow', () => { if (keyboardShouldFollowRef.current || nearBottomRef.current) scrollToLatest(false); });
    return () => { show.remove(); shown.remove(); };
  }, [scrollToLatest]);

  const loadOlder = async () => {
    if (auth.demo || loadingOlder || !meta.has_older || !meta.oldest_message_id) return;
    setLoadingOlder(true);
    try {
      const result = kind === 'channel'
        ? await api.channel(id, { message_limit: 60, before_message_id: meta.oldest_message_id })
        : await api.directConversation(id, { message_limit: 60, before_message_id: meta.oldest_message_id });
      setMessages((current) => mergeOlderMessages(current, result.messages));
      setMeta((current) => ({ ...result.meta, newest_message_id: current.newest_message_id, has_newer: current.has_newer }));
    } catch (requestError) { Alert.alert('Could not load earlier messages', (requestError as Error).message); }
    finally { setLoadingOlder(false); }
  };

  const send = async (retryMessage?: Message) => {
    const body = (retryMessage ? retryMessage.body : draft).trim();
    if ((!body && !attachments.length && !retryMessage?.client_uploads?.length) || sending) return;
    if (!messageBodyWithinLimit(body)) {
      if (retryMessage) Alert.alert('Message is too long to send', `Shorten this message to ${MESSAGE_BODY_LIMIT.toLocaleString()} characters, then send it again.`);
      return;
    }
    setSending(true);
    let optimistic: Message | null = retryMessage || null;
    try {
      const uploaded = [...(retryMessage?.client_uploads || [])];
      for (const attachment of retryMessage ? [] : attachments) {
        setAttachments((current) => current.map((item) => item.local_id === attachment.local_id ? { ...item, status: 'uploading' } : item));
        const value = await uploadAttachment(api, kind, id, attachment, (progress) => setAttachments((current) => current.map((item) => item.local_id === attachment.local_id ? { ...item, progress } : item)));
        uploaded.push(value);
      }
      const optimisticId = retryMessage?.id || -Date.now();
      const failedIntent = retryMessage?.client_message_id
        ? { body, clientMessageId: retryMessage.client_message_id }
        : null;
      const clientMessageId = clientMessageIdForSend(body, failedIntent);
      optimistic = retryMessage
        ? { ...retryMessage, client_message_id: clientMessageId }
        : { id: optimisticId, channel_id: kind === 'channel' ? id : null, direct_conversation_id: kind === 'dm' ? id : null, parent_message_id: null, client_message_id: clientMessageId, body, mention_user_ids: resolveMentionUserIds(body, mentionUsers), edited_at: null, deleted_at: null, pinned_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), mine: true, reactions: [], attachments: uploaded.map((item, index) => ({ id: -(index + 1), filename: item.filename, content_type: item.content_type, byte_size: item.byte_size, image: item.content_type.startsWith('image/'), url: attachments[index]?.uri })), author: user || demoUser, reply_count: 0, client_uploads: uploaded };
      const sendingMessage = { ...optimistic, client_status: 'sending' as const, client_error: undefined };
      setMessages((current) => sortMessages([...current.filter((item) => item.id !== optimisticId), sendingMessage]));
      scrollToLatest(false);
      if (!retryMessage) { setDraft(''); setAttachments([]); }
      if (auth.demo) {
        setMessages((current) => current.map((item) => item.id === optimisticId ? { ...item, client_status: undefined } : item));
        if (!retryMessage) voiceDraft.markSent(body);
        return;
      }
      const { message } = await api.sendMessage(kind, id, { body, client_message_id: clientMessageId, mention_user_ids: resolveMentionUserIds(body, mentionUsers), attachments: uploaded, send_push: true });
      setMessages((current) => reconcileOptimistic(current, optimisticId, message));
      if (!retryMessage) voiceDraft.markSent(body);
      if (userId && !retryMessage) {
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        pendingDraftRef.current = null;
        await clearConversationDraftAfterSend(userId, kind, id);
      }
    } catch (requestError) {
      if (!optimistic) {
        setAttachments((current) => current.map((item) => item.status === 'uploading' ? { ...item, status: 'failed', error: (requestError as Error).message } : item));
        Alert.alert('Attachment not uploaded', (requestError as Error).message);
        setSending(false);
        return;
      }
      setMessages((current) => {
        return markOptimisticFailed(current, optimistic!, (requestError as Error).message);
      });
      Alert.alert('Message not sent', (requestError as Error).message, [{ text: 'Keep for retry' }]);
    } finally { setSending(false); }
  };

  const saveEdit = async () => {
    if (!editingMessage || sending || !editDraft.trim() || !messageBodyWithinLimit(editDraft.trim())) return;
    setSending(true);
    try {
      const body = editDraft.trim();
      const result = await api.updateMessage(editingMessage.id, body, resolveMentionUserIds(body, mentionUsers));
      setMessages((current) => current.map((message) => message.id === result.message.id ? result.message : message));
      setEditingMessage(null); setEditDraft(''); setEditSelection({ start: 0, end: 0 });
    } catch (requestError) { Alert.alert('Could not edit message', (requestError as Error).message); }
    finally { setSending(false); }
  };

  const deleteMessage = (message: Message) => Alert.alert('Remove this message?', 'The message will no longer appear in the conversation.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { try { await api.deleteMessage(message.id); setMessages((current) => current.filter((item) => item.id !== message.id)); } catch (requestError) { Alert.alert('Could not remove message', (requestError as Error).message); } } }]);
  const reportMessage = (message: Message) => Alert.alert(
    'Report this message?',
    'A Code School staff member will review the message and its context. The author is not notified who submitted the report.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive', onPress: async () => {
        try { if (!auth.demo) await api.reportContent({ message_id: message.id, reason: 'inappropriate_content' }); Alert.alert('Report received', 'Thank you. Code School staff will review it.'); }
        catch (requestError) { Alert.alert('Could not send report', (requestError as Error).message); }
      } },
    ],
  );
  const reportUser = (message: Message) => Alert.alert(
    `Report ${message.author.full_name}?`,
    'A Code School staff member will review this account and the surrounding context.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Report', style: 'destructive', onPress: async () => {
        try { if (!auth.demo) await api.reportContent({ reported_user_id: message.author.id, reason: 'safety_concern' }); Alert.alert('Report received', 'Thank you. Code School staff will review it.'); }
        catch (requestError) { Alert.alert('Could not send report', (requestError as Error).message); }
      } },
    ],
  );
  const blockUser = (message: Message) => Alert.alert(
    `Block ${message.author.full_name}?`,
    'Their messages will be hidden for you, and neither of you can start or continue a direct conversation. You can unblock them from your profile.',
    [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Block', style: 'destructive', onPress: async () => {
        try {
          if (!auth.demo) await api.blockUser(message.author.id);
          setMessages((current) => current.map((item) => item.author.id === message.author.id ? { ...item, blocked: true, body: '', attachments: [], reactions: [] } : item));
          if (kind === 'dm') router.back();
          Alert.alert('User blocked', `You can unblock ${message.author.full_name} from your profile.`);
        } catch (requestError) { Alert.alert('Could not block user', (requestError as Error).message); }
      } },
    ],
  );
  const togglePin = async (message: Message) => { try { const result = await api.pinMessage(message.id, Boolean(message.pinned_at)); setMessages((current) => current.map((item) => item.id === message.id ? result.message : item)); setPinnedMessages((current) => result.message.pinned_at ? [result.message, ...current.filter((item) => item.id !== message.id)] : current.filter((item) => item.id !== message.id)); setSelectedMessage(null); } catch (requestError) { Alert.alert('Could not update pin', (requestError as Error).message); } };
  const toggleReaction = async (message: Message, value: string) => {
    if (auth.demo) {
      const actor = user || demoUser;
      setMessages((current) => current.map((item) => item.id === message.id ? toggleOwnReaction(item, value, actor) : item));
      return;
    }

    try {
      const remove = Boolean(message.reactions.find((reaction) => reaction.emoji === value)?.reacted);
      const result = await api.react(message.id, value, remove);
      setMessages((current) => current.map((item) => item.id === message.id ? result.message : item));
    } catch (requestError) {
      Alert.alert('Could not update reaction', (requestError as Error).message);
    }
  };
  const openThread = (message: Message) => router.push({ pathname: '/thread/[id]', params: { id: String(message.id), kind, conversationId: String(id), workspaceId: String(summary?.workspace_id || '') } } as unknown as Href);

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (result.canceled) return;
    try { setAttachments((current) => [...current, ...result.assets.map((asset) => pendingAttachment(asset))].slice(0, 10)); } catch (pickError) { Alert.alert('Could not attach file', (pickError as Error).message); }
  };
  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.86 });
    if (result.canceled) return;
    try { setAttachments((current) => [...current, ...result.assets.map((asset) => pendingAttachment({ uri: asset.uri, name: asset.fileName, size: asset.fileSize, mimeType: asset.mimeType }))].slice(0, 10)); } catch (pickError) { Alert.alert('Could not attach photo', (pickError as Error).message); }
  };

  const toggleMute = async () => { if (!summary) return; const next = !summary.muted; setSummary({ ...summary, muted: next }); if (!auth.demo) try { await api.updatePreference(kind, id, next); } catch { setSummary({ ...summary, muted: !next }); } };
  const title = summary ? ('name' in summary ? summary.name : summary.title) : 'Conversation';
  const canManage = user?.is_staff;

  const openSourceRecord = () => {
    if (!sourceType || !sourceId) return;
    if (sourceType === 'help_request') router.push({ pathname: '/staff/support/[id]', params: { id: String(sourceId) } });
    else router.push({ pathname: '/staff/submission/[id]', params: { id: String(sourceId), cohort_id: params.source_cohort_id || '', student_id: params.source_student_id || '' } });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={palette.text} size={22} /></Pressable>
          {kind === 'channel' ? <View style={styles.hash}><Hash color={palette.rubySoft} size={18} /></View> : <Avatar name={title} size={38} />}
          <Pressable accessibilityRole="button" accessibilityLabel="Open pinned messages" onPress={() => setShowPins(true)} style={styles.headerCopy}><Text maxFontSizeMultiplier={fontScaleLimits.title} numberOfLines={1} style={styles.title}>{title}</Text><View style={styles.status}>{status === 'connected' ? <Wifi color={palette.success} size={12} /> : <WifiOff color={palette.warning} size={12} />}<Text maxFontSizeMultiplier={fontScaleLimits.utility} numberOfLines={2} style={styles.statusText}>{status === 'connected' ? (summary?.workspace_name || 'Connected') : status === 'connecting' ? 'Connecting' : 'Reconnecting'}{pinnedMessages.length ? ` · ${pinnedMessages.length} pinned` : ''}</Text></View></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={summary?.muted ? 'Unmute conversation' : 'Mute conversation'} onPress={() => void toggleMute()} style={styles.iconButton}>{summary?.muted ? <BellOff color={palette.muted} size={20} /> : <Bell color={palette.muted} size={20} />}</Pressable>
        </View>
        {sourceType && sourceId && sourceLabel && <Pressable accessibilityRole="button" accessibilityLabel={`Return to ${sourceLabel}`} onPress={openSourceRecord} style={styles.sourceChip}><BookOpen color="#7DA8E8" size={15} /><Text numberOfLines={1} style={styles.sourceText}>From {sourceType === 'submission' ? 'submission' : 'help request'}: {sourceLabel}</Text></Pressable>}
        {loading ? <LoadingState label="Loading messages" /> : error ? <ErrorState message={error} retry={() => void load()} /> : <View style={styles.messagePane}>
          <FlatList ref={listRef} data={conversationItems} inverted keyExtractor={(item) => String(item.message.id)} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" maintainVisibleContentPosition={{ minIndexForVisible: 0 }} scrollEventThrottle={16}
            onEndReached={() => void loadOlder()} onEndReachedThreshold={0.2}
            onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => { const near = isNearConversationBottom(event.nativeEvent, 96, true); nearBottomRef.current = near; setShowScrollToLatest(!near); if (near) setNewMessagesBelow(0); }}
            onContentSizeChange={() => {
              if (anchorMessageId && !anchorScrolledRef.current) {
                const index = conversationItems.findIndex((item) => item.message.id === anchorMessageId);
                if (index >= 0) { anchorScrolledRef.current = true; requestAnimationFrame(() => listRef.current?.scrollToIndex({ animated: false, index, viewPosition: 0.5 })); }
                return;
              }
              if (!pendingScrollRef.current) return;
              pendingScrollRef.current = false;
              requestAnimationFrame(() => listRef.current?.scrollToOffset({ animated: false, offset: 0 }));
            }}
            onScrollToIndexFailed={({ index, averageItemLength }) => setTimeout(() => listRef.current?.scrollToOffset({ animated: false, offset: Math.max(0, index * averageItemLength) }), 50)}
            contentContainerStyle={styles.list}
            ListFooterComponent={loadingOlder ? <Text style={styles.loadingOlder}>Loading earlier messages…</Text> : null}
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.emptyCopy}>Messages sent here stay connected to your Code School workspace.</Text></View>}
            renderItem={({ item }) => <View style={item.message.id === anchorMessageId && styles.targetMessage}>{isDifferentConversationDay(item.message.created_at, item.previous?.created_at) && <DayDivider value={item.message.created_at} />}<MessageBubble message={item.message} showAuthor={!item.previous || item.previous.author.id !== item.message.author.id || isDifferentConversationDay(item.message.created_at, item.previous.created_at)} mentionUsers={mentionUsers} onLongPress={setSelectedMessage} onOpenReaction={(message, value) => setReactionDetails({ messageId: message.id, emoji: value })} onOpenImage={(attachment, images) => setImagePreview({ attachments: images, attachmentId: attachment.id })} onThread={openThread} onRetry={(message) => void send(message)} /></View>}
          />
          {showScrollToLatest && <Pressable accessibilityRole="button" accessibilityLabel="Jump to latest message" onPress={() => { scrollToLatest(true); if (!auth.demo) void api.markRead(kind, id); }} style={styles.latestButton}><ChevronDown color={palette.text} size={17} strokeWidth={2.5} /><Text style={styles.latestText}>{newMessagesBelow ? `${newMessagesBelow} new` : 'Jump to latest'}</Text></Pressable>}
        </View>}
        {mentionTrigger && (showEveryone || suggestions.length > 0) && <View style={styles.mentionPanel}>{showEveryone && <Pressable accessibilityRole="button" accessibilityLabel="Mention everyone" onPress={() => { const value = `${composerValue.slice(0, mentionTrigger.start)}@everyone ${composerValue.slice(mentionTrigger.end)}`; const next = messageInsertionWithinLimit(value, mentionTrigger.start + 10); if (!next) return; updateComposerValue(next.value); updateComposerSelection({ start: next.cursor, end: next.cursor }); }} style={styles.mentionRow}><View style={styles.everyoneIcon}><Hash color={palette.rubySoft} size={15} /></View><View><Text style={styles.mentionName}>@everyone</Text><Text style={styles.mentionEmail}>Notify everyone in this channel</Text></View></Pressable>}{suggestions.map((member) => <Pressable key={member.id} accessibilityRole="button" onPress={() => { const inserted = insertMention(composerValue, mentionTrigger, member); const next = messageInsertionWithinLimit(inserted.value, inserted.cursor); if (!next) return; updateComposerValue(next.value); updateComposerSelection({ start: next.cursor, end: next.cursor }); }} style={styles.mentionRow}><Avatar name={member.full_name} size={30} /><View><Text style={styles.mentionName}>{member.full_name}</Text><Text style={styles.mentionEmail}>{member.email}</Text></View></Pressable>)}</View>}
        {!!attachments.length && <ScrollView horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={styles.attachmentTray}>{attachments.map((attachment) => <View key={attachment.local_id} style={styles.pendingAttachment}><Paperclip color={palette.rubySoft} size={14} /><View style={styles.pendingCopy}><Text numberOfLines={1} style={styles.pendingName}>{attachment.filename}</Text><Text style={styles.pendingStatus}>{attachment.status === 'uploading' ? `${Math.round(attachment.progress * 100)}%` : 'Ready to send'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${attachment.filename}`} onPress={() => setAttachments((current) => current.filter((item) => item.local_id !== attachment.local_id))} style={styles.removeAttachment}><X color={palette.muted} size={14} /></Pressable></View>)}</ScrollView>}
        <VoiceDraftPanel state={voiceDraft.state} durationMillis={voiceDraft.durationMillis} maxDurationSeconds={voiceDraft.maxDurationSeconds} metering={voiceDraft.metering} error={voiceDraft.error} notice={voiceDraft.notice} hasReview={Boolean(voiceDraft.review)} hasRecording={voiceDraft.hasRecording} onStop={() => void voiceDraft.stop()} onCancel={() => void voiceDraft.cancel()} onRetry={voiceDraft.retry} onRecordAgain={() => void voiceDraft.recordAgain()} onRestore={voiceDraft.restore} onDismiss={voiceDraft.dismissReview} />
        {editingMessage && <View style={styles.editBanner}><Edit3 color={palette.rubySoft} size={15} /><Text style={styles.editText}>Editing message</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel editing" onPress={() => { setEditingMessage(null); setEditDraft(''); setEditSelection({ start: 0, end: 0 }); }} style={styles.editClose}><X color={palette.muted} size={16} /></Pressable></View>}
        <ComposerLimitNotice value={composerValue} />
        <View style={styles.composer}><Pressable accessibilityRole="button" accessibilityLabel="Add an attachment" disabled={sending || Boolean(editingMessage)} onPress={() => Alert.alert('Add an attachment', undefined, [{ text: 'Photo library', onPress: () => void pickImage() }, { text: 'Choose a file', onPress: () => void pickDocument() }, { text: 'Cancel', style: 'cancel' }])} style={styles.attachButton}><Paperclip color={palette.muted} size={19} /></Pressable><VoiceDraftButton state={voiceDraft.state} disabled={sending || Boolean(editingMessage)} onPress={() => void voiceDraft.start()} /><TextInput accessibilityLabel={editingMessage ? 'Edit message' : 'Message composer'} accessibilityHint={editingMessage ? 'Update the selected message' : `Enter a message for ${title}`} maxFontSizeMultiplier={fontScaleLimits.content} value={composerValue} selection={composerSelection} onSelectionChange={(event) => updateComposerSelection(event.nativeEvent.selection)} onChangeText={(value) => { if (messageBodyChangeAllowed(composerValue, value)) updateComposerValue(value); }} onFocus={() => { keyboardShouldFollowRef.current = nearBottomRef.current; if (nearBottomRef.current) scrollToLatest(false); }} placeholder={editingMessage ? 'Edit message' : `Message ${kind === 'channel' ? '#' : ''}${title}`} placeholderTextColor={palette.quiet} multiline style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel={editingMessage ? 'Save edit' : 'Send message'} disabled={!composerHasContent || !composerWithinLimit || sending} onPress={() => void (editingMessage ? saveEdit() : send())} style={({ pressed }) => [styles.send, (!composerHasContent || !composerWithinLimit || sending) && styles.sendDisabled, pressed && styles.pressed]}><Send color={palette.text} size={19} /></Pressable></View>
      </KeyboardAvoidingView>

      <Modal visible={Boolean(selectedMessage)} transparent animationType="fade" onRequestClose={() => setSelectedMessage(null)}><View style={styles.modalRoot}><Pressable accessibilityRole="button" accessibilityLabel="Close message actions" style={StyleSheet.absoluteFill} onPress={() => setSelectedMessage(null)} /><View style={styles.actionSheet}><View style={styles.sheetHandle} /><Text style={styles.sheetTitle}>Message actions</Text>{selectedMessage && <>
        {!selectedMessage.deleted_at && !selectedMessage.blocked && <View style={styles.reactionPicker}>{REACTION_OPTIONS.map(({ value, label, Icon }) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={label} onPress={() => { void toggleReaction(selectedMessage, value); setSelectedMessage(null); }} style={styles.reactionButton}><Icon color={palette.text} size={20} /><Text style={styles.reactionLabel}>{label}</Text></Pressable>)}</View>}
        {!selectedMessage.blocked && <Action icon={MessageSquareReply} label="Reply in thread" onPress={() => { openThread(selectedMessage); setSelectedMessage(null); }} />}
        {!!selectedMessage.body && <Action icon={ArrowDownToLine} label="Copy message" onPress={() => { void Clipboard.setStringAsync(selectedMessage.body); setSelectedMessage(null); }} />}
        {canManage && <Action icon={Pin} label={selectedMessage.pinned_at ? 'Unpin message' : 'Pin message'} onPress={() => void togglePin(selectedMessage)} />}
        {!selectedMessage.mine && selectedMessage.id > 0 && <Action icon={Flag} label="Report message" destructive onPress={() => { reportMessage(selectedMessage); setSelectedMessage(null); }} />}
        {!selectedMessage.mine && selectedMessage.id > 0 && <Action icon={Flag} label={`Report ${selectedMessage.author.full_name}`} destructive onPress={() => { reportUser(selectedMessage); setSelectedMessage(null); }} />}
        {!selectedMessage.mine && selectedMessage.id > 0 && !selectedMessage.blocked && <Action icon={UserX} label={`Block ${selectedMessage.author.full_name}`} destructive onPress={() => { blockUser(selectedMessage); setSelectedMessage(null); }} />}
        {selectedMessage.mine && !selectedMessage.deleted_at && selectedMessage.id > 0 && <Action icon={Edit3} label="Edit message" onPress={() => { setEditingMessage(selectedMessage); setEditDraft(selectedMessage.body); setEditSelection({ start: selectedMessage.body.length, end: selectedMessage.body.length }); setSelectedMessage(null); }} />}
        {selectedMessage.mine && selectedMessage.id > 0 && <Action icon={Trash2} label="Remove message" destructive onPress={() => { deleteMessage(selectedMessage); setSelectedMessage(null); }} />}
      </>}</View></View></Modal>

      <Modal visible={showPins} transparent animationType="slide" onRequestClose={() => setShowPins(false)}><View style={styles.modalRoot}><Pressable accessibilityRole="button" accessibilityLabel="Close pinned messages" style={StyleSheet.absoluteFill} onPress={() => setShowPins(false)} /><View style={styles.pinsSheet}><View style={styles.sheetHandle} /><Text style={styles.sheetTitle}>Pinned messages</Text><ScrollView contentContainerStyle={styles.pinsList}>{pinnedMessages.length ? pinnedMessages.map((message) => <Pressable key={message.id} accessibilityRole="button" onPress={() => { setShowPins(false); router.setParams({ messageId: String(message.id) }); }} style={styles.pinCard}><Pin color={palette.rubySoft} size={15} /><View style={styles.pinCardCopy}><Text numberOfLines={3} style={styles.pinBody}>{messagePreview(message.body, 180, message.attachments[0]?.filename || 'Attachment')}</Text><Text style={styles.pinAuthor}>{message.author.full_name}</Text></View></Pressable>) : <Text style={styles.noPins}>Nothing has been pinned in this conversation.</Text>}</ScrollView></View></View></Modal>

      <ReactionDetailsSheet
        key={reactionDetails ? `${reactionDetails.messageId}-${reactionDetails.emoji}` : 'closed-reactions'}
        initialEmoji={reactionDetails?.emoji || null}
        message={reactionDetailsMessage}
        onClose={() => setReactionDetails(null)}
        onToggle={async (message, value) => { await toggleReaction(message, value); }}
      />
      <ImagePreview key={imagePreview?.attachmentId ?? 'closed-preview'} attachments={imagePreview?.attachments || []} initialAttachmentId={imagePreview?.attachmentId || null} onClose={() => setImagePreview(null)} />

    </SafeAreaView>
  );
}

function Action({ icon: Icon, label, onPress, destructive = false }: { icon: LucideIcon; label: string; onPress: () => void; destructive?: boolean }) { return <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}><Icon color={destructive ? palette.rubySoft : palette.muted} size={19} /><Text style={[styles.actionText, destructive && styles.actionDanger]}>{label}</Text></Pressable>; }
function DayDivider({ value }: { value: string }) { return <View style={styles.dayDivider}><View style={styles.dayLine} /><Text style={styles.dayText}>{formatConversationDay(value)}</Text><View style={styles.dayLine} /></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, hash: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minHeight: 44, justifyContent: 'center' }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 16 }, status: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }, statusText: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11 }, sourceChip: { minHeight: 42, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#244A77', backgroundColor: '#122238', paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }, sourceText: { flex: 1, color: '#BED6F5', fontFamily: fonts.bold, fontSize: 11 },
  messagePane: { flex: 1, minHeight: 0 }, list: { paddingHorizontal: 14, paddingVertical: 20, paddingBottom: 28, flexGrow: 1 }, empty: { flex: 1, minHeight: 420, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 50 }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 18 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 }, loadingOlder: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, textAlign: 'center', paddingVertical: 18 },
  dayDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 }, dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.line }, dayText: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase' },
  targetMessage: { marginHorizontal: -8, paddingHorizontal: 8, paddingTop: 7, borderRadius: 16, backgroundColor: '#21161A' },
  latestButton: { position: 'absolute', bottom: 12, alignSelf: 'center', minHeight: 42, borderRadius: 21, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#242936', borderWidth: 1, borderColor: '#3A4253', shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 }, latestText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 },
  mentionPanel: { maxHeight: 210, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.panel, padding: 8 }, mentionRow: { minHeight: 48, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, mentionName: { color: palette.text, fontFamily: fonts.semibold, fontSize: 12 }, mentionEmail: { color: palette.subtle, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  everyoneIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' },
  attachmentTray: { paddingHorizontal: 14, paddingVertical: 8, gap: 8, backgroundColor: palette.panel }, pendingAttachment: { width: 190, minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 }, pendingCopy: { flex: 1 }, pendingName: { color: palette.text, fontFamily: fonts.semibold, fontSize: 11 }, pendingStatus: { color: palette.subtle, fontFamily: fonts.medium, fontSize: 11, marginTop: 2 }, removeAttachment: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  editBanner: { minHeight: 38, paddingHorizontal: 16, backgroundColor: '#201319', borderTopWidth: 1, borderTopColor: '#4A2029', flexDirection: 'row', alignItems: 'center', gap: 8 }, editText: { flex: 1, color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 }, editClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, backgroundColor: palette.panel }, attachButton: { width: 44, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, input: { flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 17, backgroundColor: palette.ink, borderWidth: 1, borderColor: palette.line, color: palette.text, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 11 }, send: { width: 46, height: 46, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' }, sendDisabled: { opacity: 0.38 }, pressed: { transform: [{ scale: 0.96 }] },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,4,8,0.76)' }, actionSheet: { backgroundColor: palette.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 16, paddingBottom: 30 }, pinsSheet: { maxHeight: '76%', backgroundColor: palette.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 16, paddingBottom: 30 }, sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: palette.line, alignSelf: 'center', marginTop: 10 }, sheetTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 20, marginTop: 16, marginBottom: 12 },
  reactionPicker: { flexDirection: 'row', gap: 7, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, reactionButton: { flex: 1, minHeight: 58, borderRadius: 15, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, alignItems: 'center', justifyContent: 'center', gap: 5 }, reactionLabel: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 11 }, action: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 6 }, actionText: { color: palette.text, fontFamily: fonts.semibold, fontSize: 14 }, actionDanger: { color: palette.rubySoft },
  pinsList: { gap: 8, paddingBottom: 12 }, pinCard: { minHeight: 68, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, padding: 13, flexDirection: 'row', gap: 10 }, pinCardCopy: { flex: 1 }, pinBody: { color: palette.text, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }, pinAuthor: { color: palette.subtle, fontFamily: fonts.bold, fontSize: 11, marginTop: 6 }, noPins: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 30, textAlign: 'center' },
});
