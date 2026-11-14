import { useCallback, useEffect, useLayoutEffect, useRef, type DragEvent } from 'react';
import { Button } from '../../../components/ui/Button';
import { api } from '../../../lib/api';
import { copyText } from '../../../lib/clipboard';
import { isVisiblePage, shouldPollMessages } from '../../../lib/backgroundActivity';
import { initialScopedWorkspaceId, resolveTargetWorkspaceSync, shouldKeepMessageTarget, workspaceIdForCohort } from '../../../lib/cohortScope';
import { createClientMessageId, failedSendsKey, MESSAGE_BODY_LIMIT, messageCharacterCount, readFailedSends, writeFailedSends, type StoredFailedSend, type StoredMessageSource, type UploadedMessageAttachment } from '../../../lib/messageComposerState';
import { normalizeMessageMarkdown } from '../../../lib/messageFormat';
import { firstUnreadMessageId } from '../../../lib/messagingPresentation';
import { browserPushEnabled, disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported } from '../../../lib/pushNotifications';
import { isMessageTypingEvent, subscribeToUserMessages, type RealtimeSubscription } from '../../../lib/realtime';
import { subscribeUnreadRefresh } from '../../../lib/unread';
import { uploadToS3 } from '../../../lib/uploadToS3';
import type { ChannelMessage, ChannelMessageEvent, MessageDestination, MessageSourceSummary } from '../../../types/api';
import { cacheConversationView, cachedWindowIsContiguous, conversationPath, initialMessageTarget, latestMessageFrom, mergeIncomingMessage, mergeMessageWindow, messageBelongsToTarget, positionMessageAnchor, recordMessageArrival, restoreFailedSends, rootMessageIdFor, saveConversationScroll, sortChronologicalMessages, sortPinnedMessages, targetKey, targetMatches, upsertPinnedMessage } from './helpers';
import { resolveMentionedUserIds } from './mentions';
import { type MessageComposerSend } from './MessageComposer';
import { type LocalMessage, type PendingAttachment, type RetrySend, type Target, type TargetLoadOptions } from './types';
import { useMessagesState } from './useMessagesState';

/** How a source looks on a message that hasn't reached the server yet. */
function optimisticSource(source: StoredMessageSource): MessageSourceSummary {
  return { type: source.type, id: source.id, title: source.title, lesson_id: null, cohort_id: null, learner_path: null }
}

