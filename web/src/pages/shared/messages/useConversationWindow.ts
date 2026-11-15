import { useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { api } from '../../../lib/api';
import { isVisiblePage } from '../../../lib/backgroundActivity';
import { firstUnreadMessageId, latestVisibleReadReceipts } from '../../../lib/messagingPresentation';
import { type ReturnContext } from '../../../lib/navigationContext';
import type { ChannelMessage, ChannelMessageEvent, ChannelSummary, DirectConversationSummary, MessageDestination, MessageWindowMeta, User } from '../../../types/api';
import { removeStoredFailure, storedFailureMessages } from './failedSends';
import { cacheConversationView, cachedWindowIsContiguous, conversationPath, createMessageArrivals, mergeIncomingMessage, mergeMessageWindow, messageBelongsToTarget, positionMessageAnchor, recordMessageArrival, restoreFailedSends, rootMessageIdFor, saveConversationScroll, sortChronologicalMessages, sortPinnedMessages, targetKey, targetMatches, upsertPinnedMessage, type MessageArrivals } from './helpers';
import type { ConversationViewSnapshot, LocalMessage, Target, TargetLoadOptions } from './types';
import type { ConversationState } from './useConversationState';
import type { MessagesRoute } from './useMessagesRoute';
import type { WorkspaceDirectory } from './useWorkspaceDirectory';

type Toast = { error: (message: string) => void }

type WindowInputs = {
  user: User | null
  toast: Toast
  route: Pick<MessagesRoute, 'channelId' | 'dmId' | 'locationSearch' | 'routedMessageId' | 'routedThreadId' | 'routedAnchorOffset' | 'routedDestinationKey'>
  conversation: ConversationState
  directory: Pick<WorkspaceDirectory, 'loading' | 'summaryFreshness' | 'setChannels' | 'setDirectConversations' | 'updateTargetSummaryFromEvent'>
  /** The author context sheet is open: reading there doesn't advance read cursors. */
  authorContextRef: RefObject<ChannelMessage['author'] | null>
  /** A lightbox or reaction sheet covers the feed, so rows scrolled behind it aren't read. */
  readingPaused: boolean
  releaseOptimisticAttachmentUrls: (messageId: number) => void
}

/**
 * The open conversation's message window: loading it (from the route, a cached
 * view or around a linked message), paging older/newer and thread replies,
 * applying realtime events, scroll anchoring and read cursors.
 */
export function useConversationWindow({ user, toast, route, conversation, directory, authorContextRef, readingPaused, releaseOptimisticAttachmentUrls }: WindowInputs) {
  const { channelId, dmId, locationSearch, routedMessageId, routedThreadId, routedAnchorOffset, routedDestinationKey } = route
  const {
    selectedTarget,
    setSelectedTarget,
    selectedTargetRef,
    selectedConversationKey,
    messages,
    setMessages,
    pinnedMessages,
    setPinnedMessages,
    setUnreadBoundaryId,
    conversationView,
    setConversationView,
    activeThreadRootId,
    setActiveThreadRootId,
    activeThreadRootIdRef,
    isDesktop,
    isDesktopRef,
    mobilePane,
    setMobilePane,
    mobilePaneRef,
    setEditing,
    tempMessageIdRef,
    messagesById,
    rootMessages,
    activeThreadRoot,
    activeThreadMessages,
  } = conversation
  const { loading, summaryFreshness, setChannels, setDirectConversations, updateTargetSummaryFromEvent } = directory
  const [messageWindowMeta, setMessageWindowMeta] = useState<MessageWindowMeta | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [loadingTarget, setLoadingTarget] = useState(false)
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null)
  const openingReadStateRef = useRef<{ key: string; summary: ChannelSummary | DirectConversationSummary } | null>(null)
  const messageScrollRef = useRef<HTMLDivElement | null>(null)
  const threadScrollRef = useRef<HTMLDivElement | null>(null)
  const heldAnchorRef = useRef<number | null>(null)
  const heldAnchorOffsetRef = useRef<number | undefined>(undefined)
  const readerInteractedRef = useRef(false)
  const threadFollowRef = useRef(true)
  const threadLoadedRef = useRef('')
  const [threadWindowMeta, setThreadWindowMeta] = useState<MessageWindowMeta | null>(null)
  const threadWindowMetaRef = useRef(threadWindowMeta)
  threadWindowMetaRef.current = threadWindowMeta
  const conversationWindowMetaRef = useRef(messageWindowMeta)
  conversationWindowMetaRef.current = messageWindowMeta
  const loadedMessageIdsRef = useRef(new Set<number>())
  loadedMessageIdsRef.current = new Set(messages.map((message) => message.id))
  const queuedMessagesRef = useRef(new Map<number, number | null>())
  const [, setQueuedMessagesVersion] = useState(0)
  const queuedThreadCount = [...queuedMessagesRef.current.values()].filter((parent) => parent === activeThreadRootId).length
  const queuedConversationCount = [...queuedMessagesRef.current.values()].filter((parent) => parent === null).length
  const [loadingThreadPage, setLoadingThreadPage] = useState(false)
  const readCursorRef = useRef(new Map<string, ChannelMessage>())
  const targetRequestRef = useRef(0)
  const conversationViewsRef = useRef(new Map<string, ConversationViewSnapshot>())
  const targetLoadOptionsRef = useRef<TargetLoadOptions>({})
  const routeTargetInitializedRef = useRef(false)
  const routedDestinationRef = useRef(routedDestinationKey)
  const loadingTargetRef = useRef(false)
  const backgroundTargetLoadingRef = useRef(false)
  const shouldStickToBottomRef = useRef(true)
  const initialScrollPendingRef = useRef(false)
  const scrollPersistFrameRef = useRef<number | null>(null)
  const programmaticScrollUntilRef = useRef(0)
  const programmaticScrollTimerRef = useRef<number | null>(null)
  const lastAutoScrollTargetKeyRef = useRef('')
  const messageArrivalsRef = useRef<MessageArrivals>(createMessageArrivals())
  const userId = user?.id

  const rootReadReceipts = useMemo(() => latestVisibleReadReceipts(rootMessages), [rootMessages])
  const threadReadReceipts = useMemo(() => latestVisibleReadReceipts(activeThreadMessages), [activeThreadMessages])

  const setTargetLoading = (value: boolean) => {
    loadingTargetRef.current = value
    setLoadingTarget(value)
  }

  const preserveHistoricalWindow = () => Boolean(conversationWindowMetaRef.current?.has_newer || threadWindowMetaRef.current?.has_newer || queuedMessagesRef.current.size)
  const isHistoricalWindow = (parent: number | null) => Boolean(
    (parent === null ? conversationWindowMetaRef.current?.has_newer : parent === activeThreadRootIdRef.current && threadWindowMetaRef.current?.has_newer)
    || [...queuedMessagesRef.current.values()].some((queuedParent) => queuedParent === parent),
  )
  /** A sent message that belongs after the loaded (historical) window waits behind "New messages". */
  const queueHistoricalSend = (message: ChannelMessage) => {
    const parent = message.parent_message_id ?? null
    if (!isHistoricalWindow(parent)) return false
    queuedMessagesRef.current.set(message.id, parent)
    setQueuedMessagesVersion((version) => version + 1)
    if (parent === null) { setShowScrollToLatest(true); setHasUnreadBelow(true) }
    return true
  }
  /** The reader's own optimistic send: follow it to the bottom unless reading history, and animate it in. */
  const trackOwnSend = (target: Target, parentMessageId: number | null, tempId: number) => {
    shouldStickToBottomRef.current = !isHistoricalWindow(parentMessageId)
    messageArrivalsRef.current = recordMessageArrival(messageArrivalsRef.current, targetKey(target), tempId)
  }

  const conversationReturnContext = (): ReturnContext | null => {
    if (!selectedTarget) return null
    const pane = activeThreadRootId && isDesktop ? threadScrollRef.current : messageScrollRef.current
    const bounds = pane?.getBoundingClientRect()
    const visible = pane && bounds && Array.from(pane.querySelectorAll<HTMLElement>('[id^="message-"]')).find((row) => {
      const rect = row.getBoundingClientRect()
      return rect.bottom > bounds.top && rect.top < bounds.bottom
    })
    if (!visible || !bounds) return null
    const anchor = Number(visible.id.replace('message-', ''))
    if (!Number.isSafeInteger(anchor) || anchor <= 0) return null
    const query = new URLSearchParams(locationSearch)
    query.set('message_id', String(anchor))
    query.set('message_offset', String(Math.round((visible.getBoundingClientRect().top - bounds.top) * 100) / 100))
    if (activeThreadRootId) query.set('thread_id', String(activeThreadRootId))
    else query.delete('thread_id')
    return { returnTo: `${conversationPath(selectedTarget)}?${query}`, returnLabel: 'conversation' }
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
      const cachedMessages = contiguous ? restoreFailedSends(cachedView!, storedFailureMessages(user, target, tempMessageIdRef)).messages : storedFailureMessages(user, target, tempMessageIdRef)
      serverMessages.forEach((message) => {
        if (message.client_message_id) removeStoredFailure(user, target, message.client_message_id)
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
    const cachedMessages = contiguous ? restoreFailedSends(cachedView!, storedFailureMessages(user, target, tempMessageIdRef)).messages : storedFailureMessages(user, target, tempMessageIdRef)
    serverMessages.forEach((message) => {
      if (message.client_message_id) removeStoredFailure(user, target, message.client_message_id)
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

  // The route names the conversation (and maybe a message): switch to it, from its cached view when there is one.
  const followRoute = useEffectEvent((target: Target | null, options: TargetLoadOptions, destinationKey: string) => {
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
      if (routedDestinationRef.current !== destinationKey) {
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
      const cachedView = rawCachedView ? restoreFailedSends(rawCachedView, storedFailureMessages(user, target, tempMessageIdRef)) : null
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
    routedDestinationRef.current = destinationKey
  })
  useEffect(() => {
    const options = routedMessageId !== null && Number.isInteger(routedMessageId) && routedMessageId > 0 ? { aroundMessageId: routedMessageId, highlightedMessageId: routedMessageId, anchorOffset: routedAnchorOffset, threadRootId: Number.isSafeInteger(routedThreadId) && routedThreadId !== null && routedThreadId > 0 ? routedThreadId : undefined } : {}
    const target: Target | null = channelId ? { type: 'channel', id: Number(channelId) } : dmId ? { type: 'dm', id: Number(dmId) } : null
    followRoute(target, options, routedDestinationKey)
  }, [channelId, dmId, routedMessageId, routedThreadId, routedAnchorOffset, routedDestinationKey])

  useEffect(() => {
    const saveCurrentPosition = () => {
      const element = messageScrollRef.current
      const currentTarget = selectedTargetRef.current
      if (element && currentTarget) saveConversationScroll(userId, currentTarget, element)
    }

    window.addEventListener('pagehide', saveCurrentPosition)
    return () => {
      saveCurrentPosition()
      window.removeEventListener('pagehide', saveCurrentPosition)
      if (scrollPersistFrameRef.current !== null) window.cancelAnimationFrame(scrollPersistFrameRef.current)
      if (programmaticScrollTimerRef.current !== null) window.clearTimeout(programmaticScrollTimerRef.current)
    }
  }, [userId, selectedTargetRef])

  // A different conversation opened: load it with the options its route left behind.
  const openSelectedTarget = useEffectEvent(() => {
    if (!selectedTarget) return
    setHasUnreadBelow(false)

    // StrictMode replays this effect on mount. Keep the route's options until
    // followRoute replaces them so the replay cannot cancel a message anchor
    // request with an unanchored latest-window request.
    const options = targetLoadOptionsRef.current
    loadTarget(selectedTarget, options)
  })
  useEffect(() => {
    openSelectedTarget()
  }, [selectedConversationKey])

  useEffect(() => {
    if (activeThreadRootId && !messagesById.has(activeThreadRootId)) {
      setActiveThreadRootId(null)
    }
  }, [activeThreadRootId, messagesById, setActiveThreadRootId])

  const reportThreadError = useEffectEvent((message: string) => { toast.error(message) })
  useEffect(() => {
    if (!activeThreadRootId || !selectedConversationKey) { threadLoadedRef.current = ''; return }
    const key = `${selectedConversationKey}:${activeThreadRootId}`
    if (threadLoadedRef.current === key) return
    threadLoadedRef.current = key
    threadFollowRef.current = true
    const requestId = targetRequestRef.current
    let cancelled = false
    void api.getMessageThread(activeThreadRootId, { message_limit: 80 }).then((result) => {
      if (cancelled || requestId !== targetRequestRef.current || threadLoadedRef.current !== key) return
      if (!result.data) { reportThreadError('This thread is no longer available.'); return }
      const data = result.data
      setMessages((current) => sortChronologicalMessages([...current.filter((message) => message.id !== data.root_message.id && message.parent_message_id !== data.root_message.id), data.root_message, ...data.replies]))
      setThreadWindowMeta(data.meta)
    })
    return () => { cancelled = true }
  }, [activeThreadRootId, selectedConversationKey, setMessages])

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

  useEffect(() => {
    setConversationView('messages')
  }, [selectedConversationKey, setConversationView])

  useEffect(() => {
    if (isDesktop) return
    if (activeThreadRootId) setMobilePane('thread')
    else setMobilePane(channelId || dmId ? 'conversation' : 'list')
  }, [activeThreadRootId, isDesktop, channelId, dmId, setMobilePane])

  const markLatestFromEffect = useEffectEvent(() => { markDisplayedLatest() })
  useLayoutEffect(() => {
    const element = messageScrollRef.current
    if (!element || !selectedConversationKey || loadingTarget || conversationView !== 'messages') return

    const currentTargetKey = selectedConversationKey
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
          markLatestFromEffect()
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
  }, [conversationView, loading, loadingTarget, messages.length, selectedConversationKey, userId])

  const markReadFromEffect = useEffectEvent((target: Target, messageId: number) => markRead(target, messageId))
  useEffect(() => {
    if (!highlightedMessageId || loading || loadingTarget) return

    const desktop = isDesktopRef.current
    const frame = window.requestAnimationFrame(() => {
      const pane = activeThreadRootId && desktop ? threadScrollRef.current : messageScrollRef.current
      const element = pane?.querySelector<HTMLElement>(`#message-${highlightedMessageId}`)
      if (!element) return
      positionMessageAnchor(pane!, element, heldAnchorOffsetRef.current)
      // Only the displayed anchor can advance the cursor, never newer feed items.
      const target = selectedTargetRef.current
      if (target && !authorContextRef.current && document.visibilityState === 'visible') void markReadFromEffect(target, highlightedMessageId).catch(() => {})
    })
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 2600)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [highlightedMessageId, activeThreadRootId, mobilePane, loading, loadingTarget, isDesktopRef, selectedTargetRef, authorContextRef])

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

  useEffect(() => () => {
    if (programmaticScrollTimerRef.current) {
      window.clearTimeout(programmaticScrollTimerRef.current)
    }
  }, [])

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
    if (authorContextRef.current || !pane || !target || !readerInteractedRef.current || document.visibilityState !== 'visible' || readingPaused) return
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

  /** Reloads the open conversation quietly (polling, focus), unless it is already loading or the reader is in history. */
  const refreshInBackground = async (target: Target) => {
    if (
      !isVisiblePage(document.visibilityState) ||
      loadingTargetRef.current ||
      backgroundTargetLoadingRef.current
    ) return

    backgroundTargetLoadingRef.current = true
    try {
      await loadTarget(target, { background: true })
    } finally {
      backgroundTargetLoadingRef.current = false
    }
  }

  /** A Cable message event for this person: update summaries, then the open conversation's window. */
  const applyRealtimeEvent = (event: ChannelMessageEvent, message: ChannelMessage) => {
    const currentTarget = selectedTargetRef.current
    const belongsToTarget = Boolean(currentTarget) && (
      currentTarget!.type === 'channel'
        ? event.channel_id === currentTarget!.id
        : event.direct_conversation_id === currentTarget!.id
    )
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
          if (message.client_message_id && currentTarget) removeStoredFailure(user, currentTarget, message.client_message_id)
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
  }

  return {
    messageScrollRef,
    threadScrollRef,
    messageArrivalsRef,
    messageWindowMeta,
    threadWindowMeta,
    loadingOlder,
    loadingNewer,
    loadingTarget,
    loadingThreadPage,
    hasUnreadBelow,
    showScrollToLatest,
    highlightedMessageId,
    queuedThreadCount,
    queuedConversationCount,
    rootReadReceipts,
    threadReadReceipts,
    conversationReturnContext,
    queueHistoricalSend,
    trackOwnSend,
    loadOlderMessages,
    loadNewerMessages,
    loadThreadPage,
    replyToMessage,
    scrollToLatestMessage,
    beginReadingScroll,
    handleThreadScroll,
    handleConversationScroll,
    refreshInBackground,
    applyRealtimeEvent,
  }
}

export type ConversationWindow = ReturnType<typeof useConversationWindow>
