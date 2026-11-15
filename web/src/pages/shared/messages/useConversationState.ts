import { useEffect, useMemo, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { ChannelMessage } from '../../../types/api';
import { conversationPath, rootMessageIdFor, sortPinnedMessages, targetKey } from './helpers';
import type { LocalMessage, Target, TargetLoadOptions } from './types';

type ConversationRoute = {
  channelId?: string
  dmId?: string
  navigate: NavigateFunction
  setSourceContextHidden: (hidden: boolean) => void
}

/**
 * The open conversation that every part of the page shares: which one it is,
 * its loaded messages, the open thread, the pane layout and the message being
 * edited. Loading, realtime and mutations each change these through the setters.
 */
export function useConversationState({ channelId, dmId, navigate, setSourceContextHidden }: ConversationRoute) {
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(dmId ? { type: 'dm', id: Number(dmId) } : channelId ? { type: 'channel', id: Number(channelId) } : null)
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [pinnedMessages, setPinnedMessages] = useState<LocalMessage[]>([])
  const [unreadBoundaryId, setUnreadBoundaryId] = useState<number | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [conversationView, setConversationView] = useState<'messages' | 'pins'>('messages')
  const [activeThreadRootId, setActiveThreadRootId] = useState<number | null>(null)
  const [isDesktop, setIsDesktop] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  const [mobilePane, setMobilePane] = useState<'list' | 'conversation' | 'thread'>(selectedTarget ? 'conversation' : 'list')
  const [editing, setEditing] = useState<ChannelMessage | null>(null)
  /** Where editing started, so a root shown in both the feed and the thread panel has one edit surface. */
  const [editingInThreadPanel, setEditingInThreadPanel] = useState(false)
  const [editBody, setEditBody] = useState('')
  /** Temporary (negative) ids for optimistic sends and restored failed sends. */
  const tempMessageIdRef = useRef(0)
  const activeThreadRootIdRef = useRef<number | null>(activeThreadRootId)
  const isDesktopRef = useRef(isDesktop)
  const mobilePaneRef = useRef(mobilePane)
  const selectedTargetRef = useRef<Target | null>(selectedTarget)

  activeThreadRootIdRef.current = activeThreadRootId
  isDesktopRef.current = isDesktop
  mobilePaneRef.current = mobilePane
  selectedTargetRef.current = selectedTarget
  /** Changes only when a different conversation opens, not when the same target is set again. */
  const selectedConversationKey = selectedTarget ? targetKey(selectedTarget) : null

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
  const selectedPinnedMessages = useMemo(
    () => sortPinnedMessages(pinnedMessages),
    [pinnedMessages],
  )
  const activeThreadRoot = activeThreadRootId ? messagesById.get(activeThreadRootId) || null : null
  const activeThreadMessages = useMemo(() => {
    if (!activeThreadRoot) return []

    return [activeThreadRoot, ...(threadReplies.get(activeThreadRoot.id) || [])]
  }, [activeThreadRoot, threadReplies])

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

  const selectTarget = (target: Target, options: TargetLoadOptions = {}) => {
    setSourceContextHidden(true)
    setActiveThreadRootId(null)
    setEditing(null)
    setConversationView('messages')
    navigate(conversationPath(target, options.aroundMessageId))
  }

  /** No conversation open (a workspace without one). The caller navigates to /messages first. */
  const clearConversation = () => {
    setSelectedTarget(null)
    setUnreadBoundaryId(null)
    setMessages([])
    setPinnedMessages([])
    setActiveThreadRootId(null)
    setEditing(null)
    setConversationView('messages')
    if (!isDesktop) setMobilePane('list')
  }

  return {
    selectedTarget,
    setSelectedTarget,
    selectedTargetRef,
    selectedConversationKey,
    messages,
    setMessages,
    pinnedMessages,
    setPinnedMessages,
    selectedPinnedMessages,
    unreadBoundaryId,
    setUnreadBoundaryId,
    sidebarCollapsed,
    setSidebarCollapsed,
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
    editing,
    setEditing,
    editingInThreadPanel,
    setEditingInThreadPanel,
    editBody,
    setEditBody,
    tempMessageIdRef,
    messagesById,
    actionableMessagesById,
    threadReplies,
    rootMessages,
    activeThreadRoot,
    activeThreadMessages,
    selectTarget,
    clearConversation,
  }
}

export type ConversationState = ReturnType<typeof useConversationState>
