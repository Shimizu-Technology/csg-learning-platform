import { refreshUnreadCaches } from '@/lib/updates-cache';
import { Button } from '@/components/ui/button';
import { haptic } from '@/lib/haptics';
import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { ArrowDownToLine, ArrowLeft, Bell, BellOff, BookOpen, ChevronDown, Edit3, Flag, Hash, MessageSquareReply, MoreHorizontal, UserRound, Paperclip, Pin, Send, Trash2, UserX, Wifi, WifiOff, X, type LucideIcon } from 'lucide-react-native';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppState, FlatList, Keyboard, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Avatar } from '@/components/avatar';
import { ComposerLimitNotice } from '@/components/composer-limit-notice';
import { ImagePreview } from '@/components/image-preview';
import { FormattingToggleButton, MessageFormattingToolbar } from '@/components/message-formatting-toolbar';
import { MessageAuthorContext } from '@/components/message-author-context';
import { MessageBubble } from '@/components/message-bubble';
import { ReactionDetailsSheet } from '@/components/reaction-details-sheet';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { TypingIndicator } from '@/components/typing-indicator';
import { VoiceDraftButton, VoiceDraftPanel } from '@/components/voice-draft-controls';
import { fontScaleLimits, fonts } from '@/constants/csg-theme';
import { useVoiceDraft } from '@/hooks/use-voice-draft';
import { pendingAttachment, uploadAttachment } from '@/lib/attachments';
import { subscribeToMessages, type CableSubscription } from '@/lib/cable';
import { canAutoReadConversation, createScrollGeneration, formatConversationDay, isDifferentConversationDay, isNearConversationBottom } from '@/lib/conversation-scroll';
import { conversationDraftKey, loadConversationDraft, loadFailedMessages, retryableMessagesForStorage, saveConversationDraftWithRetry, saveFailedMessagesWithRetry } from '@/lib/conversation-storage';
import { demoChannels, demoDms, demoMessages, demoUser } from '@/lib/demo-data';
import { insertMention, mentionSuggestions, mentionTriggerAt, resolveMentionUserIds } from '@/lib/mentions';
import { clientMessageIdForSend, conversationOperationIdentity, draftAfterSendConfirmation, draftAfterStoredLoad, messageBodyChangeAllowed, messageBodyWithinLimit, messageInsertionWithinLimit, MESSAGE_BODY_LIMIT } from '@/lib/message-compose';
import { messagePreview } from '@/lib/message-format';
import { messagingKeys, type ConversationSnapshot } from '@/lib/messaging-cache';
import { markOptimisticFailed, mergeMessageEvent, mergeOlderMessages, mergePinnedMessageEvent, mergeServerAndFailedMessages, pinnedMessagesFrom, reconcileOptimistic, sortMessages, toggleOwnReaction } from '@/lib/message-state';
import { REACTION_OPTIONS } from '@/lib/reactions';
import { latestReaderPositions } from '@/lib/read-receipt-position';
import { messageBodyForSend } from '@/lib/code-paste';
import { firstUnreadMessageId } from '@/lib/unread-boundary';
import type { TypingUser } from '@/lib/typing';
import type { ChannelSummary, ConversationKind, DirectConversationSummary, Message, MessageEvent, MessageTypingEvent, MessageWindowMeta, PendingAttachment, UserSummary } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';

type ConnectionStatus = 'connecting' | 'connected' | 'offline';
type ConversationItem = { message: Message; previous?: Message };
type PendingConversationDraft = { userId: number; kind: ConversationKind; id: number; body: string };

