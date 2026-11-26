import { useEffect, useEffectEvent, useMemo, useRef, useState, useTransition, type FormEvent } from 'react';
import { api } from '../../../lib/api';
import { initialScopedWorkspaceId, resolveTargetWorkspaceSync, shouldKeepMessageTarget, workspaceIdForCohort } from '../../../lib/cohortScope';
import { ConversationSummaryFreshness } from '../../../lib/conversationSummaryFreshness';
import { recentConversations } from '../../../lib/messagingPresentation';
import { conversationAttentionCount, subscribeUnreadRefresh } from '../../../lib/unread';
import type { MessageView as ChannelMessage, ChannelMessageEvent, ChannelSummary, DirectConversationSummary, User, DirectoryUserSummary as UserSummary, WorkspaceDetail, WorkspaceSummary } from '../../../types/api';
import { initialMessageTarget, latestMessageFrom } from './helpers';
import { buildMentionPatterns } from './mentions';
import type { ConversationState } from './useConversationState';
import type { MessagesRoute } from './useMessagesRoute';
import { useDirectRecipients } from './useDirectRecipients';

type Toast = { success: (message: string) => void; error: (message: string) => void }
type Cohorts = { loading: boolean; selectedCohortId: number | null; setSelectedCohort: (cohortId: number) => void }
type DirectoryConversation = Pick<ConversationState, 'selectedTarget' | 'setSelectedTarget' | 'setMessages' | 'selectTarget' | 'clearConversation'>

/**
 * Workspaces, channels, direct messages and people: the lists, their unread
 * summaries, which workspace is open (kept in step with the selected cohort),
 * and the dialogs that create channels, workspaces, members and DMs.
 */
