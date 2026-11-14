import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom';
import { useAuthContext } from '../../../contexts/AuthContext';
import { useCohortContext } from '../../../contexts/CohortContext';
import { useToast } from '../../../contexts/ToastContext';
import { ConversationSummaryFreshness } from '../../../lib/conversationSummaryFreshness';
import { composerDestinationKey } from '../../../lib/messageComposerState';
import { latestVisibleReadReceipts, recentConversations } from '../../../lib/messagingPresentation';
import { readReturnContext, type ReturnContext } from '../../../lib/navigationContext';
import { type RealtimeSubscription } from '../../../lib/realtime';
import { helpRequestPath, submissionPath } from '../../../lib/routes';
import { conversationAttentionCount } from '../../../lib/unread';
import type { ChannelMessage, ChannelSummary, DirectConversationSummary, MessageAttachment, MessageWindowMeta, UserSummary, WorkspaceDetail, WorkspaceSummary } from '../../../types/api';
import { conversationPath, createMessageArrivals, rootMessageIdFor, sortPinnedMessages, typingIndicatorLabel, type MessageArrivals } from './helpers';
import { buildMentionPatterns } from './mentions';
import { type MessageComposerHandle } from './MessageComposer';
import { type ConversationViewSnapshot, type LocalMessage, type PendingAttachment, type Target, type TargetLoadOptions, type TypingUser } from './types';
import { useMessageSearch } from './useMessageSearch';

