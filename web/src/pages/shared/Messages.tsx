import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import EmojiPicker, { Theme, type EmojiClickData } from 'emoji-picker-react'
import {
  Bell,
  BellOff,
  Bold,
  Check,
  CheckCheck,
  ChevronDown,
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
  Smartphone,
  Trash2,
  Type,
  UserPlus,
  Users,
  X,
} from 'lucide-react'
import { api } from '../../lib/api'
import { subscribeToUserMessages } from '../../lib/realtime'
import { disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported } from '../../lib/pushNotifications'
import { formatFileSize, uploadToS3 } from '../../lib/uploadToS3'
import { useAuthContext } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { Modal } from '../../components/shared/Modal'
import type {
  ChannelMessage,
  ChannelMessageEvent,
  ChannelSummary,
  DirectConversationSummary,
  MessageAttachment,
  UserSummary,
  WorkspaceDetail,
  WorkspaceSummary,
} from '../../types/api'

type Target = { type: 'channel'; id: number } | { type: 'dm'; id: number }
type TargetLoadOptions = { aroundMessageId?: number; highlightedMessageId?: number }
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
type MentionSuggestion = {
  id: string
  label: string
  subtitle: string
  kind: 'user' | 'channel'
}
type MentionPattern = {
  label: string
  normalized: string
  kind: 'user' | 'channel'
}
type MentionableUser = Pick<UserSummary, 'id' | 'full_name' | 'email'>
type MessageSearchResult = ChannelMessage & {
  context?: {
    type: 'channel' | 'direct_conversation'
    id: number
    label: string
    cohort_id: number | null
  }
}

type ReadReceipts = NonNullable<ChannelMessage['read_receipts']>

function readReceiptLabel(readReceipts: ReadReceipts): string {
  if (readReceipts.count === 1) return readReceipts.users[0]?.full_name || '1 person'
  return `${readReceipts.count} people`
}

function readReceiptTitle(readReceipts: ReadReceipts): string {
  const names = readReceipts.users.map((user) => user.full_name)
  const hiddenCount = readReceipts.count - names.length
  if (hiddenCount > 0) names.push(`${hiddenCount} more`)
  return names.join(', ')
}

const REACTIONS = ['👍', '❤️', '✅', '🙌']
const CHANNEL_MENTION_ALIASES = [
  { label: '@everyone', subtitle: 'Notify everyone in this channel' },
]
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

function sameDay(left: string, right: string) {
  return new Date(left).toDateString() === new Date(right).toDateString()
}

function closeInTime(left: string, right: string, minutes = 5) {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) <= minutes * 60 * 1000
}

function shouldCompactMessage(message: ChannelMessage, previousMessage?: ChannelMessage) {
  return Boolean(
    previousMessage &&
    previousMessage.author.id === message.author.id &&
    !previousMessage.pinned_at &&
    !message.pinned_at &&
    sameDay(previousMessage.created_at, message.created_at) &&
    closeInTime(previousMessage.created_at, message.created_at),
  )
}

function formatDayDivider(value: string) {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)

  if (date.toDateString() === today.toDateString()) return 'Today'
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'

  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
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

function sortChronologicalMessages<T extends ChannelMessage>(items: T[]) {
  return [...items].sort((a, b) => {
    const createdDelta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    if (createdDelta !== 0) return createdDelta
    return a.id - b.id
  })
}

function sortPinnedMessages<T extends ChannelMessage>(items: T[]) {
  return [...items].sort((a, b) => {
    const pinnedDelta = new Date(b.pinned_at || b.created_at).getTime() - new Date(a.pinned_at || a.created_at).getTime()
    if (pinnedDelta !== 0) return pinnedDelta
    return b.id - a.id
  })
}

function upsertPinnedMessage(prev: LocalMessage[], incoming: LocalMessage) {
  if (!incoming.pinned_at || incoming.deleted_at) {
    return prev.filter((item) => item.id !== incoming.id)
  }

  const next = prev.some((item) => item.id === incoming.id)
    ? prev.map((item) => item.id === incoming.id ? mergeIncomingMessage(item, incoming) : item)
    : [...prev, incoming]

  return sortPinnedMessages(next)
}

function editorTextBeforeCursor(editor: Editor) {
  const from = editor.state.selection.from
  return editor.state.doc.textBetween(Math.max(0, from - 80), from, '\n', '\n')
}

function stripMentionLabel(value: string) {
  return value.replace(/^@/, '').trim().toLowerCase()
}

function escapeMentionRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isMentionStartBoundary(text: string, index: number) {
  if (index === 0) return true
  return /[\s([{'"“‘>]/.test(text[index - 1] || '')
}

function isMentionEndBoundary(char?: string) {
  return !char || /[\s)\]}.,!?;:'"”’]/.test(char)
}

function messageContainsMention(body: string, fullName: string) {
  const trimmed = fullName.trim()
  if (!trimmed) return false

  const pattern = new RegExp(`(^|[^\\w])@${escapeMentionRegExp(trimmed)}(?=$|[\\s)\\]}.,!?;:'"”’])`, 'i')
  return pattern.test(body)
}

function resolveMentionedUserIds(body: string, mentionableUsers: MentionableUser[], selectedIds: number[]) {
  if (!body.trim()) return []

  const usersById = new Map(mentionableUsers.map((user) => [user.id, user]))
  const nameCounts = mentionableUsers.reduce((counts, user) => {
    const normalized = user.full_name.trim().toLowerCase()
    if (!normalized) return counts

    counts.set(normalized, (counts.get(normalized) || 0) + 1)
    return counts
  }, new Map<string, number>())

  const resolved = selectedIds.filter((id) => {
    const user = usersById.get(id)
    return Boolean(user?.full_name && messageContainsMention(body, user.full_name))
  })

  mentionableUsers.forEach((user) => {
    const normalized = user.full_name.trim().toLowerCase()
    if (!normalized) return
    if ((nameCounts.get(normalized) || 0) > 1) return
    if (!messageContainsMention(body, user.full_name)) return
    if (resolved.includes(user.id)) return

    resolved.push(user.id)
  })

  return resolved
}

function buildMentionPatterns(names: string[], includeChannel: boolean) {
  const seen = new Set<string>()
  const patterns: MentionPattern[] = []

  if (includeChannel) {
    CHANNEL_MENTION_ALIASES.forEach((mention) => {
      const normalized = mention.label.toLowerCase()
      seen.add(normalized)
      patterns.push({ label: mention.label, normalized, kind: 'channel' })
    })
  }

  names
    .map((name) => name.trim())
    .filter(Boolean)
    .forEach((name) => {
      const label = `@${name}`
      const normalized = label.toLowerCase()
      if (seen.has(normalized)) return
      seen.add(normalized)
      patterns.push({ label, normalized, kind: 'user' })
    })

  return patterns.sort((left, right) => right.label.length - left.label.length)
}

function findMentionMatches(text: string, patterns: MentionPattern[]) {
  const matches: Array<{ from: number; to: number; kind: MentionPattern['kind']; text: string }> = []
  let index = 0

  while (index < text.length) {
    if (text[index] !== '@' || !isMentionStartBoundary(text, index)) {
      index += 1
      continue
    }

    const match = patterns.find((pattern) => {
      if (text.slice(index, index + pattern.label.length).toLowerCase() !== pattern.normalized) return false
      return isMentionEndBoundary(text[index + pattern.label.length])
    })

    if (!match) {
      index += 1
      continue
    }

    matches.push({
      from: index,
      to: index + match.label.length,
      kind: match.kind,
      text: text.slice(index, index + match.label.length),
    })
    index += match.label.length
  }

  return matches
}

function renderTextWithMentions(text: string, patterns: MentionPattern[]) {
  const matches = findMentionMatches(text, patterns)
  if (matches.length === 0) return [<span key="text-0">{text}</span>]

  const nodes: ReactNode[] = []
  let cursor = 0

  matches.forEach((match, index) => {
    if (cursor < match.from) {
      nodes.push(<span key={`text-${index}-${cursor}`}>{text.slice(cursor, match.from)}</span>)
    }

    nodes.push(
      <span
        key={`mention-${index}-${match.from}`}
        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
          match.kind === 'channel'
            ? 'bg-amber-100 text-amber-800'
            : 'bg-sky-100 text-sky-800'
        }`}
      >
        {match.text}
      </span>,
    )

    cursor = match.to
  })

  if (cursor < text.length) {
    nodes.push(<span key={`text-tail-${cursor}`}>{text.slice(cursor)}</span>)
  }

  return nodes
}

const mentionHighlightPluginKey = new PluginKey('messageMentionHighlight')

const MentionHighlightExtension = Extension.create<{ getPatterns: () => MentionPattern[] }>({
  name: 'messageMentionHighlight',

  addOptions() {
    return {
      getPatterns: () => [],
    }
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: mentionHighlightPluginKey,
        props: {
          decorations: (state) => {
            const patterns = this.options.getPatterns()
            if (patterns.length === 0) return null

            const decorations: Decoration[] = []

            state.doc.descendants((node, pos, parent) => {
              if (!node.isText || !node.text) return
              if (parent?.type.name === 'codeBlock') return
              if (node.marks.some((mark) => mark.type.name === 'code')) return

              findMentionMatches(node.text, patterns).forEach((match) => {
                decorations.push(Decoration.inline(pos + match.from, pos + match.to, {
                  class: match.kind === 'channel'
                    ? 'message-mention message-mention--channel'
                    : 'message-mention',
                }))
              })
            })

            return decorations.length > 0 ? DecorationSet.create(state.doc, decorations) : null
          },
        },
      }),
    ]
  },
})

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
  const toast = useToast()
  const isStaff = Boolean(user?.is_staff)
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
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected')
  const [body, setBody] = useState('')
  const [composerMentionUserIds, setComposerMentionUserIds] = useState<number[]>([])
  const [composerTriggerText, setComposerTriggerText] = useState('')
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [activeCommandIndex, setActiveCommandIndex] = useState(0)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [lightboxAttachments, setLightboxAttachments] = useState<MessageAttachment[]>([])
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [channelsCollapsed, setChannelsCollapsed] = useState(false)
  const [dmsCollapsed, setDmsCollapsed] = useState(false)
  const [conversationView, setConversationView] = useState<'messages' | 'pins'>('messages')
  const [activeThreadRootId, setActiveThreadRootId] = useState<number | null>(null)
  const [isDesktop, setIsDesktop] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  const [mobilePane, setMobilePane] = useState<'list' | 'conversation' | 'thread'>(selectedTarget ? 'conversation' : 'list')
  const [editing, setEditing] = useState<ChannelMessage | null>(null)
  const [mobileActionsMessageId, setMobileActionsMessageId] = useState<number | null>(null)
  const [messagePendingDelete, setMessagePendingDelete] = useState<LocalMessage | null>(null)
  const [editBody, setEditBody] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<MessageSearchResult[]>([])
  const [highlightedMessageId, setHighlightedMessageId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [workspaceError, setWorkspaceError] = useState('')
  const [channelError, setChannelError] = useState('')
  const [dmUserId, setDmUserId] = useState('')
  const [memberToAddId, setMemberToAddId] = useState('')
  const [, setToolbarTick] = useState(0)
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
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const messageScrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composerFormRef = useRef<HTMLFormElement | null>(null)
  const lightboxTouchStartX = useRef<number | null>(null)
  const optimisticAttachmentUrls = useRef(new Map<number, string[]>())
  const tempMessageIdRef = useRef(0)
  const targetRequestRef = useRef(0)
  const targetLoadOptionsRef = useRef<TargetLoadOptions>({})
  const shouldStickToBottomRef = useRef(true)
  const activeThreadRootIdRef = useRef<number | null>(activeThreadRootId)
  const isDesktopRef = useRef(isDesktop)
  const mobilePaneRef = useRef(mobilePane)
  const selectedTargetRef = useRef<Target | null>(selectedTarget)
  const deferredSearchQuery = useDeferredValue(searchQuery)

  activeThreadRootIdRef.current = activeThreadRootId
  isDesktopRef.current = isDesktop
  mobilePaneRef.current = mobilePane
  selectedTargetRef.current = selectedTarget

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
  const mobileActionsMessage = mobileActionsMessageId ? messagesById.get(mobileActionsMessageId) || null : null
  const activeThreadMessages = useMemo(() => {
    if (!activeThreadRoot) return []

    return [activeThreadRoot, ...(threadReplies.get(activeThreadRoot.id) || [])]
  }, [activeThreadRoot, threadReplies])

  const visibleChannels = useMemo(
    () => selectedWorkspaceId ? channels.filter((channel) => channel.workspace_id === selectedWorkspaceId) : channels,
    [channels, selectedWorkspaceId],
  )

  const visibleDms = useMemo(
    () => selectedWorkspaceId ? directConversations.filter((conversation) => conversation.workspace_id === selectedWorkspaceId) : directConversations,
    [directConversations, selectedWorkspaceId],
  )

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
  const workspaceCards = useMemo(() => workspaces.map((workspace) => {
    const workspaceChannels = channels.filter((channel) => channel.workspace_id === workspace.id)
    const workspaceDms = directConversations.filter((conversation) => conversation.workspace_id === workspace.id)
    const unreadCount = [
      ...workspaceChannels.map((channel) => channel.unread_count),
      ...workspaceDms.map((conversation) => conversation.unread_count),
    ].reduce((sum, count) => sum + count, 0)

    return {
      workspace,
      channelCount: workspaceChannels.length,
      dmCount: workspaceDms.length,
      unreadCount,
    }
  }), [channels, directConversations, workspaces])
  const selectedPinnedMessages = useMemo(
    () => sortPinnedMessages(pinnedMessages),
    [pinnedMessages],
  )
  const channelsUnreadCount = useMemo(
    () => visibleChannels.reduce((sum, channel) => sum + channel.unread_count, 0),
    [visibleChannels],
  )
  const dmsUnreadCount = useMemo(
    () => visibleDms.reduce((sum, conversation) => sum + conversation.unread_count, 0),
    [visibleDms],
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
  const mentionPatterns = useMemo(
    () => buildMentionPatterns(
      mentionableUsers.map((mentionableUser) => mentionableUser.full_name),
      selectedTarget?.type === 'channel',
    ),
    [mentionableUsers, selectedTarget?.type],
  )
  const mentionPatternsRef = useRef<MentionPattern[]>(mentionPatterns)
  const mentionToken = useMemo(() => {
    return composerTriggerText.match(/(^|\s)@([^\s@]*)$/)?.[2] ?? null
  }, [composerTriggerText])
  const commandToken = useMemo(() => {
    return composerTriggerText.match(/(^|\n)\/([a-z]*)$/)?.[2] ?? null
  }, [composerTriggerText])
  const mentionSuggestions = useMemo<MentionSuggestion[]>(() => {
    if (mentionToken === null) return []

    const normalized = stripMentionLabel(mentionToken)
    const suggestions: MentionSuggestion[] = []

    if (selectedTarget?.type === 'channel') {
      CHANNEL_MENTION_ALIASES
        .filter((mention) => stripMentionLabel(mention.label).startsWith(normalized))
        .forEach((mention) => {
          suggestions.push({
            id: mention.label,
            label: mention.label,
            subtitle: mention.subtitle,
            kind: 'channel',
          })
        })
    }

    return [
      ...suggestions,
      ...mentionableUsers
        .filter((mentionableUser) => mentionableUser.full_name.toLowerCase().includes(normalized) || mentionableUser.email.toLowerCase().includes(normalized))
        .slice(0, 8)
        .map((mentionableUser) => ({
          id: String(mentionableUser.id),
          label: `@${mentionableUser.full_name}`,
          subtitle: mentionableUser.email,
          kind: 'user' as const,
        })),
    ]
  }, [mentionToken, mentionableUsers, selectedTarget?.type])
  const commandSuggestions = useMemo(() => {
    if (commandToken === null) return []
    return SLASH_COMMANDS.filter((item) => item.command.slice(1).startsWith(commandToken)).slice(0, 5)
  }, [commandToken])

  useEffect(() => {
    setActiveMentionIndex(0)
  }, [mentionToken])

  useEffect(() => {
    setComposerMentionUserIds([])
  }, [selectedTarget?.id, selectedTarget?.type])

  useEffect(() => {
    setActiveCommandIndex(0)
  }, [commandToken])

  const lightboxAttachment = lightboxAttachments[lightboxIndex] || null

  useLayoutEffect(() => {
    mentionPatternsRef.current = mentionPatterns
  }, [mentionPatterns])

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
      Placeholder.configure({ placeholder: 'Write a message' }),
      MentionHighlightExtension.configure({
        getPatterns: () => mentionPatternsRef.current,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'message-composer px-3 py-3 text-base leading-6 text-slate-800 outline-none sm:text-sm',
        autocapitalize: 'sentences',
        autocorrect: 'on',
        spellcheck: 'true',
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

  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr)
  }, [editor, mentionPatterns])

  const loadLists = async () => {
    const [workspaceRes, channelRes, dmRes] = await Promise.all([api.getWorkspaces(), api.getChannels(), api.getDirectConversations()])
    if (workspaceRes.data) setWorkspaces(workspaceRes.data.workspaces)
    if (channelRes.data) setChannels(channelRes.data.channels)
    if (dmRes.data) setDirectConversations(dmRes.data.direct_conversations)

    const firstTarget = channelRes.data?.channels[0]
      ? { type: 'channel' as const, id: channelRes.data.channels[0].id }
      : dmRes.data?.direct_conversations[0]
        ? { type: 'dm' as const, id: dmRes.data.direct_conversations[0].id }
        : null

    setSelectedTarget((current) => current || firstTarget)
    setSelectedWorkspaceId((current) => current || channelRes.data?.channels[0]?.workspace_id || dmRes.data?.direct_conversations[0]?.workspace_id || workspaceRes.data?.workspaces[0]?.id || null)
    setLoading(false)
  }

  const loadWorkspaceDetail = async (workspaceId: number) => {
    const workspaceRes = await api.getWorkspace(workspaceId)
    if (!workspaceRes.data) return

    setWorkspaceDetail(workspaceRes.data.workspace)

    if (isStaff && workspaceRes.data.workspace.can_manage) {
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

  const loadTarget = async (target: Target, markRead = false, options: TargetLoadOptions = {}) => {
    const requestId = targetRequestRef.current + 1
    targetRequestRef.current = requestId
    setLoadingTarget(true)
    shouldStickToBottomRef.current = !options.aroundMessageId

    if (target.type === 'channel') {
      const res = await api.getChannel(target.id, {
        around_message_id: options.aroundMessageId,
      })
      if (requestId !== targetRequestRef.current) return
      if (!res.data) {
        setLoadingTarget(false)
        return
      }

      setMessages(sortChronologicalMessages(res.data.messages || []))
      setPinnedMessages(sortPinnedMessages(res.data.pinned_messages || []))
      setChannels((prev) => prev.map((channel) => channel.id === target.id ? res.data!.channel : channel))
      setHighlightedMessageId(options.highlightedMessageId || null)
      if (markRead && channelNeedsRead(res.data.channel)) {
        await api.markChannelRead(target.id)
        setChannels((prev) => prev.map((channel) => channel.id === target.id ? { ...channel, unread_count: 0, last_read_at: new Date().toISOString() } : channel))
      }
      setLoadingTarget(false)
      return
    }

    const res = await api.getDirectConversation(target.id, {
      around_message_id: options.aroundMessageId,
    })
    if (requestId !== targetRequestRef.current) return
    if (!res.data) {
      setLoadingTarget(false)
      return
    }

    setMessages(sortChronologicalMessages(res.data.messages || []))
    setPinnedMessages(sortPinnedMessages(res.data.pinned_messages || []))
    setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? res.data!.direct_conversation : conversation))
    setHighlightedMessageId(options.highlightedMessageId || null)
    if (markRead && dmNeedsRead(res.data.direct_conversation)) {
      await api.markDirectConversationRead(target.id)
      setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? { ...conversation, unread_count: 0, last_read_at: new Date().toISOString() } : conversation))
    }
    setLoadingTarget(false)
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
    if (!selectedTarget) return
    const workspaceId = selectedChannel?.workspace_id || selectedDm?.workspace_id
    if (workspaceId) setSelectedWorkspaceId(workspaceId)
  }, [selectedTarget, selectedChannel, selectedDm])

  useEffect(() => {
    if (isDesktop) return
    setMobilePane(selectedTarget ? 'conversation' : 'list')
  }, [isDesktop, selectedTarget?.type, selectedTarget?.id])

  useEffect(() => {
    if (!selectedTarget) return

    const options = targetLoadOptionsRef.current
    targetLoadOptionsRef.current = {}
    loadTarget(selectedTarget, canAutoMarkRead(true), options)
    const interval = window.setInterval(() => loadTarget(selectedTarget, canAutoMarkRead()), 30000)
    const onFocus = () => loadTarget(selectedTarget, canAutoMarkRead())
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [selectedTarget?.type, selectedTarget?.id])

  useEffect(() => {
    if (!user) return

    let unsubscribe: (() => void) | null = null
    let active = true

    setRealtimeStatus('disconnected')

    subscribeToUserMessages((payload) => {
      if (!active) return
      const event = payload as ChannelMessageEvent
      if (!event.message) return

      const currentTarget = selectedTargetRef.current
      const belongsToTarget = Boolean(currentTarget) && (
        currentTarget!.type === 'channel'
          ? event.channel_id === currentTarget!.id
          : event.direct_conversation_id === currentTarget!.id
      )
      const message = { ...event.message, mine: event.message.mine ?? event.message.author.id === user.id }
      const shouldMarkIncomingRead = Boolean(belongsToTarget && !message.mine && event.event === 'created' && canAutoMarkRead())

      updateTargetSummaryFromEvent(event, message, message.mine || shouldMarkIncomingRead)

      if (belongsToTarget) {
        shouldStickToBottomRef.current = message.mine || shouldMarkIncomingRead || isNearConversationBottom()

        setMessages((prev) => {
          if (event.event === 'deleted') return prev.filter((item) => item.id !== message.id)
          if (prev.some((item) => item.id === message.id)) {
            return sortChronologicalMessages(prev.map((item) => item.id === message.id ? mergeIncomingMessage(item, message) : item))
          }
          return sortChronologicalMessages([...prev, message])
        })
        setPinnedMessages((prev) => {
          if (event.event === 'deleted') return prev.filter((item) => item.id !== message.id)
          return upsertPinnedMessage(prev, message)
        })

        if (shouldMarkIncomingRead && currentTarget) {
          markRead(currentTarget).catch(() => {})
        }
      }
    }, setRealtimeStatus).then((cleanup) => {
      if (active) unsubscribe = cleanup
      else cleanup()
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [user?.id])

  useEffect(() => {
    if (activeThreadRootId && !messagesById.has(activeThreadRootId)) {
      setActiveThreadRootId(null)
    }
  }, [activeThreadRootId, messagesById])

  useEffect(() => {
    if (mobileActionsMessageId && !messagesById.has(mobileActionsMessageId)) {
      setMobileActionsMessageId(null)
    }
  }, [messagesById, mobileActionsMessageId])

  useEffect(() => {
    setConversationView('messages')
  }, [selectedTarget?.type, selectedTarget?.id])

  useEffect(() => {
    if (isDesktop) return
    if (activeThreadRootId) setMobilePane('thread')
    else if (selectedTarget) setMobilePane('conversation')
  }, [activeThreadRootId, isDesktop, selectedTarget])

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
    if (!shouldStickToBottomRef.current) return
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, selectedTarget?.type, selectedTarget?.id])

  useEffect(() => {
    if (!highlightedMessageId) return

    const frame = window.requestAnimationFrame(() => {
      const element = document.getElementById(`message-${highlightedMessageId}`)
      element?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 2600)

    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
    }
  }, [highlightedMessageId])

  useEffect(() => {
    const trimmed = deferredSearchQuery.trim()
    if (trimmed.length < 2) {
      setSearchResults([])
      return
    }

    const timer = window.setTimeout(async () => {
      const res = await api.searchMessages(trimmed, 20)
      if (res.data) setSearchResults(res.data.results)
    }, 250)

    return () => window.clearTimeout(timer)
  }, [deferredSearchQuery])

  const updateLatestForTarget = (message: ChannelMessage, markRead = true) => {
    const unreadDelta = message.mine || markRead ? 0 : 1
    if (message.channel_id) {
      setChannels((prev) => prev.map((channel) => channel.id === message.channel_id ? {
        ...channel,
        unread_count: markRead ? 0 : channel.unread_count + unreadDelta,
        last_read_at: markRead ? new Date().toISOString() : channel.last_read_at,
        latest_message: latestMessageFrom(message),
      } : channel))
    }
    if (message.direct_conversation_id) {
      setDirectConversations((prev) => prev.map((conversation) => conversation.id === message.direct_conversation_id ? {
        ...conversation,
        unread_count: markRead ? 0 : conversation.unread_count + unreadDelta,
        last_read_at: markRead ? new Date().toISOString() : conversation.last_read_at,
        latest_message: latestMessageFrom(message),
      } : conversation))
    }
  }

  const updateTargetSummaryFromEvent = (event: ChannelMessageEvent, message: ChannelMessage, markRead = false) => {
    if (event.channel) {
      setChannels((prev) => {
        const next = markRead ? { ...event.channel!, unread_count: 0, last_read_at: new Date().toISOString() } : event.channel!
        return prev.some((channel) => channel.id === next.id)
          ? prev.map((channel) => channel.id === next.id ? next : channel)
          : [...prev, next].sort((left, right) => left.position - right.position || left.name.localeCompare(right.name))
      })
      return
    }

    if (event.direct_conversation) {
      setDirectConversations((prev) => {
        const next = markRead ? { ...event.direct_conversation!, unread_count: 0, last_read_at: new Date().toISOString() } : event.direct_conversation!
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

  const markRead = async (target: Target) => {
    if (target.type === 'channel') await api.markChannelRead(target.id)
    else await api.markDirectConversationRead(target.id)
  }

  const isNearConversationBottom = () => {
    const element = messageScrollRef.current
    if (!element) return true

    return element.scrollHeight - element.scrollTop - element.clientHeight < 96
  }

  const canAutoMarkRead = (ignoreScrollPosition = false) => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
    if (!isDesktopRef.current && mobilePaneRef.current !== 'conversation') return false
    if (activeThreadRootIdRef.current) return false

    return ignoreScrollPosition || isNearConversationBottom()
  }

  const selectTarget = (target: Target, options: TargetLoadOptions = {}) => {
    window.history.replaceState(null, '', target.type === 'channel' ? `/messages/${target.id}` : `/messages/dm/${target.id}`)
    targetLoadOptionsRef.current = options
    setLoadingTarget(true)
    shouldStickToBottomRef.current = !options.aroundMessageId
    startNavigationTransition(() => {
      setSelectedTarget(target)
      setActiveThreadRootId(null)
      setEditing(null)
      setConversationView('messages')
      if (!isDesktop) setMobilePane('conversation')
    })

    if (selectedTarget?.type === target.type && selectedTarget.id === target.id) {
      void loadTarget(target, canAutoMarkRead(true), options)
    }
  }

  const selectWorkspace = (id: number) => {
    startNavigationTransition(() => {
      setSelectedWorkspaceId(id)
      setChannelForm((prev) => ({ ...prev, workspace_id: String(id) }))
    })
    const firstChannel = channels.find((channel) => channel.workspace_id === id)
    const firstDm = directConversations.find((conversation) => conversation.workspace_id === id)
    if (firstChannel) selectTarget({ type: 'channel', id: firstChannel.id })
    else if (firstDm) selectTarget({ type: 'dm', id: firstDm.id })
    else {
      window.history.replaceState(null, '', '/messages')
      startNavigationTransition(() => {
        setSelectedTarget(null)
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
    const mentionUserIds = resolveMentionedUserIds(submittedBody, mentionableUsers, composerMentionUserIds)
    if (!submittedBody && submittedAttachments.length === 0) return

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
      author: {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
      },
    }

    shouldStickToBottomRef.current = true
    setMessages((prev) => sortChronologicalMessages([...prev, optimisticMessage]))
    updateLatestForTarget(optimisticMessage)
    setBody('')
    setComposerMentionUserIds([])
    setComposerTriggerText('')
    editor?.commands.clearContent()
    setPendingAttachments([])

    setSending(true)
    setError('')
    try {
      const attachments = await uploadAttachments(submittedAttachments)
      const payload = {
        body: submittedBody,
        parent_message_id: optimisticMessage.parent_message_id,
        mention_user_ids: mentionUserIds,
        attachments,
        send_push: true,
      }
      const res = selectedTarget.type === 'channel'
        ? await api.createMessage(selectedTarget.id, payload)
        : await api.createDirectMessage(selectedTarget.id, payload)

      if (res.error) {
        setError(res.error)
        toast.error(res.error)
        setMessages((prev) => prev.map((item) => item.id === tempId ? { ...item, pending: false, failed: true } : item))
      } else if (res.data) {
        const message = res.data.message
        releaseOptimisticAttachmentUrls(tempId)
        setMessages((prev) => sortChronologicalMessages([...prev.filter((item) => item.id !== tempId && item.id !== message.id), message]))
        updateLatestForTarget(message)
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Could not send message.'
      setError(message)
      toast.error(message)
      setMessages((prev) => prev.map((item) => item.id === tempId ? { ...item, pending: false, failed: true } : item))
    }
    setSending(false)
  }

  const handleCreateChannel = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!channelForm.workspace_id || !channelForm.name.trim()) return

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
        setPushMessage('Push notifications are off for this device.')
      } catch (toggleError) {
        setPushMessage(toggleError instanceof Error ? toggleError.message : 'Could not turn off notifications.')
      }
      return
    }

    const config = await api.getPushConfig()
    if (config.error) {
      setPushMessage(config.error)
      return
    }

    const configured = Boolean(config.data?.configured)
    const publicKey = config.data?.public_key || import.meta.env.VITE_WEB_PUSH_PUBLIC_KEY
    if (!configured || !publicKey) {
      setPushMessage(pushConfigurationHint({
        configured,
        missing: config.data?.missing || [],
        publicKey,
      }))
      return
    }

    try {
      await enablePushNotifications(publicKey)
      setPushEnabled(true)
      setPushMessage('Push notifications are on for every unmuted conversation in this workspace.')
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

  const selectMention = (mention: MentionSuggestion) => {
    if (mention.kind === 'user') {
      setComposerMentionUserIds((current) => current.includes(Number(mention.id)) ? current : [...current, Number(mention.id)])
    }
    insertIntoComposer(`${mention.label} `, /(^|\s)@[^\n]*$/)
  }

  const insertCodeBlock = () => {
    if (!editor) return

    editor.chain().focus().toggleCodeBlock().run()
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

    const mentionUserIds = resolveMentionedUserIds(editBody.trim(), mentionableUsers, message.mention_user_ids)
    const res = await api.updateMessage(message.id, { body: editBody.trim(), mention_user_ids: mentionUserIds })
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

  useEffect(() => () => {
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

  if (loading) return <LoadingSpinner message="Loading messages..." />

  const showListPane = isDesktop || mobilePane === 'list'
  const showConversationPane = isDesktop || mobilePane === 'conversation' || mobilePane === 'thread'
  const showCollapsedRail = isDesktop && sidebarCollapsed
  const showThreadPanel = Boolean(isDesktop && activeThreadRoot)
  const conversationMessages = activeThreadRoot && !showThreadPanel ? activeThreadMessages : rootMessages
  const showComposer = Boolean(selectedTarget) && (conversationView === 'messages' || Boolean(activeThreadRoot))
  const showPageIntro = !selectedTarget
  const showConversationHeaderPushMessage = Boolean(pushMessage) && Boolean(selectedTarget)
  const displayedMessages = conversationView === 'pins' && !activeThreadRoot ? selectedPinnedMessages : conversationMessages
  const renderComposer = (placement: 'main' | 'thread') => {
    const inThreadPanel = placement === 'thread'

    return (
      <form
        ref={composerFormRef}
        onSubmit={handleSend}
        className={`${inThreadPanel ? 'shrink-0 border-t border-slate-200 bg-white p-3' : 'shrink-0 border-t border-slate-200 bg-white px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 sm:px-4'}`}
      >
        {error && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}
        {activeThreadRoot && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="min-w-0 truncate">
              {inThreadPanel ? 'Replying in thread' : `Replying in thread to ${activeThreadRoot.author.full_name}: ${preview(activeThreadRoot.body)}`}
            </span>
            <button type="button" onClick={() => setActiveThreadRootId(null)} className="shrink-0 rounded-lg p-1 hover:bg-white" aria-label="Close thread reply">
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
          className="relative overflow-visible rounded-2xl border border-slate-200 bg-white shadow-[0_18px_42px_-30px_rgba(15,23,42,0.38)] transition-shadow focus-within:border-primary-200 focus-within:shadow-[0_20px_54px_-34px_rgba(239,68,68,0.42)]"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="messages-toolbar-scroll flex items-center gap-1.5 overflow-x-auto border-b border-slate-100 px-2 py-1.5 text-slate-500">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => fileInputRef.current?.click()} className="min-h-9 shrink-0 rounded-lg p-2 hover:bg-slate-50" aria-label="Attach files">
              <Paperclip className="h-4 w-4" />
            </button>
            <button type="button" onMouseDown={(event) => runToolbarCommand(event, () => editor?.chain().focus().toggleBold().run())} className={`min-h-9 shrink-0 rounded-lg p-2 hover:bg-slate-50 ${editor?.isActive('bold') ? 'bg-slate-100 text-slate-900' : ''}`} aria-label="Bold">
              <Bold className="h-4 w-4" />
            </button>
            <button type="button" onMouseDown={(event) => runToolbarCommand(event, () => editor?.chain().focus().toggleItalic().run())} className={`min-h-9 shrink-0 rounded-lg p-2 hover:bg-slate-50 ${editor?.isActive('italic') ? 'bg-slate-100 text-slate-900' : ''}`} aria-label="Italic">
              <Italic className="h-4 w-4" />
            </button>
            <button type="button" onMouseDown={(event) => runToolbarCommand(event, () => editor?.chain().focus().toggleCode().run())} className={`min-h-9 shrink-0 rounded-lg p-2 hover:bg-slate-50 ${editor?.isActive('code') ? 'bg-slate-100 text-slate-900' : ''}`} aria-label="Inline code">
              <Code2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onMouseDown={(event) => runToolbarCommand(event, insertCodeBlock)}
              className={`min-h-9 shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-slate-50 ${editor?.isActive('codeBlock') ? 'bg-slate-100 text-slate-900' : ''}`}
            >
              <span>Block</span>
            </button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); insertIntoComposer('@') }} className="min-h-9 shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-slate-50">@ mention</button>
            <button type="button" onMouseDown={(event) => { event.preventDefault(); insertIntoComposer('/') }} className="min-h-9 shrink-0 rounded-lg px-2.5 py-2 text-xs font-medium hover:bg-slate-50">/ command</button>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
          </div>
          <div className="p-2" onKeyDownCapture={handleComposerKeyDown}>
            <div className="min-h-0 min-w-0 rounded-xl bg-slate-50/70">
              <EditorContent editor={editor} />
            </div>
          </div>
          <div className="flex items-end justify-end border-t border-slate-100 px-3 py-2.5">
            <button
              type="submit"
              disabled={sending || (!body.trim() && pendingAttachments.length === 0)}
              className="inline-flex h-9 min-w-[104px] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-0"
              aria-label={sending ? 'Sending message' : 'Send message'}
            >
              <Send className="h-4 w-4" />
              <span>Send</span>
            </button>
          </div>
          {mentionSuggestions.length > 0 && (
            <div className={`absolute bottom-full z-30 mb-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg ${inThreadPanel ? 'left-2 right-2' : 'left-3 w-72'}`}>
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Mention someone</div>
              {mentionSuggestions.map((mention, index) => (
                <button
                  key={mention.id}
                  type="button"
                  onClick={() => selectMention(mention)}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${index === activeMentionIndex ? 'bg-primary-50 text-primary-800' : 'hover:bg-slate-50'}`}
                >
                  <span className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-semibold ${
                    mention.kind === 'channel' ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {mention.kind === 'channel' ? '#' : mention.label.replace(/^@/, '').slice(0, 1)}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-800">{mention.label}</span>
                    <span className="block truncate text-xs text-slate-500">{mention.subtitle}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          {commandSuggestions.length > 0 && (
            <div className={`absolute bottom-full z-30 mb-2 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg ${inThreadPanel ? 'left-2 right-2' : 'left-3 w-72'}`}>
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
      </form>
    )
  }

  return (
    <div className={`mx-auto flex w-full max-w-[1500px] flex-col ${showPageIntro ? 'min-h-[calc(100dvh-5.5rem)] gap-4' : 'h-[calc(100dvh-5.5rem)] gap-0 overflow-hidden'} lg:h-[calc(100dvh-5.5rem)] lg:px-4`}>
      {showPageIntro && (
      <div>
        <p className="text-sm font-medium text-primary-600">Communication</p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
            <p className="mt-1 text-sm text-slate-500">
              Workspace messaging for cohorts, alumni, staff groups, direct messages, files, and quick decisions.
              {realtimeStatus === 'connected' && <span className="ml-2 text-green-600">Live</span>}
              {realtimeStatus === 'error' && <span className="ml-2 text-amber-600">Reconnecting with refresh fallback</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!selectedTarget && pushSupported() && (
              <button
                type="button"
                onClick={handleTogglePush}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {pushEnabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                {pushEnabled ? 'Turn off push globally' : 'Turn on push globally'}
              </button>
            )}
          </div>
        </div>
        {pushMessage && !selectedTarget && (
          <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            {pushMessage}
          </div>
        )}
      </div>
      )}

      <div className={`${isDesktop ? 'grid overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_20px_54px_-42px_rgba(15,23,42,0.55)]' : 'flex overflow-hidden border-y border-slate-200 bg-white'} min-h-0 flex-1 ${isDesktop ? (sidebarCollapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[328px_minmax(0,1fr)]') : ''}`}>
        {showListPane && !sidebarCollapsed && (
        <aside className={`flex min-h-0 flex-1 flex-col bg-slate-50 ${isDesktop ? 'border-b border-slate-200 lg:border-b-0 lg:border-r' : ''}`}>
          <div className="shrink-0 border-b border-slate-200 bg-white p-3">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">{selectedWorkspace?.name || 'Workspaces'}</h2>
                <p className="text-xs text-slate-500">{isDesktop ? 'Workspace' : 'Choose a workspace, channel, or direct message'}</p>
              </div>
              <div className="flex items-center gap-1">
                {isStaff && (
                  <button
                    onClick={() => {
                      setShowWorkspaceForm(true)
                      setWorkspaceError('')
                    }}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Create workspace"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={loadLists}
                  className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Refresh messages"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                {isDesktop && (
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Collapse conversation list"
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            {workspaces.length > 1 && (
              <button
                type="button"
                onClick={() => setShowWorkspaceSwitcher(true)}
                className="group flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-semibold text-white">
                    {selectedWorkspace ? channelInitials(selectedWorkspace.name) : 'WS'}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{selectedWorkspace?.name || 'Choose workspace'}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {selectedWorkspace
                        ? `${selectedWorkspace.member_count} ${selectedWorkspace.member_count === 1 ? 'member' : 'members'}`
                        : `${workspaces.length} workspaces`}
                    </span>
                  </span>
                </span>
                <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-hover:text-slate-600" />
              </button>
            )}
            {selectedWorkspace && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{selectedWorkspace.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedWorkspace.workspace_type === 'community' ? 'Community workspace' : 'Cohort workspace'}
                      {' · '}
                      {selectedWorkspace.member_count} {selectedWorkspace.member_count === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                  {workspaceDetail?.can_manage && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowWorkspaceMembers(true)
                        setWorkspaceError('')
                      }}
                      className="shrink-0 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      {showWorkspaceMembers ? 'Hide members' : 'Manage'}
                    </button>
                  )}
                </div>
                {selectedWorkspace.description && (
                  <p className="mt-2 text-xs text-slate-500">{selectedWorkspace.description}</p>
                )}
              </div>
            )}
            <div className="relative mt-3">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search messages"
                className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-base focus:outline-none focus:ring-2 focus:ring-primary-500 sm:text-sm"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                  {searchResults.map((result) => (
                    <button
                      key={result.id}
                      onClick={() => {
                        selectTarget(
                          result.channel_id ? { type: 'channel', id: result.channel_id } : { type: 'dm', id: result.direct_conversation_id! },
                          { aroundMessageId: result.id, highlightedMessageId: result.id },
                        )
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

          <div className={`${isDesktop ? 'max-h-72 overflow-y-auto p-2 lg:max-h-[calc(100vh-13rem)]' : 'min-h-0 flex-1 overflow-y-auto p-2'}`}>
            <div className="mb-2 flex items-center justify-between px-2 pt-2">
              <button
                type="button"
                onClick={() => setChannelsCollapsed((current) => !current)}
                className="flex min-w-0 items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800"
                aria-expanded={!channelsCollapsed}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${channelsCollapsed ? '-rotate-90' : ''}`} />
                <span>Channels</span>
                {channelsUnreadCount > 0 && <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] text-primary-700">{channelsUnreadCount}</span>}
              </button>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400">{visibleChannels.length}</span>
                {isStaff && (
                  <button onClick={() => { setShowChannelForm(true); setChannelError('') }} className="rounded-lg p-1 text-slate-500 hover:bg-white" aria-label="Create channel">
                    <Plus className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
            {channelsCollapsed ? null : visibleChannels.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">No channels yet.</div>
            ) : visibleChannels.map((channel) => (
              <ConversationButton
                key={channel.id}
                active={selectedTarget?.type === 'channel' && selectedTarget.id === channel.id}
                icon={channel.visibility === 'staff_only' ? <Lock className="h-4 w-4 shrink-0" /> : <Hash className="h-4 w-4 shrink-0" />}
                title={channel.name}
                subtitle={channel.latest_message ? `${channel.latest_message.author_name}: ${preview(channel.latest_message.body)}` : channel.description || channel.workspace_name}
                unread={channel.unread_count}
                muted={channel.muted}
                onClick={() => selectTarget({ type: 'channel', id: channel.id })}
              />
            ))}

            <div className="mb-2 mt-4 flex items-center justify-between px-2">
              <button
                type="button"
                onClick={() => setDmsCollapsed((current) => !current)}
                className="flex min-w-0 items-center gap-1.5 rounded-lg py-1 pr-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800"
                aria-expanded={!dmsCollapsed}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${dmsCollapsed ? '-rotate-90' : ''}`} />
                <span>Direct messages</span>
                {dmsUnreadCount > 0 && <span className="rounded-full bg-primary-100 px-1.5 py-0.5 text-[10px] text-primary-700">{dmsUnreadCount}</span>}
              </button>
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-400">{visibleDms.length}</span>
                <button onClick={() => setShowDmForm(true)} className="rounded-lg p-1 text-slate-500 hover:bg-white" aria-label="Start direct message">
                  <UserPlus className="h-4 w-4" />
                </button>
              </div>
            </div>
            {dmsCollapsed ? null : visibleDms.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">No DMs yet.</div>
            ) : visibleDms.map((conversation) => (
              <ConversationButton
                key={conversation.id}
                active={selectedTarget?.type === 'dm' && selectedTarget.id === conversation.id}
                icon={<MessageCircle className="h-4 w-4 shrink-0" />}
                title={conversation.title}
                subtitle={conversation.latest_message ? `${conversation.latest_message.author_name}: ${preview(conversation.latest_message.body)}` : conversation.workspace_name}
                unread={conversation.unread_count}
                muted={conversation.muted}
                onClick={() => selectTarget({ type: 'dm', id: conversation.id })}
              />
            ))}
          </div>
        </aside>
        )}
        {showCollapsedRail && (
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

        {showConversationPane && (
        <section className="flex min-w-0 min-h-0 flex-1 flex-col bg-white">
          {selectedTarget && selected ? (
            <>
              <header className={`shrink-0 border-b border-slate-200/80 px-4 py-3 backdrop-blur-sm ${isDesktop ? 'bg-white/80' : 'bg-white'} sm:py-4`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    {isDesktop && sidebarCollapsed && (
                      <button
                        onClick={() => setSidebarCollapsed(false)}
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Show conversation list"
                      >
                        <PanelLeftOpen className="h-4 w-4" />
                      </button>
                    )}
                    {!isDesktop && (
                      <button
                        onClick={() => setMobilePane('list')}
                        className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Back to conversations"
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                    )}
                    {selectedTarget.type === 'channel'
                      ? selectedChannel?.visibility === 'staff_only'
                        ? <Lock className="h-5 w-5 shrink-0 text-slate-500" />
                        : <Hash className="h-5 w-5 shrink-0 text-slate-500" />
                      : <MessageCircle className="h-5 w-5 shrink-0 text-slate-500" />}
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-slate-900">{selectedLabel}</h2>
                      <p className="text-xs text-slate-500">{selected.workspace_name}{isNavigationPending && ' · updating'}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    {selectedTarget && (
                      <ConversationHeaderAction
                        onClick={toggleMute}
                        icon={selectedMuted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                        shortLabel={selectedMuted ? 'Unmute' : 'Mute'}
                        fullLabel={selectedMuted ? 'Unmute conversation' : 'Mute conversation'}
                        ariaLabel={selectedMuted ? 'Unmute conversation' : 'Mute conversation'}
                      />
                    )}
                    {pushSupported() && (
                      <ConversationHeaderAction
                        onClick={handleTogglePush}
                        icon={<Smartphone className="h-4 w-4" />}
                        shortLabel={pushEnabled ? 'Push off' : 'Push on'}
                        fullLabel={pushEnabled ? 'Turn off push globally' : 'Turn on push globally'}
                        ariaLabel={pushEnabled ? 'Turn off push notifications' : 'Turn on push notifications'}
                      />
                    )}
                    {selectedTarget.type === 'channel' && selectedChannel?.visibility === 'staff_only' && (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Staff only</span>
                    )}
                  </div>
                </div>
                {selectedTarget.type === 'channel' && selectedChannel?.description && <p className="mt-2 text-sm text-slate-500">{selectedChannel.description}</p>}
                {showConversationHeaderPushMessage && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {pushMessage}
                  </div>
                )}
                {!activeThreadRoot && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConversationView('messages')}
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        conversationView === 'messages'
                          ? 'bg-slate-900 text-white shadow-sm'
                          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Conversation
                    </button>
                    <button
                      type="button"
                      onClick={() => setConversationView('pins')}
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                        conversationView === 'pins'
                          ? 'bg-amber-500 text-white shadow-sm'
                          : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Pin className="h-3.5 w-3.5" />
                      Pinned
                      <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${conversationView === 'pins' ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-700'}`}>
                        {selectedPinnedMessages.length}
                      </span>
                    </button>
                  </div>
                )}
              </header>

              <div className={`relative min-w-0 min-h-0 flex-1 overflow-hidden ${showThreadPanel ? 'grid lg:grid-cols-[minmax(0,1fr)_380px]' : ''}`}>
                <div ref={messageScrollRef} className={`h-full min-w-0 overflow-y-auto overflow-x-hidden px-3 py-4 transition duration-200 sm:px-5 sm:py-5 ${loadingTarget || isNavigationPending ? 'opacity-60' : 'opacity-100'}`}>
                {activeThreadRoot && !showThreadPanel && (
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
                        onClick={() => {
                          setActiveThreadRootId(null)
                          if (!isDesktop) setMobilePane('conversation')
                        }}
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <ChevronLeft className="h-4 w-4" />
                        {selectedTarget.type === 'channel' ? 'Back to channel' : 'Back to conversation'}
                      </button>
                    </div>
                  </div>
                )}
                {!activeThreadRoot && conversationView === 'pins' && (
                  <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3 text-sm text-amber-800">
                    Pinned messages stay easy to find here for this workspace conversation.
                  </div>
                )}
                {displayedMessages.length === 0 ? (
                  <div className="flex min-h-full items-center justify-center py-16 text-center text-sm text-slate-500">
                    {activeThreadRoot
                      ? 'No replies yet. Start the thread.'
                      : conversationView === 'pins'
                        ? 'No pinned messages yet.'
                        : 'No messages yet. Start the conversation.'}
                  </div>
                ) : displayedMessages.map((message, index) => {
                  const previousMessage = displayedMessages[index - 1]
                  const rootId = rootMessageIdFor(message, messagesById)
                  const replyCount = threadReplies.get(rootId)?.length || 0
                  const compact = shouldCompactMessage(message, previousMessage)
                  const showDayDivider = !previousMessage || !sameDay(previousMessage.created_at, message.created_at)

                  return (
                    <div key={message.id}>
                      {showDayDivider && (
                        <div className="relative my-5 flex items-center justify-center">
                          <div className="absolute inset-x-0 top-1/2 border-t border-slate-200" />
                          <span className="relative rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                            {formatDayDivider(message.created_at)}
                          </span>
                        </div>
                      )}
                      <MessageRow
                        message={message}
                        compact={compact}
                        highlighted={highlightedMessageId === message.id}
                        editing={editing?.id === message.id}
                        editBody={editBody}
                        setEditBody={setEditBody}
                        onStartEdit={() => {
                          setEditing(message)
                          setEditBody(message.body)
                        }}
                        onCancelEdit={() => setEditing(null)}
                        onSaveEdit={() => saveEdit(message)}
                        onDelete={() => setMessagePendingDelete(message)}
                        onOpenActions={() => setMobileActionsMessageId(message.id)}
                        onPin={() => togglePin(message)}
                        canPin={isStaff}
                        inThreadView={Boolean(activeThreadRoot)}
                        replyCount={!activeThreadRoot && !message.parent_message_id ? replyCount : 0}
                        onReply={() => {
                          setActiveThreadRootId(rootId)
                          if (!isDesktop) setMobilePane('thread')
                        }}
                        onReact={(emoji) => toggleReaction(message, emoji)}
                        onOpenImage={(attachment, imageAttachments) => {
                          setLightboxAttachments(imageAttachments)
                          setLightboxIndex(Math.max(0, imageAttachments.findIndex((item) => item.id === attachment.id)))
                        }}
                        mentionPatterns={mentionPatterns}
                      />
                    </div>
                  )
                })}
                <div ref={bottomRef} />
                </div>
                {showThreadPanel && activeThreadRoot && (
                  <aside className="hidden min-h-0 border-l border-slate-200 bg-slate-50/70 lg:flex lg:flex-col">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Thread</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">
                          {activeThreadMessages.length - 1} {activeThreadMessages.length - 1 === 1 ? 'reply' : 'replies'} in {selectedLabel}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setActiveThreadRootId(null)}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        aria-label="Close thread"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
                      {activeThreadMessages.map((message, index) => {
                        const previousMessage = activeThreadMessages[index - 1]
                        const compact = shouldCompactMessage(message, previousMessage)

                        return (
                          <MessageRow
                            key={message.id}
                            message={message}
                            compact={compact}
                            highlighted={highlightedMessageId === message.id}
                            editing={editing?.id === message.id}
                            editBody={editBody}
                            setEditBody={setEditBody}
                            onStartEdit={() => {
                              setEditing(message)
                              setEditBody(message.body)
                            }}
                            onCancelEdit={() => setEditing(null)}
                            onSaveEdit={() => saveEdit(message)}
                            onDelete={() => setMessagePendingDelete(message)}
                            onOpenActions={() => setMobileActionsMessageId(message.id)}
                            onPin={() => togglePin(message)}
                            canPin={isStaff}
                            inThreadView
                            replyCount={0}
                            onReply={() => setActiveThreadRootId(activeThreadRoot.id)}
                            onReact={(emoji) => toggleReaction(message, emoji)}
                            onOpenImage={(attachment, imageAttachments) => {
                              setLightboxAttachments(imageAttachments)
                              setLightboxIndex(Math.max(0, imageAttachments.findIndex((item) => item.id === attachment.id)))
                            }}
                            mentionPatterns={mentionPatterns}
                          />
                        )
                      })}
                    </div>
                    {renderComposer('thread')}
                  </aside>
                )}
                {(loadingTarget || isNavigationPending) && (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-white/20 px-4 py-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Switching conversation…
                    </div>
                  </div>
                )}
              </div>

              {showComposer && !showThreadPanel && renderComposer('main')}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
              Pick a channel or start a direct message.
            </div>
          )}
        </section>
        )}
      </div>
      <Modal
        open={showWorkspaceSwitcher}
        onClose={() => setShowWorkspaceSwitcher(false)}
        title="Switch workspace"
        subtitle="Move between cohorts, communities, channels, and direct messages."
        size="lg"
      >
        <div className="space-y-3">
          {workspaceCards.map(({ workspace, channelCount, dmCount, unreadCount }) => {
            const active = workspace.id === selectedWorkspaceId

            return (
              <button
                key={workspace.id}
                type="button"
                onClick={() => {
                  selectWorkspace(workspace.id)
                  setShowWorkspaceSwitcher(false)
                }}
                className={`group flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left transition ${
                  active
                    ? 'border-primary-200 bg-primary-50/70 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${
                  active ? 'bg-primary-600 text-white' : 'bg-slate-900 text-white'
                }`}>
                  {channelInitials(workspace.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{workspace.name}</span>
                    {active && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-primary-700 ring-1 ring-primary-100">
                        <Check className="h-3 w-3" />
                        Current
                      </span>
                    )}
                  </span>
                  <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      {workspace.member_count} {workspace.member_count === 1 ? 'member' : 'members'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Hash className="h-3.5 w-3.5" />
                      {channelCount} {channelCount === 1 ? 'channel' : 'channels'}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <MessageCircle className="h-3.5 w-3.5" />
                      {dmCount} {dmCount === 1 ? 'DM' : 'DMs'}
                    </span>
                  </span>
                  {workspace.description && (
                    <span className="mt-2 block line-clamp-2 text-xs leading-5 text-slate-500">{workspace.description}</span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-2">
                  <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${
                    workspace.workspace_type === 'community'
                      ? 'bg-slate-100 text-slate-600'
                      : 'bg-sky-50 text-sky-700'
                  }`}>
                    {workspace.workspace_type === 'community' ? 'Community' : 'Cohort'}
                  </span>
                  {unreadCount > 0 && (
                    <span className="inline-flex min-w-6 justify-center rounded-full bg-primary-600 px-2 py-1 text-[11px] font-semibold text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </Modal>

      {isStaff && (
        <Modal
          open={showWorkspaceForm}
          onClose={() => {
            setShowWorkspaceForm(false)
            setWorkspaceError('')
          }}
          title="Create workspace"
          subtitle="Use this for alumni, staff groups, or other shared communities."
          size="lg"
        >
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            {workspaceError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {workspaceError}
              </div>
            )}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Workspace name</label>
              <input
                value={workspaceForm.name}
                onChange={(event) => setWorkspaceForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Workspace name"
                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Description</label>
              <textarea
                value={workspaceForm.description}
                onChange={(event) => setWorkspaceForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="What is this workspace for?"
                rows={3}
                className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowWorkspaceForm(false)
                  setWorkspaceError('')
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingWorkspace || !workspaceForm.name.trim()}
                className="rounded-xl bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
              >
                {creatingWorkspace ? 'Creating…' : 'Create workspace'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {workspaceDetail && (
        <Modal
          open={showWorkspaceMembers}
          onClose={() => {
            setShowWorkspaceMembers(false)
            setWorkspaceError('')
          }}
          title={`${workspaceDetail.name} members`}
          subtitle={workspaceDetail.workspace_type === 'community'
            ? 'Manage who can access this workspace.'
            : 'This workspace follows active cohort enrollment.'}
          size="lg"
        >
          <div className="space-y-4">
            {workspaceError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {workspaceError}
              </div>
            )}
            {workspaceDetail.can_manage && workspaceDetail.workspace_type === 'community' && (
              <form onSubmit={handleAddWorkspaceMember} className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={memberToAddId}
                  onChange={(event) => setMemberToAddId(event.target.value)}
                  className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Add a member</option>
                  {memberCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.full_name}</option>
                  ))}
                </select>
                <button
                  type="submit"
                  disabled={!memberToAddId}
                  className="rounded-xl bg-primary-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
                >
                  Add member
                </button>
              </form>
            )}
            <div className="space-y-2">
              {workspaceDetail.members.length === 0 ? (
                <p className="text-sm text-slate-500">No members listed yet.</p>
              ) : workspaceDetail.members.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">{member.full_name}</p>
                    <p className="truncate text-xs text-slate-500">
                      {member.email}
                      {member.membership_role && ` · ${member.membership_role}`}
                    </p>
                  </div>
                  {workspaceDetail.can_manage && workspaceDetail.workspace_type === 'community' && member.membership_role !== 'manager' && (
                    <button
                      type="button"
                      onClick={() => handleRemoveWorkspaceMember(member.id)}
                      className="rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-white"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {isStaff && (
        <Modal
          open={showChannelForm}
          onClose={() => {
            setShowChannelForm(false)
            setChannelError('')
          }}
          title="Create channel"
          subtitle="Add a shared space inside this workspace."
          size="lg"
        >
          <form onSubmit={handleCreateChannel} className="space-y-4">
            {channelError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {channelError}
              </div>
            )}
            <select
              value={channelForm.workspace_id}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, workspace_id: event.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <input
              value={channelForm.name}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Channel name"
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <textarea
              value={channelForm.description}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="What is this channel for?"
              rows={3}
              className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <select
              value={channelForm.visibility}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, visibility: event.target.value }))}
              className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="cohort">Students and staff</option>
              <option value="staff_only">Staff only</option>
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowChannelForm(false)
                  setChannelError('')
                }}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={creatingChannel || !channelForm.workspace_id || !channelForm.name.trim()}
                className="rounded-xl bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
              >
                {creatingChannel ? 'Creating…' : 'Create channel'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <Modal
        open={Boolean(messagePendingDelete)}
        onClose={() => setMessagePendingDelete(null)}
        title="Delete message?"
        subtitle="This removes the message for everyone in the conversation."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setMessagePendingDelete(null)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!messagePendingDelete) return
                void deleteMessage(messagePendingDelete)
                setMessagePendingDelete(null)
              }}
              className="rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Delete message
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            This action cannot be undone.
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {messagePendingDelete ? preview(messagePendingDelete.body) || 'Attachment-only message' : ''}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(mobileActionsMessage)}
        onClose={() => setMobileActionsMessageId(null)}
        title="Message actions"
        subtitle={mobileActionsMessage ? `${mobileActionsMessage.author.full_name} · ${formatTime(mobileActionsMessage.created_at)}` : undefined}
        size="md"
      >
        <div className="space-y-2">
          {isStaff && mobileActionsMessage && (
            <button
              type="button"
              onClick={() => {
                void togglePin(mobileActionsMessage)
                setMobileActionsMessageId(null)
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Pin className="h-4 w-4" />
              {mobileActionsMessage.pinned_at ? 'Unpin message' : 'Pin message'}
            </button>
          )}
          {mobileActionsMessage && (
            <button
              type="button"
              onClick={() => {
                const rootId = rootMessageIdFor(mobileActionsMessage, messagesById)
                setActiveThreadRootId(rootId)
                if (!isDesktop) setMobilePane('thread')
                setMobileActionsMessageId(null)
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <MessageCircle className="h-4 w-4" />
              {activeThreadRootId ? 'Reply in thread' : 'Reply'}
            </button>
          )}
          {mobileActionsMessage?.mine && (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing(mobileActionsMessage)
                  setEditBody(mobileActionsMessage.body)
                  setMobileActionsMessageId(null)
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                <Edit3 className="h-4 w-4" />
                Edit message
              </button>
              <button
                type="button"
                onClick={() => {
                  setMessagePendingDelete(mobileActionsMessage)
                  setMobileActionsMessageId(null)
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-red-200 px-4 py-3 text-left text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
                Delete message
              </button>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={showDmForm}
        onClose={() => setShowDmForm(false)}
        title="Start direct message"
        subtitle="Pick someone in this workspace."
        size="md"
      >
        <form onSubmit={handleCreateDm} className="space-y-4">
          <select
            value={dmUserId}
            onChange={(event) => setDmUserId(event.target.value)}
            className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
          >
            {availableUsers.map((availableUser) => (
              <option key={availableUser.id} value={availableUser.id}>
                {availableUser.full_name} - {availableUser.email} ({availableUser.role})
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setShowDmForm(false)}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!selectedWorkspaceId || !dmUserId}
              className="rounded-xl bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              Start direct message
            </button>
          </div>
        </form>
      </Modal>

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
      className={`mb-1 w-full rounded-2xl border px-3 py-3 text-left transition-all duration-200 ${
        active
          ? 'border-primary-100 bg-primary-50/90 text-primary-800 shadow-sm'
          : 'border-transparent hover:border-slate-200 hover:bg-white hover:shadow-sm'
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

function FormattedMessage({ body, mentionPatterns }: { body: string; mentionPatterns: MentionPattern[] }) {
  if (!body) return null

  const parts = body.split(/```/g)

  return (
    <div className="mt-0.5 max-w-full space-y-1.5 overflow-hidden break-words text-sm leading-5 text-slate-700 [overflow-wrap:anywhere]">
      {parts.map((part, index) => {
        const key = `${index}-${part.slice(0, 12)}`
        if (index % 2 === 1) {
          return (
            <pre key={key} className="max-w-full overflow-x-auto rounded-lg bg-slate-900 px-3 py-2 text-xs leading-5 text-slate-100">
              <code>{part.trim()}</code>
            </pre>
          )
        }

        return (
          <p key={key} className="whitespace-pre-wrap">
            {formatInline(part, mentionPatterns)}
          </p>
        )
      })}
    </div>
  )
}

function formatInline(text: string, mentionPatterns: MentionPattern[]) {
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
    return <span key={key}>{renderTextWithMentions(piece, mentionPatterns)}</span>
  })
}

function MessageRow({
  message,
  compact,
  highlighted,
  editing,
  editBody,
  setEditBody,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onOpenActions,
  onPin,
  canPin,
  inThreadView,
  replyCount,
  onReply,
  onReact,
  onOpenImage,
  mentionPatterns,
}: {
  message: LocalMessage
  compact: boolean
  highlighted: boolean
  editing: boolean
  editBody: string
  setEditBody: (value: string) => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onDelete: () => void
  onOpenActions: () => void
  onPin: () => void
  canPin: boolean
  inThreadView: boolean
  replyCount: number
  onReply: () => void
  onReact: (emoji: string) => void
  onOpenImage: (attachment: MessageAttachment, imageAttachments: MessageAttachment[]) => void
  mentionPatterns: MentionPattern[]
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const imageAttachments = message.attachments.filter((attachment) => attachment.image && attachment.url)

  return (
    <div
      id={`message-${message.id}`}
      className={`message-row group relative flex w-full max-w-full gap-2 rounded-xl px-2 py-1 transition-all duration-200 hover:bg-slate-50/90 sm:gap-3 sm:px-3 ${
        compact ? 'mt-0' : 'mt-2'
      } ${message.pinned_at ? 'bg-amber-50/70 ring-1 ring-amber-100' : ''} ${message.pending ? 'opacity-75' : ''} ${
        highlighted ? 'message-row-highlight bg-primary-50 ring-2 ring-primary-200' : ''
      }`}
    >
      <div className="flex w-8 shrink-0 justify-center sm:w-10">
        {compact ? (
          <span className="pt-1 text-[11px] font-medium text-slate-300 opacity-0 transition-opacity group-hover:opacity-100">
            {new Date(message.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        ) : (
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200 text-sm font-semibold text-slate-600 sm:h-9 sm:w-9">
            {message.author.avatar_url ? <img src={message.author.avatar_url} alt="" className="h-8 w-8 rounded-lg object-cover sm:h-9 sm:w-9" /> : message.author.full_name.slice(0, 1)}
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        {!compact && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-950">{message.author.full_name}</span>
            <span className="text-xs text-slate-400">{formatTime(message.created_at)}</span>
            {message.edited_at && <span className="text-xs text-slate-400">Edited</span>}
            {message.pending && <span className="text-xs text-slate-400">Sending...</span>}
            {message.failed && <span className="text-xs font-medium text-red-600">Not sent</span>}
            {message.pinned_at && <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"><Pin className="h-3 w-3" /> Pinned</span>}
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
          <FormattedMessage body={message.body} mentionPatterns={mentionPatterns} />
        )}
        {message.attachments.length > 0 && (
          <div className="mt-3 grid max-w-full min-w-0 gap-2 sm:grid-cols-2">
            {message.attachments.map((attachment) => (
              attachment.image && attachment.url ? (
              <button
                key={attachment.id}
                type="button"
                onClick={() => onOpenImage(attachment, imageAttachments)}
                className="min-w-0 rounded-lg border border-slate-200 bg-white p-2 text-left text-sm text-slate-700 hover:border-primary-200 hover:bg-primary-50"
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
                className="min-w-0 rounded-lg border border-slate-200 bg-white p-2 text-sm text-slate-700 hover:border-primary-200 hover:bg-primary-50"
              >
                <File className="mb-2 h-5 w-5 text-slate-400" />
                <div className="truncate font-medium">{attachment.filename}</div>
                <div className="text-xs text-slate-500">{formatFileSize(attachment.byte_size)}</div>
              </a>
              )
            ))}
          </div>
        )}
        {message.mine && message.read_receipts && message.read_receipts.count > 0 && (
          <div
            className="mt-1 inline-flex max-w-full items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500"
            title={readReceiptTitle(message.read_receipts)}
            aria-label={`Seen by ${readReceiptTitle(message.read_receipts)}`}
          >
            <CheckCheck className="h-3 w-3 shrink-0 text-green-600" />
            Seen by {readReceiptLabel(message.read_receipts)}
          </div>
        )}
        <div className={`flex flex-wrap items-center gap-1.5 ${message.reactions.length > 0 ? 'mt-2' : 'mt-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100'}`}>
          {message.reactions.map((reaction) => {
            const emoji = reaction.emoji
            return (
              <div key={emoji} className="group/reaction relative">
                <button
                  onClick={() => onReact(emoji)}
                  className={`min-h-9 rounded-lg border px-2.5 py-1.5 text-xs ${reaction?.reacted ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
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
          <div className="relative hidden sm:block">
            <button
              type="button"
              onClick={() => setPickerOpen((current) => !current)}
              className="min-h-8 rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-500 shadow-sm hover:bg-slate-50"
              aria-label="Add reaction"
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
          <div className="hidden items-center gap-1 sm:flex">
            {REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => onReact(emoji)}
                className="min-h-8 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
              >
                {emoji}
              </button>
            ))}
          </div>
          <button onClick={onReply} className="min-h-8 rounded-lg px-2.5 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100">
            {inThreadView ? 'Reply in thread' : 'Reply'}
          </button>
          {!inThreadView && replyCount > 0 && (
            <button onClick={onReply} className="min-h-8 rounded-lg px-2.5 py-1 text-xs font-medium text-primary-700 hover:bg-primary-50">
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-start gap-1">
        <button
          type="button"
          onClick={onOpenActions}
          className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-700 sm:hidden"
          aria-label="Open message actions"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
        <div className="hidden shrink-0 items-start gap-1 sm:flex sm:opacity-0 sm:group-hover:opacity-100">
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
    </div>
  )
}

function ConversationHeaderAction({
  onClick,
  icon,
  shortLabel,
  fullLabel,
  ariaLabel,
}: {
  onClick: () => void
  icon: ReactNode
  shortLabel: string
  fullLabel: string
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800 sm:text-sm"
      aria-label={ariaLabel}
    >
      {icon}
      <span className="sm:hidden">{shortLabel}</span>
      <span className="hidden sm:inline">{fullLabel}</span>
    </button>
  )
}
