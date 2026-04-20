import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import {
  Bell,
  BellOff,
  Bold,
  Code2,
  Edit3,
  File,
  Hash,
  Italic,
  Lock,
  MessageCircle,
  MoreHorizontal,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  Type,
  UserPlus,
  X,
} from 'lucide-react'
import { api } from '../../lib/api'
import { subscribeToChannelMessages, subscribeToDirectMessages } from '../../lib/realtime'
import { disablePushNotifications, enablePushNotifications, pushSupported } from '../../lib/pushNotifications'
import { formatFileSize, uploadToS3 } from '../../lib/uploadToS3'
import { useAuthContext } from '../../contexts/AuthContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import type {
  ChannelMessage,
  ChannelMessageEvent,
  ChannelSummary,
  CohortSummary,
  DirectConversationSummary,
  UserSummary,
} from '../../types/api'

type Target = { type: 'channel'; id: number } | { type: 'dm'; id: number }
type PendingAttachment = {
  file: File
  s3_key?: string
  filename: string
  content_type: string
  byte_size: number
  progress: number
  uploaded: boolean
}

const REACTIONS = ['👍', '❤️', '✅', '🙌']
const SLASH_COMMANDS = [
  { command: '/code', label: 'Code block', insert: '```\n\n```' },
  { command: '/quote', label: 'Quote', insert: '> ' },
  { command: '/todo', label: 'Checklist', insert: '- [ ] ' },
]

