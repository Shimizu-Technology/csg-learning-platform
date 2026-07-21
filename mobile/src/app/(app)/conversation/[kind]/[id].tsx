import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ArrowDownToLine, ArrowLeft, Bell, BellOff, ChevronDown, Edit3, Hash, MessageSquareReply, Paperclip, Pin, Send, Trash2, Wifi, WifiOff, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { MessageBubble } from '@/components/message-bubble';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { pendingAttachment, uploadAttachment } from '@/lib/attachments';
import { subscribeToMessages } from '@/lib/cable';
import { formatConversationDay, isDifferentConversationDay, isNearConversationBottom } from '@/lib/conversation-scroll';
import { loadConversationDraft, loadFailedMessages, saveConversationDraft, saveFailedMessages } from '@/lib/conversation-storage';
import { demoChannels, demoDms, demoMessages, demoUser } from '@/lib/demo-data';
import { insertMention, mentionSuggestions, mentionTriggerAt, resolveMentionUserIds } from '@/lib/mentions';
import { mergeMessageEvent, prependOlderMessages, reconcileOptimistic, sortMessages } from '@/lib/message-state';
import { REACTION_OPTIONS } from '@/lib/reactions';
import type { ChannelSummary, DirectConversationSummary, Message, MessageEvent, MessageWindowMeta, PendingAttachment, UserSummary } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

