import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import type { Editor, JSONContent } from '@tiptap/core'
import EmojiPicker, { Theme, type EmojiClickData } from 'emoji-picker-react'
import {
  Bell,
  BellOff,
  Bold,
  ChevronLeft,
  ChevronRight,
  Code2,
  Download,
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
  SmilePlus,
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
  MessageAttachment,
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
type LocalMessage = ChannelMessage & { pending?: boolean; failed?: boolean }

const REACTIONS = ['👍', '❤️', '✅', '🙌']
const SLASH_COMMANDS = [
  { command: '/code', label: 'Code block' },
  { command: '/quote', label: 'Quote' },
  { command: '/todo', label: 'Checklist' },
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
  const fallback = (text || 'Attachment')
    .replace(/```[\w-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/`{1,3}/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
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

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

function channelInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '#'
  return words.length === 1 ? words[0].slice(0, 2).toUpperCase() : words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
}

function rootMessageIdFor(message: ChannelMessage, messagesById: Map<number, ChannelMessage>) {
  let current: ChannelMessage | undefined = message

  while (current?.parent_message_id) {
    current = messagesById.get(current.parent_message_id)
  }

  return current?.id || message.id
}

function mergeIncomingMessage(existing: LocalMessage, incoming: LocalMessage) {
  const mergedReactions = incoming.reactions.map((reaction) => {
    const existingReaction = existing.reactions.find((item) => item.emoji === reaction.emoji)
    if (existingReaction?.reacted && !reaction.reacted) {
      return { ...reaction, reacted: true }
    }

    return reaction
  })

  return { ...incoming, reactions: mergedReactions }
}

function messageNotificationHint(configured: boolean, publicKey?: string | null) {
  if (configured || publicKey) return ''

  return 'Push needs WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, and WEB_PUSH_SUBJECT on the API plus VITE_WEB_PUSH_PUBLIC_KEY on the web app.'
}

function editorTextBeforeCursor(editor: Editor) {
  const from = editor.state.selection.from
  return editor.state.doc.textBetween(Math.max(0, from - 80), from, '\n', '\n')
}

function editorJsonToMarkdown(node?: JSONContent): string {
  if (!node) return ''
  if (node.type === 'text') {
    return applyMarks(node.text || '', node.marks || [])
  }

  const children = (node.content || []).map((child) => editorJsonToMarkdown(child))

  switch (node.type) {
    case 'doc':
      return children.join('\n\n').trim()
    case 'paragraph':
      return children.join('')
    case 'hardBreak':
      return '\n'
    case 'codeBlock':
      return `\`\`\`\n${children.join('')}\n\`\`\``
    case 'blockquote':
      return children.join('\n').split('\n').map((line) => `> ${line}`).join('\n')
    case 'bulletList':
      return children.join('\n')
    case 'orderedList':
      return children.map((child, index) => `${index + 1}. ${child.replace(/^\s*[-*]\s*/, '')}`).join('\n')
    case 'listItem':
      return `- ${children.join('').replace(/\n/g, '\n  ')}`
    default:
      return children.join('')
  }
}

function applyMarks(text: string, marks: NonNullable<JSONContent['marks']>) {
  return marks.reduce((value, mark) => {
    if (mark.type === 'bold') return `**${value}**`
    if (mark.type === 'italic') return `_${value}_`
    if (mark.type === 'code') return `\`${value}\``
    if (mark.type === 'link') return `[${value}](${mark.attrs?.href || value})`
    return value
  }, text)
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
  const [messages, setMessages] = useState<LocalMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [showChannelForm, setShowChannelForm] = useState(false)
  const [showDmForm, setShowDmForm] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected')
  const [body, setBody] = useState('')
  const [composerTriggerText, setComposerTriggerText] = useState('')
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [lightboxAttachments, setLightboxAttachments] = useState<MessageAttachment[]>([])
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [activeThreadRootId, setActiveThreadRootId] = useState<number | null>(null)
  const [editing, setEditing] = useState<ChannelMessage | null>(null)
  const [editBody, setEditBody] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ChannelMessage[]>([])
  const [error, setError] = useState('')
  const [channelError, setChannelError] = useState('')
  const [dmUserId, setDmUserId] = useState('')
  const [, setToolbarTick] = useState(0)
  const [channelForm, setChannelForm] = useState({
    cohort_id: '',
    name: '',
    description: '',
    visibility: 'cohort',
  })
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composerFormRef = useRef<HTMLFormElement | null>(null)
  const lightboxTouchStartX = useRef<number | null>(null)

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
  const messagesById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages])
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
  const activeThreadMessages = useMemo(() => {
    if (!activeThreadRoot) return []

    return [activeThreadRoot, ...(threadReplies.get(activeThreadRoot.id) || [])]
  }, [activeThreadRoot, threadReplies])

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
    return composerTriggerText.match(/(^|\s)@([^\s@]*)$/)?.[2] ?? null
  }, [composerTriggerText])
  const commandToken = useMemo(() => {
    return composerTriggerText.match(/(^|\n)\/([a-z]*)$/)?.[2] ?? null
  }, [composerTriggerText])
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

  const lightboxAttachment = lightboxAttachments[lightboxIndex] || null

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: {
            class: 'rounded-lg bg-slate-900 px-3 py-2 text-sm leading-6 text-slate-100',
          },
        },
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: `Message ${selectedLabel}` }),
    ],
    editorProps: {
      attributes: {
        class: 'message-composer px-3 py-3 text-sm leading-6 text-slate-800 outline-none',
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files || [])
        if (files.length === 0) return false
        addFiles(files)
        return false
      },
      handleDrop: (_view, event) => {
        const files = Array.from(event.dataTransfer?.files || [])
        if (files.length === 0) return false
        event.preventDefault()
        addFiles(files)
        return true
      },
    },
    onUpdate: ({ editor }) => {
      setBody(editorJsonToMarkdown(editor.getJSON()).trim())
      setComposerTriggerText(editorTextBeforeCursor(editor))
    },
    onSelectionUpdate: ({ editor }) => {
      setComposerTriggerText(editorTextBeforeCursor(editor))
    },
    onTransaction: () => {
      setToolbarTick((current) => current + 1)
    },
  })

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
        if (prev.some((item) => item.id === message.id)) {
          return prev.map((item) => item.id === message.id ? mergeIncomingMessage(item, message) : item)
        }
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
    if (activeThreadRootId && !messagesById.has(activeThreadRootId)) {
      setActiveThreadRootId(null)
    }
  }, [activeThreadRootId, messagesById])

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
    setActiveThreadRootId(null)
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

  const uploadAttachments = async (attachmentsToUpload = pendingAttachments) => {
    if (!selectedTarget) return []

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
    if (!selectedTarget || !user) return

    const submittedBody = (editor ? editorJsonToMarkdown(editor.getJSON()) : body).trim()
    const submittedAttachments = pendingAttachments
    const threadRoot = activeThreadRoot
    if (!submittedBody && submittedAttachments.length === 0) return

    const tempId = -Date.now()
    const optimisticAttachments = submittedAttachments.map((attachment, index) => ({
      id: tempId - index - 1,
      filename: attachment.filename,
      content_type: attachment.content_type,
      byte_size: attachment.byte_size,
      image: attachment.content_type.startsWith('image/'),
      url: URL.createObjectURL(attachment.file),
    }))
    const optimisticMessage: LocalMessage = {
      id: tempId,
      channel_id: selectedTarget.type === 'channel' ? selectedTarget.id : null,
      direct_conversation_id: selectedTarget.type === 'dm' ? selectedTarget.id : null,
      parent_message_id: threadRoot?.id || null,
      body: submittedBody,
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
      author: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    }

    setMessages((prev) => [...prev, optimisticMessage])
    updateLatestForTarget(optimisticMessage)
    setBody('')
    setComposerTriggerText('')
    editor?.commands.clearContent()
    setPendingAttachments([])

    setSending(true)
    setError('')
    try {
      const attachments = await uploadAttachments(submittedAttachments)
      const payload = { body: submittedBody, parent_message_id: optimisticMessage.parent_message_id, attachments, send_push: true }
      const res = selectedTarget.type === 'channel'
        ? await api.createMessage(selectedTarget.id, payload)
        : await api.createDirectMessage(selectedTarget.id, payload)

      if (res.error) {
        setError(res.error)
        setMessages((prev) => prev.map((item) => item.id === tempId ? { ...item, pending: false, failed: true } : item))
      } else if (res.data) {
        const message = res.data.message
        setMessages((prev) => [...prev.filter((item) => item.id !== tempId && item.id !== message.id), message])
        updateLatestForTarget(message)
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send message.')
      setMessages((prev) => prev.map((item) => item.id === tempId ? { ...item, pending: false, failed: true } : item))
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
      setPushMessage(messageNotificationHint(Boolean(config.data?.configured), publicKey))
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
    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) return

    event.preventDefault()
    addFiles(files)
  }

  const insertIntoComposer = (insert: string, replacePattern?: RegExp) => {
    if (!editor) return

    if (replacePattern) {
      const match = composerTriggerText.match(replacePattern)
      if (match) {
        const from = editor.state.selection.from - match[0].trimStart().length
        editor.chain().focus().deleteRange({ from, to: editor.state.selection.from }).insertContent(insert).run()
        return
      }
    }

    editor.chain().focus().insertContent(insert).run()
  }

  const selectMention = (availableUser: UserSummary) => {
    insertIntoComposer(`@${availableUser.full_name} `, /(^|\s)@[^\s@]*$/)
  }

  const insertCodeBlock = () => {
    if (!editor) return

    const { from, to, empty } = editor.state.selection
    const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, '\n', '\n')
    const insertAt = from

    const chain = editor.chain().focus()
    if (!empty) chain.deleteRange({ from, to })
    chain.insertContentAt(insertAt, {
      type: 'codeBlock',
      ...(selectedText ? { content: [{ type: 'text', text: selectedText }] } : {}),
    }).run()

    window.requestAnimationFrame(() => {
      const cursorOffset = selectedText.length > 0 ? selectedText.length + 1 : 1
      editor.chain().focus().setTextSelection(insertAt + cursorOffset).run()
    })
  }

  const runToolbarCommand = (event: MouseEvent<HTMLButtonElement>, command: () => void) => {
    event.preventDefault()
    command()
    setToolbarTick((current) => current + 1)
  }

  const selectCommand = (command: string) => {
    if (!editor) return
    const match = composerTriggerText.match(/(^|\n)\/[a-z]*$/)
    if (match) {
      editor.chain().focus().deleteRange({ from: editor.state.selection.from - match[0].trimStart().length, to: editor.state.selection.from }).run()
    }

    if (command === '/code') insertCodeBlock()
    else if (command === '/quote') editor.chain().focus().toggleBlockquote().run()
    else if (command === '/todo') editor.chain().focus().insertContent('- [ ] ').run()
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
        setComposerTriggerText('')
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
        selectCommand(commandSuggestions[activeCommandIndex].command)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setComposerTriggerText('')
        return
      }
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      composerFormRef.current?.requestSubmit()
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
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Create channel</h3>
                  <p className="text-xs text-slate-500">Add a shared space to this cohort.</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowChannelForm(false)
                    setChannelError('')
                  }}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Cancel channel creation"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
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
                <button
                  type="button"
                  onClick={() => {
                    setShowChannelForm(false)
                    setChannelError('')
                  }}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {showDmForm && (
            <form onSubmit={handleCreateDm} className="border-b border-slate-200 bg-white p-3">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Start direct message</h3>
                  <p className="text-xs text-slate-500">Pick someone in this workspace.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDmForm(false)}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Cancel direct message"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
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
                <button
                  type="button"
                  onClick={() => setShowDmForm(false)}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
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
                  className={`relative flex h-14 w-full flex-col items-center justify-center rounded-lg text-[10px] font-semibold ${selectedTarget?.type === 'channel' && selectedTarget.id === channel.id ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}
                >
                  {channel.visibility === 'staff_only' ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                  <span className="mt-0.5 max-w-12 truncate">{channelInitials(channel.name)}</span>
                  {channel.unread_count > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-primary-500" />}
                </button>
              ))}
              <div className="my-2 border-t border-slate-200" />
              {visibleDms.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => selectTarget({ type: 'dm', id: conversation.id })}
                  title={conversation.title}
                  className={`relative flex h-14 w-full flex-col items-center justify-center rounded-lg text-[10px] font-semibold ${selectedTarget?.type === 'dm' && selectedTarget.id === conversation.id ? 'bg-primary-50 text-primary-700' : 'text-slate-500 hover:bg-white hover:text-slate-800'}`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white text-xs shadow-sm">
                    {initials(conversation.title)}
                  </span>
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
                {activeThreadRoot && (
                  <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Thread</p>
                        <p className="mt-1 text-sm text-slate-600">
                          {activeThreadMessages.length - 1} {activeThreadMessages.length - 1 === 1 ? 'reply' : 'replies'} under this message
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveThreadRootId(null)}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        Back to channel
                      </button>
                    </div>
                  </div>
                )}
                {(activeThreadRoot ? activeThreadMessages : rootMessages).length === 0 ? (
                  <div className="py-16 text-center text-sm text-slate-500">
                    {activeThreadRoot ? 'No replies yet. Start the thread.' : 'No messages yet. Start the conversation.'}
                  </div>
                ) : (activeThreadRoot ? activeThreadMessages : rootMessages).map((message) => {
                  const rootId = rootMessageIdFor(message, messagesById)
                  const replyCount = threadReplies.get(rootId)?.length || 0

                  return (
                    <MessageRow
                      key={message.id}
                      message={message}
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
                      inThreadView={Boolean(activeThreadRoot)}
                      replyCount={!activeThreadRoot && !message.parent_message_id ? replyCount : 0}
                      onReply={() => setActiveThreadRootId(rootId)}
                      onReact={(emoji) => toggleReaction(message, emoji)}
                      onOpenImage={(attachment, imageAttachments) => {
                        setLightboxAttachments(imageAttachments)
                        setLightboxIndex(Math.max(0, imageAttachments.findIndex((item) => item.id === attachment.id)))
                      }}
                    />
                  )
                })}
                <div ref={bottomRef} />
              </div>

              <form ref={composerFormRef} onSubmit={handleSend} className="border-t border-slate-200 bg-white p-3">
                {error && (
                  <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    {error}
                  </div>
                )}
                {activeThreadRoot && (
                  <div className="mb-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    <span>Replying in thread to {activeThreadRoot.author.full_name}: {preview(activeThreadRoot.body)}</span>
                    <button type="button" onClick={() => setActiveThreadRootId(null)} className="rounded-lg p-1 hover:bg-white">
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
                    <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => fileInputRef.current?.click()} className="rounded-lg p-2 hover:bg-slate-50" aria-label="Attach files">
                      <Paperclip className="h-4 w-4" />
                    </button>
                    <button type="button" onMouseDown={(event) => runToolbarCommand(event, () => editor?.chain().focus().toggleBold().run())} className={`rounded-lg p-2 hover:bg-slate-50 ${editor?.isActive('bold') ? 'bg-slate-100 text-slate-900' : ''}`} aria-label="Bold">
                      <Bold className="h-4 w-4" />
                    </button>
                    <button type="button" onMouseDown={(event) => runToolbarCommand(event, () => editor?.chain().focus().toggleItalic().run())} className={`rounded-lg p-2 hover:bg-slate-50 ${editor?.isActive('italic') ? 'bg-slate-100 text-slate-900' : ''}`} aria-label="Italic">
                      <Italic className="h-4 w-4" />
                    </button>
                    <button type="button" onMouseDown={(event) => runToolbarCommand(event, () => editor?.chain().focus().toggleCode().run())} className={`rounded-lg p-2 hover:bg-slate-50 ${editor?.isActive('code') ? 'bg-slate-100 text-slate-900' : ''}`} aria-label="Inline code">
                      <Code2 className="h-4 w-4" />
                    </button>
                    <button type="button" onMouseDown={(event) => runToolbarCommand(event, insertCodeBlock)} className={`rounded-lg px-2 py-1 text-sm hover:bg-slate-50 ${editor?.isActive('codeBlock') ? 'bg-slate-100 text-slate-900' : ''}`}>Code block</button>
                    <button type="button" onMouseDown={(event) => { event.preventDefault(); insertIntoComposer('@') }} className="rounded-lg px-2 py-1 text-sm hover:bg-slate-50">@ mention</button>
                    <button type="button" onMouseDown={(event) => { event.preventDefault(); insertIntoComposer('/') }} className="rounded-lg px-2 py-1 text-sm hover:bg-slate-50">/ command</button>
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
                  </div>
                  <div className="p-2">
                    <div className="min-h-0 min-w-0">
                      <EditorContent editor={editor} onKeyDown={handleComposerKeyDown} />
                    </div>
                  </div>
                  <div className="flex items-end justify-end border-t border-slate-100 px-3 py-3">
                    <button
                      type="submit"
                      disabled={sending || (!body.trim() && pendingAttachments.length === 0)}
                      className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label={sending ? 'Sending message' : 'Send message'}
                    >
                      <Send className="h-4 w-4" />
                      <span>Send</span>
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
                          onClick={() => selectCommand(item.command)}
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
                <p className="mt-2 text-xs text-slate-400">
                  Press Cmd+Enter or Ctrl+Enter to send. Paste or drop screenshots, use @ for people, / for snippets, and backticks for code.
                </p>
              </form>
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
              Pick a channel or start a direct message.
            </div>
          )}
        </section>
      </div>
      {lightboxAttachment?.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          onTouchStart={(event) => {
            lightboxTouchStartX.current = event.touches[0]?.clientX ?? null
          }}
          onTouchEnd={(event) => {
            if (lightboxTouchStartX.current === null) return
            const endX = event.changedTouches[0]?.clientX
            if (endX === undefined) {
              lightboxTouchStartX.current = null
              return
            }
            const delta = endX - lightboxTouchStartX.current
            lightboxTouchStartX.current = null
            if (Math.abs(delta) < 60) return
            if (delta < 0) showNextLightboxImage()
            else showPreviousLightboxImage()
          }}
        >
          <button
            type="button"
            onClick={closeLightbox}
            className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Close image preview"
          >
            <X className="h-5 w-5" />
          </button>
          {lightboxAttachments.length > 1 && (
            <>
              <button
                type="button"
                onClick={showPreviousLightboxImage}
                disabled={lightboxIndex === 0}
                className="absolute left-4 top-1/2 rounded-lg bg-white/10 p-3 text-white hover:bg-white/20 disabled:opacity-30"
                aria-label="Previous image"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <button
                type="button"
                onClick={showNextLightboxImage}
                disabled={lightboxIndex === lightboxAttachments.length - 1}
                className="absolute right-4 top-1/2 rounded-lg bg-white/10 p-3 text-white hover:bg-white/20 disabled:opacity-30"
                aria-label="Next image"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}
          <div className="max-h-full max-w-5xl overflow-hidden rounded-lg bg-white shadow-2xl">
            <img src={lightboxAttachment.url} alt={lightboxAttachment.filename} className="max-h-[80vh] w-full object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-sm text-slate-700">
              <div className="min-w-0">
                <div className="truncate font-medium">{lightboxAttachment.filename}</div>
                <div className="text-slate-500">
                  {lightboxAttachments.length > 1 && `${lightboxIndex + 1} of ${lightboxAttachments.length} · `}
                  {formatFileSize(lightboxAttachment.byte_size)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href={lightboxAttachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Open
                </a>
                <button
                  type="button"
                  onClick={downloadLightboxAttachment}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Download className="h-4 w-4" />
                  Download
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
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
  editing,
  editBody,
  setEditBody,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onPin,
  canPin,
  inThreadView,
  replyCount,
  onReply,
  onReact,
  onOpenImage,
}: {
  message: LocalMessage
  editing: boolean
  editBody: string
  setEditBody: (value: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
  onPin: () => void
  canPin: boolean
  inThreadView: boolean
  replyCount: number
  onReply: () => void
  onReact: (emoji: string) => void
  onOpenImage: (attachment: MessageAttachment, imageAttachments: MessageAttachment[]) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const imageAttachments = message.attachments.filter((attachment) => attachment.image && attachment.url)
  const renderedReactions = [
    ...message.reactions.map((reaction) => reaction.emoji),
    ...REACTIONS.filter((emoji) => !message.reactions.some((reaction) => reaction.emoji === emoji)),
  ]

  return (
    <div className={`group mb-3 flex gap-3 rounded-lg px-2 py-2 hover:bg-slate-50 ${message.pinned_at ? 'bg-amber-50/70' : ''} ${message.pending ? 'opacity-75' : ''}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-sm font-semibold text-slate-600">
        {message.author.avatar_url ? <img src={message.author.avatar_url} alt="" className="h-9 w-9 rounded-lg object-cover" /> : message.author.full_name.slice(0, 1)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-900">{message.author.full_name}</span>
          <span className="text-xs text-slate-400">{formatTime(message.created_at)}</span>
          {message.edited_at && <span className="text-xs text-slate-400">Edited</span>}
          {message.pending && <span className="text-xs text-slate-400">Sending...</span>}
          {message.failed && <span className="text-xs font-medium text-red-600">Not sent</span>}
          {message.pinned_at && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"><Pin className="h-3 w-3" /> Pinned</span>}
        </div>
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
              attachment.image && attachment.url ? (
              <button
                key={attachment.id}
                type="button"
                onClick={() => onOpenImage(attachment, imageAttachments)}
                className="rounded-lg border border-slate-200 bg-white p-2 text-left text-sm text-slate-700 hover:border-primary-200 hover:bg-primary-50"
              >
                <img src={attachment.url} alt={attachment.filename} className="mb-2 max-h-56 w-full rounded-lg object-cover" />
                <div className="truncate font-medium">{attachment.filename}</div>
                <div className="text-xs text-slate-500">{formatFileSize(attachment.byte_size)}</div>
              </button>
              ) : (
              <a
                key={attachment.id}
                href={attachment.url}
                download={attachment.filename}
                className="rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700 hover:border-primary-200 hover:bg-primary-50"
              >
                <File className="mb-2 h-5 w-5 text-slate-400" />
                <div className="truncate font-medium">{attachment.filename}</div>
                <div className="text-xs text-slate-500">{formatFileSize(attachment.byte_size)}</div>
              </a>
              )
            ))}
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-1">
          {renderedReactions.map((emoji) => {
            const reaction = message.reactions.find((item) => item.emoji === emoji)
            return (
              <div key={emoji} className="group/reaction relative">
                <button
                  onClick={() => onReact(emoji)}
                  className={`rounded-lg border px-2 py-1 text-xs ${reaction?.reacted ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                >
                  {emoji} {reaction?.count || ''}
                </button>
                {reaction && reaction.users.length > 0 && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg group-hover/reaction:block">
                    <div className="font-medium">{emoji}</div>
                    <div className="mt-1 whitespace-nowrap">{reaction.users.map((user) => user.full_name).join(', ')}</div>
                  </div>
                )}
              </div>
            )
          })}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPickerOpen((current) => !current)}
              className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
            >
              <SmilePlus className="h-4 w-4" />
            </button>
            {pickerOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                <EmojiPicker
                  width={320}
                  height={380}
                  theme={Theme.LIGHT}
                  onEmojiClick={(data: EmojiClickData) => {
                    onReact(data.emoji)
                    setPickerOpen(false)
                  }}
                />
              </div>
            )}
          </div>
          <button onClick={onReply} className="rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100">
            {inThreadView ? 'Reply in thread' : 'Reply'}
          </button>
          {!inThreadView && replyCount > 0 && (
            <button onClick={onReply} className="rounded-lg px-2 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50">
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
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