function formatTime(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function preview(text: string) {
  const fallback = text || 'Attachment'
  return fallback.length > 80 ? `${fallback.slice(0, 77)}...` : fallback
}

function latestMessageFrom(message: ChannelMessage) {
  return {
    id: message.id,
    body: message.body || (message.attachments.length === 1 ? 'Attachment' : `${message.attachments.length} attachments`),
    created_at: message.created_at,
    author_name: message.author.full_name,
  }
}

export function Messages() {
  const { channelId, dmId } = useParams()
  const { user } = useAuthContext()
  const isStaff = Boolean(user?.is_staff)
  const [channels, setChannels] = useState<ChannelSummary[]>([])
  const [directConversations, setDirectConversations] = useState<DirectConversationSummary[]>([])
  const [cohorts, setCohorts] = useState<CohortSummary[]>([])
  const [availableUsers, setAvailableUsers] = useState<UserSummary[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<number | null>(null)
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(dmId ? { type: 'dm', id: Number(dmId) } : channelId ? { type: 'channel', id: Number(channelId) } : null)
  const [messages, setMessages] = useState<ChannelMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [showDmForm, setShowDmForm] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected')
  const [body, setBody] = useState('')
  const [composerCursor, setComposerCursor] = useState(0)
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [replyTo, setReplyTo] = useState<ChannelMessage | null>(null)
  const [editing, setEditing] = useState<ChannelMessage | null>(null)
  const [editBody, setEditBody] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ChannelMessage[]>([])
  const [error, setError] = useState('')
  const [channelError, setChannelError] = useState('')
  const [dmUserId, setDmUserId] = useState('')
  const [channelForm, setChannelForm] = useState({
    cohort_id: '',
    name: '',
    description: '',
    visibility: 'cohort',
  })
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const selectedChannel = useMemo(
    () => selectedTarget?.type === 'channel' ? channels.find((channel) => channel.id === selectedTarget.id) || null : null,
    [channels, selectedTarget],
  )

  const selectedDm = useMemo(
    () => selectedTarget?.type === 'dm' ? directConversations.find((conversation) => conversation.id === selectedTarget.id) || null : null,
    [directConversations, selectedTarget],
  )

  const selected = selectedChannel || selectedDm
  const selectedLabel = selectedChannel ? `#${selectedChannel.name}` : selectedDm?.title || 'Messages'
  const selectedMuted = Boolean(selected?.muted)

  const workspaces = useMemo(() => {
    const workspaceMap = new Map<number, string>()
    channels.forEach((channel) => workspaceMap.set(channel.cohort_id, channel.cohort_name))
    directConversations.forEach((conversation) => workspaceMap.set(conversation.cohort_id, conversation.cohort_name))
    cohorts.forEach((cohort) => workspaceMap.set(cohort.id, cohort.name))
    return Array.from(workspaceMap, ([id, name]) => ({ id, name }))
  }, [channels, directConversations, cohorts])

  const visibleChannels = useMemo(
    () => selectedWorkspaceId ? channels.filter((channel) => channel.cohort_id === selectedWorkspaceId) : channels,
    [channels, selectedWorkspaceId],
  )

  const visibleDms = useMemo(
    () => selectedWorkspaceId ? directConversations.filter((conversation) => conversation.cohort_id === selectedWorkspaceId) : directConversations,
    [directConversations, selectedWorkspaceId],
  )

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
  const mentionToken = useMemo(() => {
    const beforeCursor = body.slice(0, composerCursor)
    return beforeCursor.match(/(^|\s)@([^\s@]*)$/)?.[2] ?? null
  }, [body, composerCursor])
  const commandToken = useMemo(() => {
    const beforeCursor = body.slice(0, composerCursor)
    return beforeCursor.match(/(^|\n)\/([a-z]*)$/)?.[2] ?? null
  }, [body, composerCursor])
  const mentionSuggestions = useMemo(() => {
    if (mentionToken === null) return []
    const normalized = mentionToken.toLowerCase()
    return availableUsers
      .filter((availableUser) => availableUser.full_name.toLowerCase().includes(normalized) || availableUser.email.toLowerCase().includes(normalized))
      .slice(0, 8)
  }, [availableUsers, mentionToken])
  const commandSuggestions = useMemo(() => {
    if (commandToken === null) return []
    return SLASH_COMMANDS.filter((item) => item.command.slice(1).startsWith(commandToken)).slice(0, 5)
  }, [commandToken])

  useEffect(() => {
    setActiveMentionIndex(0)
  }, [mentionToken])

  useEffect(() => {
    setActiveCommandIndex(0)
  }, [commandToken])

  const loadLists = async () => {
    const [channelRes, dmRes] = await Promise.all([api.getChannels(), api.getDirectConversations()])
    if (channelRes.data) setChannels(channelRes.data.channels)
    if (dmRes.data) setDirectConversations(dmRes.data.direct_conversations)

    const firstTarget = channelRes.data?.channels[0]
      ? { type: 'channel' as const, id: channelRes.data.channels[0].id }
      : dmRes.data?.direct_conversations[0]
        ? { type: 'dm' as const, id: dmRes.data.direct_conversations[0].id }
        : null

    setSelectedTarget((current) => current || firstTarget)
    setSelectedWorkspaceId((current) => current || channelRes.data?.channels[0]?.cohort_id || dmRes.data?.direct_conversations[0]?.cohort_id || null)
    setLoading(false)
  }

  const loadAvailableUsers = async (cohortId: number) => {
    const res = await api.getAvailableDirectUsers(cohortId)
    if (res.data) {
      setAvailableUsers(res.data.users)
      setDmUserId(String(res.data.users[0]?.id || ''))
    }
  }

  const channelNeedsRead = (channel: ChannelSummary) => {
    if (channel.unread_count > 0) return true
    if (!channel.latest_message) return false
    if (!channel.last_read_at) return true

    return new Date(channel.latest_message.created_at) > new Date(channel.last_read_at)
  }

  const dmNeedsRead = (conversation: DirectConversationSummary) => {
    if (conversation.unread_count > 0) return true
    if (!conversation.latest_message) return false
    if (!conversation.last_read_at) return true

    return new Date(conversation.latest_message.created_at) > new Date(conversation.last_read_at)
  }

  const loadTarget = async (target: Target, markRead = false) => {
    if (target.type === 'channel') {
      const res = await api.getChannel(target.id)
      if (!res.data) return

      setMessages(res.data.messages || [])
      setChannels((prev) => prev.map((channel) => channel.id === target.id ? res.data!.channel : channel))
      if (markRead && channelNeedsRead(res.data.channel)) {
        await api.markChannelRead(target.id)
        setChannels((prev) => prev.map((channel) => channel.id === target.id ? { ...channel, unread_count: 0, last_read_at: new Date().toISOString() } : channel))
      }
      return
    }

    const res = await api.getDirectConversation(target.id)
    if (!res.data) return

    setMessages(res.data.messages || [])
    setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? res.data!.direct_conversation : conversation))
    if (markRead && dmNeedsRead(res.data.direct_conversation)) {
      await api.markDirectConversationRead(target.id)
      setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? { ...conversation, unread_count: 0, last_read_at: new Date().toISOString() } : conversation))
    }
  }

  useEffect(() => {
    loadLists()
    api.getCohorts().then((res) => {
      if (res.data) {
        setCohorts(res.data.cohorts)
        setChannelForm((prev) => ({ ...prev, cohort_id: String(res.data!.cohorts[0]?.id || '') }))
      }
    })
  }, [])

  useEffect(() => {
    if (selectedWorkspaceId) loadAvailableUsers(selectedWorkspaceId)
  }, [selectedWorkspaceId])

  useEffect(() => {
    if (!pushSupported()) return

    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setPushEnabled(Boolean(subscription)))
      .catch(() => setPushEnabled(false))
  }, [])

  useEffect(() => {
    if (channelId) setSelectedTarget({ type: 'channel', id: Number(channelId) })
    if (dmId) setSelectedTarget({ type: 'dm', id: Number(dmId) })
  }, [channelId, dmId])

  useEffect(() => {
    if (!selectedTarget) return
    const selectedCohort = selectedChannel?.cohort_id || selectedDm?.cohort_id
    if (selectedCohort) setSelectedWorkspaceId(selectedCohort)
  }, [selectedTarget, selectedChannel, selectedDm])

  useEffect(() => {
    if (!selectedTarget) return

    loadTarget(selectedTarget, true)
    const interval = window.setInterval(() => loadTarget(selectedTarget, true), 30000)
    const onFocus = () => loadTarget(selectedTarget, true)
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [selectedTarget?.type, selectedTarget?.id])

  useEffect(() => {
    if (!selectedTarget || !user) return

    let unsubscribe: (() => void) | null = null
    let active = true

    setRealtimeStatus('disconnected')

    const subscribe = selectedTarget.type === 'channel' ? subscribeToChannelMessages : subscribeToDirectMessages
    subscribe(selectedTarget.id, (payload) => {
      if (!active) return
      const event = payload as ChannelMessageEvent
      const belongsToTarget = selectedTarget.type === 'channel'
        ? event.channel_id === selectedTarget.id
        : event.direct_conversation_id === selectedTarget.id
      if (!event.message || !belongsToTarget) return

      const message = { ...event.message, mine: event.message.author.id === user.id }

      setMessages((prev) => {
        if (event.event === 'deleted') return prev.filter((item) => item.id !== message.id)
        if (prev.some((item) => item.id === message.id)) return prev.map((item) => item.id === message.id ? message : item)
        return [...prev, message]
      })

      if (event.event !== 'deleted') {
        updateLatestForTarget(message)
      }

      if (!message.mine && event.event === 'created') {
        markRead(selectedTarget).catch(() => {})
      }
    }, setRealtimeStatus).then((cleanup) => {
      if (active) unsubscribe = cleanup
      else cleanup()
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [selectedTarget?.type, selectedTarget?.id, user])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, selectedTarget?.type, selectedTarget?.id])

  useEffect(() => {
    const trimmed = searchQuery.trim()
    if (trimmed.length < 2) {
      setSearchResults([])
      return
    }

    const timer = window.setTimeout(async () => {
      const res = await api.searchMessages(trimmed, 20)
      if (res.data) setSearchResults(res.data.results)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [searchQuery])

  const updateLatestForTarget = (message: ChannelMessage) => {
    if (message.channel_id) {
      setChannels((prev) => prev.map((channel) => channel.id === message.channel_id ? {
        ...channel,
        unread_count: 0,
        last_read_at: new Date().toISOString(),
        latest_message: latestMessageFrom(message),
      } : channel))
    }
    if (message.direct_conversation_id) {
      setDirectConversations((prev) => prev.map((conversation) => conversation.id === message.direct_conversation_id ? {
        ...conversation,
        unread_count: 0,
        last_read_at: new Date().toISOString(),
        latest_message: latestMessageFrom(message),
      } : conversation))
    }
  }

  const markRead = async (target: Target) => {
    if (target.type === 'channel') await api.markChannelRead(target.id)
    else await api.markDirectConversationRead(target.id)
  }

  const selectTarget = (target: Target) => {
    window.history.replaceState(null, '', target.type === 'channel' ? `/messages/${target.id}` : `/messages/dm/${target.id}`)
    setSelectedTarget(target)
    setReplyTo(null)
    setEditing(null)
  }

  const selectWorkspace = (id: number) => {
    setSelectedWorkspaceId(id)
    setChannelForm((prev) => ({ ...prev, cohort_id: String(id) }))
    const firstChannel = channels.find((channel) => channel.cohort_id === id)
    const firstDm = directConversations.find((conversation) => conversation.cohort_id === id)
    if (firstChannel) selectTarget({ type: 'channel', id: firstChannel.id })
    else if (firstDm) selectTarget({ type: 'dm', id: firstDm.id })
  }

  const uploadAttachments = async () => {
    if (!selectedTarget) return []

    const uploaded = []
    for (const attachment of pendingAttachments) {
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
        channel_id: selectedTarget.type === 'channel' ? selectedTarget.id : undefined,
        direct_conversation_id: selectedTarget.type === 'dm' ? selectedTarget.id : undefined,
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

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedTarget || (!body.trim() && pendingAttachments.length === 0)) return

    setSending(true)
    setError('')
    try {
      const attachments = await uploadAttachments()
      const payload = { body: body.trim(), parent_message_id: replyTo?.id || null, attachments, send_push: true }
      const res = selectedTarget.type === 'channel'
        ? await api.createMessage(selectedTarget.id, payload)
        : await api.createDirectMessage(selectedTarget.id, payload)

      if (res.error) {
        setError(res.error)
      } else if (res.data) {
        const message = res.data.message
        setBody('')
        setPendingAttachments([])
        setReplyTo(null)
        setMessages((prev) => prev.some((item) => item.id === message.id) ? prev : [...prev, message])
        updateLatestForTarget(message)
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send message.')
    }
    setSending(false)
  }

  const handleCreateChannel = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!channelForm.cohort_id || !channelForm.name.trim()) return

    setCreatingChannel(true)
    setChannelError('')
    const res = await api.createChannel({
      cohort_id: Number(channelForm.cohort_id),
      name: channelForm.name.trim(),
      description: channelForm.description.trim() || undefined,
      visibility: channelForm.visibility,
    })

    if (res.error) {
      setChannelError(res.error)
    } else if (res.data) {
      setChannelForm((prev) => ({ ...prev, name: '', description: '' }))
      setShowChannelForm(false)
      await loadLists()
      selectTarget({ type: 'channel', id: res.data.channel.id })
    }
    setCreatingChannel(false)
  }

  const handleCreateDm = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedWorkspaceId || !dmUserId) return

    const res = await api.createDirectConversation({ cohort_id: selectedWorkspaceId, user_ids: [Number(dmUserId)] })
    if (res.data) {
      await loadLists()
      setShowDmForm(false)
      selectTarget({ type: 'dm', id: res.data.direct_conversation.id })
    }
  }

  const handleTogglePush = async () => {
    setPushMessage('')
    if (pushEnabled) {
      try {
        await disablePushNotifications()
        setPushEnabled(false)
        setPushMessage('Message notifications are off for this device.')
      } catch (toggleError) {
        setPushMessage(toggleError instanceof Error ? toggleError.message : 'Could not turn off notifications.')
      }
      return
    }

    const config = await api.getPushConfig()
    const publicKey = config.data?.public_key || import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
    if (!config.data?.configured && !publicKey) {
      setPushMessage('Push notifications are not configured yet.')
      return
    }

    try {
      await enablePushNotifications(publicKey)
      setPushEnabled(true)
      setPushMessage('Message notifications are on for this device.')
    } catch (toggleError) {
      setPushMessage(toggleError instanceof Error ? toggleError.message : 'Could not enable notifications.')
    }
  }

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    addFiles(Array.from(files))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const addFiles = (files: File[]) => {
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

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length > 0) {
      addFiles(files)
    }
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return

    event.preventDefault()
    addFiles(files)
  }

  const insertIntoComposer = (insert: string, replacePattern?: RegExp) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setBody((current) => replacePattern ? current.replace(replacePattern, insert) : `${current}${insert}`)
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = body.slice(0, start)
    const after = body.slice(end)
    const nextBefore = replacePattern ? before.replace(replacePattern, insert) : `${before}${insert}`
    const next = `${nextBefore}${after}`
    setBody(next)
    window.requestAnimationFrame(() => {
      textarea.focus()
      const cursor = nextBefore.length
      textarea.setSelectionRange(cursor, cursor)
      setComposerCursor(cursor)
    })
  }

  const wrapSelection = (prefix: string, suffix = prefix) => {
    const textarea = textareaRef.current
    if (!textarea) {
      setBody((current) => `${current}${prefix}${suffix}`)
      return
    }

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = body.slice(start, end) || 'text'
    const next = `${body.slice(0, start)}${prefix}${selectedText}${suffix}${body.slice(end)}`
    setBody(next)
    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(start + prefix.length, start + prefix.length + selectedText.length)
      setComposerCursor(start + prefix.length + selectedText.length)
    })
  }

  const selectMention = (availableUser: UserSummary) => {
    insertIntoComposer(`@${availableUser.full_name} `, /(^|\s)@[^\s@]*$/)
  }

  const selectCommand = (insert: string) => {
    insertIntoComposer(insert, /(^|\n)\/[a-z]*$/)
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveMentionIndex((current) => (current + 1) % mentionSuggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveMentionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        selectMention(mentionSuggestions[activeMentionIndex])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setComposerCursor(-1)
        return
      }
    }

    if (commandSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setActiveCommandIndex((current) => (current + 1) % commandSuggestions.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setActiveCommandIndex((current) => (current - 1 + commandSuggestions.length) % commandSuggestions.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        selectCommand(commandSuggestions[activeCommandIndex].insert)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setComposerCursor(-1)
        return
      }
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.currentTarget.form?.requestSubmit()
    }
  }

  const saveEdit = async (message: ChannelMessage) => {
    if (!editBody.trim()) return

    const res = await api.updateMessage(message.id, { body: editBody.trim() })
    if (res.data) {
      setMessages((prev) => prev.map((item) => item.id === message.id ? res.data!.message : item))
      setEditing(null)
    } else if (res.error) {
      setError(res.error)
    }
  }

  const deleteMessage = async (message: ChannelMessage) => {
    const res = await api.deleteMessage(message.id)
    if (res.data) setMessages((prev) => prev.filter((item) => item.id !== message.id))
    else if (res.error) setError(res.error)
  }

  const togglePin = async (message: ChannelMessage) => {
    const res = message.pinned_at ? await api.unpinMessage(message.id) : await api.pinMessage(message.id)
    if (res.data) setMessages((prev) => prev.map((item) => item.id === message.id ? res.data!.message : item))
  }

  const toggleReaction = async (message: ChannelMessage, emoji: string) => {
    const existing = message.reactions.find((reaction) => reaction.emoji === emoji)
    const res = existing?.reacted ? await api.unreactMessage(message.id, emoji) : await api.reactMessage(message.id, emoji)
    if (res.data) setMessages((prev) => prev.map((item) => item.id === message.id ? res.data!.message : item))
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

  if (loading) return <LoadingSpinner message="Loading messages..." />

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 lg:h-[calc(100vh-4rem)]">
      <div>
        <p className="text-sm font-medium text-primary-600">Communication</p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
            <p className="mt-1 text-sm text-slate-500">
              Cohort workspaces for class channels, direct messages, files, and quick decisions.
              {realtimeStatus === 'connected' && <span className="ml-2 text-green-600">Live</span>}
              {realtimeStatus === 'error' && <span className="ml-2 text-amber-600">Reconnecting with refresh fallback</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedTarget && (
              <button
                onClick={toggleMute}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {selectedMuted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                {selectedMuted ? 'Unmute' : 'Mute'}
              </button>
            )}
            {pushSupported() && (
              <button
                onClick={handleTogglePush}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {pushEnabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                {pushEnabled ? 'Turn off push' : 'Turn on push'}
              </button>
            )}
          </div>
        </div>
        {pushMessage && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {pushMessage}
          </div>
        )}
      </div>

      <div className={`grid min-h-[680px] overflow-hidden rounded-lg border border-slate-200 bg-white ${sidebarCollapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[340px_minmax(0,1fr)]'}`}>
        {!sidebarCollapsed && (
        <aside className="border-b border-slate-200 bg-slate-50 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{selectedWorkspace?.name || 'Workspaces'}</h2>
                <p className="text-xs text-slate-500">Cohort workspace</p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={loadLists}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Refresh messages"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setSidebarCollapsed(true)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Collapse conversation list"
                >
                  <PanelLeftClose className="h-4 w-4" />
                </button>
              </div>
            </div>
            {workspaces.length > 1 && (
              <select
                value={selectedWorkspaceId || ''}
                onChange={(event) => selectWorkspace(Number(event.target.value))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
            )}
            <div className="relative mt-3">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search messages"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      onClick={() => {
                        selectTarget(result.channel_id ? { type: 'channel', id: result.channel_id } : { type: 'dm', id: result.direct_conversation_id! })
                        setSearchQuery('')
                        setSearchResults([])
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                    >
                      <span className="font-medium text-slate-800">{result.author.full_name}</span>
                      <span className="ml-2 text-xs text-slate-500">{formatTime(result.created_at)}</span>
                      <p className="mt-1 truncate text-xs text-slate-500">{preview(result.body)}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {isStaff && showChannelForm && (
            <form onSubmit={handleCreateChannel} className="border-b border-slate-200 bg-white p-3">
              {channelError && (
                <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {channelError}
                </div>
              )}
              <div className="space-y-2">
                <select
                  value={channelForm.cohort_id}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, cohort_id: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {cohorts.map((cohort) => (
                    <option key={cohort.id} value={cohort.id}>{cohort.name}</option>
                  ))}
                </select>
                <input
                  value={channelForm.name}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Channel name"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <textarea
                  value={channelForm.description}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, description: event.target.value }))}
                  placeholder="What is this channel for?"
                  rows={2}
                  className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                />
                <select
                  value={channelForm.visibility}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, visibility: event.target.value }))}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="cohort">Students and staff</option>
                  <option value="staff_only">Staff only</option>
                </select>
                <button
                  type="submit"
                  disabled={creatingChannel || !channelForm.cohort_id || !channelForm.name.trim()}
                  className="w-full rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                >
                  {creatingChannel ? 'Creating...' : 'Create channel'}
                </button>
              </div>
            </form>
          )}

          {showDmForm && (
            <form onSubmit={handleCreateDm} className="border-b border-slate-200 bg-white p-3">
              <div className="space-y-2">
                <select
                  value={dmUserId}
                  onChange={(event) => setDmUserId(event.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  {availableUsers.map((availableUser) => (
                    <option key={availableUser.id} value={availableUser.id}>{availableUser.full_name}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!selectedWorkspaceId || !dmUserId}
                  className="w-full rounded-lg bg-primary-500 px-3 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                >
                  Start direct message
                </button>
              </div>
            </form>
          )}

          <div className="max-h-72 overflow-y-auto p-2 lg:max-h-[calc(100vh-13rem)]">
            <div className="mb-2 flex items-center justify-between px-2 pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Channels</h3>
              {isStaff && (
                <button onClick={() => setShowChannelForm((current) => !current)} className="rounded-lg p-1 text-slate-500 hover:bg-white" aria-label="Create channel">
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>
            {visibleChannels.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">No channels yet.</div>
            ) : visibleChannels.map((channel) => (
              <ConversationButton
                key={channel.id}
                active={selectedTarget?.type === 'channel' && selectedTarget.id === channel.id}
                icon={channel.visibility === 'staff_only' ? <Lock className="h-4 w-4 shrink-0" /> : <Hash className="h-4 w-4 shrink-0" />}
                title={channel.name}
                subtitle={channel.latest_message ? `${channel.latest_message.author_name}: ${preview(channel.latest_message.body)}` : channel.description || channel.cohort_name}
                unread={channel.unread_count}
                muted={channel.muted}
                onClick={() => selectTarget({ type: 'channel', id: channel.id })}
              />
            ))}

            <div className="mb-2 mt-4 flex items-center justify-between px-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Direct messages</h3>
              <button onClick={() => setShowDmForm((current) => !current)} className="rounded-lg p-1 text-slate-500 hover:bg-white" aria-label="Start direct message">
                <UserPlus className="h-4 w-4" />
              </button>
            </div>
            {visibleDms.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">No DMs yet.</div>
            ) : visibleDms.map((conversation) => (
              <ConversationButton
                key={conversation.id}
                active={selectedTarget?.type === 'dm' && selectedTarget.id === conversation.id}
                icon={<MessageCircle className="h-4 w-4 shrink-0" />}
                title={conversation.title}
                subtitle={conversation.latest_message ? `${conversation.latest_message.author_name}: ${preview(conversation.latest_message.body)}` : conversation.cohort_name}
                unread={conversation.unread_count}
                muted={conversation.muted}
                onClick={() => selectTarget({ type: 'dm', id: conversation.id })}
              />
            ))}
          </div>
        </aside>
        )}
        {sidebarCollapsed && (
          <aside className="hidden border-r border-slate-200 bg-slate-50 p-2 lg:block">
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="mb-3 flex h-11 w-full items-center justify-center rounded-lg text-slate-500 hover:bg-white hover:text-slate-800"
              aria-label="Show conversation list"
            >
              <PanelLeftOpen className="h-5 w-5" />
            </button>
            <div className="space-y-2">
              {visibleChannels.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => selectTarget({ type: 'channel', id: channel.id })}
                  title={channel.name}
                  className={`relative flex h-11 w-full items-center justify-center rounded-lg ${selectedTarget?.type === 'channel' && selectedTarget.id === channel.id ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}
                >
                  {channel.visibility === 'staff_only' ? <Lock className="h-5 w-5" /> : <Hash className="h-5 w-5" />}
                  {channel.unread_count > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-primary-500" />}
                </button>
              ))}
              <div className="my-2 border-t border-slate-200" />
              {visibleDms.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => selectTarget({ type: 'dm', id: conversation.id })}
                  title={conversation.title}
                  className={`relative flex h-11 w-full items-center justify-center rounded-lg ${selectedTarget?.type === 'dm' && selectedTarget.id === conversation.id ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}
                >
                  <MessageCircle className="h-5 w-5" />
                  {conversation.unread_count > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-primary-500" />}
                </button>
              ))}
            </div>
          </aside>
        )}

        <section className="flex min-h-[560px] flex-col">
          {selectedTarget && selected ? (
            <>
              <header className="border-b border-slate-200 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    {sidebarCollapsed && (
                      <button
                        onClick={() => setSidebarCollapsed(false)}
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Show conversation list"
                      >
                        <PanelLeftOpen className="h-4 w-4" />
                      </button>
                    )}
                    {selectedTarget.type === 'channel'
                      ? selectedChannel?.visibility === 'staff_only'
                        ? <Lock className="h-5 w-5 shrink-0 text-slate-500" />
                        : <Hash className="h-5 w-5 shrink-0 text-slate-500" />
                      : <MessageCircle className="h-5 w-5 shrink-0 text-slate-500" />}
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-slate-900">{selectedLabel}</h2>
                      <p className="text-xs text-slate-500">{selected.cohort_name}</p>
                    </div>
                  </div>
                  {selectedTarget.type === 'channel' && selectedChannel?.visibility === 'staff_only' && (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Staff only</span>
                  )}
                </div>
                {selectedTarget.type === 'channel' && selectedChannel?.description && <p className="mt-2 text-sm text-slate-500">{selectedChannel.description}</p>}
              </header>

              <div className="flex-1 overflow-y-auto bg-white px-4 py-4">
                {messages.length === 0 ? (
                  <div className="py-16 text-center text-sm text-slate-500">No messages yet. Start the conversation.</div>
                ) : messages.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    replyTarget={messages.find((item) => item.id === message.parent_message_id) || null}
                    editing={editing?.id === message.id}
                    editBody={editBody}
                    setEditBody={setEditBody}
                    onStartEdit={() => {
                      setEditing(message)
                      setEditBody(message.body)
                    }}
                    onCancelEdit={() => setEditing(null)}
                    onSaveEdit={() => saveEdit(message)}
                    onDelete={() => deleteMessage(message)}
                    onPin={() => togglePin(message)}
                    canPin={isStaff}
                    onReply={() => setReplyTo(message)}
                    onReact={(emoji) => toggleReaction(message, emoji)}
                  />
                ))}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={handleSend} className="border-t border-slate-200 bg-white p-3">
                {error && (
                  <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                {replyTo && (
                  <div className="mb-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <span>Replying to {replyTo.author.full_name}: {preview(replyTo.body)}</span>
                    <button type="button" onClick={() => setReplyTo(null)} className="rounded-lg p-1 hover:bg-white">
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {pendingAttachments.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    {pendingAttachments.map((attachment) => (
                      <div key={`${attachment.filename}-${attachment.byte_size}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                        <File className="h-4 w-4 shrink-0" />
                        <span className="truncate">{attachment.filename}</span>
                        <span>{attachment.progress > 0 ? `${attachment.progress}%` : formatFileSize(attachment.byte_size)}</span>
                        <button
                          type="button"
                          onClick={() => setPendingAttachments((prev) => prev.filter((item) => item.file !== attachment.file))}
                          className="rounded-lg p-1 hover:bg-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div
                  className="relative rounded-lg border border-slate-200 bg-white"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  <div className="flex items-center gap-1 border-b border-slate-100 px-2 py-2 text-slate-500">
                    <button type="button" onClick={() => fileInputRef.current?.click()} className="rounded-lg p-2 hover:bg-slate-50" aria-label="Attach files">
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => wrapSelection('**')} className="rounded-lg p-2 hover:bg-slate-50" aria-label="Bold">
                      <Bold className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => wrapSelection('_')} className="rounded-lg p-2 hover:bg-slate-50" aria-label="Italic">
                      <Italic className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => wrapSelection('`')} className="rounded-lg p-2 hover:bg-slate-50" aria-label="Inline code">
                      <Code2 className="h-4 w-4" />
                    </button>
                    <button type="button" onClick={() => wrapSelection('```\n', '\n```')} className="rounded-lg px-2 py-1 text-sm hover:bg-slate-50">Code block</button>
                    <button type="button" onClick={() => insertIntoComposer('@')} className="rounded-lg px-2 py-1 text-sm hover:bg-slate-50">@ mention</button>
                    <button type="button" onClick={() => insertIntoComposer('/')} className="rounded-lg px-2 py-1 text-sm hover:bg-slate-50">/ command</button>
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
                  </div>
                  <div className="flex gap-2 p-2">
                    <div className="min-w-0 flex-1">
                      {body.trim() && /(`|\*\*|_)/.test(body) && (
                        <div className="mb-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                          <div className="mb-1 text-xs font-medium text-slate-400">Preview</div>
                          <FormattedMessage body={body} />
                        </div>
                      )}
                      <textarea
                        ref={textareaRef}
                        value={body}
                        onChange={(event) => {
                          setBody(event.target.value)
                          setComposerCursor(event.target.selectionStart)
                        }}
                        onClick={(event) => setComposerCursor(event.currentTarget.selectionStart)}
                        onKeyUp={(event) => setComposerCursor(event.currentTarget.selectionStart)}
                        onSelect={(event) => setComposerCursor(event.currentTarget.selectionStart)}
                        onPaste={handlePaste}
                        placeholder={`Message ${selectedLabel}`}
                        rows={2}
                        className="min-h-12 w-full resize-none border-0 px-2 py-2 text-sm focus:outline-none focus:ring-0"
                        onKeyDown={handleComposerKeyDown}
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={sending || (!body.trim() && pendingAttachments.length === 0)}
                      className="inline-flex min-w-24 items-center justify-center gap-2 rounded-lg bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                    >
                      <Send className="h-4 w-4" />
                      {sending ? 'Sending' : 'Send'}
                    </button>
                  </div>
                  {mentionSuggestions.length > 0 && (
                    <div className="absolute bottom-full left-3 z-30 mb-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                      <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mention someone</div>
                      {mentionSuggestions.map((availableUser, index) => (
                        <button
                          key={availableUser.id}
                          type="button"
                          onClick={() => selectMention(availableUser)}
                          className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${index === activeMentionIndex ? 'bg-primary-50 text-primary-800' : 'hover:bg-slate-50'}`}
                        >
                          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 text-xs font-semibold text-slate-600">
                            {availableUser.avatar_url ? <img src={availableUser.avatar_url} alt="" className="h-8 w-8 rounded-lg object-cover" /> : availableUser.full_name.slice(0, 1)}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-slate-800">{availableUser.full_name}</span>
                            <span className="block truncate text-xs text-slate-500">{availableUser.email}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                  {commandSuggestions.length > 0 && (
                    <div className="absolute bottom-full left-3 z-30 mb-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                      <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Commands</div>
                      {commandSuggestions.map((item, index) => (
                        <button
                          key={item.command}
                          type="button"
                          onClick={() => selectCommand(item.insert)}
                          className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${index === activeCommandIndex ? 'bg-primary-50 text-primary-800' : 'hover:bg-slate-50'}`}
                        >
                          <Type className="h-4 w-4 text-slate-400" />
                          <span>
                            <span className="block font-medium text-slate-800">{item.command}</span>
                            <span className="block text-xs text-slate-500">{item.label}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-xs text-slate-400">Press Cmd+Enter or Ctrl+Enter to send. Paste or drop screenshots, use @ for people, / for snippets, and backticks for code.</p>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
              Pick a channel or start a direct message.
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function ConversationButton({
  active,
  icon,
  title,
  subtitle,
  unread,
  muted,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  title: string
  subtitle: string
  unread: number
  muted: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`mb-1 w-full rounded-lg px-3 py-3 text-left transition-colors ${
        active ? 'bg-primary-50 text-primary-800' : 'hover:bg-white'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {icon}
          <span className="truncate text-sm font-semibold">{title}</span>
          {muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
        </span>
        {unread > 0 && (
          <span className="rounded-full bg-primary-500 px-2 py-0.5 text-xs font-semibold text-white">
            {unread}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>
    </button>
  )
}

function FormattedMessage({ body }: { body: string }) {
  if (!body) return null

  const parts = body.split(/```/g)

  return (
    <div className="mt-1 space-y-2 text-sm leading-6 text-slate-700">
      {parts.map((part, index) => {
        const key = `${index}-${part.slice(0, 12)}`
        if (index % 2 === 1) {
          return (
            <pre key={key} className="overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs leading-5 text-slate-100">
              <code>{part.trim()}</code>
            </pre>
          )
        }

        return (
          <p key={key} className="whitespace-pre-wrap">
            {formatInline(part)}
          </p>
        )
      })}
    </div>
  )
}

function formatInline(text: string) {
  const pieces = text.split(/(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g)

  return pieces.map((piece, index) => {
    const key = `${index}-${piece}`
    if (piece.startsWith('`') && piece.endsWith('`')) {
      return <code key={key} className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-800">{piece.slice(1, -1)}</code>
    }
    if (piece.startsWith('**') && piece.endsWith('**')) {
      return <strong key={key}>{piece.slice(2, -2)}</strong>
    }
    if (piece.startsWith('_') && piece.endsWith('_')) {
      return <em key={key}>{piece.slice(1, -1)}</em>
    }
    return <span key={key}>{piece}</span>
  })
}

function MessageRow({
  message,
  replyTarget,
  editing,
  editBody,
  setEditBody,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onPin,
  canPin,
  onReply,
  onReact,
}: {
  message: ChannelMessage
  replyTarget: ChannelMessage | null
  editing: boolean
  editBody: string
  setEditBody: (value: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
  onPin: () => void
  canPin: boolean
  onReply: () => void
  onReact: (emoji: string) => void
}) {
  return (
    <div className={`group mb-3 flex gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 ${message.pinned_at ? 'bg-amber-50/70' : ''}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-sm font-semibold text-slate-600">
        {message.author.avatar_url ? <img src={message.author.avatar_url} alt="" className="h-9 w-9 rounded-lg object-cover" /> : message.author.full_name.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{message.author.full_name}</span>
          <span className="text-xs text-slate-400">{formatTime(message.created_at)}</span>
          {message.edited_at && <span className="text-xs text-slate-400">Edited</span>}
          {message.pinned_at && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"><Pin className="h-3 w-3" /> Pinned</span>}
        </div>
        {replyTarget && (
          <div className="mt-2 rounded-lg border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            Reply to {replyTarget.author.full_name}: {preview(replyTarget.body)}
          </div>
        )}
        {editing ? (
          <div className="mt-2">
            <textarea
              value={editBody}
              onChange={(event) => setEditBody(event.target.value)}
              rows={3}
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <div className="mt-2 flex gap-2">
              <button onClick={onSaveEdit} className="rounded-lg bg-primary-500 px-3 py-1.5 text-xs font-medium text-white">Save</button>
              <button onClick={onCancelEdit} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600">Cancel</button>
            </div>
          </div>
        ) : (
          <FormattedMessage body={message.body} />
        )}
        {message.attachments.length > 0 && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {message.attachments.map((attachment) => (
              <a
                key={attachment.id}
                href={attachment.url}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700 hover:border-primary-200 hover:bg-primary-50"
              >
                {attachment.image && attachment.url ? (
                  <img src={attachment.url} alt={attachment.filename} className="mb-2 max-h-56 w-full rounded-lg object-cover" />
                ) : (
                  <File className="mb-2 h-5 w-5 text-slate-400" />
                )}
                <div className="truncate font-medium">{attachment.filename}</div>
                <div className="text-xs text-slate-500">{formatFileSize(attachment.byte_size)}</div>
              </a>
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {REACTIONS.map((emoji) => {
            const reaction = message.reactions.find((item) => item.emoji === emoji)
            return (
              <button
                key={emoji}
                onClick={() => onReact(emoji)}
                className={`rounded-lg border px-2 py-1 text-xs ${reaction?.reacted ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
              >
                {emoji} {reaction?.count || ''}
              </button>
            )
          })}
          <button onClick={onReply} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">Reply</button>
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
        {canPin && (
          <button onClick={onPin} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700" aria-label="Pin message">
            <Pin className="h-4 w-4" />
          </button>
        )}
        {message.mine && (
          <>
            <button onClick={onStartEdit} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-700" aria-label="Edit message">
              <Edit3 className="h-4 w-4" />
            </button>
            <button onClick={onDelete} className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-red-600" aria-label="Delete message">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
        <MoreHorizontal className="mt-1.5 h-4 w-4 text-slate-300" />
      </div>
    </div>
  )
}