export default function ConversationScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const params = useLocalSearchParams<{ kind: string; id: string; title?: string; workspaceName?: string; messageId?: string; source_type?: string; source_id?: string; source_label?: string; source_cohort_id?: string; source_student_id?: string }>();
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
  const queryClient = useQueryClient();
  const { workspaces, selectWorkspace } = useWorkspace();
  const [authorizedDestination, setAuthorizedDestination] = useState<{ key: string; workspaceId: number } | null>(null);
  const syncedDestinationRef = useRef<string | null>(null);
  const [resolvedAnchorId, setResolvedAnchorId] = useState(anchorMessageId);
  const userId = user?.id ?? null;
  const operationIdentity = conversationOperationIdentity(userId, kind, id);
  const destinationKey = `${operationIdentity}:${anchorMessageId || 'latest'}`;
  const authorizedWorkspaceId = authorizedDestination?.key === destinationKey ? authorizedDestination.workspaceId : null;
  const conversationCacheKey = useMemo(() => messagingKeys.conversation(userId ?? 0, kind, id), [id, kind, userId]);
  const initialSnapshot = useMemo(() => queryClient.getQueryData<ConversationSnapshot>(conversationCacheKey), [conversationCacheKey, queryClient]);
  const listRef = useRef<FlatList<ConversationItem>>(null);
  const composerInputRef = useRef<TextInput>(null);
  const nearBottomRef = useRef(!anchorMessageId);
  const draggingRef = useRef(false);
  const screenFocusedRef = useRef(false);
  const modalVisibleRef = useRef(false);
  const anchorReadGateRef = useRef(Boolean(anchorMessageId));
  const pendingScrollRef = useRef(!anchorMessageId);
  const keyboardShouldFollowRef = useRef(false);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftValueRef = useRef('');
  const pendingDraftRef = useRef<PendingConversationDraft | null>(null);
  const draftWriteGenerationsRef = useRef(new Map<string, number>());
  const persistedFailedRef = useRef<string | null>(null);
  const anchorScrolledRef = useRef(false);
  const anchorRetryRef = useRef<{ index: number; attempts: number } | null>(null);
  const scrollGenerationRef = useRef(createScrollGeneration());
  const loadRequestRef = useRef(0);
  const loadOlderRequestRef = useRef(0);
  const loadNewerRequestRef = useRef(0);
  const sendRequestRef = useRef(0);
  const sendAbortRef = useRef(new Set<AbortController>());
  const optimisticIdRef = useRef(-Date.now());
  const realtimeSubscriptionRef = useRef<CableSubscription | null>(null);
  const typingExpiryTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const typingStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outboundTypingRef = useRef<{ active: boolean; lastSentAt: number } | null>(null);
  const [summary, setSummary] = useState<ChannelSummary | DirectConversationSummary | null>(initialSnapshot?.summary ?? null);
  const [messages, setMessages] = useState<Message[]>(initialSnapshot?.messages ?? []);
  const [pinnedMessages, setPinnedMessages] = useState<Message[]>(initialSnapshot?.pinnedMessages ?? []);
  const [meta, setMeta] = useState<MessageWindowMeta>(initialSnapshot?.meta ?? { oldest_message_id: null, newest_message_id: null, has_older: false, has_newer: false });
  const metaRef = useRef(meta);
  metaRef.current = meta;
  const loadedMessageIdsRef = useRef(new Set<number>());
  loadedMessageIdsRef.current = new Set(messages.map((message) => message.id));
  const queuedMessageIdsRef = useRef(new Set<number>());
  const [mentionUsers, setMentionUsers] = useState<UserSummary[]>(initialSnapshot?.mentionUsers ?? []);
  const [arrivalUnreadBoundaryId, setArrivalUnreadBoundaryId] = useState<number | null>(null);
  const [openingReadState, setOpeningReadState] = useState<Pick<ChannelSummary, 'last_read_at' | 'last_read_message_id' | 'unread_count'> | null>(initialSnapshot?.summary ?? null);
  const [draft, setDraft] = useState('');
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [loading, setLoading] = useState(!initialSnapshot || Boolean(anchorMessageId));
  const [loadedOperationIdentity, setLoadedOperationIdentity] = useState<string | null>(initialSnapshot ? operationIdentity : null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadingNewer, setLoadingNewer] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftReadyOperationIdentity, setDraftReadyOperationIdentity] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(auth.demo ? 'connected' : 'connecting');
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [realtimeSubscriptionVersion, setRealtimeSubscriptionVersion] = useState(0);
  const [showScrollToLatest, setShowScrollToLatest] = useState(Boolean(anchorMessageId));
  const [newMessagesBelow, setNewMessagesBelow] = useState(0);
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  const [showPins, setShowPins] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editSelection, setEditSelection] = useState({ start: 0, end: 0 });
  const [formattingExpanded, setFormattingExpanded] = useState(false);
  const [authorContext, setAuthorContext] = useState<Message['author'] | null>(null);
  const [composerToolsExpanded, setComposerToolsExpanded] = useState(false);
  const [reactionDetails, setReactionDetails] = useState<{ messageId: number; emoji: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<{ attachments: Message['attachments']; attachmentId: number } | null>(null);
  useLayoutEffect(() => { modalVisibleRef.current = Boolean(selectedMessage || showPins || reactionDetails || imagePreview || authorContext); }, [selectedMessage, showPins, reactionDetails, imagePreview, authorContext]);
  const conversationVisible = () => screenFocusedRef.current && AppState.currentState === 'active' && !modalVisibleRef.current;
  useFocusEffect(useCallback(() => {
    screenFocusedRef.current = true;
    return () => { screenFocusedRef.current = false; nearBottomRef.current = false; };
  }, []));
  const operationIdentityRef = useRef(operationIdentity);
  useLayoutEffect(() => {
    const cached = queryClient.getQueryData<ConversationSnapshot>(conversationCacheKey);
    queuedMessageIdsRef.current.clear();
    operationIdentityRef.current = operationIdentity;
    loadRequestRef.current += 1;
    loadOlderRequestRef.current += 1;
    loadNewerRequestRef.current += 1;
    sendRequestRef.current += 1;
    sendAbortRef.current.forEach((controller) => controller.abort());
    sendAbortRef.current.clear();
    setLoading(!cached || Boolean(anchorMessageId));
    setLoadingOlder(false);
    setLoadingNewer(false);
    setLoadedOperationIdentity(cached ? operationIdentity : null);
    setDraftReadyOperationIdentity(null);
    setSummary(cached?.summary ?? null);
    setMessages(cached?.messages ?? []);
    setPinnedMessages(cached?.pinnedMessages ?? []);
    setMeta(cached?.meta ?? { oldest_message_id: null, newest_message_id: null, has_older: false, has_newer: false });
    setMentionUsers(cached?.mentionUsers ?? []);
    setOpeningReadState(cached?.summary ?? null);
    setArrivalUnreadBoundaryId(null);
    setError(null);
    setAuthorizedDestination(null);
    setResolvedAnchorId(anchorMessageId);
    setAttachments([]);
    setEditingMessage(null);
    setEditDraft('');
    setEditSelection({ start: 0, end: 0 });
    setSelectedMessage(null);
    setImagePreview(null);
    setReactionDetails(null);
    setShowPins(false);
    setSending(false);
  }, [anchorMessageId, conversationCacheKey, operationIdentity, queryClient]);
  const updateDraft = useCallback((value: string) => {
    draftValueRef.current = value;
    setDraft(value);
  }, []);
  const voiceDraft = useVoiceDraft({
    api,
    demo: auth.demo,
    surface: 'message',
    draft,
    selection,
    disabled: sending || Boolean(editingMessage),
    maxDraftLength: MESSAGE_BODY_LIMIT,
    onDraftChange: updateDraft,
    onSelectionChange: setSelection,
  });

  const composerValue = editingMessage ? editDraft : draft;
  const updateComposerValue = editingMessage ? setEditDraft : updateDraft;
  const composerSelection = editingMessage ? editSelection : selection;
  const updateComposerSelection = editingMessage ? setEditSelection : setSelection;
  const composerHasContent = Boolean(composerValue.trim() || (!editingMessage && attachments.length));
  // The limit applies to what is actually sent, including a fence added around code.
  const preparedComposerBody = useMemo(() => messageBodyForSend(composerValue), [composerValue]);
  const composerWithinLimit = messageBodyWithinLimit(preparedComposerBody);
  const focusComposer = useCallback(() => composerInputRef.current?.focus(), []);
  const rootMessages = useMemo(() => messages.filter((message) => !message.parent_message_id), [messages]);
  const unreadBoundaryId = useMemo(() => openingReadState ? firstUnreadMessageId(messages, openingReadState.last_read_at, openingReadState.unread_count, meta, openingReadState.last_read_message_id) : null, [messages, meta, openingReadState]) ?? arrivalUnreadBoundaryId;
  const readerPositions = useMemo(() => latestReaderPositions(rootMessages), [rootMessages]);
  const conversationItems = useMemo(() => rootMessages.map((message, index) => ({ message, previous: rootMessages[index - 1] })).reverse(), [rootMessages]);
  const mentionTrigger = useMemo(() => mentionTriggerAt(composerValue, composerSelection.start), [composerSelection.start, composerValue]);
  const suggestions = useMemo(() => mentionTrigger ? mentionSuggestions(mentionUsers.filter((member) => member.id !== user?.id), mentionTrigger.query) : [], [mentionTrigger, mentionUsers, user?.id]);
  const showEveryone = Boolean(kind === 'channel' && mentionTrigger && 'everyone'.startsWith(mentionTrigger.query.trim().toLowerCase()));
  const reactionDetailsMessage = reactionDetails ? messages.find((message) => message.id === reactionDetails.messageId) || null : null;

  const viewableHandlerRef = useRef<(items: { item: ConversationItem; isViewable: boolean }[]) => void>(() => {});
  viewableHandlerRef.current = (items) => {
    if (auth.demo || !authorizedWorkspaceId || !conversationVisible() || loadedOperationIdentity !== operationIdentity) return;
    const displayed = items.filter((item) => item.isViewable).map((item) => item.item.message);
    const message = anchorReadGateRef.current
      ? displayed.find((item) => item.id === anchorMessageId)
      : sortMessages(displayed.filter((item) => !item.parent_message_id && item.id > 0)).at(-1);
    if (message) void api.markRead(kind, id, message.id).then(() => {
      refreshUnreadCaches(queryClient, userId);
    }).catch(() => undefined);
  };
  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { item: ConversationItem; isViewable: boolean }[] }) => viewableHandlerRef.current(viewableItems)).current;

  const scrollToLatest = useCallback((animated = true) => {
    anchorReadGateRef.current = false;
    nearBottomRef.current = true;
    pendingScrollRef.current = true;
    anchorRetryRef.current = null;
    scrollGenerationRef.current.invalidate();
    setShowScrollToLatest(false);
    setNewMessagesBelow(0);
    requestAnimationFrame(() => listRef.current?.scrollToOffset({ animated, offset: 0 }));
  }, []);

  const persistPendingDraft = useCallback((pending: PendingConversationDraft) => {
    const key = conversationDraftKey(pending.userId, pending.kind, pending.id);
    const generation = (draftWriteGenerationsRef.current.get(key) || 0) + 1;
    draftWriteGenerationsRef.current.set(key, generation);
    void saveConversationDraftWithRetry(
      pending.userId,
      pending.kind,
      pending.id,
      pending.body,
      () => draftWriteGenerationsRef.current.get(key) === generation,
    ).then((saved) => {
      if (draftWriteGenerationsRef.current.get(key) === generation) draftWriteGenerationsRef.current.delete(key);
      if (saved && pendingDraftRef.current === pending) pendingDraftRef.current = null;
    });
  }, []);

  const flushPendingDraft = useCallback(() => {
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const pending = pendingDraftRef.current;
    if (pending) persistPendingDraft(pending);
  }, [persistPendingDraft]);

  useEffect(() => {
    const activeSends = sendAbortRef.current;
    flushPendingDraft();
    draftValueRef.current = '';
    setDraft('');
    setSelection({ start: 0, end: 0 });
    return () => {
      sendRequestRef.current += 1;
      activeSends.forEach((controller) => controller.abort());
      activeSends.clear();
    };
  }, [conversationIdentity, flushPendingDraft, userId]);

  // Synchronize only once per authorized destination. Later deliberate workspace
  // choices must not be reset by a cached summary or a provider refresh.
  useEffect(() => {
    const destination = `${operationIdentity}:${anchorMessageId || 'latest'}`;
    if (!authorizedWorkspaceId || syncedDestinationRef.current === destination || !workspaces.some((workspace) => workspace.id === authorizedWorkspaceId)) return;
    syncedDestinationRef.current = destination;
    void selectWorkspace(authorizedWorkspaceId);
  }, [anchorMessageId, authorizedWorkspaceId, operationIdentity, selectWorkspace, workspaces]);

  const load = useCallback(async () => {
    const requestIdentity = operationIdentity;
    const requestId = ++loadRequestRef.current;
    loadOlderRequestRef.current += 1;
    setLoadingOlder(false);
    const isCurrentRequest = () => operationIdentityRef.current === requestIdentity && loadRequestRef.current === requestId;
    persistedFailedRef.current = null;
    const cached = queryClient.getQueryData<ConversationSnapshot>(conversationCacheKey);
    if (!cached || anchorMessageId) setLoading(true);
    anchorScrolledRef.current = false;
    anchorReadGateRef.current = Boolean(anchorMessageId);
    try {
      const destination = anchorMessageId && !auth.demo ? await api.messageDestination(anchorMessageId) : null;
      if (!isCurrentRequest()) return;
      if (destination && (destination.message_id !== anchorMessageId || (kind === 'channel' ? destination.channel_id !== id : destination.direct_conversation_id !== id))) throw new Error('This message is no longer available.');
      const feedAnchorId = destination?.thread_root_id || anchorMessageId;
      setResolvedAnchorId(feedAnchorId);
      const [storedDraft, loadedConversation] = await Promise.all([
        userId && !auth.demo ? loadConversationDraft(userId, kind, id).catch(() => '') : Promise.resolve(''),
        auth.demo ? Promise.resolve(null) : Promise.all([
          kind === 'channel'
            ? api.channel(id, { message_limit: 80, around_message_id: feedAnchorId })
            : api.directConversation(id, { message_limit: 80, around_message_id: feedAnchorId }),
          userId ? loadFailedMessages(userId, kind, id) : Promise.resolve([]),
        ]),
      ]);
      if (userId && !auth.demo) {
        if (!isCurrentRequest()) return;
        const nextDraft = draftAfterStoredLoad(draftValueRef.current, storedDraft);
        if (nextDraft !== draftValueRef.current) updateDraft(nextDraft);
      }
      if (!isCurrentRequest()) return;
      setDraftReadyOperationIdentity(operationIdentity);
      if (auth.demo) {
        const demoConversationMessages = cached?.messages ?? demoMessages[`${kind}:${id}`] ?? [];
        const demoSummary = cached?.summary ?? (kind === 'channel' ? demoChannels.find((item) => item.id === id) || null : demoDms.find((item) => item.id === id) || null);
        setSummary(demoSummary);
        setMessages(demoConversationMessages);
        setOpeningReadState(demoSummary);
        setPinnedMessages(cached?.pinnedMessages ?? pinnedMessagesFrom(demoConversationMessages));
        setMentionUsers(cached?.mentionUsers ?? [demoUser]);
        setLoadedOperationIdentity(operationIdentity);
      } else {
        const [result, failed] = loadedConversation!;
        if (!isCurrentRequest()) return;
        const nextSummary = 'channel' in result ? result.channel : result.direct_conversation;
        const mergedMessages = mergeServerAndFailedMessages(result.messages, failed);
        setSummary(nextSummary);
        setMessages(mergedMessages);
        setOpeningReadState(nextSummary);
        setPinnedMessages(result.pinned_messages);
        setMeta(result.meta);
        setLoadedOperationIdentity(operationIdentity);
        setError(null);
        void api.workspace(nextSummary.workspace_id).then((workspaceResult) => {
          if (isCurrentRequest()) setMentionUsers(workspaceResult.workspace.members);
        }).catch(() => undefined);
        setAuthorizedDestination({ key: destinationKey, workspaceId: nextSummary.workspace_id });
        if (destination && destination.thread_root_id !== anchorMessageId) {
          router.push({ pathname: '/thread/[id]', params: { id: String(destination.thread_root_id), kind, conversationId: String(id), workspaceId: String(nextSummary.workspace_id), messageId: String(anchorMessageId) } });
        }
      }
      if (!isCurrentRequest()) return;
      nearBottomRef.current = !anchorMessageId;
      pendingScrollRef.current = !anchorMessageId;
      setShowScrollToLatest(Boolean(anchorMessageId));
      setError(null);
    } catch (requestError) {
      if (isCurrentRequest()) {
        if (cached && !anchorMessageId) {
          setError(null);
          setStatus('offline');
        } else { setLoadedOperationIdentity(null); setError((requestError as Error).message); }
      }
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [anchorMessageId, api, auth.demo, conversationCacheKey, destinationKey, id, kind, operationIdentity, queryClient, router, updateDraft, userId]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => void load());
    return () => { cancelAnimationFrame(frame); loadRequestRef.current += 1; flushPendingDraft(); };
  }, [flushPendingDraft, load]);

  useEffect(() => {
    if (loadedOperationIdentity !== operationIdentity || !summary) return;
    queryClient.setQueryData<ConversationSnapshot>(conversationCacheKey, { summary, messages, pinnedMessages, meta, mentionUsers });
  }, [conversationCacheKey, loadedOperationIdentity, mentionUsers, messages, meta, operationIdentity, pinnedMessages, queryClient, summary]);


  useEffect(() => {
    if (!userId || auth.demo || loading || loadedOperationIdentity !== operationIdentity) return;
    const failed = retryableMessagesForStorage(messages);
    const serialized = JSON.stringify(failed);
    if (persistedFailedRef.current === serialized) return;
    persistedFailedRef.current = serialized;
    let active = true;
    void saveFailedMessagesWithRetry(userId, kind, id, failed, () => active && persistedFailedRef.current === serialized).then((saved) => {
      if (!saved && persistedFailedRef.current === serialized) persistedFailedRef.current = null;
    });
    return () => { active = false; };
  }, [auth.demo, id, kind, loadedOperationIdentity, loading, messages, operationIdentity, userId]);

  useEffect(() => {
    if (auth.demo || loading || error || loadedOperationIdentity !== operationIdentity) return undefined;
    const typingTimers = typingExpiryTimersRef.current;
    setTypingUsers([]);
    const subscription = subscribeToMessages(api, kind, id, (payload: MessageEvent) => {
      if ((kind === 'channel' && payload.channel_id !== id) || (kind === 'dm' && payload.direct_conversation_id !== id)) return;
      if (payload.message.parent_message_id && payload.event === 'created') return;
      if (payload.message.parent_message_id === null) {
        const typingTimer = typingTimers.get(payload.message.author.id);
        if (typingTimer) clearTimeout(typingTimer);
        typingTimers.delete(payload.message.author.id);
        setTypingUsers((current) => current.filter((typingUser) => typingUser.id !== payload.message.author.id));
      }
      const queued = queuedMessageIdsRef.current;
      if (!loadedMessageIdsRef.current.has(payload.message.id) && (metaRef.current.has_newer || queued.size > 0)) {
        if (payload.event === 'created') queued.add(payload.message.id);
        if (payload.event === 'deleted') queued.delete(payload.message.id);
        setNewMessagesBelow(queued.size);
        if (queued.size) { nearBottomRef.current = false; setShowScrollToLatest(true); }
        return;
      }
      const follow = !metaRef.current.has_newer && (payload.message.mine || canAutoReadConversation(conversationVisible(), anchorReadGateRef.current, nearBottomRef.current));
      if (payload.event === 'created' && !follow) {
        setShowScrollToLatest(true);
        if (!payload.message.mine) { setNewMessagesBelow((current) => current + 1); setArrivalUnreadBoundaryId((current) => current ?? payload.message.id); }
      }
      setMessages((current) => mergeMessageEvent(current, payload));
      setPinnedMessages((current) => mergePinnedMessageEvent(current, payload));
      if (follow) scrollToLatest(false);
    }, (nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus === 'connected') {
        outboundTypingRef.current = null;
        setRealtimeSubscriptionVersion((current) => current + 1);
      }
    }, (event: MessageTypingEvent) => {
      if (event.user.id === userId || event.thread_root_id !== null) return;
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
      const outbound = outboundTypingRef.current;
      if (outbound?.active) subscription.perform('typing', { target_type: kind, target_id: id, thread_root_id: null, active: false });
      outboundTypingRef.current = null;
      if (typingStopTimerRef.current) clearTimeout(typingStopTimerRef.current);
      typingStopTimerRef.current = null;
      typingTimers.forEach((timer) => clearTimeout(timer));
      typingTimers.clear();
      realtimeSubscriptionRef.current = null;
      subscription();
    };
  }, [api, auth.demo, error, id, kind, loadedOperationIdentity, loading, operationIdentity, queryClient, scrollToLatest, userId]);

  useEffect(() => {
    const subscription = realtimeSubscriptionRef.current;
    const active = Boolean(draft.trim()) && !editingMessage;
    const previous = outboundTypingRef.current;
    const send = (nextActive: boolean) => subscription?.perform('typing', { target_type: kind, target_id: id, thread_root_id: null, active: nextActive }) ?? false;

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
  }, [draft, editingMessage, id, kind, realtimeSubscriptionVersion]);

  useEffect(() => {
    typingExpiryTimersRef.current.forEach((timer) => clearTimeout(timer));
    typingExpiryTimersRef.current.clear();
    setTypingUsers([]);
  }, [conversationIdentity]);

  useEffect(() => {
    if (!userId || loading || draftReadyOperationIdentity !== operationIdentity) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const pending = { userId, kind, id, body: draft };
    pendingDraftRef.current = pending;
    draftTimerRef.current = setTimeout(() => persistPendingDraft(pending), 300);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [draft, draftReadyOperationIdentity, id, kind, loading, operationIdentity, persistPendingDraft, userId]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const show = Keyboard.addListener(showEvent, () => { if (keyboardShouldFollowRef.current || nearBottomRef.current) scrollToLatest(false); });
    const layoutEvents = ['keyboardDidShow', 'keyboardDidHide', 'keyboardDidChangeFrame'] as const;
    const changes = layoutEvents.map((event) => Keyboard.addListener(event, () => { if (nearBottomRef.current) scrollToLatest(false); }));
    return () => { show.remove(); changes.forEach((listener) => listener.remove()); };
  }, [scrollToLatest]);

  const loadOlder = async () => {
    if (auth.demo || loadingOlder || !meta.has_older || !meta.oldest_message_id) return;
    const requestIdentity = operationIdentity;
    const requestId = ++loadOlderRequestRef.current;
    const isCurrentRequest = () => operationIdentityRef.current === requestIdentity && loadOlderRequestRef.current === requestId;
    setLoadingOlder(true);
    try {
      const result = kind === 'channel'
        ? await api.channel(id, { message_limit: 60, before_message_id: meta.oldest_message_id })
        : await api.directConversation(id, { message_limit: 60, before_message_id: meta.oldest_message_id });
      if (!isCurrentRequest()) return;
      setMessages((current) => mergeOlderMessages(current, result.messages));
      setMeta((current) => ({ ...result.meta, newest_message_id: current.newest_message_id, has_newer: current.has_newer }));
    } catch (requestError) {
      if (isCurrentRequest()) Alert.alert('Could not load earlier messages', (requestError as Error).message);
    } finally {
      if (isCurrentRequest()) setLoadingOlder(false);
    }
  };

  const loadNewer = async () => {
    if (auth.demo || loadingNewer || !meta.has_newer || !meta.newest_message_id) return;
    const requestIdentity = operationIdentity;
    const requestId = ++loadNewerRequestRef.current;
    const isCurrentRequest = () => operationIdentityRef.current === requestIdentity && loadNewerRequestRef.current === requestId;
    nearBottomRef.current = false;
    setLoadingNewer(true);
    try {
      const result = kind === 'channel'
        ? await api.channel(id, { message_limit: 60, after_message_id: meta.newest_message_id })
        : await api.directConversation(id, { message_limit: 60, after_message_id: meta.newest_message_id });
      if (!isCurrentRequest()) return;
      result.messages.forEach((message) => queuedMessageIdsRef.current.delete(message.id));
      setNewMessagesBelow(queuedMessageIdsRef.current.size);
      setMessages((current) => mergeOlderMessages(current, result.messages));
      setMeta((current) => ({ ...result.meta, oldest_message_id: current.oldest_message_id, has_older: current.has_older }));
    } catch (requestError) {
      if (isCurrentRequest()) Alert.alert('Could not load newer messages', (requestError as Error).message);
    } finally {
      if (isCurrentRequest()) setLoadingNewer(false);
    }
  };

  const jumpToLatest = async () => {
    if ((meta.has_newer || queuedMessageIdsRef.current.size) && !auth.demo) {
      loadNewerRequestRef.current += 1;
      setLoadingNewer(false);
      try {
        const result = kind === 'channel'
          ? await api.channel(id, { message_limit: 80 })
          : await api.directConversation(id, { message_limit: 80 });
        if (operationIdentityRef.current !== operationIdentity) return;
        setMessages((current) => mergeServerAndFailedMessages(result.messages, current.filter((message) => message.client_status === 'sending' || message.client_status === 'failed')));
        setMeta(result.meta);
        // Keep arrivals beyond the response boundary behind the latest action.
        for (const messageId of queuedMessageIdsRef.current) {
          if (result.meta.newest_message_id !== null && messageId <= result.meta.newest_message_id) queuedMessageIdsRef.current.delete(messageId);
        }
        setNewMessagesBelow(queuedMessageIdsRef.current.size);
        if (queuedMessageIdsRef.current.size) {
          anchorReadGateRef.current = false;
          nearBottomRef.current = false;
          setShowScrollToLatest(true);
          requestAnimationFrame(() => listRef.current?.scrollToOffset({ animated: true, offset: 0 }));
          return;
        }
      } catch (requestError) {
        Alert.alert('Could not reach latest messages', (requestError as Error).message);
        return;
      }
    }
    scrollToLatest(true);
  };

  const send = async (retryMessage?: Message) => {
    // Typed or pasted multi-line code keeps its indentation: it is sent as a fenced code block.
    const body = retryMessage ? retryMessage.body.trim() : messageBodyForSend(draft);
    const pendingUploads = retryMessage?.client_pending_attachments ?? attachments;
    if (!body && !pendingUploads.length && !retryMessage?.client_uploads?.length) return;
    if (!messageBodyWithinLimit(body)) {
      if (retryMessage) Alert.alert('Message is too long to send', `Shorten this message to ${MESSAGE_BODY_LIMIT.toLocaleString()} characters, then send it again.`);
      return;
    }
    const requestIdentity = operationIdentity;
    const abortController = new AbortController();
    sendAbortRef.current.add(abortController);
    const isCurrentRequest = () => operationIdentityRef.current === requestIdentity && !abortController.signal.aborted;
    const uploaded = [...(retryMessage?.client_uploads || [])];
    const optimisticId = retryMessage?.id ?? --optimisticIdRef.current;
    const clientMessageId = clientMessageIdForSend(body, retryMessage?.client_message_id
      ? { body, clientMessageId: retryMessage.client_message_id }
      : null);
    const optimistic: Message = retryMessage
      ? { ...retryMessage, client_message_id: clientMessageId }
      : { id: optimisticId, channel_id: kind === 'channel' ? id : null, direct_conversation_id: kind === 'dm' ? id : null, parent_message_id: null, client_message_id: clientMessageId, body, mention_user_ids: resolveMentionUserIds(body, mentionUsers), edited_at: null, deleted_at: null, pinned_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), mine: true, reactions: [], attachments: pendingUploads.map((item, index) => ({ id: -(index + 1), filename: item.filename, content_type: item.content_type, byte_size: item.byte_size, image: item.image, url: item.uri })), author: user || demoUser, reply_count: 0 };
    setMessages((current) => sortMessages([...current.filter((item) => item.id !== optimisticId), {
      ...optimistic,
      client_status: 'sending',
      client_error: undefined,
      client_pending_attachments: pendingUploads,
      client_uploads: uploaded,
      client_upload_progress: pendingUploads.length > uploaded.length ? uploaded.length / pendingUploads.length : undefined,
    }]));
    if (!metaRef.current.has_newer && !queuedMessageIdsRef.current.size) scrollToLatest(false);
    if (!retryMessage) {
      updateDraft('');
      setAttachments([]);
    }
    try {
      for (const [index, attachment] of pendingUploads.entries()) {
        if (index < uploaded.length) continue;
        if (!isCurrentRequest()) return;
        const value = await uploadAttachment(api, kind, id, attachment, (progress) => {
          if (isCurrentRequest()) setMessages((current) => current.map((item) => item.id === optimisticId ? {
            ...item,
            client_upload_progress: (index + progress) / pendingUploads.length,
          } : item));
        }, abortController.signal);
        if (!isCurrentRequest()) return;
        uploaded.push(value);
        setMessages((current) => current.map((item) => item.id === optimisticId ? {
          ...item,
          client_uploads: [...uploaded],
          client_upload_progress: uploaded.length < pendingUploads.length ? uploaded.length / pendingUploads.length : undefined,
        } : item));
      }
      if (auth.demo) {
        setMessages((current) => current.map((item) => item.id === optimisticId ? { ...item, client_status: undefined, client_upload_progress: undefined } : item));
        if (!retryMessage) voiceDraft.markSent(body);
        return;
      }
      const { message } = await api.sendMessage(kind, id, { body, client_message_id: clientMessageId, mention_user_ids: resolveMentionUserIds(body, mentionUsers), attachments: uploaded, send_push: true });
      if (!isCurrentRequest()) return;
      if (metaRef.current.has_newer || queuedMessageIdsRef.current.size) {
        queuedMessageIdsRef.current.add(message.id);
        setNewMessagesBelow(queuedMessageIdsRef.current.size);
        setShowScrollToLatest(true);
        setMessages((current) => current.filter((item) => item.id !== optimisticId));
      } else setMessages((current) => reconcileOptimistic(current, optimisticId, message));
      if (!retryMessage) voiceDraft.markSent(body);
      if (userId && !retryMessage) {
        const retainedDraft = draftAfterSendConfirmation(
          draftValueRef.current,
          { body, clientMessageId },
          message.client_message_id,
          message.author.id,
          userId,
        );
        if (retainedDraft === null) return;
        if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
        const pending = { userId, kind, id, body: retainedDraft };
        pendingDraftRef.current = pending;
        persistPendingDraft(pending);
      }
    } catch (requestError) {
      if (!isCurrentRequest()) return;
      haptic('error');
      setMessages((current) => {
        return markOptimisticFailed(current, { ...optimistic, client_uploads: uploaded, client_pending_attachments: pendingUploads }, (requestError as Error).message);
      });
    } finally {
      sendAbortRef.current.delete(abortController);
    }
  };

  const saveEdit = async () => {
    if (!editingMessage || sending || !editDraft.trim() || !messageBodyWithinLimit(messageBodyForSend(editDraft))) return;
    const requestIdentity = operationIdentity;
    const requestId = ++sendRequestRef.current;
    const isCurrentRequest = () => operationIdentityRef.current === requestIdentity && sendRequestRef.current === requestId;
    setSending(true);
    try {
      const body = messageBodyForSend(editDraft);
      const result = auth.demo
        ? { message: { ...editingMessage, body, edited_at: new Date().toISOString(), updated_at: new Date().toISOString() } }
        : await api.updateMessage(editingMessage.id, body, resolveMentionUserIds(body, mentionUsers));
      if (!isCurrentRequest()) return;
      setMessages((current) => current.map((message) => message.id === result.message.id ? result.message : message));
      setPinnedMessages((current) => current.map((message) => message.id === result.message.id ? result.message : message));
      setEditingMessage(null); setEditDraft(''); setEditSelection({ start: 0, end: 0 });
    } catch (requestError) {
      if (isCurrentRequest()) Alert.alert('Could not edit message', (requestError as Error).message);
    } finally {
      if (isCurrentRequest()) setSending(false);
    }
  };

  const deleteMessage = (message: Message) => Alert.alert('Remove this message?', 'The message will no longer appear in the conversation.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: async () => { try { if (!auth.demo) await api.deleteMessage(message.id); setMessages((current) => current.filter((item) => item.id !== message.id)); setPinnedMessages((current) => current.filter((item) => item.id !== message.id)); } catch (requestError) { Alert.alert('Could not remove message', (requestError as Error).message); } } }]);
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
  const togglePin = async (message: Message) => { try { const result = auth.demo ? { message: { ...message, pinned_at: message.pinned_at ? null : new Date().toISOString(), updated_at: new Date().toISOString() } } : await api.pinMessage(message.id, Boolean(message.pinned_at)); setMessages((current) => current.map((item) => item.id === message.id ? result.message : item)); setPinnedMessages((current) => result.message.pinned_at ? [result.message, ...current.filter((item) => item.id !== message.id)] : current.filter((item) => item.id !== message.id)); setSelectedMessage(null); } catch (requestError) { Alert.alert('Could not update pin', (requestError as Error).message); } };
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
  const startEditingSelectedMessage = () => {
    if (!selectedMessage) return;
    const message = selectedMessage;
    const requestIdentity = operationIdentity;
    setSelectedMessage(null);
    void voiceDraft.cancel().then(() => {
      if (operationIdentityRef.current !== requestIdentity) return;
      setEditingMessage(message);
      setEditDraft(message.body);
      setEditSelection({ start: message.body.length, end: message.body.length });
    }).catch((cancelError) => {
      if (operationIdentityRef.current === requestIdentity) Alert.alert('Could not start editing', (cancelError as Error).message);
    });
  };
  const openThread = (message: Message) => {
    if (userId) {
      queryClient.setQueryData(messagingKeys.thread(userId, message.id), {
        root: message,
        replies: messages.filter((item) => item.parent_message_id === message.id),
        users: mentionUsers,
      });
    }
    router.push({ pathname: '/thread/[id]', params: { id: String(message.id), kind, conversationId: String(id), workspaceId: String(summary?.workspace_id || '') } } as unknown as Href);
  };

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

  const toggleMute = async () => { if (!summary) return; const next = !summary.muted; setSummary({ ...summary, muted: next }); if (!auth.demo) try { await api.updatePreference(kind, id, next); refreshUnreadCaches(queryClient, userId); } catch { setSummary({ ...summary, muted: !next }); } };
  const conversationReady = loadedOperationIdentity === operationIdentity;
  const title = summary ? ('name' in summary ? summary.name : summary.title) : params.title?.trim() || 'Conversation';
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
          <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={c.text.strong} size={22} /></Pressable>
          {kind === 'channel' ? <View style={styles.hash}><Hash color={c.text.body} size={18} /></View> : <Avatar name={title} size={38} />}
          <Pressable accessibilityRole="button" accessibilityLabel="Open pinned messages" onPress={() => setShowPins(true)} style={styles.headerCopy}><Text maxFontSizeMultiplier={fontScaleLimits.title} numberOfLines={1} style={styles.title}>{title}</Text><View style={styles.status}>{status === 'connected' ? <Wifi color={c.status.success.fg} size={12} /> : <WifiOff color={c.status.warning.fg} size={12} />}<Text maxFontSizeMultiplier={fontScaleLimits.utility} numberOfLines={2} style={styles.statusText}>{status === 'connected' ? (summary?.workspace_name || params.workspaceName || 'Connected') : status === 'connecting' ? 'Connecting' : 'Reconnecting'}{pinnedMessages.length ? ` · ${pinnedMessages.length} pinned` : ''}</Text></View></Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={summary?.muted ? 'Unmute conversation' : 'Mute conversation'} onPress={() => void toggleMute()} style={styles.iconButton}>{summary?.muted ? <BellOff color={c.text.body} size={20} /> : <Bell color={c.text.body} size={20} />}</Pressable>
        </View>
        {sourceType && sourceId && sourceLabel && <Pressable accessibilityRole="button" accessibilityLabel={`Return to ${sourceLabel}`} onPress={openSourceRecord} style={styles.sourceChip}><BookOpen color={c.text.body} size={15} /><Text numberOfLines={1} style={styles.sourceText}>From {sourceType === 'submission' ? 'submission' : 'help request'}: {sourceLabel}</Text></Pressable>}
        {error && !conversationReady ? <ErrorState message={error} retry={() => void load()} /> : loading || !conversationReady ? <LoadingState label="Loading messages" /> : <View style={styles.messagePane}>
          <FlatList ref={listRef} onViewableItemsChanged={onViewableItemsChanged} data={conversationItems} inverted keyExtractor={(item) => String(item.message.id)} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" maintainVisibleContentPosition={{ minIndexForVisible: 0 }} scrollEventThrottle={16}
            onEndReached={() => void loadOlder()} onEndReachedThreshold={0.2}
            onLayout={() => { if (nearBottomRef.current && !anchorReadGateRef.current) requestAnimationFrame(() => { if (nearBottomRef.current && !anchorReadGateRef.current) listRef.current?.scrollToOffset({ animated: false, offset: 0 }); }); }}
            onScrollBeginDrag={() => { draggingRef.current = true; nearBottomRef.current = false; pendingScrollRef.current = false; keyboardShouldFollowRef.current = false; anchorRetryRef.current = null; scrollGenerationRef.current.invalidate(); if (anchorScrolledRef.current) anchorReadGateRef.current = false; }}
            onScrollEndDrag={() => { draggingRef.current = false; }}
            onMomentumScrollBegin={() => { draggingRef.current = true; }}
            onMomentumScrollEnd={() => { draggingRef.current = false; }}
            onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => { const visible = conversationVisible(); const near = canAutoReadConversation(visible, anchorReadGateRef.current, isNearConversationBottom(event.nativeEvent, 96, true)) && !meta.has_newer && !queuedMessageIdsRef.current.size; const wasNear = nearBottomRef.current; if (wasNear && !near && !draggingRef.current) return; nearBottomRef.current = near; setShowScrollToLatest(!near); if (near) { setNewMessagesBelow(0); const newest = rootMessages.at(-1); if (!wasNear && canAutoReadConversation(visible, anchorReadGateRef.current, isNearConversationBottom(event.nativeEvent, 16, true)) && !meta.has_newer && newest && !auth.demo) void api.markRead(kind, id, newest.id).then(() => { refreshUnreadCaches(queryClient, userId); }).catch(() => undefined); } }}
            onContentSizeChange={() => {
              if (resolvedAnchorId && !anchorScrolledRef.current) {
                const index = conversationItems.findIndex((item) => item.message.id === resolvedAnchorId);
                if (index >= 0) { anchorRetryRef.current = { index, attempts: 0 }; anchorScrolledRef.current = true; requestAnimationFrame(() => listRef.current?.scrollToIndex({ animated: false, index, viewPosition: 0.5 })); }
                return;
              }
              if (!pendingScrollRef.current && !nearBottomRef.current) return;
              pendingScrollRef.current = false;
              requestAnimationFrame(() => { if (nearBottomRef.current) listRef.current?.scrollToOffset({ animated: false, offset: 0 }); });
            }}
            onScrollToIndexFailed={({ index, averageItemLength }) => {
              const generation = scrollGenerationRef.current.capture();
              setTimeout(() => {
              // A jump to the latest message after this failure supersedes the fallback scroll.
              if (!scrollGenerationRef.current.isCurrent(generation)) return;
              listRef.current?.scrollToOffset({ animated: false, offset: Math.max(0, index * averageItemLength) });
              // Rows far from the end are not measured yet: retry the anchor a few times once they render.
              const retry = anchorRetryRef.current;
              if (retry && retry.index === index && retry.attempts < 3) {
                retry.attempts += 1;
                setTimeout(() => {
                  // The learner may have jumped to the latest message meanwhile; only retry the current anchor request.
                  if (anchorRetryRef.current !== retry) return;
                  listRef.current?.scrollToIndex({ animated: false, index, viewPosition: 0.5 });
                }, 120);
              }
              }, 50);
            }}
            contentContainerStyle={styles.list}
            ListHeaderComponent={meta.has_newer ? <Pressable accessibilityRole="button" accessibilityLabel="Load newer messages" disabled={loadingNewer} onPress={() => void loadNewer()} style={styles.loadingOlder}><Text style={styles.pendingStatus}>{loadingNewer ? 'Loading newer messages…' : 'Load newer messages'}</Text></Pressable> : null}
            ListFooterComponent={loadingOlder ? <Text style={styles.loadingOlder}>Loading earlier messages…</Text> : null}
            ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.emptyCopy}>Messages sent here stay connected to your Code School workspace.</Text></View>}
            renderItem={({ item }) => <View style={item.message.id === anchorMessageId && styles.targetMessage}>{isDifferentConversationDay(item.message.created_at, item.previous?.created_at) && <DayDivider value={item.message.created_at} />}{item.message.id === unreadBoundaryId && <View accessibilityRole="text" style={styles.unreadDivider}><View style={styles.unreadLine} /><Text style={styles.unreadDividerText}>New messages</Text><View style={styles.unreadLine} /></View>}<MessageBubble message={item.message} showAuthor={!item.previous || item.previous.author.id !== item.message.author.id || isDifferentConversationDay(item.message.created_at, item.previous.created_at)} mentionUsers={mentionUsers} receiptLabel={readerPositions.get(item.message.id)} onOpenAuthor={setAuthorContext} onLongPress={setSelectedMessage} onOpenReaction={(message, value) => setReactionDetails({ messageId: message.id, emoji: value })} onOpenImage={(attachment, images) => setImagePreview({ attachments: images, attachmentId: attachment.id })} onThread={openThread} onRetry={(message) => void send(message)} /></View>}
          />
          {showScrollToLatest && <Pressable accessibilityRole="button" accessibilityLabel="Jump to latest message" onPress={() => void jumpToLatest()} style={styles.latestButton}><ChevronDown color={c.text.strong} size={17} strokeWidth={2.5} /><Text style={styles.latestText}>{newMessagesBelow ? `${newMessagesBelow} new` : 'Jump to latest'}</Text></Pressable>}
        </View>}
        {mentionTrigger && (showEveryone || suggestions.length > 0) && <View style={styles.mentionPanel}>{showEveryone && <Pressable accessibilityRole="button" accessibilityLabel="Mention everyone" onPress={() => { const value = `${composerValue.slice(0, mentionTrigger.start)}@everyone ${composerValue.slice(mentionTrigger.end)}`; const next = messageInsertionWithinLimit(value, mentionTrigger.start + 10); if (!next) { Alert.alert('Draft is too long', `Adding this mention would exceed the ${MESSAGE_BODY_LIMIT.toLocaleString()}-character limit.`); return; } updateComposerValue(next.value); updateComposerSelection({ start: next.cursor, end: next.cursor }); }} style={styles.mentionRow}><View style={styles.everyoneIcon}><Hash color={c.text.body} size={15} /></View><View><Text style={styles.mentionName}>@everyone</Text><Text style={styles.mentionEmail}>Notify everyone in this channel</Text></View></Pressable>}{suggestions.map((member) => <Pressable key={member.id} accessibilityRole="button" onPress={() => { const inserted = insertMention(composerValue, mentionTrigger, member); const next = messageInsertionWithinLimit(inserted.value, inserted.cursor); if (!next) { Alert.alert('Draft is too long', `Adding this mention would exceed the ${MESSAGE_BODY_LIMIT.toLocaleString()}-character limit.`); return; } updateComposerValue(next.value); updateComposerSelection({ start: next.cursor, end: next.cursor }); }} style={styles.mentionRow}><Avatar name={member.full_name} size={30} /><View><Text style={styles.mentionName}>{member.full_name}</Text><Text style={styles.mentionEmail}>{member.email}</Text></View></Pressable>)}</View>}
        {!!attachments.length && <ScrollView horizontal keyboardShouldPersistTaps="handled" contentContainerStyle={styles.attachmentTray}>{attachments.map((attachment) => <View key={attachment.local_id} style={styles.pendingAttachment}><Paperclip color={c.text.body} size={14} /><View style={styles.pendingCopy}><Text numberOfLines={1} style={styles.pendingName}>{attachment.filename}</Text><Text style={styles.pendingStatus}>{attachment.status === 'uploading' ? `${Math.round(attachment.progress * 100)}%` : 'Ready to send'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={`Remove ${attachment.filename}`} onPress={() => setAttachments((current) => current.filter((item) => item.local_id !== attachment.local_id))} style={styles.removeAttachment}><X color={c.text.body} size={14} /></Pressable></View>)}</ScrollView>}
        {!editingMessage && <VoiceDraftPanel state={voiceDraft.state} durationMillis={voiceDraft.durationMillis} maxDurationSeconds={voiceDraft.maxDurationSeconds} metering={voiceDraft.metering} error={voiceDraft.error} notice={voiceDraft.notice} hasReview={Boolean(voiceDraft.review)} hasRecording={voiceDraft.hasRecording} onStop={() => void voiceDraft.stop()} onCancel={() => void voiceDraft.cancel()} onRetry={voiceDraft.retry} onRecordAgain={() => void voiceDraft.recordAgain()} onRestore={voiceDraft.restore} onDismiss={voiceDraft.dismissReview} />}
        {editingMessage && <View style={styles.editBanner}><Edit3 color={c.text.body} size={15} /><Text style={styles.editText}>Editing message</Text><Pressable accessibilityRole="button" accessibilityLabel="Cancel editing" onPress={() => { setEditingMessage(null); setEditDraft(''); setEditSelection({ start: 0, end: 0 }); }} style={styles.editClose}><X color={c.text.body} size={16} /></Pressable></View>}
        <TypingIndicator users={typingUsers} />
        <ComposerLimitNotice value={preparedComposerBody} />
        <MessageFormattingToolbar value={composerValue} selection={composerSelection} visible={formattingExpanded} disabled={sending} onChange={updateComposerValue} onSelectionChange={updateComposerSelection} onComposerFocus={focusComposer} onLimitExceeded={() => Alert.alert('Draft is too long', `This formatting would exceed the ${MESSAGE_BODY_LIMIT.toLocaleString()}-character limit.`)} />
        <View style={styles.composer}>

          {composerToolsExpanded && <View style={styles.composerActions}>
            <Pressable accessibilityRole="button" accessibilityLabel="Add an attachment" disabled={sending || Boolean(editingMessage)} onPress={() => Alert.alert('Add an attachment', undefined, [{ text: 'Photo library', onPress: () => void pickImage() }, { text: 'Choose a file', onPress: () => void pickDocument() }, { text: 'Cancel', style: 'cancel' }])} style={styles.attachButton}><Paperclip color={c.text.body} size={19} /></Pressable>
            <FormattingToggleButton expanded={formattingExpanded} disabled={sending} onPress={() => setFormattingExpanded((current) => !current)} />
            <VoiceDraftButton state={voiceDraft.state} disabled={sending || Boolean(editingMessage)} onPress={() => void voiceDraft.start()} />
            </View>}
          <View style={styles.composerActions}><Pressable accessibilityRole="button" accessibilityLabel="Composer options" accessibilityState={{ expanded: composerToolsExpanded }} onPress={() => setComposerToolsExpanded(!composerToolsExpanded)} style={styles.composerOptions}><MoreHorizontal color={c.text.body} size={20} /></Pressable><TextInput keyboardAppearance={scheme} ref={composerInputRef} accessibilityLabel={editingMessage ? 'Edit message' : 'Message composer'} accessibilityHint={editingMessage ? 'Update the selected message' : `Enter a message for ${title}`} maxFontSizeMultiplier={fontScaleLimits.content} value={composerValue} selection={composerSelection} onSelectionChange={(event) => updateComposerSelection(event.nativeEvent.selection)} onChangeText={(value) => { if (messageBodyChangeAllowed(composerValue, value)) updateComposerValue(value); }} onFocus={() => { keyboardShouldFollowRef.current = nearBottomRef.current; if (nearBottomRef.current) scrollToLatest(false); }} placeholder={editingMessage ? 'Edit message' : `Message ${kind === 'channel' ? '#' : ''}${title}`} placeholderTextColor={c.text.body} multiline style={styles.input} />
            <Button variant="primary" accessibilityRole="button" accessibilityLabel={editingMessage ? 'Save edit' : 'Send message'} disabled={!composerHasContent || !composerWithinLimit || sending} onPress={() => void (editingMessage ? saveEdit() : send())} style={({ pressed }) => [styles.send, (!composerHasContent || !composerWithinLimit || sending) && styles.sendDisabled, pressed && styles.pressed]}><Send color={c.text.onAction} size={19} /></Button>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={Boolean(selectedMessage)} transparent animationType="fade" onRequestClose={() => setSelectedMessage(null)}><View style={styles.modalRoot}><Pressable accessibilityRole="button" accessibilityLabel="Close message actions" style={StyleSheet.absoluteFill} onPress={() => setSelectedMessage(null)} /><View style={[styles.actionSheet, { maxHeight: '85%' }]}><ScrollView><View style={styles.sheetHandle} /><Text style={styles.sheetTitle}>Message actions</Text>{selectedMessage && <>
        {!selectedMessage.deleted_at && !selectedMessage.blocked && <View style={styles.reactionPicker}>{REACTION_OPTIONS.map(({ value, label, Icon }) => <Pressable key={value} accessibilityRole="button" accessibilityLabel={label} onPress={() => { void toggleReaction(selectedMessage, value); setSelectedMessage(null); }} style={styles.reactionButton}><Icon color={c.text.strong} size={20} /><Text style={styles.reactionLabel}>{label}</Text></Pressable>)}</View>}
        {user?.is_staff && selectedMessage.author.role === 'student' && <Action icon={UserRound} label="View student" onPress={() => { setAuthorContext(selectedMessage.author); setSelectedMessage(null); }} />}
        {!selectedMessage.blocked && <Action icon={MessageSquareReply} label="Reply in thread" onPress={() => { openThread(selectedMessage); setSelectedMessage(null); }} />}
        {!!selectedMessage.body && !selectedMessage.blocked && <Action icon={ArrowDownToLine} label="Copy message" onPress={() => { void Clipboard.setStringAsync(selectedMessage.body); setSelectedMessage(null); }} />}
        {canManage && <Action icon={Pin} label={selectedMessage.pinned_at ? 'Unpin message' : 'Pin message'} onPress={() => void togglePin(selectedMessage)} />}
        {!selectedMessage.mine && selectedMessage.id > 0 && <Action icon={Flag} label="Report message" destructive onPress={() => { reportMessage(selectedMessage); setSelectedMessage(null); }} />}
        {!selectedMessage.mine && selectedMessage.id > 0 && <Action icon={Flag} label={`Report ${selectedMessage.author.full_name}`} destructive onPress={() => { reportUser(selectedMessage); setSelectedMessage(null); }} />}
        {!selectedMessage.mine && selectedMessage.id > 0 && !selectedMessage.blocked && <Action icon={UserX} label={`Block ${selectedMessage.author.full_name}`} destructive onPress={() => { blockUser(selectedMessage); setSelectedMessage(null); }} />}
        {selectedMessage.mine && !selectedMessage.deleted_at && selectedMessage.id > 0 && <Action icon={Edit3} label="Edit message" onPress={startEditingSelectedMessage} />}
        {selectedMessage.mine && selectedMessage.id > 0 && <Action icon={Trash2} label="Remove message" destructive onPress={() => { deleteMessage(selectedMessage); setSelectedMessage(null); }} />}
      </>}<Button variant="secondary" onPress={() => setSelectedMessage(null)}>Cancel</Button></ScrollView></View></View></Modal>

      <Modal visible={showPins} transparent animationType="fade" onRequestClose={() => setShowPins(false)}><View style={styles.modalRoot}><Pressable accessibilityRole="button" accessibilityLabel="Close pinned messages" style={StyleSheet.absoluteFill} onPress={() => setShowPins(false)} /><View style={styles.pinsSheet}><View style={styles.sheetHandle} /><Text style={styles.sheetTitle}>Pinned messages</Text><ScrollView contentContainerStyle={styles.pinsList}>{pinnedMessages.length ? pinnedMessages.map((message) => <Pressable key={message.id} accessibilityRole="button" onPress={() => { setShowPins(false); router.setParams({ messageId: String(message.id) }); }} style={styles.pinCard}><Pin color={c.text.body} size={15} /><View style={styles.pinCardCopy}><Text numberOfLines={3} style={styles.pinBody}>{messagePreview(message.body, 180, message.attachments[0]?.filename || 'Attachment')}</Text><Text style={styles.pinAuthor}>{message.author.full_name}</Text></View></Pressable>) : <Text style={styles.noPins}>Nothing has been pinned in this conversation.</Text>}</ScrollView></View></View></Modal>

      {authorContext && <MessageAuthorContext author={authorContext} cohortId={summary?.cohort_id} onClose={() => setAuthorContext(null)} />}
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

function Action({ icon: Icon, label, onPress, destructive = false }: { icon: LucideIcon; label: string; onPress: () => void; destructive?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); return <Pressable accessibilityRole="button" onPress={onPress} style={styles.action}><Icon color={destructive ? c.status.danger.fg : c.text.body} size={19} /><Text style={[styles.actionText, destructive && styles.actionDanger]}>{label}</Text></Pressable>; }
function DayDivider({ value }: { value: string }) {
  const styles = useStyles(); return <View style={styles.dayDivider}><View style={styles.dayLine} /><Text style={styles.dayText}>{formatConversationDay(value)}</Text><View style={styles.dayLine} /></View>; }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  composerOptions: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 56, paddingVertical: 4, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle }, iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, hash: { width: 38, height: 38, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1, minHeight: 44, justifyContent: 'center' }, title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 }, status: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }, statusText: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12 }, sourceChip: { minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.strong, backgroundColor: c.surface.sunken, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 8 }, sourceText: { flex: 1, color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  messagePane: { flex: 1, minHeight: 0 }, list: { paddingHorizontal: 14, paddingVertical: 20, paddingBottom: 28, flexGrow: 1 }, empty: { flex: 1, minHeight: 420, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 50 }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 18 }, emptyCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 }, loadingOlder: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, textAlign: 'center', paddingVertical: 18 },
  dayDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 }, dayLine: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: c.border.subtle }, dayText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  unreadDivider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 }, unreadLine: { flex: 1, height: 1, backgroundColor: c.text.body }, unreadDividerText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.5 },
  targetMessage: { marginHorizontal: -8, paddingHorizontal: 8, paddingTop: 7, borderRadius: 16, backgroundColor: c.surface.sunken },
  latestButton: { position: 'absolute', bottom: 12, alignSelf: 'center', minHeight: 44, borderRadius: 22, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.strong, shadowColor: c.border.strong, shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 }, latestText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 },
  mentionPanel: { maxHeight: 210, borderTopWidth: 1, borderTopColor: c.border.subtle, backgroundColor: c.surface.raised, padding: 8 }, mentionRow: { minHeight: 48, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 10 }, mentionName: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 12 }, mentionEmail: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  everyoneIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  attachmentTray: { paddingHorizontal: 14, paddingVertical: 8, gap: 8, backgroundColor: c.surface.raised }, pendingAttachment: { width: 204, minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, paddingLeft: 11, flexDirection: 'row', alignItems: 'center', gap: 8 }, pendingCopy: { flex: 1 }, pendingName: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 12 }, pendingStatus: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, marginTop: 2 }, removeAttachment: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  editBanner: { minHeight: 44, paddingLeft: 16, backgroundColor: c.surface.sunken, borderTopWidth: 1, borderTopColor: c.border.strong, flexDirection: 'row', alignItems: 'center', gap: 8 }, editText: { flex: 1, color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, editClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  composer: { gap: 4, paddingHorizontal: 12, paddingTop: 9, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle, backgroundColor: c.surface.raised }, composerActions: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 4 }, composerSpacer: { flex: 1 }, attachButton: { width: 44, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, input: { flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 17, backgroundColor: c.surface.page, borderWidth: 1, borderColor: c.border.subtle, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 11 }, send: { width: 46, height: 46, borderRadius: 16,  alignItems: 'center', justifyContent: 'center' }, sendDisabled: { opacity: 0.38 }, pressed: { transform: [{ scale: 0.96 }] },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay }, actionSheet: { backgroundColor: c.surface.raised, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 16, paddingBottom: 30 }, pinsSheet: { maxHeight: '76%', backgroundColor: c.surface.raised, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 16, paddingBottom: 30 }, sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: c.border.subtle, alignSelf: 'center', marginTop: 10 }, sheetTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 20, marginTop: 16, marginBottom: 12 },
  reactionPicker: { flexDirection: 'row', gap: 7, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle }, reactionButton: { flex: 1, minHeight: 58, borderRadius: 15, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center', gap: 5 }, reactionLabel: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, action: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 6 }, actionText: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 14 }, actionDanger: { color: c.status.danger.fg },
  pinsList: { gap: 8, paddingBottom: 12 }, pinCard: { minHeight: 68, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, padding: 13, flexDirection: 'row', gap: 10 }, pinCardCopy: { flex: 1 }, pinBody: { color: c.text.strong, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }, pinAuthor: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, marginTop: 6 }, noPins: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 30, textAlign: 'center' },
}));
