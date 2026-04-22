import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import { Extension, type Editor, type JSONContent } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
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
  Smartphone,
  Trash2,
  Type,
  UserPlus,
  X,
} from 'lucide-react'
import { api } from '../../lib/api'
import { subscribeToChannelMessages, subscribeToDirectMessages } from '../../lib/realtime'
import { disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported } from '../../lib/pushNotifications'
import { formatFileSize, uploadToS3 } from '../../lib/uploadToS3'
import { useAuthContext } from '../../contexts/AuthContext'
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

function isMentionStartBoundary(text: string, index: number) {
  if (index === 0) return true
  return /[\s([{'"“‘>]/.test(text[index - 1] || '')
}

function isMentionEndBoundary(char?: string) {
  return !char || /[\s)\]}.,!?;:'"”’]/.test(char)
}

function buildMentionPatterns(names: string[], includeChannel: boolean) {
  const seen = new Set<string>()
  const patterns: MentionPattern[] = []

  if (includeChannel) {
    seen.add('@channel')
    patterns.push({ label: '@channel', normalized: '@channel', kind: 'channel' })
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
  const [showWorkspaceMembers, setShowWorkspaceMembers] = useState(false)
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
  const [conversationView, setConversationView] = useState<'messages' | 'pins'>('messages')
  const [activeThreadRootId, setActiveThreadRootId] = useState<number | null>(null)
  const [isDesktop, setIsDesktop] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  const [mobilePane, setMobilePane] = useState<'list' | 'conversation' | 'thread'>(selectedTarget ? 'conversation' : 'list')
  const [editing, setEditing] = useState<ChannelMessage | null>(null)
  const [editBody, setEditBody] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ChannelMessage[]>([])
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
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composerFormRef = useRef<HTMLFormElement | null>(null)
  const lightboxTouchStartX = useRef<number | null>(null)
  const optimisticAttachmentUrls = useRef(new Map<number, string[]>())
  const tempMessageIdRef = useRef(0)
  const targetRequestRef = useRef(0)
  const deferredSearchQuery = useDeferredValue(searchQuery)

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

  const visibleChannels = useMemo(
    () => selectedWorkspaceId ? channels.filter((channel) => channel.workspace_id === selectedWorkspaceId) : channels,
    [channels, selectedWorkspaceId],
  )

  const visibleDms = useMemo(
    () => selectedWorkspaceId ? directConversations.filter((conversation) => conversation.workspace_id === selectedWorkspaceId) : directConversations,
    [directConversations, selectedWorkspaceId],
  )

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId)
  const selectedPinnedMessages = useMemo(
    () => sortPinnedMessages(pinnedMessages),
    [pinnedMessages],
  )
  const memberCandidates = useMemo(() => {
    const memberIds = new Set((workspaceDetail?.members || []).map((member) => member.id))
    return allUsers.filter((candidate) => !memberIds.has(candidate.id))
  }, [allUsers, workspaceDetail?.members])
  const mentionableUsers = useMemo(
    () => selectedTarget?.type === 'channel' ? (workspaceDetail?.members ?? []) : availableUsers,
    [availableUsers, selectedTarget?.type, workspaceDetail?.members],
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

    if (selectedTarget?.type === 'channel' && 'channel'.startsWith(normalized)) {
      suggestions.push({
        id: 'channel',
        label: '@channel',
        subtitle: 'Notify everyone in this channel',
        kind: 'channel',
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
      Placeholder.configure({ placeholder: `Message ${selectedLabel}` }),
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

  const loadTarget = async (target: Target, markRead = false) => {
    const requestId = targetRequestRef.current + 1
    targetRequestRef.current = requestId
    setLoadingTarget(true)

    if (target.type === 'channel') {
      const res = await api.getChannel(target.id)
      if (requestId !== targetRequestRef.current) return
      if (!res.data) {
        setLoadingTarget(false)
        return
      }

      setMessages(sortChronologicalMessages(res.data.messages || []))
      setPinnedMessages(sortPinnedMessages(res.data.pinned_messages || []))
      setChannels((prev) => prev.map((channel) => channel.id === target.id ? res.data!.channel : channel))
      if (markRead && channelNeedsRead(res.data.channel)) {
        await api.markChannelRead(target.id)
        setChannels((prev) => prev.map((channel) => channel.id === target.id ? { ...channel, unread_count: 0, last_read_at: new Date().toISOString() } : channel))
      }
      setLoadingTarget(false)
      return
    }

    const res = await api.getDirectConversation(target.id)
    if (requestId !== targetRequestRef.current) return
    if (!res.data) {
      setLoadingTarget(false)
      return
    }

    setMessages(sortChronologicalMessages(res.data.messages || []))
    setPinnedMessages(sortPinnedMessages(res.data.pinned_messages || []))
    setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? res.data!.direct_conversation : conversation))
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
          return sortChronologicalMessages(prev.map((item) => item.id === message.id ? mergeIncomingMessage(item, message) : item))
        }
        return sortChronologicalMessages([...prev, message])
      })
      setPinnedMessages((prev) => {
        if (event.event === 'deleted') return prev.filter((item) => item.id !== message.id)
        return upsertPinnedMessage(prev, message)
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
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages.length, selectedTarget?.type, selectedTarget?.id])

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
    setLoadingTarget(true)
    startNavigationTransition(() => {
      setSelectedTarget(target)
      setActiveThreadRootId(null)
      setEditing(null)
      setConversationView('messages')
      if (!isDesktop) setMobilePane('conversation')
    })
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

    setMessages((prev) => sortChronologicalMessages([...prev, optimisticMessage]))
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
        releaseOptimisticAttachmentUrls(tempId)
        setMessages((prev) => sortChronologicalMessages([...prev.filter((item) => item.id !== tempId && item.id !== message.id), message]))
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
    } else if (res.data) {
      setChannelForm((prev) => ({ ...prev, name: '', description: '' }))
      setShowChannelForm(false)
      await loadLists()
      selectTarget({ type: 'channel', id: res.data.channel.id })
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
    } else if (res.data) {
      setWorkspaceForm({ name: '', description: '' })
      setShowWorkspaceForm(false)
      await loadLists()
      setWorkspaceDetail(res.data.workspace)
      selectWorkspace(res.data.workspace.id)
      setShowWorkspaceMembers(true)
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
      return
    }

    if (res.data) {
      setWorkspaceDetail(res.data.workspace)
      setWorkspaces((prev) => prev.map((workspace) => workspace.id === res.data!.workspace.id ? {
        ...workspace,
        member_count: res.data!.workspace.member_count,
      } : workspace))
      setMemberToAddId('')
    }
  }

  const handleRemoveWorkspaceMember = async (userId: number) => {
    if (!workspaceDetail) return

    setWorkspaceError('')
    const res = await api.removeWorkspaceMember(workspaceDetail.id, userId)
    if (res.error) {
      setWorkspaceError(res.error)
      return
    }

    if (res.data) {
      setWorkspaceDetail(res.data.workspace)
      setWorkspaces((prev) => prev.map((workspace) => workspace.id === res.data!.workspace.id ? {
        ...workspace,
        member_count: res.data!.workspace.member_count,
      } : workspace))
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

  const selectMention = (mention: MentionSuggestion) => {
    insertIntoComposer(`${mention.label} `, /(^|\s)@[^\n]*$/)
  }

  const insertCodeBlock = () => {
    if (!editor) return

    const { from, to, empty } = editor.state.selection
    const selectedText = empty ? '' : editor.state.doc.textBetween(from, to, '\n', '\n')
    const codeBlock = editor.state.schema.nodes.codeBlock.create(
      undefined,
      selectedText ? editor.state.schema.text(selectedText) : undefined,
    )
    let transaction = editor.state.tr.replaceSelectionWith(codeBlock, false)
    const mappedFrom = transaction.mapping.map(from)
    const cursorPosition = mappedFrom + 1 + selectedText.length
    transaction = transaction.setSelection(TextSelection.create(transaction.doc, cursorPosition))
    editor.view.dispatch(transaction.scrollIntoView())
    editor.view.focus()
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
      setPinnedMessages((prev) => upsertPinnedMessage(prev, res.data!.message))
      setEditing(null)
    } else if (res.error) {
      setError(res.error)
    }
  }

  const deleteMessage = async (message: ChannelMessage) => {
    const res = await api.deleteMessage(message.id)
    if (res.data) {
      releaseOptimisticAttachmentUrls(message.id)
      setMessages((prev) => prev.filter((item) => item.id !== message.id))
      setPinnedMessages((prev) => prev.filter((item) => item.id !== message.id))
    }
    else if (res.error) setError(res.error)
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
  const conversationMessages = activeThreadRoot ? activeThreadMessages : rootMessages
  const showComposer = Boolean(selectedTarget) && (conversationView === 'messages' || Boolean(activeThreadRoot))
  const showPageIntro = isDesktop || !selectedTarget
  const showConversationHeaderPushMessage = Boolean(pushMessage) && Boolean(selectedTarget)

  return (
    <div className={`mx-auto flex min-h-[calc(100dvh-5.5rem)] max-w-7xl flex-col ${showPageIntro ? 'gap-4' : 'gap-0'} lg:h-[calc(100dvh-5.5rem)]`}>
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
                onClick={handleTogglePush}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                {pushEnabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                {pushEnabled ? 'Turn off push' : 'Turn on push'}
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

      <div className={`${isDesktop ? 'grid rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_70px_-38px_rgba(15,23,42,0.28)]' : 'block overflow-hidden border-y border-slate-200 bg-white'} min-h-0 flex-1 ${isDesktop ? (sidebarCollapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[360px_minmax(0,1fr)]') : ''}`}>
        {showListPane && !sidebarCollapsed && (
        <aside className={`bg-slate-50 ${isDesktop ? 'border-b border-slate-200 lg:border-b-0 lg:border-r' : ''}`}>
          <div className="border-b border-slate-200 bg-white p-3">
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

          <div className={`${isDesktop ? 'max-h-72 overflow-y-auto p-2 lg:max-h-[calc(100vh-13rem)]' : 'p-2'}`}>
            <div className="mb-2 flex items-center justify-between px-2 pt-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Channels</h3>
              {isStaff && (
                <button onClick={() => { setShowChannelForm(true); setChannelError('') }} className="rounded-lg p-1 text-slate-500 hover:bg-white" aria-label="Create channel">
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
                subtitle={channel.latest_message ? `${channel.latest_message.author_name}: ${preview(channel.latest_message.body)}` : channel.description || channel.workspace_name}
                unread={channel.unread_count}
                muted={channel.muted}
                onClick={() => selectTarget({ type: 'channel', id: channel.id })}
              />
            ))}

            <div className="mb-2 mt-4 flex items-center justify-between px-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Direct messages</h3>
              <button onClick={() => setShowDmForm(true)} className="rounded-lg p-1 text-slate-500 hover:bg-white" aria-label="Start direct message">
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
        <section className={`flex min-h-0 flex-1 flex-col ${isDesktop ? 'bg-[radial-gradient(circle_at_top_right,_rgba(239,68,68,0.08),_transparent_32%),linear-gradient(180deg,_#ffffff_0%,_#fff8f8_100%)]' : 'bg-white'}`}>
          {selectedTarget && selected ? (
            <>
              <header className={`border-b border-slate-200/80 px-4 py-3 backdrop-blur-sm ${isDesktop ? 'bg-white/80' : 'sticky top-0 z-10 bg-white'} sm:py-4`}>
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
                        fullLabel={pushEnabled ? 'Turn off push' : 'Turn on push'}
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

              <div className="relative min-h-0 flex-1 overflow-hidden">
                <div className={`h-full overflow-y-auto px-3 py-3 transition duration-200 sm:px-4 sm:py-4 ${loadingTarget || isNavigationPending ? 'opacity-60' : 'opacity-100'}`}>
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
                {(conversationView === 'pins' && !activeThreadRoot ? selectedPinnedMessages : conversationMessages).length === 0 ? (
                  <div className="flex min-h-full items-center justify-center py-16 text-center text-sm text-slate-500">
                    {activeThreadRoot
                      ? 'No replies yet. Start the thread.'
                      : conversationView === 'pins'
                        ? 'No pinned messages yet.'
                        : 'No messages yet. Start the conversation.'}
                  </div>
                ) : (conversationView === 'pins' && !activeThreadRoot ? selectedPinnedMessages : conversationMessages).map((message) => {
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
                  )
                })}
                <div ref={bottomRef} />
                </div>
                {(loadingTarget || isNavigationPending) && (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-white/20 px-4 py-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm backdrop-blur">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Switching conversation…
                    </div>
                  </div>
                )}
              </div>

              {showComposer && (
              <form
                ref={composerFormRef}
                onSubmit={handleSend}
                className="border-t border-slate-200 bg-white px-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] pt-2 sm:p-3"
              >
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
                  className="relative rounded-2xl border border-slate-200 bg-white shadow-[0_12px_32px_-24px_rgba(15,23,42,0.32)]"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={handleDrop}
                >
                  <div className="messages-toolbar-scroll flex items-center gap-1 overflow-x-auto border-b border-slate-100 px-2 py-2 text-slate-500">
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
                    <button
                      type="button"
                      onMouseDown={(event) => runToolbarCommand(event, insertCodeBlock)}
                      className={`rounded-full px-2.5 py-1 text-xs font-medium hover:bg-slate-50 ${editor?.isActive('codeBlock') ? 'bg-slate-100 text-slate-900' : ''}`}
                    >
                      <span className="hidden sm:inline">Code block</span>
                      <span className="sm:hidden">Block</span>
                    </button>
                    <button type="button" onMouseDown={(event) => { event.preventDefault(); insertIntoComposer('@') }} className="rounded-full px-2.5 py-1 text-xs font-medium hover:bg-slate-50">@ mention</button>
                    <button type="button" onMouseDown={(event) => { event.preventDefault(); insertIntoComposer('/') }} className="rounded-full px-2.5 py-1 text-xs font-medium hover:bg-slate-50">/ command</button>
                    <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
                  </div>
                    <div className="p-2" onKeyDownCapture={handleComposerKeyDown}>
                      <div className="min-h-0 min-w-0 rounded-xl bg-slate-50/70">
                      <EditorContent editor={editor} />
                      </div>
                    </div>
                  <div className="flex items-end justify-end border-t border-slate-100 px-3 py-3">
                    <button
                      type="submit"
                      disabled={sending || (!body.trim() && pendingAttachments.length === 0)}
                      className="inline-flex h-10 min-w-[120px] shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-500 px-4 text-sm font-medium text-white shadow-sm transition hover:bg-primary-600 disabled:cursor-not-allowed disabled:opacity-50 sm:min-w-0"
                      aria-label={sending ? 'Sending message' : 'Send message'}
                    >
                      <Send className="h-4 w-4" />
                      <span>Send</span>
                    </button>
                  </div>
                  {mentionSuggestions.length > 0 && (
                    <div className="absolute bottom-full left-3 z-30 mb-2 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
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
                <p className="mt-2 hidden text-xs text-slate-400 sm:block">
                  Press Cmd+Enter or Ctrl+Enter to send. Paste or drop screenshots, use @ for people, / for snippets, and backticks for code.
                </p>
              </form>
              )}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
              Pick a channel or start a direct message.
            </div>
          )}
        </section>
        )}
      </div>
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
              <option key={availableUser.id} value={availableUser.id}>{availableUser.full_name}</option>
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
  mentionPatterns,
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
  mentionPatterns: MentionPattern[]
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
          <FormattedMessage body={message.body} mentionPatterns={mentionPatterns} />
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