/** Per-page state, refs, and derived conversation/workspace selectors. */
export function useMessagesState() {


  const { channelId, dmId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigationType = useNavigationType()
  const rememberedReturn = navigationType === 'POP' ? readReturnContext(location.state) : null
  const returnUrl = rememberedReturn ? new URL(rememberedReturn.returnTo, 'https://csg.invalid') : null
  const destinationParams = returnUrl?.pathname === location.pathname ? returnUrl.searchParams : searchParams
  const routedMessageId = Number(destinationParams.get('message_id')) || null
  const routedThreadId = Number(destinationParams.get('thread_id')) || null
  const requestedAnchorOffset = destinationParams.has('message_offset') ? Number(destinationParams.get('message_offset')) : NaN
  const routedAnchorOffset = Number.isFinite(requestedAnchorOffset) && Math.abs(requestedAnchorOffset) <= 10000 ? requestedAnchorOffset : undefined
  const requestedWorkspaceId = Number(searchParams.get('workspace_id')) || null
  const { user } = useAuthContext()
  const { loading: cohortsLoading, selectedCohortId, setSelectedCohort } = useCohortContext()
  const toast = useToast()
  const isStaff = Boolean(user?.is_staff)
  const isAdmin = Boolean(user?.is_admin)
  const summaryFreshness = useRef(new ConversationSummaryFreshness()).current
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [directConversations, setDirectConversations] = useState<DirectConversationSummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspaceDetail, setWorkspaceDetail] = useState<WorkspaceDetail | null>(null)
  const [availableUsers, setAvailableUsers] = useState<UserSummary[]>([])
  const [allUsers, setAllUsers] = useState<UserSummary[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(dmId ? { type: 'dm', id: Number(dmId) } : channelId ? { type: 'channel', id: Number(channelId) } : null)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [pinnedMessages, setPinnedMessages] = useState<LocalMessage[]>([])
  const [messageWindowMeta, setMessageWindowMeta] = useState<MessageWindowMeta | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [loadingNewer, setLoadingNewer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingTarget, setLoadingTarget] = useState(false)
  const [sending, setSending] = useState(false)
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [showDmForm, setShowDmForm] = useState(false)
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false)
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false)
  const [showWorkspaceMembers, setShowWorkspaceMembers] = useState(false)
  const [sourceContextHidden, setSourceContextHidden] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false)
  const [unreadBoundaryId, setUnreadBoundaryId] = useState<number | null>(null)
  const openingReadStateRef = useRef<{ key: string; summary: ChannelSummary | DirectConversationSummary } | null>(null)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected')
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [, setRealtimeSubscriptionVersion] = useState(0)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [lightboxAttachments, setLightboxAttachments] = useState<MessageAttachment[]>([])
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [reactionDetails, setReactionDetails] = useState<{ messageId: number; emoji: string } | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [channelsCollapsed, setChannelsCollapsed] = useState(false)
  const [conversationView, setConversationView] = useState<'messages' | 'pins'>('messages')
  const [activeThreadRootId, setActiveThreadRootId] = useState<number | null>(null)
  const [isDesktop, setIsDesktop] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  const [mobilePane, setMobilePane] = useState<'list' | 'conversation' | 'thread'>(selectedTarget ? 'conversation' : 'list')
  const [editing, setEditing] = useState<ChannelMessage | null>(null)
  /** Where editing started, so a root shown in both the feed and the thread panel has one edit surface. */
  const [editingInThreadPanel, setEditingInThreadPanel] = useState(false)
  const [authorContext, setAuthorContext] = useState<ChannelMessage['author'] | null>(null)
  const authorContextRef = useRef(authorContext)
  useLayoutEffect(() => { authorContextRef.current = authorContext }, [authorContext])
  const [showConversationOptions, setShowConversationOptions] = useState(false)
  const [showInboxSearch, setShowInboxSearch] = useState(false)
  const [showInboxActions, setShowInboxActions] = useState(false)
  const [mobileActionsMessageId, setMobileActionsMessageId] = useState<number | null>(null)
  /** Was the actions sheet opened from the desktop thread panel? Edit opens there, not in the feed. */
  const actionsFromThreadPanelRef = useRef(false)
  const [messagePendingDelete, setMessagePendingDelete] = useState<LocalMessage | null>(null)
  const [editBody, setEditBody] = useState('')
  const { searchQuery, setSearchQuery, searchResults, setSearchResults } = useMessageSearch()
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [workspaceError, setWorkspaceError] = useState('')
  const [channelError, setChannelError] = useState('')
  const [dmUserId, setDmUserId] = useState('')
  const [memberToAddId, setMemberToAddId] = useState('')
  const [isNavigationPending, startNavigationTransition] = useTransition()
  const [workspaceForm, setWorkspaceForm] = useState({
    name: '',
    description: '',
  })
  const [channelForm, setChannelForm] = useState({
    workspace_id: '',
    name: '',
    description: '',
    visibility: 'cohort',
  })
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
  const preserveHistoricalWindow = () => Boolean(conversationWindowMetaRef.current?.has_newer || threadWindowMetaRef.current?.has_newer || queuedMessagesRef.current.size)
  const isHistoricalWindow = (parent: number | null) => Boolean(
    (parent === null ? conversationWindowMetaRef.current?.has_newer : parent === activeThreadRootIdRef.current && threadWindowMetaRef.current?.has_newer)
    || [...queuedMessagesRef.current.values()].some((queuedParent) => queuedParent === parent),
  )
  const queueHistoricalSend = (message: ChannelMessage) => {
    const parent = message.parent_message_id ?? null
    if (!isHistoricalWindow(parent)) return false
    queuedMessagesRef.current.set(message.id, parent)
    setQueuedMessagesVersion((version) => version + 1)
    if (parent === null) { setShowScrollToLatest(true); setHasUnreadBelow(true) }
    return true
  }
  const [loadingThreadPage, setLoadingThreadPage] = useState(false)
  const readCursorRef = useRef(new Map<string, ChannelMessage>())
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composerRef = useRef<MessageComposerHandle | null>(null)
  const lightboxTouchStartX = useRef<number | null>(null)
  const optimisticAttachmentUrls = useRef(new Map<number, string[]>())
  const tempMessageIdRef = useRef(0)
  const targetRequestRef = useRef(0)
  const conversationViewsRef = useRef(new Map<string, ConversationViewSnapshot>())
  const targetLoadOptionsRef = useRef<TargetLoadOptions>({})
  const routeTargetInitializedRef = useRef(false)
  const routedDestinationKey = `${routedMessageId}:${routedThreadId}:${routedAnchorOffset}`
  const routedDestinationRef = useRef(routedDestinationKey)
  const loadingTargetRef = useRef(false)
  const backgroundTargetLoadingRef = useRef(false)
  const shouldStickToBottomRef = useRef(true)
  const initialScrollPendingRef = useRef(false)
  const scrollPersistFrameRef = useRef<number | null>(null)
  const programmaticScrollUntilRef = useRef(0)
  const programmaticScrollTimerRef = useRef<number | null>(null)
  const lastAutoScrollTargetKeyRef = useRef('')
  const activeThreadRootIdRef = useRef<number | null>(activeThreadRootId)
  const isDesktopRef = useRef(isDesktop)
  const mobilePaneRef = useRef(mobilePane)
  const selectedTargetRef = useRef<Target | null>(selectedTarget)
  const messageArrivalsRef = useRef<MessageArrivals>(createMessageArrivals())
  const attachmentBucketKeyRef = useRef<string | null>(null)
  const pendingAttachmentBucketsRef = useRef(new Map<string, PendingAttachment[]>())
  const pendingAttachmentsRef = useRef(pendingAttachments)
  const realtimeSubscriptionRef = useRef<RealtimeSubscription | null>(null)
  const typingExpiryTimersRef = useRef(new Map<number, number>())
  const lastAppliedCohortWorkspaceRef = useRef<string | null | undefined>(undefined)
  const pendingCohortWorkspaceIdRef = useRef<number | null>(null)
  const preserveRoutedWorkspaceRef = useRef(Boolean(requestedWorkspaceId || channelId || dmId))
  const typingStopTimerRef = useRef<number | null>(null)
  const outboundTypingRef = useRef<{
    target: Target
    threadRootId: number | null
    active: boolean
    lastSentAt: number
  } | null>(null)

  activeThreadRootIdRef.current = activeThreadRootId
  isDesktopRef.current = isDesktop
  mobilePaneRef.current = mobilePane
  selectedTargetRef.current = selectedTarget
  pendingAttachmentsRef.current = pendingAttachments

  const setTargetLoading = (value: boolean) => {
    loadingTargetRef.current = value
    setLoadingTarget(value)
  }

  const selectedChannel = useMemo(
    () => selectedTarget?.type === 'channel' ? channels.find((channel) => channel.id === selectedTarget.id) || null : null,
    [channels, selectedTarget],
  )

  const selectedDm = useMemo(
    () => selectedTarget?.type === 'dm' ? directConversations.find((conversation) => conversation.id === selectedTarget.id) || null : null,
    [directConversations, selectedTarget],
  )

  const selectedDmStudent = useMemo(() => {
    if (!isStaff || !selectedDm?.cohort_id) return null
    const students = selectedDm.users.filter((member) => member.id !== user?.id && !member.is_staff)
    return students.length === 1 ? students[0] : null
  }, [isStaff, selectedDm, user?.id])
  const sourceRecord = useMemo(() => {
    if (sourceContextHidden) return null
    const type = searchParams.get('source_type')
    const id = Number(searchParams.get('source_id'))
    const label = searchParams.get('source_label')?.trim()
    if ((type !== 'submission' && type !== 'help_request') || !Number.isInteger(id) || id <= 0 || !label) return null
    return { type, id, label } as const
  }, [searchParams, sourceContextHidden])
  const sourceRecordPath = sourceRecord?.type === 'submission' ? submissionPath(sourceRecord.id) : sourceRecord?.type === 'help_request' ? helpRequestPath(sourceRecord.id) : null

  useEffect(() => { setSourceContextHidden(false) }, [searchParams])

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
    const query = new URLSearchParams(location.search)
    query.set('message_id', String(anchor))
    query.set('message_offset', String(Math.round((visible.getBoundingClientRect().top - bounds.top) * 100) / 100))
    if (activeThreadRootId) query.set('thread_id', String(activeThreadRootId))
    else query.delete('thread_id')
    return { returnTo: `${conversationPath(selectedTarget)}?${query}`, returnLabel: 'conversation' }
  }

  const selected = selectedChannel || selectedDm
  const selectedLabel = selectedChannel ? `#${selectedChannel.name}` : selectedDm?.title || 'Messages'
  const selectedMuted = Boolean(selected?.muted)
  const messagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])
  const actionableMessagesById = useMemo(() => new Map([...pinnedMessages, ...messages].map((message) => [message.id, message])), [messages, pinnedMessages])
  const threadReplies = useMemo(() => {
    const replies = new Map<number, LocalMessage[]>()

    messages.forEach((message) => {
      if (!message.parent_message_id) return

      const rootId = rootMessageIdFor(message, messagesById)
      replies.set(rootId, [...(replies.get(rootId) || []), message])
    })

    replies.forEach((items, key) => {
      replies.set(key, items.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()))
    })

    return replies
  }, [messages, messagesById])
  const rootMessages = useMemo(
    () => messages.filter((message) => !message.parent_message_id),
    [messages],
  )
  const activeThreadRoot = activeThreadRootId ? messagesById.get(activeThreadRootId) || null : null
  const mobileActionsMessage = mobileActionsMessageId ? actionableMessagesById.get(mobileActionsMessageId) || null : null
  const typingLabel = typingIndicatorLabel(typingUsers)
  const reactionDetailsMessage = reactionDetails ? actionableMessagesById.get(reactionDetails.messageId) || null : null
  const selectedReaction = reactionDetailsMessage?.reactions.find((reaction) => reaction.emoji === reactionDetails?.emoji)
    || reactionDetailsMessage?.reactions[0]
    || null
  const activeThreadMessages = useMemo(() => {
    if (!activeThreadRoot) return []

    return [activeThreadRoot, ...(threadReplies.get(activeThreadRoot.id) || [])]
  }, [activeThreadRoot, threadReplies])
  const rootReadReceipts = useMemo(() => latestVisibleReadReceipts(rootMessages), [rootMessages])
  const threadReadReceipts = useMemo(() => latestVisibleReadReceipts(activeThreadMessages), [activeThreadMessages])

  const visibleChannels = useMemo(
    () => selectedWorkspaceId ? channels.filter((channel) => channel.workspace_id === selectedWorkspaceId) : channels,
    [channels, selectedWorkspaceId],
  )

  const visibleDms = useMemo(
    () => selectedWorkspaceId ? directConversations.filter((conversation) => conversation.workspace_id === selectedWorkspaceId) : directConversations,
    [directConversations, selectedWorkspaceId],
  )
  const recent = useMemo(() => recentConversations(visibleChannels, visibleDms), [visibleChannels, visibleDms])

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
  const canManageChannels = isStaff && (isAdmin || selectedWorkspace?.workspace_type === 'cohort')
  const workspaceCards = useMemo(() => workspaces.map((workspace) => {
    const workspaceChannels = channels.filter((channel) => channel.workspace_id === workspace.id)
    const workspaceDms = directConversations.filter((conversation) => conversation.workspace_id === workspace.id)
    const unreadChannelCount = workspaceChannels.reduce((sum, channel) => sum + conversationAttentionCount(channel), 0)
    const unreadDmCount = workspaceDms.reduce((sum, conversation) => sum + conversationAttentionCount(conversation), 0)
    const unreadCount = [
      unreadChannelCount,
      unreadDmCount,
    ].reduce((sum, count) => sum + count, 0)

    return {
      workspace,
      channelCount: workspaceChannels.length,
      dmCount: workspaceDms.length,
      unreadChannelCount,
      unreadDmCount,
      unreadCount,
    }
  }), [channels, directConversations, workspaces])
  const {
    totalWorkspaceUnreadCount,
    workspaceSwitcherSubtitle,
    sortedWorkspaceCards,
    unreadOtherWorkspaceCards,
  } = useMemo(() => {
    const selectedUnread = workspaceCards.find((item) => item.workspace.id === selectedWorkspaceId)?.unreadCount || 0
    const totalUnread = workspaceCards.reduce((sum, item) => sum + item.unreadCount, 0)
    const otherUnread = Math.max(0, totalUnread - selectedUnread)
    const subtitle = otherUnread > 0
      ? `${otherUnread} unread in other ${otherUnread === 1 ? 'workspace' : 'workspaces'}`
      : selectedUnread > 0
        ? `${selectedUnread} unread here`
        : selectedWorkspace
          ? `${selectedWorkspace.member_count} ${selectedWorkspace.member_count === 1 ? 'member' : 'members'}`
          : `${workspaces.length} workspaces`
    const sorted = [...workspaceCards].sort((left, right) => {
      const leftActive = left.workspace.id === selectedWorkspaceId
      const rightActive = right.workspace.id === selectedWorkspaceId
      if (leftActive !== rightActive) return leftActive ? -1 : 1
      if (left.unreadCount !== right.unreadCount) return right.unreadCount - left.unreadCount
      return left.workspace.name.localeCompare(right.workspace.name)
    })
    const unreadOther = sorted.filter((item) => item.workspace.id !== selectedWorkspaceId && item.unreadCount > 0)

    return {
      totalWorkspaceUnreadCount: totalUnread,
      workspaceSwitcherSubtitle: subtitle,
      sortedWorkspaceCards: sorted,
      unreadOtherWorkspaceCards: unreadOther,
    }
  }, [selectedWorkspaceId, selectedWorkspace, workspaceCards, workspaces.length])
  const selectedPinnedMessages = useMemo(
    () => sortPinnedMessages(pinnedMessages),
    [pinnedMessages],
  )
  const channelsUnreadCount = useMemo(
    () => visibleChannels.reduce((sum, channel) => sum + conversationAttentionCount(channel), 0),
    [visibleChannels],
  )
  const memberCandidates = useMemo(() => {
    const memberIds = new Set((workspaceDetail?.members || []).map((member) => member.id))
    return allUsers.filter((candidate) => !memberIds.has(candidate.id))
  }, [allUsers, workspaceDetail?.members])
  const directMentionableUsers = useMemo(
    () => (selectedDm?.users ?? []).filter((mentionableUser) => mentionableUser.id !== user?.id),
    [selectedDm?.users, user?.id],
  )
  const mentionableUsers = useMemo(
    () => selectedTarget?.type === 'channel' ? (workspaceDetail?.members ?? []) : directMentionableUsers,
    [directMentionableUsers, selectedTarget?.type, workspaceDetail?.members],
  )
  const mentionPatterns = useMemo(() => {
    const people = [...mentionableUsers.filter((person) => person.id !== user?.id), ...(user ? [user] : [])]
    return buildMentionPatterns([], selectedTarget?.type === 'channel')
      .concat(people.filter((person) => person.full_name.trim()).map((person) => ({
        label: `@${person.full_name.trim()}`,
        normalized: `@${person.full_name.trim()}`.toLowerCase(),
        kind: 'user' as const,
        userId: person.id,
        me: person.id === user?.id,
      })))
      .sort((a, b) => b.label.length - a.label.length)
  }, [mentionableUsers, selectedTarget?.type, user])
  const lightboxAttachment = lightboxAttachments[lightboxIndex] || null

  const composerDraftKey = user && selectedTarget ? composerDestinationKey(user.id, selectedTarget, activeThreadRootId) : null

  // Pending attachments belong to a draft: switching conversations keeps each one's files.
  useEffect(() => {
    const previous = attachmentBucketKeyRef.current
    if (previous === composerDraftKey) return
    if (previous) pendingAttachmentBucketsRef.current.set(previous, pendingAttachmentsRef.current)
    attachmentBucketKeyRef.current = composerDraftKey
    setPendingAttachments(composerDraftKey ? pendingAttachmentBucketsRef.current.get(composerDraftKey) || [] : [])
  }, [composerDraftKey])
return {
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
    channelsCollapsed,
    setChannelsCollapsed,
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
    showConversationOptions,
    setShowConversationOptions,
    showInboxSearch,
    setShowInboxSearch,
    showInboxActions,
    setShowInboxActions,
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
  }
}