export function useMessagesController() {
const {
    channelId,
    dmId,
    navigate,
    routedMessageId,
    routedThreadId,
    routedAnchorOffset,
    requestedWorkspaceId,
    user,
    cohortsLoading,
    selectedCohortId,
    setSelectedCohort,
    toast,
    isStaff,
    isAdmin,
    summaryFreshness,
    channels,
    setChannels,
    directConversations,
    setDirectConversations,
    workspaces,
    setWorkspaces,
    workspaceDetail,
    setWorkspaceDetail,
    availableUsers,
    setAvailableUsers,
    setAllUsers,
    selectedWorkspaceId,
    setSelectedWorkspaceId,
    selectedTarget,
    setSelectedTarget,
    messages,
    setMessages,
    pinnedMessages,
    setPinnedMessages,
    messageWindowMeta,
    setMessageWindowMeta,
    loadingOlder,
    setLoadingOlder,
    loadingNewer,
    setLoadingNewer,
    loading,
    setLoading,
    loadingTarget,
    sending,
    setSending,
    creatingChannel,
    setCreatingChannel,
    creatingWorkspace,
    setCreatingWorkspace,
    showChannelForm,
    setShowChannelForm,
    showDmForm,
    setShowDmForm,
    showWorkspaceForm,
    setShowWorkspaceForm,
    showWorkspaceSwitcher,
    setShowWorkspaceSwitcher,
    showWorkspaceMembers,
    setShowWorkspaceMembers,
    setSourceContextHidden,
    pushEnabled,
    setPushEnabled,
    pushMessage,
    setPushMessage,
    hasUnreadBelow,
    setHasUnreadBelow,
    unreadBoundaryId,
    setUnreadBoundaryId,
    openingReadStateRef,
    showScrollToLatest,
    setShowScrollToLatest,
    realtimeStatus,
    setRealtimeStatus,
    setTypingUsers,
    setRealtimeSubscriptionVersion,
    pendingAttachments,
    setPendingAttachments,
    lightboxAttachments,
    setLightboxAttachments,
    lightboxIndex,
    setLightboxIndex,
    reactionDetails,
    setReactionDetails,
    sidebarCollapsed,
    setSidebarCollapsed,
    conversationView,
    setConversationView,
    activeThreadRootId,
    setActiveThreadRootId,
    isDesktop,
    setIsDesktop,
    mobilePane,
    setMobilePane,
    editing,
    setEditing,
    editingInThreadPanel,
    setEditingInThreadPanel,
    authorContext,
    setAuthorContext,
    authorContextRef,
    showInboxSearch,
    setShowInboxSearch,
    mobileActionsMessageId,
    setMobileActionsMessageId,
    actionsFromThreadPanelRef,
    messagePendingDelete,
    setMessagePendingDelete,
    editBody,
    setEditBody,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    highlightedMessageId,
    setHighlightedMessageId,
    error,
    setError,
    workspaceError,
    setWorkspaceError,
    channelError,
    setChannelError,
    dmUserId,
    setDmUserId,
    memberToAddId,
    setMemberToAddId,
    isNavigationPending,
    startNavigationTransition,
    workspaceForm,
    setWorkspaceForm,
    channelForm,
    setChannelForm,
    messageScrollRef,
    threadScrollRef,
    heldAnchorRef,
    heldAnchorOffsetRef,
    readerInteractedRef,
    threadFollowRef,
    threadLoadedRef,
    threadWindowMeta,
    setThreadWindowMeta,
    threadWindowMetaRef,
    conversationWindowMetaRef,
    loadedMessageIdsRef,
    queuedMessagesRef,
    setQueuedMessagesVersion,
    queuedThreadCount,
    queuedConversationCount,
    preserveHistoricalWindow,
    isHistoricalWindow,
    queueHistoricalSend,
    loadingThreadPage,
    setLoadingThreadPage,
    readCursorRef,
    fileInputRef,
    composerRef,
    lightboxTouchStartX,
    optimisticAttachmentUrls,
    tempMessageIdRef,
    targetRequestRef,
    conversationViewsRef,
    targetLoadOptionsRef,
    routeTargetInitializedRef,
    routedDestinationKey,
    routedDestinationRef,
    loadingTargetRef,
    backgroundTargetLoadingRef,
    shouldStickToBottomRef,
    initialScrollPendingRef,
    scrollPersistFrameRef,
    programmaticScrollUntilRef,
    programmaticScrollTimerRef,
    lastAutoScrollTargetKeyRef,
    activeThreadRootIdRef,
    isDesktopRef,
    mobilePaneRef,
    selectedTargetRef,
    messageArrivalsRef,
    pendingAttachmentBucketsRef,
    realtimeSubscriptionRef,
    typingExpiryTimersRef,
    lastAppliedCohortWorkspaceRef,
    pendingCohortWorkspaceIdRef,
    preserveRoutedWorkspaceRef,
    typingStopTimerRef,
    outboundTypingRef,
    setTargetLoading,
    selectedChannel,
    selectedDm,
    selectedDmStudent,
    sourceRecord,
    sourceRecordPath,
    conversationReturnContext,
    selected,
    selectedLabel,
    selectedMuted,
    messagesById,
    actionableMessagesById,
    threadReplies,
    rootMessages,
    activeThreadRoot,
    mobileActionsMessage,
    typingLabel,
    reactionDetailsMessage,
    selectedReaction,
    activeThreadMessages,
    rootReadReceipts,
    threadReadReceipts,
    visibleChannels,
    recent,
    selectedWorkspace,
    canManageChannels,
    totalWorkspaceUnreadCount,
    workspaceSwitcherSubtitle,
    sortedWorkspaceCards,
    unreadOtherWorkspaceCards,
    selectedPinnedMessages,
    channelsUnreadCount,
    memberCandidates,
    mentionableUsers,
    mentionPatterns,
    lightboxAttachment,
    composerDraftKey
  } = useMessagesState()
  /** Conversation and source pairs already attached to a sent message, so the context goes out once. */
  const sentSourceKeysRef = useRef(new Set<string>())
  /**
   * Conversation and source pairs attached to a send that hasn't succeeded yet,
   * by client message id. A failed send keeps its reservation while it can
   * still be retried; discarding it (or restoring its text) releases the
   * context for the next message.
   */
  const pendingSourceKeysRef = useRef(new Map<string, string>())


  const loadLists = async () => {
    const started = summaryFreshness.startRequest()
    const [workspaceRes, channelRes, dmRes] = await Promise.all([api.getWorkspaces(), api.getChannels(), api.getDirectConversations()])
    const loadedWorkspaces = workspaceRes.data?.workspaces || []
    if (workspaceRes.data) setWorkspaces(loadedWorkspaces)
    if (channelRes.data) setChannels((current) => summaryFreshness.reconcileList('channel', current, channelRes.data!.channels, started))
    if (dmRes.data) setDirectConversations((current) => summaryFreshness.reconcileList('dm', current, dmRes.data!.direct_conversations, started))

    summaryFreshness.completeRequest(started)

    const loadedChannels = channelRes.data?.channels || []
    const loadedDirectConversations = dmRes.data?.direct_conversations || []
    const routedWorkspaceId = channelId
      ? loadedChannels.find((channel) => channel.id === Number(channelId))?.workspace_id
      : dmId
        ? loadedDirectConversations.find((conversation) => conversation.id === Number(dmId))?.workspace_id
        : null
    const initialWorkspaceId = initialScopedWorkspaceId({
      workspaces: loadedWorkspaces,
      routedWorkspaceId,
      requestedWorkspaceId,
      cohortWorkspaceId: workspaceIdForCohort(loadedWorkspaces, selectedCohortId),
    })
    const initialTarget = initialMessageTarget(
      loadedChannels.filter((channel) => channel.workspace_id === initialWorkspaceId),
      loadedDirectConversations.filter((conversation) => conversation.workspace_id === initialWorkspaceId),
    )

    setSelectedTarget((current) => current || initialTarget)
    setSelectedWorkspaceId((current) => current || initialWorkspaceId)
    setLoading(false)
  }

  useEffect(() => {
    if (!user) return
    let active = true
    let generation = 0
    const refresh = async () => {
      const request = ++generation
      const started = summaryFreshness.startRequest()
      const [channelRes, dmRes] = await Promise.all([api.getChannels(), api.getDirectConversations()])
      if (!active || request !== generation) return
      if (channelRes.data) setChannels((current) => summaryFreshness.reconcileList('channel', current, channelRes.data!.channels, started))
      if (dmRes.data) setDirectConversations((current) => summaryFreshness.reconcileList('dm', current, dmRes.data!.direct_conversations, started))
      summaryFreshness.completeRequest(started)
    }
    const unsubscribe = subscribeUnreadRefresh(() => { void refresh() })
    return () => { active = false; unsubscribe() }
  }, [user?.id, summaryFreshness])

  useEffect(() => {
    if (!requestedWorkspaceId || !workspaces.some((workspace) => workspace.id === requestedWorkspaceId) || channelId || dmId) return
    setSelectedWorkspaceId(requestedWorkspaceId)
    setSelectedTarget(null)
    setMessages([])
  }, [requestedWorkspaceId, workspaces, channelId, dmId])

  const loadWorkspaceDetail = async (workspaceId: number) => {
    const workspaceRes = await api.getWorkspace(workspaceId)
    if (!workspaceRes.data) return

    setWorkspaceDetail(workspaceRes.data.workspace)

    if (isAdmin && workspaceRes.data.workspace.can_manage) {
      const usersRes = await api.getUsers()
      if (usersRes.data) {
        setAllUsers(usersRes.data.users.map((item) => ({
          id: item.id,
          full_name: item.full_name,
          email: item.email,
          role: item.role,
          avatar_url: item.avatar_url,
          is_admin: item.is_admin,
          is_staff: item.is_staff,
        })))
      }
    } else {
      setAllUsers([])
    }
  }

  const loadAvailableUsers = async (workspaceId: number) => {
    const res = await api.getAvailableDirectUsers(workspaceId)
    if (res.data) {
      setAvailableUsers(res.data.users)
      setDmUserId(String(res.data.users[0]?.id || ''))
    }
  }

  const storedFailureMessages = (target: Target): LocalMessage[] => {
    if (!user || typeof window === 'undefined') return []

    return readFailedSends(failedSendsKey(user.id, target), window.localStorage)
      .filter((failure) => targetMatches(failure.target, target))
      .map((failure) => {
        tempMessageIdRef.current -= 1
        return {
          id: tempMessageIdRef.current,
          channel_id: target.type === 'channel' ? target.id : null,
          direct_conversation_id: target.type === 'dm' ? target.id : null,
          parent_message_id: failure.parentMessageId,
          client_message_id: failure.clientMessageId,
          body: failure.body,
          mention_user_ids: failure.mentionUserIds,
          edited_at: null,
          deleted_at: null,
          pinned_at: null,
          pinned_by_id: null,
          created_at: failure.createdAt,
          updated_at: failure.createdAt,
          mine: true,
          failed: true,
          failureError: failure.attachmentCount !== failure.attachments.length
            ? `${failure.error} Restore the text and attach the files again.`
            : failure.error,
          retrySend: failure.attachmentCount === failure.attachments.length ? {
            clientMessageId: failure.clientMessageId,
            body: failure.body,
            parentMessageId: failure.parentMessageId,
            mentionUserIds: failure.mentionUserIds,
            pendingAttachments: [],
            uploadedAttachments: failure.attachments,
            source: failure.source,
          } : undefined,
          source: failure.source ? optimisticSource(failure.source) : null,
          attachments: failure.attachments.map((attachment, index) => ({
            id: tempMessageIdRef.current - index - 1,
            filename: attachment.filename,
            content_type: attachment.content_type,
            byte_size: attachment.byte_size,
            image: attachment.content_type.startsWith('image/'),
          })),
          reactions: [],
          author: {
            id: user.id,
            full_name: user.full_name,
            email: user.email,
            role: user.role,
            avatar_url: user.avatar_url,
          },
        }
      })
  }

  const saveStoredFailure = (target: Target, failure: StoredFailedSend) => {
    if (!user || typeof window === 'undefined') return
    const key = failedSendsKey(user.id, target)
    const failures = readFailedSends(key, window.localStorage).filter((item) => item.clientMessageId !== failure.clientMessageId)
    writeFailedSends(key, [...failures, failure], window.localStorage)
  }

  const removeStoredFailure = (target: Target, clientMessageId: string) => {
    if (!user || typeof window === 'undefined') return
    const key = failedSendsKey(user.id, target)
    writeFailedSends(
      key,
      readFailedSends(key, window.localStorage).filter((item) => item.clientMessageId !== clientMessageId),
      window.localStorage,
    )
  }

  const loadTarget = async (target: Target, options: TargetLoadOptions = {}) => {
    if (options.background && preserveHistoricalWindow()) return
    const requestId = targetRequestRef.current + 1
    targetRequestRef.current = requestId
    const cachedView = options.aroundMessageId ? null : conversationViewsRef.current.get(targetKey(target))
    const showTargetLoader = !options.background && !cachedView
    if (!options.background) initialScrollPendingRef.current = !options.aroundMessageId

    if (showTargetLoader) {
      setTargetLoading(true)
      setHasUnreadBelow(false)
      if (!options.background) setUnreadBoundaryId(null)
      setShowScrollToLatest(false)
      shouldStickToBottomRef.current = !options.aroundMessageId
    }

    // Resolve the named message independently of the feed window. A reply's
    // root may be years older than its latest reply.
    let destination: MessageDestination | null = null
    let destinationMessages: ChannelMessage[] = []
    if (!options.background) {
      heldAnchorRef.current = options.aroundMessageId || null
      heldAnchorOffsetRef.current = options.anchorOffset
      readerInteractedRef.current = false
      threadFollowRef.current = !options.aroundMessageId
      threadLoadedRef.current = ''
      queuedMessagesRef.current.clear()
      setQueuedMessagesVersion((version) => version + 1)
      setThreadWindowMeta(null)
    }
    if (options.aroundMessageId) {
      const result = await api.getMessageDestination(options.aroundMessageId)
      if (requestId !== targetRequestRef.current) return
      destination = result.data ?? null
      if (!destination || destination.message_id !== options.aroundMessageId || (target.type === 'channel' ? destination.channel_id !== target.id : destination.direct_conversation_id !== target.id)) {
        setTargetLoading(false)
        toast.error('This message is no longer available.')
        return
      }
      if (destination.thread_root_id !== destination.message_id || options.threadRootId === destination.thread_root_id) {
        const window = await api.getMessageThread(destination.thread_root_id, { around_message_id: destination.message_id, message_limit: 80 })
        if (requestId !== targetRequestRef.current) return
        if (!window.data) { setTargetLoading(false); toast.error('This thread is no longer available.'); return }
        destinationMessages = [window.data.root_message, ...window.data.replies]
        threadLoadedRef.current = `${targetKey(target)}:${destination.thread_root_id}`
        setThreadWindowMeta(window.data.meta)
      }
    }
    const started = summaryFreshness.startRequest()
    const feedAnchorId = destination?.thread_root_id || options.aroundMessageId
    const showDestination = () => {
      if (destination && (destination.thread_root_id !== options.aroundMessageId || options.threadRootId === destination.thread_root_id)) setActiveThreadRootId(destination.thread_root_id)
      setHighlightedMessageId(options.highlightedMessageId || null)
    }

    if (target.type === 'channel') {
      const res = await api.getChannel(target.id, {
        around_message_id: feedAnchorId,
      })
      if (requestId !== targetRequestRef.current || (options.background && preserveHistoricalWindow())) return
      if (!res.data) {
        if (showTargetLoader) setTargetLoading(false)
        return
      }

      const serverMessages = sortChronologicalMessages([...new Map([...(res.data.messages || []).filter((message) => !destinationMessages.length || message.parent_message_id !== destination?.thread_root_id), ...destinationMessages].map((message) => [message.id, message])).values()])
      if (!options.background && !options.aroundMessageId) {
        openingReadStateRef.current = { key: targetKey(target), summary: res.data.channel }
        setUnreadBoundaryId(firstUnreadMessageId(serverMessages, res.data.channel.last_read_at, res.data.channel.unread_count, res.data.channel.last_read_message_id))
      }
      const contiguous = Boolean(cachedView && cachedWindowIsContiguous(cachedView, serverMessages, res.data.meta || null))
      const cachedMessages = contiguous ? restoreFailedSends(cachedView!, storedFailureMessages(target)).messages : storedFailureMessages(target)
      serverMessages.forEach((message) => {
        if (message.client_message_id) removeStoredFailure(target, message.client_message_id)
      })
      setMessages((current) => mergeMessageWindow(
        options.background ? current.filter((message) => messageBelongsToTarget(message, target)) : cachedMessages,
        serverMessages,
        Boolean(options.background || contiguous),
      ))
      setPinnedMessages(sortPinnedMessages(res.data.pinned_messages || []))
      setMessageWindowMeta((current) => (options.background || contiguous) && current && res.data?.meta ? {
        ...res.data.meta,
        oldest_message_id: current.oldest_message_id,
        has_older: current.has_older,
      } : res.data?.meta || null)
      if (!options.background && !options.aroundMessageId) cacheConversationView(conversationViewsRef.current, target, {
        messages: mergeMessageWindow(cachedMessages, serverMessages, contiguous),
        pinnedMessages: sortPinnedMessages(res.data.pinned_messages || []),
        meta: contiguous && cachedView?.meta && res.data.meta ? { ...res.data.meta, oldest_message_id: cachedView.meta.oldest_message_id, has_older: cachedView.meta.has_older } : res.data.meta || null,
      })
      setChannels((prev) => prev.map((channel) => channel.id === target.id ? summaryFreshness.reconcile('channel', channel, res.data!.channel, started) : channel))
      summaryFreshness.completeRequest(started)
      showDestination()
      if (showTargetLoader) setTargetLoading(false)
      return
    }

    const res = await api.getDirectConversation(target.id, {
      around_message_id: feedAnchorId,
    })
    if (requestId !== targetRequestRef.current || (options.background && preserveHistoricalWindow())) return
    if (!res.data) {
      if (showTargetLoader) setTargetLoading(false)
      return
    }

    const serverMessages = sortChronologicalMessages([...new Map([...(res.data.messages || []).filter((message) => !destinationMessages.length || message.parent_message_id !== destination?.thread_root_id), ...destinationMessages].map((message) => [message.id, message])).values()])
    if (!options.background && !options.aroundMessageId) {
      openingReadStateRef.current = { key: targetKey(target), summary: res.data.direct_conversation }
      setUnreadBoundaryId(firstUnreadMessageId(serverMessages, res.data.direct_conversation.last_read_at, res.data.direct_conversation.unread_count, res.data.direct_conversation.last_read_message_id))
    }
    const contiguous = Boolean(cachedView && cachedWindowIsContiguous(cachedView, serverMessages, res.data.meta || null))
    const cachedMessages = contiguous ? restoreFailedSends(cachedView!, storedFailureMessages(target)).messages : storedFailureMessages(target)
    serverMessages.forEach((message) => {
      if (message.client_message_id) removeStoredFailure(target, message.client_message_id)
    })
    setMessages((current) => mergeMessageWindow(
      options.background ? current.filter((message) => messageBelongsToTarget(message, target)) : cachedMessages,
      serverMessages,
      Boolean(options.background || contiguous),
    ))
    setPinnedMessages(sortPinnedMessages(res.data.pinned_messages || []))
    setMessageWindowMeta((current) => (options.background || contiguous) && current && res.data?.meta ? {
      ...res.data.meta,
      oldest_message_id: current.oldest_message_id,
      has_older: current.has_older,
    } : res.data?.meta || null)
    if (!options.background && !options.aroundMessageId) cacheConversationView(conversationViewsRef.current, target, {
      messages: mergeMessageWindow(cachedMessages, serverMessages, contiguous),
      pinnedMessages: sortPinnedMessages(res.data.pinned_messages || []),
      meta: contiguous && cachedView?.meta && res.data.meta ? { ...res.data.meta, oldest_message_id: cachedView.meta.oldest_message_id, has_older: cachedView.meta.has_older } : res.data.meta || null,
    })
    setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? summaryFreshness.reconcile('dm', conversation, res.data!.direct_conversation, started) : conversation))
    summaryFreshness.completeRequest(started)
    showDestination()
    if (showTargetLoader) setTargetLoading(false)
  }

  const loadOlderMessages = async () => {
    if (!selectedTarget || !messageWindowMeta?.has_older || !messageWindowMeta.oldest_message_id || loadingOlder) return

    const target = selectedTarget
    const element = messageScrollRef.current
    const previousHeight = element?.scrollHeight || 0
    const previousTop = element?.scrollTop || 0
    shouldStickToBottomRef.current = false
    setLoadingOlder(true)

    const params = { before_message_id: messageWindowMeta.oldest_message_id }
    const res = target.type === 'channel'
      ? await api.getChannel(target.id, params)
      : await api.getDirectConversation(target.id, params)

    if (targetMatches(selectedTargetRef.current, target) && !res.data) {
      toast.error(res.error || 'Could not load earlier messages.')
    } else if (targetMatches(selectedTargetRef.current, target) && res.data) {
      const older = sortChronologicalMessages(res.data.messages || [])
      const opening = openingReadStateRef.current
      if (opening?.key === targetKey(target)) {
        const { last_read_at, unread_count, last_read_message_id } = opening.summary
        const olderBoundary = firstUnreadMessageId(older, last_read_at, unread_count, last_read_message_id)
        if (olderBoundary) setUnreadBoundaryId(olderBoundary)
      }
      setMessages((current) => {
        const existingIds = new Set(current.map((message) => message.id))
        return sortChronologicalMessages([...older.filter((message) => !existingIds.has(message.id)), ...current])
      })
      setMessageWindowMeta((current) => ({
        oldest_message_id: res.data?.meta?.oldest_message_id ?? current?.oldest_message_id ?? null,
        newest_message_id: current?.newest_message_id ?? res.data?.meta?.newest_message_id ?? null,
        has_older: res.data?.meta?.has_older ?? false,
        has_newer: current?.has_newer ?? res.data?.meta?.has_newer ?? false,
      }))
      window.requestAnimationFrame(() => {
        if (element) element.scrollTop = previousTop + Math.max(0, element.scrollHeight - previousHeight)
      })
    }

    setLoadingOlder(false)
  }

  const loadNewerMessages = async () => {
    if (!selectedTarget || !messageWindowMeta?.has_newer || !messageWindowMeta.newest_message_id || loadingNewer) return
    const target = selectedTarget
    setLoadingNewer(true)
    try {
      const params = { after_message_id: messageWindowMeta.newest_message_id }
      const res = target.type === 'channel'
        ? await api.getChannel(target.id, params)
        : await api.getDirectConversation(target.id, params)
      if (!targetMatches(selectedTargetRef.current, target)) return
      if (!res.data) {
        toast.error(res.error || 'Could not load newer messages.')
        return
      }
      res.data.messages?.forEach((message) => queuedMessagesRef.current.delete(message.id))
      setQueuedMessagesVersion((version) => version + 1)
      shouldStickToBottomRef.current = false
      setMessages((current) => sortChronologicalMessages([
        ...current,
        ...(res.data!.messages || []).filter((incoming) => !current.some((message) => message.id === incoming.id || (
          incoming.client_message_id && message.client_message_id === incoming.client_message_id
        ))),
      ]))
      setMessageWindowMeta((current) => ({
        oldest_message_id: current?.oldest_message_id ?? res.data?.meta?.oldest_message_id ?? null,
        newest_message_id: res.data?.meta?.newest_message_id ?? current?.newest_message_id ?? null,
        has_older: current?.has_older ?? res.data?.meta?.has_older ?? false,
        has_newer: res.data?.meta?.has_newer ?? false,
      }))
    } catch {
      if (targetMatches(selectedTargetRef.current, target)) toast.error('Could not load newer messages.')
    } finally {
      if (targetMatches(selectedTargetRef.current, target)) setLoadingNewer(false)
    }
  }

  useEffect(() => {
    loadLists()
  }, [])

  useEffect(() => {
    if (!channelForm.workspace_id && workspaces.length > 0) {
      setChannelForm((prev) => ({ ...prev, workspace_id: String(workspaces[0].id) }))
    }
  }, [channelForm.workspace_id, workspaces])

  useEffect(() => {
    if (selectedWorkspaceId) loadAvailableUsers(selectedWorkspaceId)
  }, [selectedWorkspaceId])

  useEffect(() => {
    if (!selectedWorkspaceId) {
      setWorkspaceDetail(null)
      return
    }

    loadWorkspaceDetail(selectedWorkspaceId)
  }, [selectedWorkspaceId])

  useEffect(() => {
    let active = true
    Promise.all([
      api.getPushConfig(),
      pushSupported()
        ? navigator.serviceWorker.ready.then((registration) => registration.pushManager.getSubscription()).catch(() => null)
        : Promise.resolve(null),
    ]).then(([config, subscription]) => {
      if (!active) return
      setPushEnabled(browserPushEnabled(config.data, subscription))
    }).catch(() => {
      if (active) setPushEnabled(false)
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const options = routedMessageId !== null && Number.isInteger(routedMessageId) && routedMessageId > 0 ? { aroundMessageId: routedMessageId, highlightedMessageId: routedMessageId, anchorOffset: routedAnchorOffset, threadRootId: Number.isSafeInteger(routedThreadId) && routedThreadId !== null && routedThreadId > 0 ? routedThreadId : undefined } : {}
    const target: Target | null = channelId ? { type: 'channel', id: Number(channelId) } : dmId ? { type: 'dm', id: Number(dmId) } : null
    if (!target) {
      routeTargetInitializedRef.current = true
      routedDestinationRef.current = ''
      setActiveThreadRootId(null)
      if (!isDesktopRef.current) setMobilePane('list')
      return
    }

    const current = selectedTargetRef.current
    const sameTarget = current?.type === target.type && current.id === target.id
    if (routeTargetInitializedRef.current && sameTarget) {
      if (routedDestinationRef.current !== routedDestinationKey) {
        targetLoadOptionsRef.current = {}
        setActiveThreadRootId(null)
        void loadTarget(target, options)
      }
    } else {
      const element = messageScrollRef.current
      if (element && current) saveConversationScroll(user?.id, current, element)
      if (current && !loadingTargetRef.current && !messageWindowMeta?.has_newer) {
        cacheConversationView(conversationViewsRef.current, current, { messages, pinnedMessages, meta: messageWindowMeta })
      }
      const rawCachedView = options.aroundMessageId ? null : conversationViewsRef.current.get(targetKey(target))
      const cachedView = rawCachedView ? restoreFailedSends(rawCachedView, storedFailureMessages(target)) : null
      targetRequestRef.current += 1
      targetLoadOptionsRef.current = options
      setUnreadBoundaryId(null)
      setMessages(cachedView?.messages ?? [])
      setPinnedMessages(cachedView?.pinnedMessages ?? [])
      setMessageWindowMeta(cachedView?.meta ?? null)
      setTargetLoading(!cachedView)
      setLoadingNewer(false)
      shouldStickToBottomRef.current = !options.aroundMessageId
      setActiveThreadRootId(null)
      setEditing(null)
      setConversationView('messages')
      setSelectedTarget(target)
    }
    if (!isDesktopRef.current) setMobilePane('conversation')
    routeTargetInitializedRef.current = true
    routedDestinationRef.current = routedDestinationKey
  }, [channelId, dmId, routedMessageId, routedThreadId, routedAnchorOffset, routedDestinationKey])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mediaQuery = window.matchMedia('(min-width: 1024px)')
    const sync = () => setIsDesktop(mediaQuery.matches)
    sync()

    mediaQuery.addEventListener('change', sync)
    return () => mediaQuery.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    if (!isDesktop) setSidebarCollapsed(false)
  }, [isDesktop])

  useEffect(() => {
    const saveCurrentPosition = () => {
      const element = messageScrollRef.current
      const currentTarget = selectedTargetRef.current
      if (element && currentTarget) saveConversationScroll(user?.id, currentTarget, element)
    }

    window.addEventListener('pagehide', saveCurrentPosition)
    return () => {
      saveCurrentPosition()
      window.removeEventListener('pagehide', saveCurrentPosition)
      if (scrollPersistFrameRef.current !== null) window.cancelAnimationFrame(scrollPersistFrameRef.current)
      if (programmaticScrollTimerRef.current !== null) window.clearTimeout(programmaticScrollTimerRef.current)
    }
  }, [user?.id])

  useEffect(() => {
    if (!selectedTarget) return
    const workspaceId = selectedChannel?.workspace_id || selectedDm?.workspace_id
    if (!workspaceId) return
    const sync = resolveTargetWorkspaceSync({
      targetWorkspaceId: workspaceId,
      selectedWorkspaceId,
      pendingCohortWorkspaceId: pendingCohortWorkspaceIdRef.current,
    })
    if (sync === 'wait') return
    if (sync === 'complete') pendingCohortWorkspaceIdRef.current = null
    setSelectedWorkspaceId(workspaceId)
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (sync === 'promote' && workspace?.cohort_id) setSelectedCohort(workspace.cohort_id)
  }, [selectedTarget, selectedChannel, selectedDm, selectedWorkspaceId, setSelectedCohort, workspaces])

  useEffect(() => {
    if (cohortsLoading || workspaces.length === 0) return
    const routedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
    if (preserveRoutedWorkspaceRef.current && routedWorkspace) {
      if (routedWorkspace.cohort_id && routedWorkspace.cohort_id !== selectedCohortId) {
        setSelectedCohort(routedWorkspace.cohort_id)
        return
      }
      const cohortWorkspaceId = workspaceIdForCohort(workspaces, selectedCohortId)
      lastAppliedCohortWorkspaceRef.current = selectedCohortId && cohortWorkspaceId
        ? `${selectedCohortId}:${cohortWorkspaceId}`
        : null
      preserveRoutedWorkspaceRef.current = false
      return
    }
    const workspaceId = workspaceIdForCohort(workspaces, selectedCohortId)
    if (!workspaceId || !workspaces.some((workspace) => workspace.id === workspaceId)) return
    const selectionKey = `${selectedCohortId}:${workspaceId}`
    if (lastAppliedCohortWorkspaceRef.current === selectionKey) return
    lastAppliedCohortWorkspaceRef.current = selectionKey
    setSelectedWorkspaceId(workspaceId)
    setChannelForm((current) => ({ ...current, workspace_id: String(workspaceId) }))
    const selectedTargetWorkspaceId = selectedChannel?.workspace_id || selectedDm?.workspace_id
    if (shouldKeepMessageTarget(selectedTargetWorkspaceId, workspaceId)) {
      pendingCohortWorkspaceIdRef.current = null
      return
    }
    const target = initialMessageTarget(
      channels.filter((channel) => channel.workspace_id === workspaceId),
      directConversations.filter((conversation) => conversation.workspace_id === workspaceId),
    )
    if (target) {
      pendingCohortWorkspaceIdRef.current = workspaceId
      selectTarget(target)
      return
    }
    pendingCohortWorkspaceIdRef.current = null
    navigate('/messages')
    setSelectedTarget(null)
    setUnreadBoundaryId(null)
    setMessages([])
    setPinnedMessages([])
    setActiveThreadRootId(null)
    setEditing(null)
    setConversationView('messages')
    if (!isDesktop) setMobilePane('list')
  }, [channels, cohortsLoading, directConversations, selectedChannel, selectedCohortId, selectedDm, selectedWorkspaceId, setSelectedCohort, workspaces])

  useEffect(() => {
    if (!selectedTarget) return
    setHasUnreadBelow(false)

    const options = targetLoadOptionsRef.current
    targetLoadOptionsRef.current = {}
    loadTarget(selectedTarget, options)
  }, [selectedTarget?.type, selectedTarget?.id])

  useEffect(() => {
    if (!selectedTarget) return

    const refreshTarget = async () => {
      if (
        !isVisiblePage(document.visibilityState) ||
        loadingTargetRef.current ||
        backgroundTargetLoadingRef.current
      ) return

      backgroundTargetLoadingRef.current = true
      try {
        await loadTarget(selectedTarget, { background: true })
      } finally {
        backgroundTargetLoadingRef.current = false
      }
    }

    let interval: number | null = null
    const syncPolling = () => {
      const shouldPoll = shouldPollMessages(document.visibilityState, realtimeStatus)
      if (shouldPoll && interval === null) {
        interval = window.setInterval(() => void refreshTarget(), 30000)
      } else if (!shouldPoll && interval !== null) {
        window.clearInterval(interval)
        interval = null
      }
    }
    const onFocus = () => void refreshTarget()
    const onVisibilityChange = () => {
      syncPolling()
      if (isVisiblePage(document.visibilityState)) void refreshTarget()
    }

    syncPolling()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      if (interval !== null) window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [selectedTarget?.type, selectedTarget?.id, realtimeStatus])

  useEffect(() => {
    if (!user) return

    let unsubscribe: RealtimeSubscription | null = null
    let active = true

    setRealtimeStatus('disconnected')
    setTypingUsers([])

    subscribeToUserMessages((payload) => {
      if (!active) return
      if (isMessageTypingEvent(payload)) {
        const currentTarget = selectedTargetRef.current
        const belongsToTarget = Boolean(currentTarget) && (
          currentTarget!.type === 'channel'
            ? payload.channel_id === currentTarget!.id
            : payload.direct_conversation_id === currentTarget!.id
        )
        if (!belongsToTarget || payload.user.id === user.id || payload.thread_root_id !== activeThreadRootIdRef.current) return

        const existingTimer = typingExpiryTimersRef.current.get(payload.user.id)
        if (existingTimer) window.clearTimeout(existingTimer)
        typingExpiryTimersRef.current.delete(payload.user.id)
        if (!payload.active) {
          setTypingUsers((current) => current.filter((typingUser) => typingUser.id !== payload.user.id))
          return
        }

        setTypingUsers((current) => [payload.user, ...current.filter((typingUser) => typingUser.id !== payload.user.id)])
        const timer = window.setTimeout(() => {
          typingExpiryTimersRef.current.delete(payload.user.id)
          setTypingUsers((current) => current.filter((typingUser) => typingUser.id !== payload.user.id))
        }, 5_000)
        typingExpiryTimersRef.current.set(payload.user.id, timer)
        return
      }

      const event = payload as ChannelMessageEvent
      if (!event.message) return

      const currentTarget = selectedTargetRef.current
      const belongsToTarget = Boolean(currentTarget) && (
        currentTarget!.type === 'channel'
          ? event.channel_id === currentTarget!.id
          : event.direct_conversation_id === currentTarget!.id
      )
      const message = { ...event.message, mine: event.message.mine ?? event.message.author.id === user.id }
      if (belongsToTarget && message.parent_message_id === activeThreadRootIdRef.current) {
        const typingTimer = typingExpiryTimersRef.current.get(message.author.id)
        if (typingTimer) window.clearTimeout(typingTimer)
        typingExpiryTimersRef.current.delete(message.author.id)
        setTypingUsers((current) => current.filter((typingUser) => typingUser.id !== message.author.id))
      }
      const shouldMarkIncomingRead = Boolean(!conversationWindowMetaRef.current?.has_newer && belongsToTarget && !message.parent_message_id && !message.mine && event.event === 'created' && canAutoMarkRead())

      updateTargetSummaryFromEvent(event, message, false)

      if (belongsToTarget) {
        const parent = message.parent_message_id ?? null
        const historical = parent === null ? conversationWindowMetaRef.current?.has_newer
          : parent === activeThreadRootIdRef.current && threadWindowMetaRef.current?.has_newer
        const queued = queuedMessagesRef.current
        const hasQueuedForWindow = [...queued.values()].some((queuedParent) => queuedParent === parent)
        if (!loadedMessageIdsRef.current.has(message.id) && (historical || hasQueuedForWindow)) {
          if (event.event === 'created') queued.set(message.id, parent)
          if (event.event === 'deleted') queued.delete(message.id)
          setQueuedMessagesVersion((version) => version + 1)
          if (parent === null && queued.size) { shouldStickToBottomRef.current = false; setShowScrollToLatest(true); setHasUnreadBelow(true) }
          return
        }
        const duringProgrammaticScroll = shouldStickToBottomRef.current && window.performance.now() < programmaticScrollUntilRef.current
        if (!duringProgrammaticScroll) {
          shouldStickToBottomRef.current = message.mine || shouldMarkIncomingRead || isNearConversationBottom()
        }

        if (event.event === 'created' && !message.mine && !message.parent_message_id && !shouldStickToBottomRef.current) {
          setHasUnreadBelow(true)
          setUnreadBoundaryId((current) => current ?? message.id)
        }

        setMessages((prev) => {
          if (event.event === 'deleted') return prev.filter((item) => item.id !== message.id)
          const matchingLocal = prev.find((item) => item.id === message.id || (
            message.client_message_id && item.client_message_id === message.client_message_id
          ))
          if (matchingLocal) {
            if (matchingLocal.id < 0) releaseOptimisticAttachmentUrls(matchingLocal.id)
            if (message.client_message_id && currentTarget) removeStoredFailure(currentTarget, message.client_message_id)
            return sortChronologicalMessages(prev.map((item) => item === matchingLocal ? mergeIncomingMessage(item, message) : item))
          }
          if (event.event !== 'created') return prev
          if (event.event === 'created' && currentTarget) {
            messageArrivalsRef.current = recordMessageArrival(messageArrivalsRef.current, targetKey(currentTarget), message.id)
          }
          return sortChronologicalMessages([...prev, message])
        })
        setPinnedMessages((prev) => {
          if (event.event === 'deleted') return prev.filter((item) => item.id !== message.id)
          return upsertPinnedMessage(prev, message)
        })

      }
    }, (status) => {
      setRealtimeStatus(status)
      if (status === 'connected') setRealtimeSubscriptionVersion((current) => current + 1)
    }).then((cleanup) => {
      if (active) {
        unsubscribe = cleanup
        realtimeSubscriptionRef.current = cleanup
      }
      else cleanup()
    })

    return () => {
      active = false
      const outbound = outboundTypingRef.current
      if (outbound?.active) {
        unsubscribe?.perform('typing', {
          target_type: outbound.target.type,
          target_id: outbound.target.id,
          thread_root_id: outbound.threadRootId,
          active: false,
        })
      }
      outboundTypingRef.current = null
      if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current)
      typingStopTimerRef.current = null
      realtimeSubscriptionRef.current = null
      unsubscribe?.()
      typingExpiryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
      typingExpiryTimersRef.current.clear()
    }
  }, [user?.id])

  /**
   * Typing presence from the composer, without page state: an "active" ping at
   * most every 2 seconds while there's text, "inactive" 4 seconds after the
   * last keystroke, when the text is cleared or sent, or on leaving.
   */
  const reportComposerTyping = useCallback((hasContent: boolean) => {
    const subscription = realtimeSubscriptionRef.current
    const target = selectedTargetRef.current
    const threadRootId = activeThreadRootIdRef.current
    const previous = outboundTypingRef.current
    const sameDestination = Boolean(previous && target
      && previous.target.type === target.type
      && previous.target.id === target.id
      && previous.threadRootId === threadRootId)

    const send = (outboundTarget: Target, outboundThreadRootId: number | null, active: boolean) => subscription?.perform('typing', {
      target_type: outboundTarget.type,
      target_id: outboundTarget.id,
      thread_root_id: outboundThreadRootId,
      active,
    }) ?? false

    if (previous?.active && (!sameDestination || !hasContent)) {
      send(previous.target, previous.threadRootId, false)
      outboundTypingRef.current = null
    }

    if (typingStopTimerRef.current) window.clearTimeout(typingStopTimerRef.current)
    typingStopTimerRef.current = null
    if (!subscription || !target || !hasContent) return

    const now = Date.now()
    if (!sameDestination || !previous?.active || now - previous.lastSentAt >= 2_000) {
      if (send(target, threadRootId, true)) {
        outboundTypingRef.current = { target, threadRootId, active: true, lastSentAt: now }
      }
    }

    typingStopTimerRef.current = window.setTimeout(() => {
      const latest = outboundTypingRef.current
      if (latest?.active) send(latest.target, latest.threadRootId, false)
      outboundTypingRef.current = null
      typingStopTimerRef.current = null
    }, 4_000)
  }, [])

  useEffect(() => {
    typingExpiryTimersRef.current.forEach((timer) => window.clearTimeout(timer))
    typingExpiryTimersRef.current.clear()
    setTypingUsers([])
  }, [activeThreadRootId, selectedTarget?.id, selectedTarget?.type])

  useEffect(() => {
    if (activeThreadRootId && !messagesById.has(activeThreadRootId)) {
      setActiveThreadRootId(null)
    }
  }, [activeThreadRootId, messagesById])

  useEffect(() => {
    if (!activeThreadRootId || !selectedTarget) { threadLoadedRef.current = ''; return }
    const key = `${targetKey(selectedTarget)}:${activeThreadRootId}`
    if (threadLoadedRef.current === key) return
    threadLoadedRef.current = key
    threadFollowRef.current = true
    const requestId = targetRequestRef.current
    let cancelled = false
    void api.getMessageThread(activeThreadRootId, { message_limit: 80 }).then((result) => {
      if (cancelled || requestId !== targetRequestRef.current || threadLoadedRef.current !== key) return
      if (!result.data) { toast.error('This thread is no longer available.'); return }
      const data = result.data
      setMessages((current) => sortChronologicalMessages([...current.filter((message) => message.id !== data.root_message.id && message.parent_message_id !== data.root_message.id), data.root_message, ...data.replies]))
      setThreadWindowMeta(data.meta)
    })
    return () => { cancelled = true }
  }, [activeThreadRootId, selectedTarget?.type, selectedTarget?.id])

  const loadThreadPage = async (direction: 'older' | 'newer' | 'latest') => {
    if (!activeThreadRootId || !selectedTarget || loadingThreadPage || !threadWindowMeta) return
    const rootId = activeThreadRootId
    const key = `${targetKey(selectedTarget)}:${rootId}`
    const requestId = targetRequestRef.current
    const pane = isDesktop ? threadScrollRef.current : messageScrollRef.current
    const previousHeight = pane?.scrollHeight || 0
    const previousTop = pane?.scrollTop || 0
    const options = direction === 'latest' ? {} : direction === 'older' ? { before_message_id: threadWindowMeta.oldest_message_id! } : { after_message_id: threadWindowMeta.newest_message_id! }
    heldAnchorRef.current = null
    threadFollowRef.current = false
    setLoadingThreadPage(true)
    try {
      const result = await api.getMessageThread(rootId, { ...options, message_limit: 80 })
      if (requestId !== targetRequestRef.current || threadLoadedRef.current !== key) return
      if (!result.data) { toast.error('Could not load replies. Try again.'); return }
      const data = result.data
      data.replies.forEach((reply) => queuedMessagesRef.current.delete(reply.id))
      if (direction === 'latest') {
        // The response is a snapshot: Cable may already know about newer replies.
        for (const [id, parent] of queuedMessagesRef.current) {
          if (parent === rootId && data.meta.newest_message_id !== null && id <= data.meta.newest_message_id) queuedMessagesRef.current.delete(id)
        }
        threadFollowRef.current = !data.meta.has_newer && ![...queuedMessagesRef.current.values()].some((parent) => parent === rootId)
        readerInteractedRef.current = true
      }
      setQueuedMessagesVersion((version) => version + 1)
      setMessages((current) => sortChronologicalMessages([...new Map([...(direction === 'latest' ? current.filter((message) => message.parent_message_id !== rootId) : current), ...data.replies].map((message) => [message.id, message])).values()]))
      setThreadWindowMeta((current) => direction === 'latest' || !current ? data.meta : direction === 'older'
        ? { ...current, oldest_message_id: data.meta.oldest_message_id, has_older: data.meta.has_older }
        : { ...current, newest_message_id: data.meta.newest_message_id, has_newer: data.meta.has_newer })
      if (pane) requestAnimationFrame(() => { pane.scrollTop = direction === 'latest' ? pane.scrollHeight : direction === 'older' ? previousTop + pane.scrollHeight - previousHeight : previousTop })
    } finally { setLoadingThreadPage(false) }
  }
  const replyToMessage = (message: LocalMessage) => {
    const rootId = rootMessageIdFor(message, messagesById)
    if (conversationView === 'pins' && selectedTarget) {
      setConversationView('messages')
      void loadTarget(selectedTarget, { aroundMessageId: message.id, threadRootId: rootId, highlightedMessageId: message.id })
    } else {
      setActiveThreadRootId(rootId)
    }
    if (!isDesktop) setMobilePane('thread')
  }

  const renderThreadPaging = (direction: 'older' | 'newer') => threadWindowMeta?.[direction === 'older' ? 'has_older' : 'has_newer'] ? <div className="flex justify-center py-3"><Button variant="secondary" disabled={loadingThreadPage} onClick={() => void loadThreadPage(direction)}>Load {direction === 'older' ? 'earlier' : 'newer'} replies</Button></div> : null

  const renderThreadLatest = () => threadWindowMeta?.has_newer || queuedThreadCount ? <div className="flex justify-center py-3"><Button variant="secondary" disabled={loadingThreadPage} onClick={() => void loadThreadPage('latest')}>{queuedThreadCount ? `New replies (${queuedThreadCount})` : 'Jump to latest reply'}</Button></div> : null

  useEffect(() => {
    if (mobileActionsMessageId && !actionableMessagesById.has(mobileActionsMessageId)) {
      setMobileActionsMessageId(null)
    }
  }, [actionableMessagesById, mobileActionsMessageId])

  useEffect(() => {
    setConversationView('messages')
  }, [selectedTarget?.type, selectedTarget?.id])

  useEffect(() => {
    if (isDesktop) return
    if (activeThreadRootId) setMobilePane('thread')
    else setMobilePane(channelId || dmId ? 'conversation' : 'list')
  }, [activeThreadRootId, isDesktop, channelId, dmId])

  useEffect(() => {
    if (!lightboxAttachment) return

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setLightboxAttachments([])
        setLightboxIndex(0)
        return
      }
      if (event.key === 'ArrowRight') {
        setLightboxIndex((current) => Math.min(current + 1, lightboxAttachments.length - 1))
        return
      }
      if (event.key === 'ArrowLeft') {
        setLightboxIndex((current) => Math.max(current - 1, 0))
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightboxAttachment, lightboxAttachments.length])

  useLayoutEffect(() => {
    const element = messageScrollRef.current
    if (!element || !selectedTarget || loadingTarget || conversationView !== 'messages') return

    const currentTargetKey = targetKey(selectedTarget)
    const targetChanged = lastAutoScrollTargetKeyRef.current !== currentTargetKey
    lastAutoScrollTargetKeyRef.current = currentTargetKey

    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (initialScrollPendingRef.current || shouldStickToBottomRef.current) {
          const behavior = initialScrollPendingRef.current || targetChanged ? 'auto' : 'smooth'
          initialScrollPendingRef.current = false
          shouldStickToBottomRef.current = true
          if (programmaticScrollTimerRef.current) window.clearTimeout(programmaticScrollTimerRef.current)
          programmaticScrollUntilRef.current = window.performance.now() + (behavior === 'smooth' ? 600 : 80)
          element.scrollTo({ top: element.scrollHeight, behavior })
          setShowScrollToLatest(false)
          markDisplayedLatest()
          programmaticScrollTimerRef.current = window.setTimeout(() => {
            programmaticScrollUntilRef.current = 0
            programmaticScrollTimerRef.current = null
          }, behavior === 'smooth' ? 650 : 100)
        }
      })

    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      if (secondFrame !== null) window.cancelAnimationFrame(secondFrame)
    }
  }, [conversationView, loading, loadingTarget, messages.length, selectedTarget?.type, selectedTarget?.id, user?.id])

  useEffect(() => {
    if (!highlightedMessageId || loading || loadingTarget) return

    const frame = window.requestAnimationFrame(() => {
      const pane = activeThreadRootId && isDesktop ? threadScrollRef.current : messageScrollRef.current
      const element = pane?.querySelector<HTMLElement>(`#message-${highlightedMessageId}`)
      if (!element) return
      positionMessageAnchor(pane!, element, heldAnchorOffsetRef.current)
      // Only the displayed anchor can advance the cursor, never newer feed items.
      const target = selectedTargetRef.current
      if (target && !authorContextRef.current && document.visibilityState === 'visible') void markRead(target, highlightedMessageId).catch(() => {})
    })
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 2600)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [highlightedMessageId, activeThreadRootId, mobilePane, loading, loadingTarget])

  useLayoutEffect(() => {
    if (loadingTarget || conversationView !== 'messages') return
    const panes = [messageScrollRef.current, threadScrollRef.current].filter((pane): pane is HTMLDivElement => Boolean(pane))
    const maintain = (pane: HTMLDivElement) => {
      const isThread = pane === threadScrollRef.current || (!isDesktop && Boolean(activeThreadRootId))
      const anchor = heldAnchorRef.current && pane.querySelector<HTMLElement>(`#message-${heldAnchorRef.current}`)
      if (anchor) { positionMessageAnchor(pane, anchor, heldAnchorOffsetRef.current); return }
      if (isThread ? threadFollowRef.current && !threadWindowMetaRef.current?.has_newer : shouldStickToBottomRef.current && !conversationWindowMetaRef.current?.has_newer) pane.scrollTop = pane.scrollHeight
    }
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => panes.forEach(maintain))
    panes.forEach((pane) => {
      observer?.observe(pane)
      Array.from(pane.children).forEach((child) => observer?.observe(child))
      maintain(pane)
    })
    return () => observer?.disconnect()
  }, [loadingTarget, conversationView, messages, activeThreadRootId, isDesktop, mobilePane])


  const updateLatestForTarget = (message: ChannelMessage, markRead = false) => {
    const unreadDelta = message.mine || markRead ? 0 : 1
    if (message.channel_id) {
      setChannels((prev) => prev.map((channel) => channel.id === message.channel_id ? {
        ...channel,
        unread_count: markRead ? 0 : channel.unread_count + unreadDelta,
        last_read_at: markRead ? message.created_at : channel.last_read_at,
        last_read_message_id: markRead ? message.id : channel.last_read_message_id,
        latest_message: latestMessageFrom(message),
      } : channel))
    }
    if (message.direct_conversation_id) {
      setDirectConversations((prev) => prev.map((conversation) => conversation.id === message.direct_conversation_id ? {
        ...conversation,
        unread_count: markRead ? 0 : conversation.unread_count + unreadDelta,
        last_read_at: markRead ? message.created_at : conversation.last_read_at,
        last_read_message_id: markRead ? message.id : conversation.last_read_message_id,
        latest_message: latestMessageFrom(message),
      } : conversation))
    }
  }

  const updateTargetSummaryFromEvent = (event: ChannelMessageEvent, message: ChannelMessage, markRead = false) => {
    if (event.channel_id || event.channel) summaryFreshness.recordRealtime('channel', event.channel?.id || event.channel_id!)
    if (event.direct_conversation_id || event.direct_conversation) summaryFreshness.recordRealtime('dm', event.direct_conversation?.id || event.direct_conversation_id!)
    if (event.channel) {
      setChannels((prev) => {
        const next = markRead ? { ...event.channel!, unread_count: 0, last_read_at: message.created_at, last_read_message_id: message.id } : event.channel!
        return prev.some((channel) => channel.id === next.id)
          ? prev.map((channel) => channel.id === next.id ? next : channel)
          : [...prev, next].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name))
      })
      return
    }

    if (event.direct_conversation) {
      setDirectConversations((prev) => {
        const next = markRead ? { ...event.direct_conversation!, unread_count: 0, last_read_at: message.created_at, last_read_message_id: message.id } : event.direct_conversation!
        return prev.some((conversation) => conversation.id === next.id)
          ? prev.map((conversation) => conversation.id === next.id ? next : conversation)
          : [next, ...prev]
      })
      return
    }

    if (event.event !== 'deleted') {
      updateLatestForTarget(message, markRead)
    }
  }

  const markRead = async (target: Target, messageId: number) => {
    const started = summaryFreshness.startRequest()
    const message = messagesById.get(messageId)
    const key = targetKey(target)
    const previous = readCursorRef.current.get(key)
    if (message && previous && (message.created_at < previous.created_at || (message.created_at === previous.created_at && message.id <= previous.id))) return
    if (message) readCursorRef.current.set(key, message)
    if (target.type === 'channel') {
      const res = await api.markChannelRead(target.id, messageId)
      if (res.error && readCursorRef.current.get(key) === message) { if (previous) readCursorRef.current.set(key, previous); else readCursorRef.current.delete(key) }
      summaryFreshness.completeRequest(started)
      if (res.data?.channel) {
        // A read response is the newest truth for this conversation: decide now, then mark it fresh so an
        // older in-flight list refresh cannot revive the unread count it just cleared.
        const summary = res.data.channel
        const keepLocal = summaryFreshness.hasRealtimeAfter('channel', target.id, started)
        summaryFreshness.recordRealtime('channel', target.id)
        if (!keepLocal) setChannels((prev) => prev.map((channel) => channel.id === target.id ? summary : channel))
      }
    } else {
      const res = await api.markDirectConversationRead(target.id, messageId)
      if (res.error && readCursorRef.current.get(key) === message) { if (previous) readCursorRef.current.set(key, previous); else readCursorRef.current.delete(key) }
      summaryFreshness.completeRequest(started)
      if (res.data?.direct_conversation) {
        const summary = res.data.direct_conversation
        const keepLocal = summaryFreshness.hasRealtimeAfter('dm', target.id, started)
        summaryFreshness.recordRealtime('dm', target.id)
        if (!keepLocal) setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? summary : conversation))
      }
    }
  }

  const markWorkspaceRead = async (workspaceId: number) => {
    const workspaceChannels = channels.filter((channel) => channel.workspace_id === workspaceId && channel.unread_count > 0)
    const workspaceDms = directConversations.filter((conversation) => conversation.workspace_id === workspaceId && conversation.unread_count > 0)
    if (workspaceChannels.length === 0 && workspaceDms.length === 0) return

    const started = summaryFreshness.startRequest()
    const [channelResults, dmResults] = await Promise.all([
      Promise.all(workspaceChannels.map((channel) => api.markChannelRead(channel.id))),
      Promise.all(workspaceDms.map((conversation) => api.markDirectConversationRead(conversation.id))),
    ])
    const readChannels = new Map(channelResults.flatMap((result) => result.data?.channel ? [[result.data.channel.id, result.data.channel] as const] : []))
    const readDms = new Map(dmResults.flatMap((result) => result.data?.direct_conversation ? [[result.data.direct_conversation.id, result.data.direct_conversation] as const] : []))
    setChannels((prev) => prev.map((channel) => readChannels.has(channel.id) ? summaryFreshness.reconcile('channel', channel, readChannels.get(channel.id)!, started) : channel))
    setDirectConversations((prev) => prev.map((conversation) => readDms.has(conversation.id) ? summaryFreshness.reconcile('dm', conversation, readDms.get(conversation.id)!, started) : conversation))
    summaryFreshness.completeRequest(started)
    if ([...channelResults, ...dmResults].some((result) => result.error)) toast.error('Some conversations could not be marked read.')
    else toast.success('Workspace marked read')
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'smooth') => {
    shouldStickToBottomRef.current = true
    setShowScrollToLatest(false)
    if (programmaticScrollTimerRef.current) {
      window.clearTimeout(programmaticScrollTimerRef.current)
    }

    programmaticScrollUntilRef.current = window.performance.now() + (behavior === 'smooth' ? 600 : 80)
    const element = messageScrollRef.current
    element?.scrollTo({ top: element.scrollHeight, behavior })
    programmaticScrollTimerRef.current = window.setTimeout(() => {
      programmaticScrollUntilRef.current = 0
      programmaticScrollTimerRef.current = null
      if (element && selectedTargetRef.current) {
        saveConversationScroll(user?.id, selectedTargetRef.current, element)
      }
    }, behavior === 'smooth' ? 650 : 100)
  }

  const scrollToLatestMessage = async () => {
    // This action targets the main feed, including when the thread root is
    // still present in the latest response on a phone's shared scroll pane.
    setActiveThreadRootId(null)
    if (selectedTarget && (messageWindowMeta?.has_newer || queuedConversationCount)) {
      conversationViewsRef.current.delete(targetKey(selectedTarget))
      await loadTarget(selectedTarget)
    }
    setHasUnreadBelow(false)
    scrollToBottom('smooth')
  }

  const isNearConversationBottom = () => {
    const element = messageScrollRef.current
    if (!element) return true

    return element.scrollHeight - element.scrollTop - element.clientHeight < 96
  }

  const markDisplayedLatest = () => {
    const target = selectedTargetRef.current
    const latest = rootMessages.filter((message) => message.id > 0).at(-1)
    if (!target || !latest || !canAutoMarkRead() || messageWindowMeta?.has_newer) return
    const row = document.getElementById(`message-${latest.id}`)
    const pane = messageScrollRef.current
    if (!row || !pane) return
    const bounds = row.getBoundingClientRect()
    const viewport = pane.getBoundingClientRect()
    if (bounds.top < viewport.bottom && bounds.bottom > viewport.top) void markRead(target, latest.id).catch(() => {})
  }

  const beginReadingScroll = () => {
    heldAnchorRef.current = null
    readerInteractedRef.current = true
    initialScrollPendingRef.current = false
    programmaticScrollUntilRef.current = 0
    shouldStickToBottomRef.current = false
    threadFollowRef.current = false
  }
  const markDisplayedRows = (pane: HTMLDivElement | null, items: LocalMessage[]) => {
    const target = selectedTargetRef.current
    if (authorContextRef.current || !pane || !target || !readerInteractedRef.current || document.visibilityState !== 'visible' || lightboxAttachment || reactionDetails) return
    const viewport = pane.getBoundingClientRect()
    const displayed = items.filter((message) => {
      if (message.id <= 0) return false
      const bounds = pane.querySelector(`#message-${message.id}`)?.getBoundingClientRect()
      return bounds && bounds.top < viewport.bottom && bounds.bottom > viewport.top
    })
    const newest = sortChronologicalMessages(displayed).at(-1)
    if (newest) void markRead(target, newest.id).catch(() => {})
  }
  const handleThreadScroll = () => {
    const pane = threadScrollRef.current
    if (!pane || !readerInteractedRef.current) return
    threadFollowRef.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 96 && !threadWindowMeta?.has_newer
    markDisplayedRows(pane, activeThreadMessages)
  }

  const handleConversationScroll = () => {
    if (initialScrollPendingRef.current) return
    if (!isDesktop && activeThreadRoot) {
      if (readerInteractedRef.current && messageScrollRef.current) {
        threadFollowRef.current = isNearConversationBottom() && !threadWindowMeta?.has_newer
        markDisplayedRows(messageScrollRef.current, activeThreadMessages)
      }
      return
    }
    markDisplayedRows(messageScrollRef.current, rootMessages)
    const nearBottom = isNearConversationBottom()
    const duringProgrammaticScroll = shouldStickToBottomRef.current && window.performance.now() < programmaticScrollUntilRef.current
    if (duringProgrammaticScroll && !nearBottom) return

    setShowScrollToLatest(!nearBottom)

    const element = messageScrollRef.current
    const currentTarget = selectedTargetRef.current
    if (element && currentTarget && scrollPersistFrameRef.current === null) {
      scrollPersistFrameRef.current = window.requestAnimationFrame(() => {
        saveConversationScroll(user?.id, currentTarget, element)
        scrollPersistFrameRef.current = null
      })
    }

    if (nearBottom) {
      shouldStickToBottomRef.current = true
      setHasUnreadBelow(false)
      markDisplayedLatest()
      return
    }

    shouldStickToBottomRef.current = false
  }

  const canAutoMarkRead = (ignoreScrollPosition = false) => {
    if (authorContextRef.current) return false
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
    if (!isDesktopRef.current && mobilePaneRef.current !== 'conversation') return false
    if (activeThreadRootIdRef.current) return false

    return ignoreScrollPosition || isNearConversationBottom()
  }

  const selectTarget = (target: Target, options: TargetLoadOptions = {}) => {
    setSourceContextHidden(true)
    setActiveThreadRootId(null)
    setEditing(null)
    setConversationView('messages')
    navigate(conversationPath(target, options.aroundMessageId))
  }

  const selectWorkspace = (id: number) => {
    preserveRoutedWorkspaceRef.current = false
    const workspace = workspaces.find((item) => item.id === id)
    if (workspace?.cohort_id) setSelectedCohort(workspace.cohort_id)
    startNavigationTransition(() => {
      setSelectedWorkspaceId(id)
      setChannelForm((prev) => ({ ...prev, workspace_id: String(id) }))
    })
    const workspaceTarget = initialMessageTarget(
      channels.filter((channel) => channel.workspace_id === id),
      directConversations.filter((conversation) => conversation.workspace_id === id),
    )
    if (workspaceTarget) selectTarget(workspaceTarget)
    else {
      navigate('/messages')
      startNavigationTransition(() => {
        setSelectedTarget(null)
        setUnreadBoundaryId(null)
        setMessages([])
        setPinnedMessages([])
        setActiveThreadRootId(null)
        setEditing(null)
        setConversationView('messages')
        if (!isDesktop) setMobilePane('list')
      })
    }
  }

  const showPreviousLightboxImage = () => {
    setLightboxIndex((current) => Math.max(current - 1, 0))
  }

  const showNextLightboxImage = () => {
    setLightboxIndex((current) => Math.min(current + 1, lightboxAttachments.length - 1))
  }

  const closeLightbox = () => {
    setLightboxAttachments([])
    setLightboxIndex(0)
  }

  const releaseOptimisticAttachmentUrls = (messageId: number) => {
    const urls = optimisticAttachmentUrls.current.get(messageId)
    if (!urls) return

    urls.forEach((url) => URL.revokeObjectURL(url))
    optimisticAttachmentUrls.current.delete(messageId)
  }

  const downloadLightboxAttachment = async () => {
    if (!lightboxAttachment?.url) return

    try {
      const response = await fetch(lightboxAttachment.url)
      const blob = await response.blob()
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = lightboxAttachment.filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch {
      window.open(lightboxAttachment.url, '_blank', 'noopener,noreferrer')
    }
  }

  const uploadAttachments = async (attachmentsToUpload = pendingAttachments, target = selectedTarget) => {
    if (!target) return []

    const uploaded = []
    for (const attachment of attachmentsToUpload) {
      if (attachment.uploaded && attachment.s3_key) {
        uploaded.push({
          s3_key: attachment.s3_key,
          filename: attachment.filename,
          content_type: attachment.content_type,
          byte_size: attachment.byte_size,
        })
        continue
      }

      const presign = await api.presignMessageAttachment({
        channel_id: target.type === 'channel' ? target.id : undefined,
        direct_conversation_id: target.type === 'dm' ? target.id : undefined,
        filename: attachment.filename,
        content_type: attachment.content_type,
      })
      if (!presign.data) throw new Error(presign.error || 'Could not prepare upload.')

      await uploadToS3(presign.data.upload_url, presign.data.fields, attachment.file, (progress) => {
        setPendingAttachments((prev) => prev.map((item) => item.file === attachment.file ? { ...item, progress: progress.percent } : item))
      })

      uploaded.push({
        s3_key: presign.data.s3_key,
        filename: attachment.filename,
        content_type: attachment.content_type,
        byte_size: attachment.byte_size,
      })
    }
    return uploaded
  }

  /** Sends what the composer wrote. Returns false when nothing was sent, so the composer keeps the text. */
  const sendComposerMessage = ({ body: submittedBody, mentionUserIds }: MessageComposerSend) => {
    if (!selectedTarget || !user || sending) return false
    const submittedAttachments = pendingAttachments
    if (!submittedBody && submittedAttachments.length === 0) return false
    if (messageCharacterCount(submittedBody) > MESSAGE_BODY_LIMIT) return false
    void deliverComposerMessage(submittedBody, mentionUserIds, submittedAttachments)
    return true
  }

  /**
   * The record a staff member opened this conversation from (a submission or
   * help request), attached to the first top-level message they send here so
   * the learner sees what it's about (L-1.8). Once per conversation and record.
   */
  const messageSourceFor = (target: Target, threadRoot: LocalMessage | null, clientMessageId: string): StoredMessageSource | null => {
    if (target.type !== 'dm' || threadRoot || !sourceRecord) return null
    const key = `${targetKey(target)}:${sourceRecord.type}:${sourceRecord.id}`
    if (sentSourceKeysRef.current.has(key) || pendingSourceKeysRef.current.has(key) || messages.some((message) => message.source?.type === sourceRecord.type && message.source.id === sourceRecord.id)) return null
    pendingSourceKeysRef.current.set(key, clientMessageId)
    return { type: sourceRecord.type, id: sourceRecord.id, title: sourceRecord.label }
  }

  /** A send carrying a source succeeded: the context has gone out for good. */
  const confirmSourceReservation = (clientMessageId: string) => {
    for (const [key, owner] of pendingSourceKeysRef.current) {
      if (owner !== clientMessageId) continue
      pendingSourceKeysRef.current.delete(key)
      sentSourceKeysRef.current.add(key)
    }
  }

  /** A failed send was dropped, so the next message carries the context instead. */
  const releaseSourceReservation = (clientMessageId: string) => {
    for (const [key, owner] of pendingSourceKeysRef.current) {
      if (owner === clientMessageId) pendingSourceKeysRef.current.delete(key)
    }
  }

  const deliverComposerMessage = async (submittedBody: string, mentionUserIds: number[], submittedAttachments: PendingAttachment[]) => {
    if (!selectedTarget || !user) return
    const submittedTarget = selectedTarget
    const submittedDraftKey = composerDraftKey
    const threadRoot = activeThreadRoot
    const clientMessageId = createClientMessageId()
    const source = messageSourceFor(submittedTarget, threadRoot, clientMessageId)
    const retrySource = source ?? undefined

    tempMessageIdRef.current -= 1
    const tempId = tempMessageIdRef.current
    const optimisticUrls: string[] = []
    const optimisticAttachments = submittedAttachments.map((attachment, index) => {
      const url = URL.createObjectURL(attachment.file)
      optimisticUrls.push(url)

      return {
        id: tempId - index - 1,
        filename: attachment.filename,
        content_type: attachment.content_type,
        byte_size: attachment.byte_size,
        image: attachment.content_type.startsWith('image/'),
        url,
      }
    })
    if (optimisticUrls.length > 0) optimisticAttachmentUrls.current.set(tempId, optimisticUrls)
    const optimisticMessage: LocalMessage = {
      id: tempId,
      channel_id: selectedTarget.type === 'channel' ? selectedTarget.id : null,
      direct_conversation_id: selectedTarget.type === 'dm' ? selectedTarget.id : null,
      parent_message_id: threadRoot?.id || null,
      client_message_id: clientMessageId,
      body: submittedBody,
      mention_user_ids: mentionUserIds,
      edited_at: null,
      deleted_at: null,
      pinned_at: null,
      pinned_by_id: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      mine: true,
      pending: true,
      attachments: optimisticAttachments,
      reactions: [],
      source: source ? optimisticSource(source) : null,
      author: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    }

    shouldStickToBottomRef.current = !isHistoricalWindow(optimisticMessage.parent_message_id)
    messageArrivalsRef.current = recordMessageArrival(messageArrivalsRef.current, targetKey(selectedTarget), tempId)
    setMessages((prev) => sortChronologicalMessages([...prev, optimisticMessage]))
    updateLatestForTarget(optimisticMessage)
    setPendingAttachments([])
    if (submittedDraftKey) pendingAttachmentBucketsRef.current.delete(submittedDraftKey)

    setSending(true)
    setError('')
    let uploadedAttachments: UploadedMessageAttachment[] = []
    try {
      uploadedAttachments = await uploadAttachments(submittedAttachments, submittedTarget)
      const payload = {
        body: submittedBody,
        parent_message_id: optimisticMessage.parent_message_id,
        client_message_id: clientMessageId,
        mention_user_ids: mentionUserIds,
        attachments: uploadedAttachments,
        send_push: true,
      }
      const res = submittedTarget.type === 'channel'
        ? await api.createMessage(submittedTarget.id, payload)
        : await api.createDirectMessage(submittedTarget.id, retrySource ? { ...payload, source_type: retrySource.type, source_id: retrySource.id } : payload)

      if (!res.data) {
        const failureError = res.error || 'Could not send message.'
        setError(failureError)
        toast.error(failureError)
        const retrySend: RetrySend = { clientMessageId, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, pendingAttachments: submittedAttachments, uploadedAttachments, source: retrySource }
        saveStoredFailure(submittedTarget, { version: 1, clientMessageId, target: submittedTarget, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, attachments: uploadedAttachments, attachmentCount: submittedAttachments.length, createdAt: optimisticMessage.created_at, error: failureError, ...(retrySource ? { source: retrySource } : {}) })
        if (targetMatches(selectedTargetRef.current, submittedTarget)) {
          setMessages((prev) => prev.map((item) => item.id === tempId ? { ...item, pending: false, failed: true, failureError, retrySend } : item))
        }
      } else {
        const message = res.data.message
        confirmSourceReservation(clientMessageId)
        removeStoredFailure(submittedTarget, clientMessageId)
        releaseOptimisticAttachmentUrls(tempId)
        if (targetMatches(selectedTargetRef.current, submittedTarget)) {
          const queued = queueHistoricalSend(message)
          setMessages((prev) => sortChronologicalMessages([...prev.filter((item) => item.id !== tempId && item.id !== message.id && item.client_message_id !== clientMessageId), ...(queued ? [] : [message])]))
        }
        updateLatestForTarget(message)
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Could not send message.'
      setError(message)
      toast.error(message)
      const retrySend: RetrySend = { clientMessageId, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, pendingAttachments: submittedAttachments, uploadedAttachments, source: retrySource }
      saveStoredFailure(submittedTarget, { version: 1, clientMessageId, target: submittedTarget, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, attachments: uploadedAttachments, attachmentCount: submittedAttachments.length, createdAt: optimisticMessage.created_at, error: message, ...(retrySource ? { source: retrySource } : {}) })
      if (targetMatches(selectedTargetRef.current, submittedTarget)) {
        setMessages((prev) => prev.map((item) => item.id === tempId ? { ...item, pending: false, failed: true, failureError: message, retrySend } : item))
      }
    }
    setSending(false)
  }

  const retryFailedMessage = async (message: LocalMessage) => {
    if (!selectedTarget || !message.retrySend || sending) return
    const target = selectedTarget
    const retry = message.retrySend
    setSending(true)
    setError('')
    setMessages((current) => current.map((item) => item.id === message.id ? { ...item, pending: true, failed: false } : item))
    let retryAttachments = retry.uploadedAttachments

    try {
      retryAttachments = retry.uploadedAttachments.length > 0
        ? retry.uploadedAttachments
        : await uploadAttachments(retry.pendingAttachments, target)
      const payload = {
        body: retry.body,
        parent_message_id: retry.parentMessageId,
        client_message_id: retry.clientMessageId,
        mention_user_ids: retry.mentionUserIds,
        attachments: retryAttachments,
        send_push: true,
      }
      const res = target.type === 'channel'
        ? await api.createMessage(target.id, payload)
        : await api.createDirectMessage(target.id, retry.source ? { ...payload, source_type: retry.source.type, source_id: retry.source.id } : payload)

      if (!res.data) throw new Error(res.error || 'Could not send message.')

      confirmSourceReservation(retry.clientMessageId)
      removeStoredFailure(target, retry.clientMessageId)
      releaseOptimisticAttachmentUrls(message.id)
      if (targetMatches(selectedTargetRef.current, target)) {
        const queued = queueHistoricalSend(res.data.message)
        setMessages((current) => sortChronologicalMessages([
          ...current.filter((item) => item.id !== message.id && item.id !== res.data!.message.id && item.client_message_id !== retry.clientMessageId),
          ...(queued ? [] : [res.data!.message]),
        ]))
      }
      updateLatestForTarget(res.data.message)
    } catch (retryError) {
      const failureError = retryError instanceof Error ? retryError.message : 'Could not send message.'
      saveStoredFailure(target, {
        version: 1,
        clientMessageId: retry.clientMessageId,
        target,
        body: retry.body,
        parentMessageId: retry.parentMessageId,
        mentionUserIds: retry.mentionUserIds,
        attachments: retryAttachments,
        attachmentCount: Math.max(retry.pendingAttachments.length, retryAttachments.length),
        createdAt: message.created_at,
        error: failureError,
        ...(retry.source ? { source: retry.source } : {}),
      })
      if (targetMatches(selectedTargetRef.current, target)) {
        setMessages((current) => current.map((item) => item.id === message.id ? {
          ...item,
          pending: false,
          failed: true,
          failureError,
          retrySend: { ...retry, uploadedAttachments: retryAttachments },
        } : item))
      }
      setError(failureError)
      toast.error(failureError)
    } finally {
      setSending(false)
    }
  }

  const discardFailedMessage = (message: LocalMessage) => {
    if (!selectedTarget || !message.client_message_id) return
    removeStoredFailure(selectedTarget, message.client_message_id)
    releaseSourceReservation(message.client_message_id)
    releaseOptimisticAttachmentUrls(message.id)
    setMessages((current) => current.filter((item) => item.id !== message.id))
  }

  const restoreFailedMessageText = (message: LocalMessage) => {
    const insert = () => {
      if (message.body) composerRef.current?.insertMarkdown(message.body)
      discardFailedMessage(message)
      if (!message.body) fileInputRef.current?.click()
    }

    if (message.parent_message_id && activeThreadRootId !== message.parent_message_id) {
      setActiveThreadRootId(message.parent_message_id)
      window.requestAnimationFrame(insert)
    } else {
      insert()
    }
  }

  const handleCreateChannel = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!channelForm.workspace_id || !channelForm.name.trim()) return
    if (!isStaff || (!isAdmin && !workspaces.some((workspace) => workspace.id === Number(channelForm.workspace_id) && workspace.workspace_type === 'cohort'))) return

    setCreatingChannel(true)
    setChannelError('')
    const res = await api.createChannel({
      workspace_id: Number(channelForm.workspace_id),
      name: channelForm.name.trim(),
      description: channelForm.description.trim() || undefined,
      visibility: channelForm.visibility,
    })

    if (res.error) {
      setChannelError(res.error)
      toast.error(res.error)
    } else if (res.data) {
      setChannelForm((prev) => ({ ...prev, name: '', description: '' }))
      setShowChannelForm(false)
      await loadLists()
      selectTarget({ type: 'channel', id: res.data.channel.id })
      toast.success(`Created channel #${res.data.channel.name}`)
    }
    setCreatingChannel(false)
  }

  const handleCreateWorkspace = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!workspaceForm.name.trim()) return

    setCreatingWorkspace(true)
    setWorkspaceError('')
    const res = await api.createWorkspace({
      name: workspaceForm.name.trim(),
      description: workspaceForm.description.trim() || undefined,
    })

    if (res.error) {
      setWorkspaceError(res.error)
      toast.error(res.error)
    } else if (res.data) {
      setWorkspaceForm({ name: '', description: '' })
      setShowWorkspaceForm(false)
      await loadLists()
      setWorkspaceDetail(res.data.workspace)
      selectWorkspace(res.data.workspace.id)
      setShowWorkspaceMembers(true)
      toast.success(`Created workspace "${res.data.workspace.name}"`)
    }
    setCreatingWorkspace(false)
  }

  const handleAddWorkspaceMember = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!workspaceDetail || !memberToAddId) return

    setWorkspaceError('')
    const res = await api.addWorkspaceMembers(workspaceDetail.id, [Number(memberToAddId)])
    if (res.error) {
      setWorkspaceError(res.error)
      toast.error(res.error)
      return
    }

    if (res.data) {
      setWorkspaceDetail(res.data.workspace)
      setWorkspaces((prev) => prev.map((workspace) => workspace.id === res.data!.workspace.id ? {
        ...workspace,
        member_count: res.data!.workspace.member_count,
      } : workspace))
      setMemberToAddId('')
      toast.success('Workspace member added')
    }
  }

  const handleRemoveWorkspaceMember = async (userId: number) => {
    if (!workspaceDetail) return

    setWorkspaceError('')
    const res = await api.removeWorkspaceMember(workspaceDetail.id, userId)
    if (res.error) {
      setWorkspaceError(res.error)
      toast.error(res.error)
      return
    }

    if (res.data) {
      setWorkspaceDetail(res.data.workspace)
      setWorkspaces((prev) => prev.map((workspace) => workspace.id === res.data!.workspace.id ? {
        ...workspace,
        member_count: res.data!.workspace.member_count,
      } : workspace))
      toast.success('Workspace member removed')
    }
  }

  const handleCreateDm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedWorkspaceId || !dmUserId) return

    const res = await api.createDirectConversation({ workspace_id: selectedWorkspaceId, user_ids: [Number(dmUserId)] })
    if (res.data) {
      await loadLists()
      setShowDmForm(false)
      selectTarget({ type: 'dm', id: res.data.direct_conversation.id })
    } else if (res.error) {
      toast.error(res.error)
    }
  }

  const handleTogglePush = async () => {
    setPushMessage('')
    if (pushEnabled) {
      try {
        await disablePushNotifications()
        setPushEnabled(false)
        setPushMessage('Browser alerts are off on your account. Message emails are unchanged.')
      } catch (toggleError) {
        setPushMessage(toggleError instanceof Error ? toggleError.message : 'Could not turn off notifications.')
      }
      return
    }

    if (!pushSupported()) {
      setPushMessage('Browser alerts are not supported on this device. You can still manage message emails from Profile.')
      return
    }

    const config = await api.getPushConfig()
    if (config.error) {
      setPushMessage(`Browser alerts could not be checked: ${config.error}`)
      return
    }

    const configured = Boolean(config.data?.configured)
    const publicKey = config.data?.public_key || import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
    if (!configured || !publicKey) {
      const hint = pushConfigurationHint({
        configured,
        missing: config.data?.missing || [],
        publicKey,
      })
      setPushMessage(hint)
      return
    }

    try {
      await enablePushNotifications(publicKey)
      setPushEnabled(true)
      setPushMessage('Browser alerts are on for this device. Message emails are managed separately in Profile.')
    } catch (toggleError) {
      const detail = toggleError instanceof Error ? toggleError.message : 'Browser push could not be enabled.'
      setPushMessage(detail)
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    addFiles(Array.from(files))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  function addFiles(files: File[]) {
    const next = files.map((file) => ({
      file,
      filename: file.name,
      content_type: file.type || 'application/octet-stream',
      byte_size: file.size,
      progress: 0,
      uploaded: false,
    }))
    setPendingAttachments((prev) => [...prev, ...next])
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    // Rich mode's editor already took the files (and prevented the default); don't add them twice.
    if (event.defaultPrevented) return
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return

    event.preventDefault()
    addFiles(files)
  }

  const saveEdit = async (message: ChannelMessage, editedBody: string) => {
    const normalizedBody = normalizeMessageMarkdown(editedBody)
    if (!normalizedBody || messageCharacterCount(normalizedBody) > MESSAGE_BODY_LIMIT) return

    const mentionUserIds = resolveMentionedUserIds(normalizedBody, mentionableUsers, message.mention_user_ids)
    const res = await api.updateMessage(message.id, { body: normalizedBody, mention_user_ids: mentionUserIds })
    if (res.data) {
      setMessages((prev) => prev.map((item) => item.id === message.id ? res.data!.message : item))
      setPinnedMessages((prev) => upsertPinnedMessage(prev, res.data!.message))
      setEditing(null)
      toast.success('Message updated')
    } else if (res.error) {
      setError(res.error)
      toast.error(res.error)
    }
  }

  const deleteMessage = async (message: ChannelMessage) => {
    const res = await api.deleteMessage(message.id)
    if (res.data) {
      releaseOptimisticAttachmentUrls(message.id)
      setMessages((prev) => prev.filter((item) => item.id !== message.id))
      setPinnedMessages((prev) => prev.filter((item) => item.id !== message.id))
      toast.success('Message deleted')
    }
    else if (res.error) {
      setError(res.error)
      toast.error(res.error)
    }
  }

  const copyMessage = async (message: ChannelMessage) => {
    if (!message.body) return

    try {
      await navigator.clipboard.writeText(message.body)
      toast.success('Message copied')
    } catch {
      toast.error('Could not copy message.')
    }
  }

  /** A link that opens this conversation scrolled to the message and highlights it (L-2.8). */
  const messageLink = (message: ChannelMessage) => {
    const target: Target | null = message.channel_id ? { type: 'channel', id: message.channel_id } : message.direct_conversation_id ? { type: 'dm', id: message.direct_conversation_id } : null
    return target && message.id > 0 ? `${window.location.origin}${conversationPath(target, message.id)}` : null
  }

  const copyMessageLink = async (message: ChannelMessage) => {
    const link = messageLink(message)
    if (!link) return
    if (await copyText(link)) toast.success('Link to message copied')
    else toast.error('Could not copy the link.')
  }

  const copyConversationLink = async () => {
    if (!selectedTarget) return
    if (await copyText(`${window.location.origin}${conversationPath(selectedTarget)}`)) toast.success('Link to conversation copied')
    else toast.error('Could not copy the link.')
  }

  const reportMessage = async (message: ChannelMessage) => {
    const res = await api.reportContent({ message_id: message.id, reason: 'inappropriate_content' })
    if (!res.data) return toast.error(res.error || 'Could not submit the report.')
    toast.success('Report received. Code School staff will review it.')
  }

  const reportUser = async (message: ChannelMessage) => {
    const res = await api.reportContent({ reported_user_id: message.author.id, reason: 'safety_concern' })
    if (!res.data) return toast.error(res.error || 'Could not submit the user report.')
    toast.success('User report received. Code School staff will review it.')
  }

  const blockMessageAuthor = async (message: ChannelMessage) => {
    const res = await api.blockUser(message.author.id)
    if (!res.data) return toast.error(res.error || 'Could not block this user.')
    const hideAuthor = (item: LocalMessage): LocalMessage => item.author.id === message.author.id
      ? { ...item, blocked: true, body: '', attachments: [], reactions: [] }
      : item
    setMessages((prev) => prev.map(hideAuthor))
    setPinnedMessages((prev) => prev.map(hideAuthor))
    toast.success(`${message.author.full_name} was blocked. You can unblock them from your profile.`)
  }

  useEffect(() => () => {
    if (programmaticScrollTimerRef.current) {
      window.clearTimeout(programmaticScrollTimerRef.current)
    }
    optimisticAttachmentUrls.current.forEach((urls) => urls.forEach((url) => URL.revokeObjectURL(url)))
    optimisticAttachmentUrls.current.clear()
  }, [])

  const togglePin = async (message: ChannelMessage) => {
    const res = message.pinned_at ? await api.unpinMessage(message.id) : await api.pinMessage(message.id)
    if (res.data) {
      setMessages((prev) => prev.map((item) => item.id === message.id ? res.data!.message : item))
      setPinnedMessages((prev) => upsertPinnedMessage(prev, res.data!.message))
    }
  }

  const toggleReaction = async (message: ChannelMessage, emoji: string) => {
    const existing = message.reactions.find((reaction) => reaction.emoji === emoji)
    const res = existing?.reacted ? await api.unreactMessage(message.id, emoji) : await api.reactMessage(message.id, emoji)
    if (res.data) {
      setMessages((prev) => prev.map((item) => item.id === message.id ? res.data!.message : item))
      setPinnedMessages((prev) => upsertPinnedMessage(prev, res.data!.message))
    }
  }

  const toggleMute = async () => {
    if (!selectedTarget) return

    const targetType = selectedTarget.type === 'channel' ? 'Channel' : 'DirectConversation'
    const res = await api.updateMessagePreference(targetType, selectedTarget.id, !selectedMuted)
    if (!res.data) return

    if (selectedTarget.type === 'channel') {
      setChannels((prev) => prev.map((channel) => channel.id === selectedTarget.id ? { ...channel, muted: !selectedMuted } : channel))
    } else {
      setDirectConversations((prev) => prev.map((conversation) => conversation.id === selectedTarget.id ? { ...conversation, muted: !selectedMuted } : conversation))
    }
  }
  return {
    navigate,
    toast,
    isStaff,
    isAdmin,
    workspaces,
    workspaceDetail,
    availableUsers,
    selectedWorkspaceId,
    selectedTarget,
    messageWindowMeta,
    loadingOlder,
    loadingNewer,
    loading,
    loadingTarget,
    sending,
    creatingChannel,
    creatingWorkspace,
    showChannelForm,
    setShowChannelForm,
    showDmForm,
    setShowDmForm,
    showWorkspaceForm,
    setShowWorkspaceForm,
    showWorkspaceSwitcher,
    setShowWorkspaceSwitcher,
    showWorkspaceMembers,
    setShowWorkspaceMembers,
    pushEnabled,
    pushMessage,
    hasUnreadBelow,
    unreadBoundaryId,
    showScrollToLatest,
    realtimeStatus,
    pendingAttachments,
    setPendingAttachments,
    lightboxAttachments,
    setLightboxAttachments,
    lightboxIndex,
    setLightboxIndex,
    setReactionDetails,
    sidebarCollapsed,
    setSidebarCollapsed,
    conversationView,
    setConversationView,
    activeThreadRootId,
    setActiveThreadRootId,
    isDesktop,
    mobilePane,
    setMobilePane,
    editing,
    setEditing,
    editingInThreadPanel,
    setEditingInThreadPanel,
    authorContext,
    setAuthorContext,
    showInboxSearch,
    setShowInboxSearch,
    setMobileActionsMessageId,
    actionsFromThreadPanelRef,
    messagePendingDelete,
    setMessagePendingDelete,
    editBody,
    setEditBody,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    highlightedMessageId,
    error,
    workspaceError,
    setWorkspaceError,
    channelError,
    setChannelError,
    dmUserId,
    setDmUserId,
    memberToAddId,
    setMemberToAddId,
    isNavigationPending,
    workspaceForm,
    setWorkspaceForm,
    channelForm,
    setChannelForm,
    messageScrollRef,
    threadScrollRef,
    queuedConversationCount,
    fileInputRef,
    composerRef,
    lightboxTouchStartX,
    messageArrivalsRef,
    selectedChannel,
    selectedDmStudent,
    sourceRecord,
    sourceRecordPath,
    conversationReturnContext,
    selected,
    selectedLabel,
    selectedMuted,
    messagesById,
    threadReplies,
    rootMessages,
    activeThreadRoot,
    mobileActionsMessage,
    typingLabel,
    reactionDetailsMessage,
    selectedReaction,
    activeThreadMessages,
    rootReadReceipts,
    threadReadReceipts,
    visibleChannels,
    recent,
    selectedWorkspace,
    canManageChannels,
    totalWorkspaceUnreadCount,
    workspaceSwitcherSubtitle,
    sortedWorkspaceCards,
    unreadOtherWorkspaceCards,
    selectedPinnedMessages,
    channelsUnreadCount,
    memberCandidates,
    mentionableUsers,
    mentionPatterns,
    lightboxAttachment,
    composerDraftKey,
    loadLists,
    loadOlderMessages,
    loadNewerMessages,
    reportComposerTyping,
    replyToMessage,
    renderThreadPaging,
    renderThreadLatest,
    markWorkspaceRead,
    scrollToLatestMessage,
    beginReadingScroll,
    handleThreadScroll,
    handleConversationScroll,
    selectTarget,
    selectWorkspace,
    showPreviousLightboxImage,
    showNextLightboxImage,
    closeLightbox,
    downloadLightboxAttachment,
    sendComposerMessage,
    retryFailedMessage,
    discardFailedMessage,
    restoreFailedMessageText,
    handleCreateChannel,
    handleCreateWorkspace,
    handleAddWorkspaceMember,
    handleRemoveWorkspaceMember,
    handleCreateDm,
    handleTogglePush,
    handleFiles,
    addFiles,
    handleDrop,
    saveEdit,
    deleteMessage,
    copyMessage,
    copyMessageLink,
    copyConversationLink,
    reportMessage,
    reportUser,
    blockMessageAuthor,
    togglePin,
    toggleReaction,
    toggleMute
  }
}
export type MessagesController = ReturnType<typeof useMessagesController>