type ConnectionStatus = 'connecting' | 'connected' | 'offline';
type ConversationItem = { message: Message; previous?: Message };

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ kind: string; id: string; messageId?: string }>();
  const kind = params.kind === 'dm' ? 'dm' : 'channel';
  const id = Number(params.id);
  const anchorMessageId = Number(params.messageId) || undefined;
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const listRef = useRef<FlatList<ConversationItem>>(null);
  const nearBottomRef = useRef(true);
  const pendingScrollRef = useRef(!anchorMessageId);
  const keyboardShouldFollowRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchorScrolledRef = useRef(false);
  const [summary, setSummary] = useState<ChannelSummary | DirectConversationSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>([]);
  const [meta, setMeta] = useState<MessageWindowMeta>({ oldest_message_id: null, newest_message_id: null, has_older: false, has_newer: false });
  const [mentionUsers, setMentionUsers] = useState<UserSummary[]>([]);
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(auth.demo ? 'connected' : 'connecting');
  const [showScrollToLatest, setShowScrollToLatest] = useState(Boolean(anchorMessageId));
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showPins, setShowPins] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);

  const rootMessages = useMemo(() => messages.filter((message) => !message.parent_message_id), [messages]);
  const conversationItems = useMemo(() => rootMessages.map((message, index) => ({ message, previous: rootMessages[index - 1] })).reverse(), [rootMessages]);
  const mentionTrigger = useMemo(() => mentionTriggerAt(draft, selection.start), [draft, selection.start]);
  const suggestions = useMemo(() => mentionTrigger ? mentionSuggestions(mentionUsers.filter((member) => member.id !== user?.id), mentionTrigger.query) : [], [mentionTrigger, mentionUsers, user?.id]);
  const showEveryone = Boolean(kind === 'channel' && mentionTrigger && 'everyone'.startsWith(mentionTrigger.query.trim().toLowerCase()));

  const scrollToLatest = useCallback((animated = true) => {
    nearBottomRef.current = true;
    pendingScrollRef.current = true;
    setShowScrollToLatest(false);
    setNewMessagesBelow(0);
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ animated, offset: 0 }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    anchorScrolledRef.current = false;
    try {
      if (auth.demo) {
        setSummary(kind === 'channel' ? demoChannels.find((item) => item.id === id) || null : demoDms.find((item) => item.id === id) || null);
        setMessages(demoMessages[`${kind}:${id}`] || []);
        setMentionUsers([demoUser]);
      } else {
        const result = kind === 'channel'
          ? await api.channel(id, { message_limit: 80, around_message_id: anchorMessageId })
          : await api.directConversation(id, { message_limit: 80, around_message_id: anchorMessageId });
        const nextSummary = 'channel' in result ? result.channel : result.direct_conversation;
        const workspaceResult = await api.workspace(nextSummary.workspace_id);
        const failed = user ? await loadFailedMessages(user.id, kind, id) : [];
        setSummary(nextSummary);
        setMessages(sortMessages([...result.messages, ...failed]));
        setPinnedMessages(result.pinned_messages);
        setMeta(result.meta);
        setMentionUsers(workspaceResult.workspace.members);
        if (user) setDraft(await loadConversationDraft(user.id, kind, id));
        await api.markRead(kind, id);
      }
      nearBottomRef.current = !anchorMessageId;
      pendingScrollRef.current = !anchorMessageId;
      setShowScrollToLatest(Boolean(anchorMessageId));
      setError(null);
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setLoading(false); }
  }, [anchorMessageId, api, auth.demo, id, kind, user]);

  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  useEffect(() => auth.demo || loading || error ? undefined : subscribeToMessages(api, kind, id, (payload: MessageEvent) => {
    if ((kind === 'channel' && payload.channel_id !== id) || (kind === 'dm' && payload.direct_conversation_id !== id)) return;
    if (payload.message.parent_message_id && payload.event === 'created') return;
    const follow = payload.message.mine || nearBottomRef.current;
    if (payload.event === 'created' && !follow) {
      setShowScrollToLatest(true);
      if (!payload.message.mine) setNewMessagesBelow((current) => current + 1);
    }
    setMessages((current) => mergeMessageEvent(current, payload));
    setPinnedMessages((current) => payload.message.pinned_at
      ? [payload.message, ...current.filter((message) => message.id !== payload.message.id)]
      : current.filter((message) => message.id !== payload.message.id));
    if (follow) scrollToLatest(false);
  }, setStatus), [api, auth.demo, error, id, kind, loading, scrollToLatest]);

  useEffect(() => {
    if (!user || loading) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => void saveConversationDraft(user.id, kind, id, draft), 300);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [draft, id, kind, loading, user]);

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
      setMessages((current) => prependOlderMessages(current, result.messages));
      setMeta((current) => ({ ...result.meta, newest_message_id: current.newest_message_id, has_newer: current.has_newer }));
    } catch (requestError) { Alert.alert('Could not load earlier messages', (requestError as Error).message); }
    finally { setLoadingOlder(false); }
  };

  const persistFailed = useCallback((next: Message[]) => { if (user) void saveFailedMessages(user.id, kind, id, next); }, [id, kind, user]);

  const send = async (retryMessage?: Message) => {
    const body = (retryMessage?.body || draft).trim();
    if ((!body && !attachments.length && !retryMessage?.client_uploads?.length) || sending) return;
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
      optimistic = retryMessage || { id: optimisticId, channel_id: kind === 'channel' ? id : null, direct_conversation_id: kind === 'dm' ? id : null, parent_message_id: null, body, mention_user_ids: resolveMentionUserIds(body, mentionUsers), edited_at: null, deleted_at: null, pinned_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), mine: true, reactions: [], attachments: uploaded.map((item, index) => ({ id: -(index + 1), filename: item.filename, content_type: item.content_type, byte_size: item.byte_size, image: item.content_type.startsWith('image/'), url: attachments[index]?.uri })), author: user || demoUser, reply_count: 0, client_uploads: uploaded };
      const sendingMessage = { ...optimistic, client_status: 'sending' as const, client_error: undefined };
      setMessages((current) => sortMessages([...current.filter((item) => item.id !== optimisticId), sendingMessage]));
      scrollToLatest(false);
      if (!retryMessage) { setDraft(''); setAttachments([]); }
      if (auth.demo) { setMessages((current) => current.map((item) => item.id === optimisticId ? { ...item, client_status: undefined } : item)); return; }
      const { message } = await api.sendMessage(kind, id, { body, mention_user_ids: resolveMentionUserIds(body, mentionUsers), attachments: uploaded, send_push: true });
      setMessages((current) => { const next = reconcileOptimistic(current, optimisticId, message); persistFailed(next); return next; });
      if (user) await saveConversationDraft(user.id, kind, id, '');
    } catch (requestError) {
      if (!optimistic) {
        setAttachments((current) => current.map((item) => item.status === 'uploading' ? { ...item, status: 'failed', error: (requestError as Error).message } : item));
        Alert.alert('Attachment not uploaded', (requestError as Error).message);
        setSending(false);
        return;
      }
      setMessages((current) => {
        const failed: Message = { ...optimistic!, client_status: 'failed', client_error: (requestError as Error).message };
        const next = sortMessages([...current.filter((item) => item.id !== failed.id), failed]); persistFailed(next); return next;
      });
      Alert.alert('Message not sent', (requestError as Error).message, [{ text: 'Keep for retry' }]);
    } finally { setSending(false); }
  };

  const saveEdit = async () => {
    if (!editingMessage || !draft.trim()) return;
    try {
      const result = await api.updateMessage(editingMessage.id, draft.trim(), resolveMentionUserIds(draft, mentionUsers));
      setMessages((current) => current.map((message) => message.id === result.message.id ? result.message : message));
      setEditingMessage(null); setDraft('');
    } catch (requestError) { Alert.alert('Could not edit message', (requestError as Error).message); }
  };

  const deleteMessage = (message: Message) => Alert.alert('Remove this message?', 'The message will no longer appear in the conversation.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { try { await api.deleteMessage(message.id); setMessages((current) => current.filter((item) => item.id !== message.id)); } catch (requestError) { Alert.alert('Could not remove message', (requestError as Error).message); } } }]);
  const togglePin = async (message: Message) => { try { const result = await api.pinMessage(message.id, Boolean(message.pinned_at)); setMessages((current) => current.map((item) => item.id === message.id ? result.message : item)); setPinnedMessages((current) => result.message.pinned_at ? [result.message, ...current.filter((item) => item.id !== message.id)] : current.filter((item) => item.id !== message.id)); setSelectedMessage(null); } catch (requestError) { Alert.alert('Could not update pin', (requestError as Error).message); } };
  const toggleReaction = async (message: Message, value: string) => { try { const remove = Boolean(message.reactions.find((reaction) => reaction.emoji === value)?.reacted); const result = await api.react(message.id, value, remove); setMessages((current) => current.map((item) => item.id === message.id ? result.message : item)); } catch (requestError) { Alert.alert('Could not update reaction', (requestError as Error).message); } };
  const openThread = (message: Message) => router.push({ pathname: '/thread/[id]', params: { id: String(message.id), kind, conversationId: String(id) } } as unknown as Href);

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

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={palette.text} size={22} /></Pressable>
          {kind === 'channel' ? <View style={styles.hash}><Hash color={palette.rubySoft} size={18} /></View> : <Avatar name={title} size={38} />}
          <Pressable accessibilityRole="button" accessibilityLabel="Open pinned messages" onPress={() => setShowPins(true)} style={styles.headerCopy}><Text numberOfLines={1} style={styles.title}>{title}</Text><View style={styles.status}>{status === 'connected' ? <Wifi color={palette.success} size={12} /> : <WifiOff color={palette.warning} size={12} />}<Text style={styles.statusText}>{status === 'connected' ? (summary?.workspace_name || 'Connected') : status === 'connecting' ? 'Connecting' : 'Reconnecting'}{pinnedMessages.length ? ` · ${pinnedMessages.length} pinned` : ''}</Text></View></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={summary?.muted ? 'Unmute conversation' : 'Mute conversation'} onPress={() => void toggleMute()} style={styles.iconButton}>{summary?.muted ? <BellOff color={palette.muted} size={20} /> : <Bell color={palette.muted} size={20} />}</Pressable>
        </View>
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
            renderItem={({ item }) => <View style={item.message.id === anchorMessageId && styles.targetMessage}>{isDifferentConversationDay(item.message.created_at, item.previous?.created_at) && <DayDivider value={item.message.created_at} />}<MessageBubble message={item.message} showAuthor={!item.previous || item.previous.author.id !== item.message.author.id || isDifferentConversationDay(item.message.created_at, item.previous.created_at)} mentionUsers={mentionUsers} onLongPress={setSelectedMessage} onReact={(message, value) => void toggleReaction(message, value)} onThread={openThread} onRetry={(message) => void send(message)} /></View>}
          />
          {showScrollToLatest && <Pressable accessibilityRole="button" accessibilityLabel="Jump to latest message" onPress={() => { scrollToLatest(true); if (!auth.demo) void api.markRead(kind, id); }} style={styles.latestButton}><ChevronDown color={palette.text} size={17} strokeWidth={2.5} /><Text style={styles.latestText}>{newMessagesBelow ? `${newMessagesBelow} new` : 'Jump to latest'}</Text></Pressable>}
        </View>}
        {mentionTrigger && (showEveryone || suggestions.length > 0) && <View style={styles.mentionPanel}>{showEveryone && <Pressable accessibilityRole="button" accessibilityLabel="Mention everyone" onPress={() => { const value = `${draft.slice(0, mentionTrigger.start)}@everyone ${draft.slice(mentionTrigger.end)}`; const cursor = mentionTrigger.start + 10; setDraft(value); setSelection({ start: cursor, end: cursor }); }} style={styles.mentionRow}><View style={styles.everyoneIcon}><Hash color={palette.rubySoft} size={15} /></View><View><Text style={styles.mentionName}>@everyone</Text><Text style={styles.mentionEmail}>Notify everyone in this channel</Text></View></Pressable>}{suggestions.map((member) => <Pressable key={member.id} accessibilityRole="button" onPress={() => { const next = insertMention(draft, mentionTrigger, member); setDraft(next.value); setSelection({ start: next.cursor, end: next.cursor }); }} style={styles.mentionRow}><Avatar name={member.full_name} size={30} /><View><Text style={styles.mentionName}>{member.full_name}</Text><Text style={styles.mentionEmail}>{member.email}</Text></View></Pressable>)}</View>}
        {!!attachments.length && <ScrollView horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={styles.attachmentTray}>{attachments.map((attachment) => <View key={attachment.local_id} style={styles.pendingAttachment}><Paperclip color={palette.rubySoft} size={14} /><View style={styles.pendingCopy}><Text numberOfLines={1} style={styles.pendingName}>{attachment.filename}</Text><Text style={styles.pendingStatus}>{attachment.status === 'uploading' ? `${Math.round(attachment.progress * 100)}%` : 'Ready to send'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${attachment.filename}`} onPress={() => setAttachments((current) => current.filter((item) => item.local_id !== attachment.local_id))} style={styles.removeAttachment}><X color={palette.muted} size={14} /></Pressable></View>)}</ScrollView>}
        {editingMessage && <View style={styles.editBanner}><Edit3 color={palette.rubySoft} size={15} /><Text style={styles.editText}>Editing message</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel editing" onPress={() => { setEditingMessage(null); setDraft(''); }} style={styles.editClose}><X color={palette.muted} size={16} /></Pressable></View>}
        <View style={styles.composer}><Pressable accessibilityRole="button" accessibilityLabel="Add an attachment" disabled={sending || Boolean(editingMessage)} onPress={() => Alert.alert('Add an attachment', undefined, [{ text: 'Photo library', onPress: () => void pickImage() }, { text: 'Choose a file', onPress: () => void pickDocument() }, { text: 'Cancel', style: 'cancel' }])} style={styles.attachButton}><Paperclip color={palette.muted} size={19} /></Pressable><TextInput accessibilityLabel="Message" value={draft} selection={selection} onSelectionChange={(event) => setSelection(event.nativeEvent.selection)} onChangeText={setDraft} onFocus={() => { keyboardShouldFollowRef.current = nearBottomRef.current; if (nearBottomRef.current) scrollToLatest(false); }} placeholder={`Message ${kind === 'channel' ? '#' : ''}${title}`} placeholderTextColor={palette.quiet} multiline maxLength={10_000} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel={editingMessage ? 'Save edit' : 'Send message'} disabled={(!draft.trim() && !attachments.length) || sending} onPress={() => void (editingMessage ? saveEdit() : send())} style={({ pressed }) => [styles.send, ((!draft.trim() && !attachments.length) || sending) && styles.sendDisabled, pressed && styles.pressed]}><Send color={palette.text} size={19} /></Pressable></View>
      </KeyboardAvoidingView>

      <Modal visible={Boolean(selectedMessage)} transparent animationType="fade" onRequestClose={() => setSelectedMessage(null)}><View style={styles.modalRoot}><Pressable style={StyleSheet.absoluteFill} onPress={() => setSelectedMessage(null)} /><View style={styles.actionSheet}><View style={styles.sheetHandle} /><Text style={styles.sheetTitle}>Message actions</Text>{selectedMessage && <>
        {!selectedMessage.deleted_at && <View style={styles.reactionPicker}>{REACTION_OPTIONS.map(({ value, label, Icon }) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={label} onPress={() => { void toggleReaction(selectedMessage, value); setSelectedMessage(null); }} style={styles.reactionButton}><Icon color={palette.text} size={20} /><Text style={styles.reactionLabel}>{label}</Text></Pressable>)}</View>}
        <Action icon={MessageSquareReply} label="Reply in thread" onPress={() => { openThread(selectedMessage); setSelectedMessage(null); }} />
        {!!selectedMessage.body && <Action icon={ArrowDownToLine} label="Copy message" onPress={() => { void Clipboard.setStringAsync(selectedMessage.body); setSelectedMessage(null); }} />}
        {canManage && <Action icon={Pin} label={selectedMessage.pinned_at ? 'Unpin message' : 'Pin message'} onPress={() => void togglePin(selectedMessage)} />}
        {selectedMessage.mine && !selectedMessage.deleted_at && selectedMessage.id > 0 && <Action icon={Edit3} label="Edit message" onPress={() => { setEditingMessage(selectedMessage); setDraft(selectedMessage.body); setSelectedMessage(null); }} />}
        {selectedMessage.mine && selectedMessage.id > 0 && <Action icon={Trash2} label="Remove message" destructive onPress={() => { deleteMessage(selectedMessage); setSelectedMessage(null); }} />}
      </>}</View></View></Modal>

      <Modal visible={showPins} transparent animationType="slide" onRequestClose={() => setShowPins(false)}><View style={styles.modalRoot}><Pressable style={StyleSheet.absoluteFill} onPress={() => setShowPins(false)} /><View style={styles.pinsSheet}><View style={styles.sheetHandle} /><Text style={styles.sheetTitle}>Pinned messages</Text><ScrollView contentContainerStyle={styles.pinsList}>{pinnedMessages.length ? pinnedMessages.map((message) => <Pressable key={message.id} accessibilityRole="button" onPress={() => { setShowPins(false); router.setParams({ messageId: String(message.id) }); }} style={styles.pinCard}><Pin color={palette.rubySoft} size={15} /><View style={styles.pinCardCopy}><Text numberOfLines={3} style={styles.pinBody}>{message.body || message.attachments[0]?.filename}</Text><Text style={styles.pinAuthor}>{message.author.full_name}</Text></View></Pressable>) : <Text style={styles.noPins}>Nothing has been pinned in this conversation.</Text>}</ScrollView></View></View></Modal>

    </SafeAreaView>
  );
}

function Action({ icon: Icon, label, onPress, destructive = false }: { icon: LucideIcon; label: string; onPress: () => void; destructive?: boolean }) { return <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}><Icon color={destructive ? palette.rubySoft : palette.muted} size={19} /><Text style={[styles.actionText, destructive && styles.actionDanger]}>{label}</Text></Pressable>; }
function DayDivider({ value }: { value: string }) { return <View style={styles.dayDivider}><View style={styles.dayLine} /><Text style={styles.dayText}>{formatConversationDay(value)}</Text><View style={styles.dayLine} /></View>; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, hash: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minHeight: 44, justifyContent: 'center' }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 16 }, status: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }, statusText: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10 },
  messagePane: { flex: 1, minHeight: 0 }, list: { paddingHorizontal: 14, paddingVertical: 20, paddingBottom: 28, flexGrow: 1 }, empty: { flex: 1, minHeight: 420, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 50 }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 18 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 }, loadingOlder: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10, textAlign: 'center', paddingVertical: 18 },
  dayDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 }, dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.line }, dayText: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 0.8, textTransform: 'uppercase' },
  targetMessage: { marginHorizontal: -8, paddingHorizontal: 8, paddingTop: 7, borderRadius: 16, backgroundColor: '#21161A' },
  latestButton: { position: 'absolute', bottom: 12, alignSelf: 'center', minHeight: 42, borderRadius: 21, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#242936', borderWidth: 1, borderColor: '#3A4253', shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 }, latestText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 },
  mentionPanel: { maxHeight: 210, borderTopWidth: 1, borderTopColor: palette.line, backgroundColor: palette.panel, padding: 8 }, mentionRow: { minHeight: 48, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, mentionName: { color: palette.text, fontFamily: fonts.semibold, fontSize: 12 }, mentionEmail: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 9, marginTop: 2 },
  everyoneIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' },
  attachmentTray: { paddingHorizontal: 14, paddingVertical: 8, gap: 8, backgroundColor: palette.panel }, pendingAttachment: { width: 190, minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', gap: 8 }, pendingCopy: { flex: 1 }, pendingName: { color: palette.text, fontFamily: fonts.semibold, fontSize: 10 }, pendingStatus: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 8, marginTop: 2 }, removeAttachment: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  editBanner: { minHeight: 38, paddingHorizontal: 16, backgroundColor: '#201319', borderTopWidth: 1, borderTopColor: '#4A2029', flexDirection: 'row', alignItems: 'center', gap: 8 }, editText: { flex: 1, color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10 }, editClose: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, backgroundColor: palette.panel }, attachButton: { width: 44, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, input: { flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 17, backgroundColor: palette.ink, borderWidth: 1, borderColor: palette.line, color: palette.text, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 11 }, send: { width: 46, height: 46, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' }, sendDisabled: { opacity: 0.38 }, pressed: { transform: [{ scale: 0.96 }] },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2,4,8,0.76)' }, actionSheet: { backgroundColor: palette.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 16, paddingBottom: 30 }, pinsSheet: { maxHeight: '76%', backgroundColor: palette.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 16, paddingBottom: 30 }, sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: palette.line, alignSelf: 'center', marginTop: 10 }, sheetTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 20, marginTop: 16, marginBottom: 12 },
  reactionPicker: { flexDirection: 'row', gap: 7, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, reactionButton: { flex: 1, minHeight: 58, borderRadius: 15, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, alignItems: 'center', justifyContent: 'center', gap: 5 }, reactionLabel: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 7 }, action: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 6 }, actionText: { color: palette.text, fontFamily: fonts.semibold, fontSize: 14 }, actionDanger: { color: palette.rubySoft },
  pinsList: { gap: 8, paddingBottom: 12 }, pinCard: { minHeight: 68, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, padding: 13, flexDirection: 'row', gap: 10 }, pinCardCopy: { flex: 1 }, pinBody: { color: palette.text, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }, pinAuthor: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 9, marginTop: 6 }, noPins: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 30, textAlign: 'center' },
});