export function useWorkspaceDirectory(
  user: User | null,
  toast: Toast,
  { loading: cohortsLoading, selectedCohortId: contextCohortId, setSelectedCohort }: Cohorts,
  { channelId, dmId, navigate, requestedWorkspaceId, requestedCohortId, requestedStudentId }: Pick<MessagesRoute, 'channelId' | 'dmId' | 'navigate' | 'requestedWorkspaceId' | 'requestedCohortId' | 'requestedStudentId'>,
  { selectedTarget, setSelectedTarget, setMessages, selectTarget, clearConversation }: DirectoryConversation,
) {
  const selectedCohortId = requestedCohortId ?? contextCohortId
  const isStaff = Boolean(user?.is_staff)
  const isAdmin = Boolean(user?.is_admin)
  const summaryFreshness = useRef(new ConversationSummaryFreshness()).current
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [directConversations, setDirectConversations] = useState<DirectConversationSummary[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspaceDetail, setWorkspaceDetail] = useState<WorkspaceDetail | null>(null)
  const [allUsers, setAllUsers] = useState<UserSummary[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [showDmForm, setShowDmForm] = useState(false)
  const [showWorkspaceForm, setShowWorkspaceForm] = useState(false)
  const [showWorkspaceSwitcher, setShowWorkspaceSwitcher] = useState(false)
  const [showWorkspaceMembers, setShowWorkspaceMembers] = useState(false)
  const [workspaceError, setWorkspaceError] = useState('')
  const [channelError, setChannelError] = useState('')
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
  const lastAppliedCohortWorkspaceRef = useRef<string | null | undefined>(undefined)
  const pendingCohortWorkspaceIdRef = useRef<number | null>(null)
  const preserveRoutedWorkspaceRef = useRef(Boolean(requestedWorkspaceId || channelId || dmId))

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

  const selected = selectedChannel || selectedDm
  const selectedLabel = selectedChannel ? `#${selectedChannel.name}` : selectedDm?.title || 'Messages'
  const selectedMuted = Boolean(selected?.muted)

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
  const { totalWorkspaceUnreadCount, sortedWorkspaceCards } = useMemo(() => {
    const totalUnread = workspaceCards.reduce((sum, item) => sum + item.unreadCount, 0)
    const sorted = [...workspaceCards].sort((left, right) => {
      const leftActive = left.workspace.id === selectedWorkspaceId
      const rightActive = right.workspace.id === selectedWorkspaceId
      if (leftActive !== rightActive) return leftActive ? -1 : 1
      if (left.unreadCount !== right.unreadCount) return right.unreadCount - left.unreadCount
      return left.workspace.name.localeCompare(right.workspace.name)
    })

    return {
      totalWorkspaceUnreadCount: totalUnread,
      sortedWorkspaceCards: sorted,
    }
  }, [selectedWorkspaceId, workspaceCards])
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

  const loadLists = async () => {
    const started = summaryFreshness.startRequest()
    const [workspaceRes, channelRes, dmRes] = await Promise.all([api.getWorkspaces(), api.getChannels(), (requestedStudentId ? api.getDirectConversations({ cohort_id: requestedCohortId, student_id: requestedStudentId }) : api.getDirectConversations())])
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
      cohortWorkspaceId: workspaceIdForCohort(loadedWorkspaces, requestedCohortId ?? selectedCohortId),
    })
    const initialTarget = initialMessageTarget(
      requestedStudentId ? [] : loadedChannels.filter((channel) => channel.workspace_id === initialWorkspaceId),
      loadedDirectConversations.filter((conversation) => conversation.workspace_id === initialWorkspaceId),
    )

    setSelectedTarget((current) => current || initialTarget)
    setSelectedWorkspaceId((current) => current || initialWorkspaceId)
    setLoading(false)
  }

  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let active = true
    let generation = 0
    const refresh = async () => {
      const request = ++generation
      const started = summaryFreshness.startRequest()
      const [channelRes, dmRes] = await Promise.all([api.getChannels(), (requestedStudentId ? api.getDirectConversations({ cohort_id: requestedCohortId, student_id: requestedStudentId }) : api.getDirectConversations())])
      if (!active || request !== generation) return
      if (channelRes.data) setChannels((current) => summaryFreshness.reconcileList('channel', current, channelRes.data!.channels, started))
      if (dmRes.data) setDirectConversations((current) => summaryFreshness.reconcileList('dm', current, dmRes.data!.direct_conversations, started))
      summaryFreshness.completeRequest(started)
    }
    const unsubscribe = subscribeUnreadRefresh(() => { void refresh() })
    return () => { active = false; unsubscribe() }
  }, [userId, summaryFreshness, requestedCohortId, requestedStudentId])

  useEffect(() => {
    if (!requestedWorkspaceId || !workspaces.some((workspace) => workspace.id === requestedWorkspaceId) || channelId || dmId) return
    setSelectedWorkspaceId(requestedWorkspaceId)
    setSelectedTarget(null)
    setMessages([])
  }, [requestedWorkspaceId, workspaces, channelId, dmId, setSelectedTarget, setMessages])

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

  const loadInitialLists = useEffectEvent(() => { loadLists() })
  useEffect(() => {
    loadInitialLists()
  }, [requestedCohortId, requestedStudentId])

  useEffect(() => {
    if (!channelForm.workspace_id && workspaces.length > 0) {
      setChannelForm((prev) => ({ ...prev, workspace_id: String(workspaces[0].id) }))
    }
  }, [channelForm.workspace_id, workspaces])

  // Everyone picked for a new direct message (one person starts a 1:1, several a group), for this workspace only.
  const recipients = useDirectRecipients(selectedWorkspaceId)
  const availableUsers = recipients.users
  const dmUserIds = recipients.selectedIds
  const setDmUserIds = recipients.setSelectedIds

  const loadSelectedWorkspaceDetail = useEffectEvent((workspaceId: number) => { loadWorkspaceDetail(workspaceId) })
  useEffect(() => {
    if (!selectedWorkspaceId) {
      setWorkspaceDetail(null)
      return
    }

    loadSelectedWorkspaceDetail(selectedWorkspaceId)
  }, [selectedWorkspaceId])

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

  // Opening or clearing the conversation navigates; it isn't a dependency of this sync.
  const openWorkspaceTarget = useEffectEvent((workspaceId: number, target: ReturnType<typeof initialMessageTarget>) => {
    if (target) {
      pendingCohortWorkspaceIdRef.current = workspaceId
      selectTarget(target)
      return
    }
    pendingCohortWorkspaceIdRef.current = null
    navigate('/messages')
    clearConversation()
  })
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
    openWorkspaceTarget(workspaceId, initialMessageTarget(
      channels.filter((channel) => channel.workspace_id === workspaceId),
      directConversations.filter((conversation) => conversation.workspace_id === workspaceId),
    ))
  }, [channels, cohortsLoading, directConversations, selectedChannel, selectedCohortId, selectedDm, selectedWorkspaceId, setSelectedCohort, workspaces])

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
    const incomingDm = event.direct_conversation
    if (requestedStudentId && incomingDm && (!incomingDm.users.some(member => member.id === requestedStudentId) || (requestedCohortId && incomingDm.cohort_id !== requestedCohortId))) return
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
    else toast.success('Marked as read')
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
      startNavigationTransition(clearConversation)
    }
  }

  const handleCreateChannel = async (event: FormEvent) => {
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
      toast.success(`Created group chat #${res.data.channel.name}`)
    }
    setCreatingChannel(false)
  }

  const handleCreateWorkspace = async (event: FormEvent) => {
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
      toast.success(`Created community "${res.data.workspace.name}"`)
    }
    setCreatingWorkspace(false)
  }

  const handleAddWorkspaceMember = async (event: FormEvent) => {
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
      toast.success('Member added')
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
      toast.success('Member removed')
    }
  }

  const handleCreateDm = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedWorkspaceId || recipients.status !== 'ready' || dmUserIds.length === 0) return

    const res = await api.createDirectConversation({ workspace_id: selectedWorkspaceId, user_ids: dmUserIds })
    if (res.data) {
      await loadLists()
      setShowDmForm(false)
      setDmUserIds([])
      selectTarget({ type: 'dm', id: res.data.direct_conversation.id })
    } else if (res.error) {
      toast.error(res.error)
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
    currentUserId: user?.id,
    isStaff,
    isAdmin,
    loading,
    summaryFreshness,
    setChannels,
    setDirectConversations,
    workspaces,
    workspaceDetail,
    availableUsers,
    recipientsStatus: recipients.status,
    retryRecipients: recipients.retry,
    selectedWorkspaceId,
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
    workspaceError,
    setWorkspaceError,
    channelError,
    setChannelError,
    dmUserIds,
    setDmUserIds,
    memberToAddId,
    setMemberToAddId,
    isNavigationPending,
    workspaceForm,
    setWorkspaceForm,
    channelForm,
    setChannelForm,
    selectedChannel,
    selectedDm,
    selectedDmStudent,
    selected,
    selectedLabel,
    selectedMuted,
    recent,
    selectedWorkspace,
    canManageChannels,
    totalWorkspaceUnreadCount,
    sortedWorkspaceCards,
    memberCandidates,
    mentionableUsers,
    mentionPatterns,
    loadLists,
    updateLatestForTarget,
    updateTargetSummaryFromEvent,
    markWorkspaceRead,
    selectWorkspace,
    handleCreateChannel,
    handleCreateWorkspace,
    handleAddWorkspaceMember,
    handleRemoveWorkspaceMember,
    handleCreateDm,
    toggleMute,
  }
}

export type WorkspaceDirectory = ReturnType<typeof useWorkspaceDirectory>
