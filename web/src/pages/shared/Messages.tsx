import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TiptapLink from '@tiptap/extension-link'
import UnderlineExtension from '@tiptap/extension-underline'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  Bell,
  BellOff,
  BookOpen,
  Bold,
  Braces,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Code2,
  Copy,
  Download,
  Edit3,
  File,
  Flag,
  Hash,
  Heart,
  Italic,
  Link2,
  List,
  ListOrdered,
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
  Strikethrough,
  TextQuote,
  ThumbsUp,
  Trash2,
  Underline as UnderlineIcon,
  UserPlus,
  UserRound,
  UserX,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { api } from '../../lib/api'
import { isMessageTypingEvent, subscribeToUserMessages, type RealtimeSubscription } from '../../lib/realtime'
import { isVisiblePage, shouldPollMessages } from '../../lib/backgroundActivity'
import { disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported, webPushPreferenceEnabled } from '../../lib/pushNotifications'
import { formatFileSize, uploadToS3 } from '../../lib/uploadToS3'
import { editorJsonToMarkdown, normalizeMessageMarkdown, parseMessageBlocks } from '../../lib/messageFormat'
import {
  MESSAGE_BODY_LIMIT,
  composerBodyMatchesDestination,
  composerDestinationKey,
  createClientMessageId,
  failedSendsKey,
  messageCharacterCount,
  readComposerDraft,
  readFailedSends,
  writeComposerDraft,
  writeFailedSends,
  type StoredFailedSend,
  type UploadedMessageAttachment,
} from '../../lib/messageComposerState'
import { useAuthContext } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { MessagesLoadingShell } from '../../components/shared/MessagesLoadingShell'
import { Modal } from '../../components/shared/Modal'
import { StudentContextDrawer } from '../../components/admin/StudentContextDrawer'
import { helpRequestPath, submissionPath } from '../../lib/routes'
import type {
  ChannelMessage,
  ChannelMessageEvent,
  ChannelSummary,
  DirectConversationSummary,
  MessageAttachment,
  MessageWindowMeta,
  MessageTypingEvent,
  UserSummary,
  WorkspaceDetail,
  WorkspaceSummary,
} from '../../types/api'

type Target = { type: 'channel'; id: number } | { type: 'dm'; id: number }
type TargetLoadOptions = { aroundMessageId?: number; highlightedMessageId?: number; background?: boolean }
type SavedConversationScroll = { distanceFromBottom: number; atBottom: boolean }
type PendingAttachment = {
  file: File
  s3_key?: string
  filename: string
  content_type: string
  byte_size: number
  progress: number
  uploaded: boolean
}
type RetrySend = {
  clientMessageId: string
  body: string
  parentMessageId: number | null
  mentionUserIds: number[]
  pendingAttachments: PendingAttachment[]
  uploadedAttachments: UploadedMessageAttachment[]
}
type LocalMessage = ChannelMessage & { pending?: boolean; failed?: boolean; failureError?: string; retrySend?: RetrySend }
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
type TypingUser = MessageTypingEvent['user']

function targetKey(target: Target) {
  return `${target.type}:${target.id}`
}

function targetMatches(left: Target | null, right: Target) {
  return left?.type === right.type && left.id === right.id
}

function messageBelongsToTarget(message: ChannelMessage, target: Target) {
  return target.type === 'channel' ? message.channel_id === target.id : message.direct_conversation_id === target.id
}

function scrollStorageKey(userId: number, target: Target) {
  return `csg-message-scroll:${userId}:${targetKey(target)}`
}

function readSavedConversationScroll(userId: number | undefined, target: Target): SavedConversationScroll | null {
  if (!userId || typeof window === 'undefined') return null

  try {
    const raw = window.sessionStorage.getItem(scrollStorageKey(userId, target))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<SavedConversationScroll>
    if (typeof parsed.distanceFromBottom !== 'number' || typeof parsed.atBottom !== 'boolean') return null
    return { distanceFromBottom: Math.max(0, parsed.distanceFromBottom), atBottom: parsed.atBottom }
  } catch {
    return null
  }
}

function saveConversationScroll(userId: number | undefined, target: Target, element: HTMLDivElement) {
  if (!userId || typeof window === 'undefined') return

  const distanceFromBottom = Math.max(0, element.scrollHeight - element.scrollTop - element.clientHeight)
  try {
    window.sessionStorage.setItem(scrollStorageKey(userId, target), JSON.stringify({
      distanceFromBottom,
      atBottom: distanceFromBottom < 96,
    } satisfies SavedConversationScroll))
  } catch {
    // Session storage can be unavailable in private browsing or locked-down WebViews.
  }
}

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

type QuickReaction = {
  value: string
  label: string
  Icon: LucideIcon
}

const REACTIONS: QuickReaction[] = [
  { value: '\u{1F44D}', label: 'Thumbs up', Icon: ThumbsUp },
  { value: '\u2764\uFE0F', label: 'Love', Icon: Heart },
  { value: '\u2705', label: 'Complete', Icon: CircleCheck },
  { value: '\u{1F64C}', label: 'Celebrate', Icon: SmilePlus },
]
const REACTIONS_BY_VALUE = new Map(REACTIONS.map((reaction) => [reaction.value, reaction]))
const CHANNEL_MENTION_ALIASES = [
  { label: '@everyone', subtitle: 'Notify everyone in this channel' },
]
const COMMON_FILE_EXTENSIONS = new Set([
  'css',
  'gif',
  'htm',
  'html',
  'jpeg',
  'jpg',
  'js',
  'json',
  'md',
  'pdf',
  'php',
  'png',
  'py',
  'rb',
  'svg',
  'ts',
  'tsx',
  'txt',
  'webp',
  'yaml',
  'yml',
  'zip',
])
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
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\+\+([^+]+)\+\+/g, '$1')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
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

export function mergeMessageWindow(existing: LocalMessage[], incoming: ChannelMessage[], preserveOlder = false) {
  const incomingIds = new Set(incoming.map((message) => message.id))
  const incomingClientIds = new Set(incoming.map((message) => message.client_message_id).filter(Boolean))
  const oldestIncoming = sortChronologicalMessages(incoming)[0]
  const localOnly = existing.filter((message) => (
    (message.pending || message.failed || (preserveOlder && oldestIncoming && (
      new Date(message.created_at).getTime() < new Date(oldestIncoming.created_at).getTime()
      || (message.created_at === oldestIncoming.created_at && message.id < oldestIncoming.id)
    )))
    && !incomingIds.has(message.id)
    && (!message.client_message_id || !incomingClientIds.has(message.client_message_id))
  ))
  const mergedIncoming = incoming.map((message) => {
    const previous = existing.find((item) => item.id === message.id || (
      message.client_message_id && item.client_message_id === message.client_message_id
    ))
    return previous ? mergeIncomingMessage(previous, message) : message
  })

  return sortChronologicalMessages([...mergedIncoming, ...localOnly])
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

function latestMessageTime(item: ChannelSummary | DirectConversationSummary) {
  return item.latest_message ? new Date(item.latest_message.created_at).getTime() : 0
}

function initialMessageTarget(channels: ChannelSummary[], directConversations: DirectConversationSummary[]): Target | null {
  const unreadTargets = [
    ...channels.filter((channel) => channel.unread_count > 0).map((channel) => ({ target: { type: 'channel' as const, id: channel.id }, latestAt: latestMessageTime(channel) })),
    ...directConversations.filter((conversation) => conversation.unread_count > 0).map((conversation) => ({ target: { type: 'dm' as const, id: conversation.id }, latestAt: latestMessageTime(conversation) })),
  ].sort((left, right) => right.latestAt - left.latestAt)

  if (unreadTargets[0]) return unreadTargets[0].target
  if (channels[0]) return { type: 'channel', id: channels[0].id }
  if (directConversations[0]) return { type: 'dm', id: directConversations[0].id }

  return null
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

export function applyComposerList(
  editor: Editor,
  kind: 'orderedList' | 'bulletList',
  selection?: { from: number; to: number } | null,
) {
  if (selection) {
    const maxPosition = editor.state.doc.content.size
    editor.commands.setTextSelection({
      from: Math.min(selection.from, maxPosition),
      to: Math.min(selection.to, maxPosition),
    })
  }

  const toggle = () => kind === 'orderedList'
    ? editor.chain().focus().toggleOrderedList().run()
    : editor.chain().focus().toggleBulletList().run()
  const { empty, $from } = editor.state.selection

  if (!editor.isActive(kind) && empty && $from.parent.isTextblock && $from.parentOffset > 0) {
    const split = editor.chain().focus().splitBlock().run()
    if (!split) return false
  }

  return toggle()
}

export function applyComposerListShortcut(
  editor: Editor,
  event: Pick<KeyboardEvent<HTMLDivElement>, 'metaKey' | 'ctrlKey' | 'shiftKey' | 'code' | 'preventDefault'>,
  selection?: { from: number; to: number } | null,
) {
  if (!(event.metaKey || event.ctrlKey) || !event.shiftKey) return false

  const kind = event.code === 'Digit7'
    ? 'orderedList'
    : event.code === 'Digit8'
      ? 'bulletList'
      : null
  if (!kind) return false

  event.preventDefault()
  applyComposerList(editor, kind, selection)
  return true
}

export function typingIndicatorLabel(users: TypingUser[]) {
  const names = users.map((typingUser) => typingUser.full_name)
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more are typing…`
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

function normalizeLinkHref(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`

  const bareDomainMatch = trimmed.match(/^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+)([/?#].*)?$/i)
  if (!bareDomainMatch) return ''

  const tld = bareDomainMatch[1].split('.').pop()?.toLowerCase() || ''
  if (!/^[a-z]{2,24}$/.test(tld) || COMMON_FILE_EXTENSIONS.has(tld)) return ''

  return `https://${trimmed}`
}

function splitTrailingUrlPunctuation(value: string) {
  let href = value
  let trailing = ''

  while (/[.,!?;:]$/.test(href)) {
    trailing = `${href.slice(-1)}${trailing}`
    href = href.slice(0, -1)
  }

  if (href.endsWith(')') && !href.includes('(')) {
    trailing = `)${trailing}`
    href = href.slice(0, -1)
  }

  return { href, trailing }
}

function renderLinkNode(text: ReactNode, href: string, key: string) {
  const normalizedHref = normalizeLinkHref(href)
  if (!normalizedHref) return <span key={key}>{text}</span>

  return (
    <a
      key={key}
      href={normalizedHref}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-primary-700 underline decoration-primary-300 underline-offset-2 transition-colors hover:text-primary-800 hover:decoration-primary-500"
    >
      {text}
    </a>
  )
}

export function ComposerToolbarButton({
  label,
  shortcut,
  active = false,
  children,
  className = '',
  toggle = false,
  onClick,
  onPointerDown,
}: {
  label: string
  shortcut?: string
  active?: boolean
  children: ReactNode
  className?: string
  toggle?: boolean
  onClick?: () => void
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void
}) {
  const tooltipId = useId()
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null)

  const showTooltip = () => {
    const button = buttonRef.current
    if (!button || typeof window === 'undefined') return

    const rect = button.getBoundingClientRect()
    setTooltipPosition({
      left: Math.min(Math.max(rect.left + rect.width / 2, 16), window.innerWidth - 16),
      top: rect.top - 10,
    })
  }

  const hideTooltip = () => setTooltipPosition(null)

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onClick}
        onPointerDown={onPointerDown}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        className={`relative min-h-11 min-w-11 shrink-0 rounded-xl p-2 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 sm:min-h-9 sm:min-w-9 ${
          active ? 'bg-slate-100 text-slate-900' : ''
        } ${className}`}
        aria-label={shortcut ? `${label} (${shortcut})` : label}
        aria-describedby={tooltipPosition ? tooltipId : undefined}
        aria-pressed={toggle ? active : undefined}
      >
        {children}
      </button>
      {tooltipPosition && typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-lg"
          style={{ left: tooltipPosition.left, top: tooltipPosition.top }}
          id={tooltipId}
          role="tooltip"
        >
          {label}
          {shortcut && <span className="ml-2 font-medium text-slate-300">{shortcut}</span>}
          <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-slate-950" aria-hidden="true" />
        </div>,
        document.body,
      )}
    </>
  )
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

export function Messages() {
  const { channelId, dmId } = useParams()
  const [searchParams] = useSearchParams()
  const routedMessageId = Number(searchParams.get('message_id')) || null
  const { user } = useAuthContext()
  const toast = useToast()
  const composerHelpId = useId()
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
  const [messageWindowMeta, setMessageWindowMeta] = useState<MessageWindowMeta | null>(null)
  const [loadingOlder, setLoadingOlder] = useState(false)
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
  const [showStudentContext, setShowStudentContext] = useState(false)
  const [sourceContextHidden, setSourceContextHidden] = useState(false)
  const [pushEnabled, setPushEnabled] = useState(false)
  const [pushMessage, setPushMessage] = useState('')
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false)
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [realtimeStatus, setRealtimeStatus] = useState<'connected' | 'disconnected' | 'error'>('disconnected')
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([])
  const [realtimeSubscriptionVersion, setRealtimeSubscriptionVersion] = useState(0)
  const [body, setBody] = useState('')
  const [bodyDestinationKey, setBodyDestinationKey] = useState<string | null>(null)
  const [composerMentionUserIds, setComposerMentionUserIds] = useState<number[]>([])
  const [composerTriggerText, setComposerTriggerText] = useState('')
  const [activeMentionIndex, setActiveMentionIndex] = useState(0)
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
  const [lightboxAttachments, setLightboxAttachments] = useState<MessageAttachment[]>([])
  const [lightboxIndex, setLightboxIndex] = useState(0)
  const [reactionDetails, setReactionDetails] = useState<{ messageId: number; emoji: string } | null>(null)
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
  const [showLinkForm, setShowLinkForm] = useState(false)
  const [linkText, setLinkText] = useState('')
  const [linkHref, setLinkHref] = useState('')
  const [linkError, setLinkError] = useState('')
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
  const messageScrollRef = useRef<HTMLDivElement | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composerFormRef = useRef<HTMLFormElement | null>(null)
  const lightboxTouchStartX = useRef<number | null>(null)
  const optimisticAttachmentUrls = useRef(new Map<number, string[]>())
  const tempMessageIdRef = useRef(0)
  const targetRequestRef = useRef(0)
  const targetLoadOptionsRef = useRef<TargetLoadOptions>({})
  const routeTargetInitializedRef = useRef(false)
  const loadingTargetRef = useRef(false)
  const backgroundTargetLoadingRef = useRef(false)
  const shouldStickToBottomRef = useRef(true)
  const pendingScrollRestoreTargetKeyRef = useRef<string | null>(null)
  const scrollPersistFrameRef = useRef<number | null>(null)
  const programmaticScrollUntilRef = useRef(0)
  const programmaticScrollTimerRef = useRef<number | null>(null)
  const lastAutoScrollTargetKeyRef = useRef('')
  const activeThreadRootIdRef = useRef<number | null>(activeThreadRootId)
  const isDesktopRef = useRef(isDesktop)
  const mobilePaneRef = useRef(mobilePane)
  const selectedTargetRef = useRef<Target | null>(selectedTarget)
  const composerSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const activeDraftKeyRef = useRef<string | null>(null)
  const draftSaveTimerRef = useRef<number | null>(null)
  const pendingAttachmentBucketsRef = useRef(new Map<string, PendingAttachment[]>())
  const pendingAttachmentsRef = useRef(pendingAttachments)
  const realtimeSubscriptionRef = useRef<RealtimeSubscription | null>(null)
  const typingExpiryTimersRef = useRef(new Map<number, number>())
  const typingStopTimerRef = useRef<number | null>(null)
  const outboundTypingRef = useRef<{
    target: Target
    threadRootId: number | null
    active: boolean
    lastSentAt: number
  } | null>(null)
  const deferredSearchQuery = useDeferredValue(searchQuery)

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
  const typingLabel = typingIndicatorLabel(typingUsers)
  const reactionDetailsMessage = reactionDetails ? messagesById.get(reactionDetails.messageId) || null : null
  const selectedReaction = reactionDetailsMessage?.reactions.find((reaction) => reaction.emoji === reactionDetails?.emoji)
    || reactionDetailsMessage?.reactions[0]
    || null
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
    const unreadChannelCount = workspaceChannels.reduce((sum, channel) => sum + channel.unread_count, 0)
    const unreadDmCount = workspaceDms.reduce((sum, conversation) => sum + conversation.unread_count, 0)
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
  useEffect(() => {
    setActiveMentionIndex(0)
  }, [mentionToken])

  useEffect(() => {
    setComposerMentionUserIds([])
  }, [selectedTarget?.id, selectedTarget?.type])

  const lightboxAttachment = lightboxAttachments[lightboxIndex] || null

  useLayoutEffect(() => {
    mentionPatternsRef.current = mentionPatterns
  }, [mentionPatterns])

  const scheduleDraftSave = (draftBody: string, content: ReturnType<Editor['getJSON']>) => {
    const key = activeDraftKeyRef.current
    if (!key || typeof window === 'undefined') return
    if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current)

    draftSaveTimerRef.current = window.setTimeout(() => {
      writeComposerDraft(key, { version: 1, body: draftBody, content }, window.localStorage)
      draftSaveTimerRef.current = null
    }, 250)
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
        underline: false,
        codeBlock: {
          HTMLAttributes: {
            class: 'rounded-lg bg-slate-900 px-3 py-2 text-sm leading-6 text-slate-100',
          },
        },
      }),
      UnderlineExtension,
      TiptapLink.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: 'Write a message' }),
      MentionHighlightExtension.configure({
        getPatterns: () => mentionPatternsRef.current,
      }),
    ],
    editorProps: {
      attributes: {
        class: 'message-composer px-3 py-2.5 text-base leading-6 text-slate-800 outline-none sm:py-3 sm:text-sm',
        'aria-label': 'Write a message',
        'aria-describedby': composerHelpId,
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
      const content = editor.getJSON()
      const nextBody = editorJsonToMarkdown(content)
      composerSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to }
      setBody(nextBody)
      setBodyDestinationKey(activeDraftKeyRef.current)
      scheduleDraftSave(nextBody, content)
      setComposerTriggerText(editorTextBeforeCursor(editor))
    },
    onSelectionUpdate: ({ editor }) => {
      composerSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to }
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

  useEffect(() => {
    if (!editor || !user || !selectedTarget || typeof window === 'undefined') return

    const nextKey = composerDestinationKey(user.id, selectedTarget, activeThreadRootId)
    const previousKey = activeDraftKeyRef.current
    if (previousKey === nextKey) return

    if (previousKey) {
      if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current)
      writeComposerDraft(previousKey, {
        version: 1,
        body: editorJsonToMarkdown(editor.getJSON()),
        content: editor.getJSON(),
      }, window.localStorage)
      pendingAttachmentBucketsRef.current.set(previousKey, pendingAttachmentsRef.current)
    }

    activeDraftKeyRef.current = nextKey
    const draft = readComposerDraft(nextKey, window.localStorage)
    editor.commands.setContent(draft?.content || { type: 'doc', content: [{ type: 'paragraph' }] }, { emitUpdate: false })
    setBody(draft?.body || '')
    setBodyDestinationKey(nextKey)
    setComposerMentionUserIds([])
    setComposerTriggerText('')
    setPendingAttachments(pendingAttachmentBucketsRef.current.get(nextKey) || [])
    composerSelectionRef.current = { from: 1, to: 1 }
  }, [editor, user?.id, selectedTarget?.type, selectedTarget?.id, activeThreadRootId])

  useEffect(() => () => {
    if (draftSaveTimerRef.current !== null) window.clearTimeout(draftSaveTimerRef.current)
    const key = activeDraftKeyRef.current
    if (key && editor && typeof window !== 'undefined') {
      writeComposerDraft(key, {
        version: 1,
        body: editorJsonToMarkdown(editor.getJSON()),
        content: editor.getJSON(),
      }, window.localStorage)
    }
  }, [editor])

  const loadLists = async () => {
    const [workspaceRes, channelRes, dmRes] = await Promise.all([api.getWorkspaces(), api.getChannels(), api.getDirectConversations()])
    if (workspaceRes.data) setWorkspaces(workspaceRes.data.workspaces)
    if (channelRes.data) setChannels(channelRes.data.channels)
    if (dmRes.data) setDirectConversations(dmRes.data.direct_conversations)

    const loadedChannels = channelRes.data?.channels || []
    const loadedDirectConversations = dmRes.data?.direct_conversations || []
    const firstTarget = initialMessageTarget(loadedChannels, loadedDirectConversations)
    const firstTargetWorkspaceId = firstTarget?.type === 'channel'
      ? loadedChannels.find((channel) => channel.id === firstTarget.id)?.workspace_id
      : loadedDirectConversations.find((conversation) => conversation.id === firstTarget?.id)?.workspace_id

    setSelectedTarget((current) => current || firstTarget)
    setSelectedWorkspaceId((current) => current || firstTargetWorkspaceId || workspaceRes.data?.workspaces[0]?.id || null)
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
          } : undefined,
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

  const loadTarget = async (target: Target, markRead = false, options: TargetLoadOptions = {}) => {
    const requestId = targetRequestRef.current + 1
    targetRequestRef.current = requestId
    const showTargetLoader = !options.background

    if (showTargetLoader) {
      setTargetLoading(true)
      setHasUnreadBelow(false)
      setShowScrollToLatest(false)
      const savedScroll = readSavedConversationScroll(user?.id, target)
      shouldStickToBottomRef.current = !options.aroundMessageId && (!savedScroll || savedScroll.atBottom)
      pendingScrollRestoreTargetKeyRef.current = options.aroundMessageId ? null : targetKey(target)
    }

    if (target.type === 'channel') {
      const res = await api.getChannel(target.id, {
        around_message_id: options.aroundMessageId,
      })
      if (requestId !== targetRequestRef.current) return
      if (!res.data) {
        if (showTargetLoader) setTargetLoading(false)
        return
      }

      const serverMessages = sortChronologicalMessages(res.data.messages || [])
      serverMessages.forEach((message) => {
        if (message.client_message_id) removeStoredFailure(target, message.client_message_id)
      })
      setMessages((current) => mergeMessageWindow(
        options.background ? current.filter((message) => messageBelongsToTarget(message, target)) : storedFailureMessages(target),
        serverMessages,
        options.background,
      ))
      setPinnedMessages(sortPinnedMessages(res.data.pinned_messages || []))
      setMessageWindowMeta((current) => options.background && current && res.data?.meta ? {
        ...res.data.meta,
        oldest_message_id: current.oldest_message_id,
        has_older: current.has_older,
      } : res.data?.meta || null)
      setChannels((prev) => prev.map((channel) => channel.id === target.id ? res.data!.channel : channel))
      setHighlightedMessageId(options.highlightedMessageId || null)
      if (markRead && channelNeedsRead(res.data.channel)) {
        await api.markChannelRead(target.id)
        setChannels((prev) => prev.map((channel) => channel.id === target.id ? { ...channel, unread_count: 0, last_read_at: new Date().toISOString() } : channel))
      }
      if (showTargetLoader) setTargetLoading(false)
      return
    }

    const res = await api.getDirectConversation(target.id, {
      around_message_id: options.aroundMessageId,
    })
    if (requestId !== targetRequestRef.current) return
    if (!res.data) {
      if (showTargetLoader) setTargetLoading(false)
      return
    }

    const serverMessages = sortChronologicalMessages(res.data.messages || [])
    serverMessages.forEach((message) => {
      if (message.client_message_id) removeStoredFailure(target, message.client_message_id)
    })
    setMessages((current) => mergeMessageWindow(
      options.background ? current.filter((message) => messageBelongsToTarget(message, target)) : storedFailureMessages(target),
      serverMessages,
      options.background,
    ))
    setPinnedMessages(sortPinnedMessages(res.data.pinned_messages || []))
    setMessageWindowMeta((current) => options.background && current && res.data?.meta ? {
      ...res.data.meta,
      oldest_message_id: current.oldest_message_id,
      has_older: current.has_older,
    } : res.data?.meta || null)
    setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? res.data!.direct_conversation : conversation))
    setHighlightedMessageId(options.highlightedMessageId || null)
    if (markRead && dmNeedsRead(res.data.direct_conversation)) {
      await api.markDirectConversationRead(target.id)
      setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? { ...conversation, unread_count: 0, last_read_at: new Date().toISOString() } : conversation))
    }
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
      const accountAllowsPush = config.data ? webPushPreferenceEnabled(config.data) : true
      setPushEnabled(accountAllowsPush && Boolean(subscription))
    }).catch(() => {
      if (active) setPushEnabled(false)
    })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const options = routedMessageId !== null && Number.isInteger(routedMessageId) && routedMessageId > 0 ? { aroundMessageId: routedMessageId, highlightedMessageId: routedMessageId } : {}
    const target: Target | null = channelId ? { type: 'channel', id: Number(channelId) } : dmId ? { type: 'dm', id: Number(dmId) } : null
    if (!target) return

    const current = selectedTargetRef.current
    const sameTarget = current?.type === target.type && current.id === target.id
    if (routeTargetInitializedRef.current && sameTarget) {
      targetLoadOptionsRef.current = {}
      void loadTarget(target, canAutoMarkRead(true), options)
    } else {
      targetLoadOptionsRef.current = options
      setSelectedTarget(target)
    }
    routeTargetInitializedRef.current = true
  }, [channelId, dmId, routedMessageId])

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
    if (workspaceId) setSelectedWorkspaceId(workspaceId)
  }, [selectedTarget, selectedChannel, selectedDm])

  useEffect(() => {
    if (isDesktop) return
    setMobilePane(selectedTarget ? 'conversation' : 'list')
  }, [isDesktop, selectedTarget?.type, selectedTarget?.id])

  useEffect(() => {
    if (!selectedTarget) return
    setHasUnreadBelow(false)

    const options = targetLoadOptionsRef.current
    targetLoadOptionsRef.current = {}
    loadTarget(selectedTarget, canAutoMarkRead(true), options)
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
        await loadTarget(selectedTarget, canAutoMarkRead(), { background: true })
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
      const shouldMarkIncomingRead = Boolean(belongsToTarget && !message.mine && event.event === 'created' && canAutoMarkRead())

      updateTargetSummaryFromEvent(event, message, message.mine || shouldMarkIncomingRead)

      if (belongsToTarget) {
        const duringProgrammaticScroll = shouldStickToBottomRef.current && window.performance.now() < programmaticScrollUntilRef.current
        if (!duringProgrammaticScroll) {
          shouldStickToBottomRef.current = message.mine || shouldMarkIncomingRead || isNearConversationBottom()
        }

        if (event.event === 'created' && !message.mine && !message.parent_message_id && !shouldStickToBottomRef.current) {
          setHasUnreadBelow(true)
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

  useEffect(() => {
    const subscription = realtimeSubscriptionRef.current
    const target = selectedTarget
    const threadRootId = activeThreadRootId
    const hasContent = composerBodyMatchesDestination(bodyDestinationKey, user?.id, target, threadRootId)
      && Boolean(normalizeMessageMarkdown(body))
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
  }, [activeThreadRootId, body, bodyDestinationKey, realtimeSubscriptionVersion, selectedTarget, user?.id])

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

  useLayoutEffect(() => {
    const element = messageScrollRef.current
    if (!element || !selectedTarget || conversationView !== 'messages') return

    const currentTargetKey = targetKey(selectedTarget)
    const restoringTarget = pendingScrollRestoreTargetKeyRef.current === currentTargetKey
    const targetChanged = lastAutoScrollTargetKeyRef.current !== currentTargetKey
    lastAutoScrollTargetKeyRef.current = currentTargetKey

    let secondFrame: number | null = null
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        if (restoringTarget) {
          pendingScrollRestoreTargetKeyRef.current = null
          const savedScroll = readSavedConversationScroll(user?.id, selectedTarget)
          if (savedScroll && !savedScroll.atBottom) {
            element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight - savedScroll.distanceFromBottom)
            shouldStickToBottomRef.current = false
            setShowScrollToLatest(true)
            return
          }
        }

        if (shouldStickToBottomRef.current) {
          const behavior = targetChanged ? 'auto' : 'smooth'
          if (programmaticScrollTimerRef.current) window.clearTimeout(programmaticScrollTimerRef.current)
          programmaticScrollUntilRef.current = window.performance.now() + (behavior === 'smooth' ? 600 : 80)
          element.scrollTo({ top: element.scrollHeight, behavior })
          setShowScrollToLatest(false)
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
  }, [conversationView, messages.length, selectedTarget?.type, selectedTarget?.id, user?.id])

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

  const markWorkspaceRead = async (workspaceId: number) => {
    const workspaceChannels = channels.filter((channel) => channel.workspace_id === workspaceId && channel.unread_count > 0)
    const workspaceDms = directConversations.filter((conversation) => conversation.workspace_id === workspaceId && conversation.unread_count > 0)
    if (workspaceChannels.length === 0 && workspaceDms.length === 0) return

    await Promise.all([
      ...workspaceChannels.map((channel) => api.markChannelRead(channel.id)),
      ...workspaceDms.map((conversation) => api.markDirectConversationRead(conversation.id)),
    ])

    const now = new Date().toISOString()
    setChannels((prev) => prev.map((channel) => channel.workspace_id === workspaceId ? { ...channel, unread_count: 0, last_read_at: now } : channel))
    setDirectConversations((prev) => prev.map((conversation) => conversation.workspace_id === workspaceId ? { ...conversation, unread_count: 0, last_read_at: now } : conversation))
    toast.success('Workspace marked read')
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

  const scrollToLatestMessage = () => {
    setHasUnreadBelow(false)
    scrollToBottom('smooth')
    if (selectedTarget && canAutoMarkRead(true)) {
      markRead(selectedTarget).catch(() => {})
    }
  }

  const isNearConversationBottom = () => {
    const element = messageScrollRef.current
    if (!element) return true

    return element.scrollHeight - element.scrollTop - element.clientHeight < 96
  }

  const handleConversationScroll = () => {
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
      return
    }

    shouldStickToBottomRef.current = false
  }

  const canAutoMarkRead = (ignoreScrollPosition = false) => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false
    if (!isDesktopRef.current && mobilePaneRef.current !== 'conversation') return false
    if (activeThreadRootIdRef.current) return false

    return ignoreScrollPosition || isNearConversationBottom()
  }

  const selectTarget = (target: Target, options: TargetLoadOptions = {}) => {
    const currentElement = messageScrollRef.current
    const currentTarget = selectedTargetRef.current
    if (currentElement && currentTarget) saveConversationScroll(user?.id, currentTarget, currentElement)

    window.history.replaceState(null, '', target.type === 'channel' ? `/messages/${target.id}` : `/messages/dm/${target.id}`)
    setSourceContextHidden(true)
    targetLoadOptionsRef.current = options
    setTargetLoading(true)
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

  const handleSend = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!selectedTarget || !user) return

    const submittedBody = normalizeMessageMarkdown(editor ? editorJsonToMarkdown(editor.getJSON()) : body)
    const submittedAttachments = pendingAttachments
    const submittedTarget = selectedTarget
    const submittedDraftKey = activeDraftKeyRef.current
    const threadRoot = activeThreadRoot
    const mentionUserIds = resolveMentionedUserIds(submittedBody, mentionableUsers, composerMentionUserIds)
    if (!submittedBody && submittedAttachments.length === 0) return
    if (messageCharacterCount(submittedBody) > MESSAGE_BODY_LIMIT) return

    const clientMessageId = createClientMessageId()

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
    if (submittedDraftKey && typeof window !== 'undefined') {
      writeComposerDraft(submittedDraftKey, null, window.localStorage)
      pendingAttachmentBucketsRef.current.delete(submittedDraftKey)
    }

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
        : await api.createDirectMessage(submittedTarget.id, payload)

      if (!res.data) {
        const failureError = res.error || 'Could not send message.'
        setError(failureError)
        toast.error(failureError)
        const retrySend: RetrySend = { clientMessageId, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, pendingAttachments: submittedAttachments, uploadedAttachments }
        saveStoredFailure(submittedTarget, { version: 1, clientMessageId, target: submittedTarget, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, attachments: uploadedAttachments, attachmentCount: submittedAttachments.length, createdAt: optimisticMessage.created_at, error: failureError })
        if (targetMatches(selectedTargetRef.current, submittedTarget)) {
          setMessages((prev) => prev.map((item) => item.id === tempId ? { ...item, pending: false, failed: true, failureError, retrySend } : item))
        }
      } else {
        const message = res.data.message
        removeStoredFailure(submittedTarget, clientMessageId)
        releaseOptimisticAttachmentUrls(tempId)
        if (targetMatches(selectedTargetRef.current, submittedTarget)) {
          setMessages((prev) => sortChronologicalMessages([...prev.filter((item) => item.id !== tempId && item.id !== message.id && item.client_message_id !== clientMessageId), message]))
        }
        updateLatestForTarget(message)
      }
    } catch (sendError) {
      const message = sendError instanceof Error ? sendError.message : 'Could not send message.'
      setError(message)
      toast.error(message)
      const retrySend: RetrySend = { clientMessageId, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, pendingAttachments: submittedAttachments, uploadedAttachments }
      saveStoredFailure(submittedTarget, { version: 1, clientMessageId, target: submittedTarget, body: submittedBody, parentMessageId: optimisticMessage.parent_message_id, mentionUserIds, attachments: uploadedAttachments, attachmentCount: submittedAttachments.length, createdAt: optimisticMessage.created_at, error: message })
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
        : await api.createDirectMessage(target.id, payload)

      if (!res.data) throw new Error(res.error || 'Could not send message.')

      removeStoredFailure(target, retry.clientMessageId)
      releaseOptimisticAttachmentUrls(message.id)
      if (targetMatches(selectedTargetRef.current, target)) {
        setMessages((current) => sortChronologicalMessages([
          ...current.filter((item) => item.id !== message.id && item.id !== res.data!.message.id && item.client_message_id !== retry.clientMessageId),
          res.data!.message,
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
    releaseOptimisticAttachmentUrls(message.id)
    setMessages((current) => current.filter((item) => item.id !== message.id))
  }

  const restoreFailedMessageText = (message: LocalMessage) => {
    if (!editor) return
    const insert = () => {
      if (message.body) editor.chain().focus().insertContent(message.body).run()
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

  const openLinkForm = () => {
    if (!editor) return

    restoreComposerSelection()

    const { from, to } = editor.state.selection
    const selectedText = editor.state.doc.textBetween(from, to, ' ').trim()
    const currentHref = editor.getAttributes('link').href || ''

    setLinkText(selectedText)
    setLinkHref(currentHref)
    setLinkError('')
    setShowLinkForm(true)
  }

  const closeLinkForm = () => {
    setShowLinkForm(false)
    setLinkText('')
    setLinkHref('')
    setLinkError('')
  }

  const applyLink = (event: React.FormEvent) => {
    event.preventDefault()
    if (!editor) return

    restoreComposerSelection()

    const href = normalizeLinkHref(linkHref)
    if (!href) {
      setLinkError('Enter a valid website or email link, like https://example.com or example.com.')
      return
    }

    const { empty } = editor.state.selection
    const customText = linkText.trim()
    const displayText = customText || href

    if (empty && editor.isActive('link')) {
      if (customText) {
        editor.chain().focus().extendMarkRange('link').deleteSelection().insertContent({
          type: 'text',
          text: displayText,
          marks: [{ type: 'link', attrs: { href } }],
        }).run()
      } else {
        editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
      }
    } else if (empty) {
      editor.chain().focus().insertContent({
        type: 'text',
        text: displayText,
        marks: [{ type: 'link', attrs: { href } }],
      }).run()
    } else {
      editor.chain().focus().deleteSelection().insertContent({
        type: 'text',
        text: displayText,
        marks: [{ type: 'link', attrs: { href } }],
      }).run()
    }

    closeLinkForm()
  }

  const restoreComposerSelection = () => {
    if (!editor || !composerSelectionRef.current) return
    const maxPosition = editor.state.doc.content.size
    const from = Math.min(composerSelectionRef.current.from, maxPosition)
    const to = Math.min(composerSelectionRef.current.to, maxPosition)
    editor.commands.setTextSelection({ from, to })
  }

  const runToolbarCommand = (command: () => void) => {
    restoreComposerSelection()
    command()
    setToolbarTick((current) => current + 1)
  }

  const toggleComposerList = (kind: 'orderedList' | 'bulletList') => {
    if (!editor) return
    applyComposerList(editor, kind, composerSelectionRef.current)
    composerSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to }
    setToolbarTick((current) => current + 1)
  }

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const modifier = event.metaKey || event.ctrlKey
    const key = event.key.toLowerCase()

    if (modifier && event.shiftKey && key === 'u') {
      event.preventDefault()
      openLinkForm()
      return
    }

    if (editor && applyComposerListShortcut(editor, event, composerSelectionRef.current)) {
      composerSelectionRef.current = { from: editor.state.selection.from, to: editor.state.selection.to }
      setToolbarTick((current) => current + 1)
      return
    }

    if (modifier && event.shiftKey && event.altKey && key === 'c') {
      event.preventDefault()
      insertCodeBlock()
      return
    }

    if (modifier && event.shiftKey && !event.altKey && key === 'c') {
      event.preventDefault()
      editor?.chain().focus().toggleCode().run()
      return
    }

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

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      composerFormRef.current?.requestSubmit()
    }
  }

  const saveEdit = async (message: ChannelMessage) => {
    const normalizedBody = normalizeMessageMarkdown(editBody)
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

  if (loading) return <MessagesLoadingShell />

  const showListPane = isDesktop || mobilePane === 'list'
  const showConversationPane = isDesktop || mobilePane === 'conversation' || mobilePane === 'thread'
  const showCollapsedRail = isDesktop && sidebarCollapsed
  const showThreadPanel = Boolean(isDesktop && activeThreadRoot)
  const conversationMessages = activeThreadRoot && !showThreadPanel ? activeThreadMessages : rootMessages
  const showComposer = Boolean(selectedTarget) && (conversationView === 'messages' || Boolean(activeThreadRoot))
  const showPageIntro = !selectedTarget
  const showConversationHeaderPushMessage = Boolean(pushMessage) && Boolean(selectedTarget)
  const displayedMessages = conversationView === 'pins' && !activeThreadRoot ? selectedPinnedMessages : conversationMessages
  const composerCharacterCount = messageCharacterCount(normalizeMessageMarkdown(body))
  const composerOverLimit = composerCharacterCount > MESSAGE_BODY_LIMIT
  const renderComposer = (placement: 'main' | 'thread') => {
    const inThreadPanel = placement === 'thread'

    return (
      <form
        ref={composerFormRef}
        onSubmit={handleSend}
        className={`${inThreadPanel ? 'shrink-0 border-t border-slate-200 bg-white p-3' : 'shrink-0 border-t border-slate-200 bg-white px-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] pt-2.5 sm:px-4 sm:pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pt-3'}`}
      >
        {typingLabel && (
          <div className="mb-1.5 flex min-h-5 items-center gap-2 px-2 text-xs font-semibold text-slate-500" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-0.5" aria-hidden="true">
              <span className="h-1 w-1 rounded-full bg-slate-400" />
              <span className="h-1 w-1 rounded-full bg-slate-400" />
              <span className="h-1 w-1 rounded-full bg-slate-400" />
            </span>
            {typingLabel}
          </div>
        )}
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
          className="relative min-w-0 overflow-visible rounded-xl border border-slate-200 bg-white shadow-[0_18px_42px_-30px_rgba(15,23,42,0.38)] transition-shadow focus-within:border-primary-200 focus-within:shadow-[0_20px_54px_-34px_rgba(239,68,68,0.42)] sm:rounded-2xl"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="messages-toolbar-scroll flex items-center gap-1 overflow-x-auto border-b border-slate-100 px-1.5 py-1 text-slate-500 sm:gap-1.5 sm:px-2 sm:py-1.5" role="toolbar" aria-label="Message formatting">
            <ComposerToolbarButton label="Attach files" onPointerDown={(event) => event.preventDefault()} onClick={() => fileInputRef.current?.click()}>
              <Paperclip className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Bold" shortcut="⌘B" toggle active={Boolean(editor?.isActive('bold'))} onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(() => editor?.chain().focus().toggleBold().run())}>
              <Bold className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Italic" shortcut="⌘I" toggle active={Boolean(editor?.isActive('italic'))} onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(() => editor?.chain().focus().toggleItalic().run())}>
              <Italic className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Underline" shortcut="⌘U" toggle active={Boolean(editor?.isActive('underline'))} onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(() => editor?.chain().focus().toggleUnderline().run())}>
              <UnderlineIcon className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Strikethrough" toggle active={Boolean(editor?.isActive('strike'))} onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(() => editor?.chain().focus().toggleStrike().run())}>
              <Strikethrough className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Link" shortcut="⌘⇧U" toggle active={Boolean(editor?.isActive('link'))} onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(openLinkForm)}>
              <Link2 className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Numbered list" shortcut="⌘⇧7" toggle active={Boolean(editor?.isActive('orderedList'))} onPointerDown={(event) => event.preventDefault()} onClick={() => toggleComposerList('orderedList')}>
              <ListOrdered className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Bulleted list" shortcut="⌘⇧8" toggle active={Boolean(editor?.isActive('bulletList'))} onPointerDown={(event) => event.preventDefault()} onClick={() => toggleComposerList('bulletList')}>
              <List className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Quote" toggle active={Boolean(editor?.isActive('blockquote'))} onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(() => editor?.chain().focus().toggleBlockquote().run())}>
              <TextQuote className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Inline code" shortcut="⌘⇧C" toggle active={Boolean(editor?.isActive('code'))} onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(() => editor?.chain().focus().toggleCode().run())}>
              <Code2 className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Code block" shortcut="⌘⌥⇧C" toggle active={Boolean(editor?.isActive('codeBlock'))} onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(insertCodeBlock)}>
              <Braces className="h-4 w-4" />
            </ComposerToolbarButton>
            <ComposerToolbarButton label="Mention" shortcut="@" className="px-2.5 text-xs font-medium" onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(() => insertIntoComposer('@'))}>
              @ mention
            </ComposerToolbarButton>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
          </div>
          <div className="p-1.5 sm:p-2" onKeyDownCapture={handleComposerKeyDown}>
            <div className="min-h-0 min-w-0 rounded-lg bg-slate-50/70 sm:rounded-xl">
              <EditorContent editor={editor} />
            </div>
          </div>
          <div className="flex min-h-14 items-center justify-between gap-3 border-t border-slate-100 px-2.5 py-1.5 sm:min-h-0 sm:px-3 sm:py-2.5">
            <div id={composerHelpId} className={`min-w-0 text-xs ${composerOverLimit ? 'font-semibold text-red-600' : 'text-slate-400'}`} aria-live="polite">
              {composerOverLimit || composerCharacterCount >= 4_500
                ? `${composerCharacterCount.toLocaleString()} / ${MESSAGE_BODY_LIMIT.toLocaleString()} characters`
                : <span className="hidden sm:inline">Press ⌘/Ctrl + Enter to send</span>}
            </div>
            <button
              type="submit"
              disabled={sending || composerOverLimit || (!body.trim() && pendingAttachments.length === 0)}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-primary-500 text-sm font-medium text-white shadow-sm transition hover:bg-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:w-auto sm:px-4"
              aria-label={sending ? 'Sending message' : 'Send message'}
            >
              <Send className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">Send</span>
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
        </div>
      </form>
    )
  }

  return (
    <div className={`mx-auto flex h-full w-full max-w-[1500px] min-w-0 flex-col ${showPageIntro ? 'min-h-0 gap-4 p-4 lg:p-0' : 'min-h-0 gap-0 overflow-hidden'}`}>
      {showPageIntro && (
      <div>
        <p className="app-eyebrow">Communication</p>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="app-title mt-2">Messages</h1>
            <p className="app-description mt-2">
              Workspace messaging for cohorts, alumni, staff groups, direct messages, files, and quick decisions.
              {realtimeStatus === 'connected' && <span className="ml-2 text-green-600">Live</span>}
              {realtimeStatus === 'error' && <span className="ml-2 text-amber-600">Reconnecting with refresh fallback</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!selectedTarget && (
              <button
                type="button"
                onClick={handleTogglePush}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
              >
                {pushEnabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                {pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts'}
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

      <div className={`${isDesktop ? 'grid overflow-hidden rounded-[1.75rem] border border-slate-200/80 bg-white shadow-[0_20px_54px_-42px_rgba(15,23,42,0.55)]' : 'flex min-w-0 overflow-hidden border-y border-slate-200 bg-white'} min-h-0 flex-1 ${isDesktop ? (sidebarCollapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[328px_minmax(0,1fr)]') : ''}`}>
        {showListPane && !sidebarCollapsed && (
        <aside className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 ${isDesktop ? 'border-b border-slate-200 lg:border-b-0 lg:border-r' : ''}`}>
          <div className="shrink-0 border-b border-slate-200 bg-white p-2.5 sm:p-3">
            <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2 sm:mb-3">
              <div className="min-w-0">
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
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Create workspace"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={loadLists}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Refresh messages"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
                {isDesktop && (
                  <button
                    onClick={() => setSidebarCollapsed(true)}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 hover:text-slate-700"
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
                className="group flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left shadow-sm transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-primary-500 sm:py-2.5"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-xs font-semibold text-white">
                    {selectedWorkspace ? channelInitials(selectedWorkspace.name) : 'WS'}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{selectedWorkspace?.name || 'Choose workspace'}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {workspaceSwitcherSubtitle}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {totalWorkspaceUnreadCount > 0 && (
                    <span className="inline-flex min-w-5 justify-center rounded-full bg-primary-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                      {totalWorkspaceUnreadCount > 99 ? '99+' : totalWorkspaceUnreadCount}
                    </span>
                  )}
                  <ChevronDown className="h-4 w-4 text-slate-400 transition group-hover:text-slate-600" />
                </span>
              </button>
            )}
            {selectedWorkspace && (
              <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:mt-3 sm:py-3">
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
                  <p className="mt-2 line-clamp-2 text-xs text-slate-500">{selectedWorkspace.description}</p>
                )}
              </div>
            )}
            {unreadOtherWorkspaceCards.length > 0 && (
              <div className="mt-3 rounded-lg border border-primary-100 bg-primary-50/70 px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary-700">Unread elsewhere</p>
                  <button
                    type="button"
                    onClick={() => setShowWorkspaceSwitcher(true)}
                    className="text-xs font-semibold text-primary-700 hover:text-primary-800"
                  >
                    View all
                  </button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unreadOtherWorkspaceCards.slice(0, 3).map(({ workspace, unreadCount }) => (
                    <button
                      key={workspace.id}
                      type="button"
                      onClick={() => selectWorkspace(workspace.id)}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-primary-700 ring-1 ring-primary-100 hover:bg-primary-100"
                    >
                      <span className="truncate">{workspace.name}</span>
                      <span className="rounded-full bg-primary-500 px-1.5 py-0.5 text-[10px] leading-none text-white">
                        {unreadCount > 99 ? '99+' : unreadCount}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="relative mt-3">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search messages"
                aria-label="Search messages"
                className="app-control w-full pl-9 text-base sm:text-sm"
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

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1.5 sm:p-2">
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
        <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
          {selectedTarget && selected ? (
            <>
              <header className={`shrink-0 border-b border-slate-200/80 px-3 py-2.5 backdrop-blur-sm ${isDesktop ? 'bg-white/80' : 'bg-white'} sm:px-4 sm:py-4`}>
                <div className="flex items-start justify-between gap-2">
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
                  <div className="flex shrink-0 items-center gap-1.5 sm:justify-end sm:gap-2">
                    {selectedDmStudent && (
                      <ConversationHeaderAction
                        onClick={() => setShowStudentContext(true)}
                        icon={<UserRound className="h-4 w-4" />}
                        shortLabel="Student"
                        fullLabel="Student context"
                        ariaLabel={`Open ${selectedDmStudent.full_name}'s student context`}
                      />
                    )}
                    {selectedTarget && (
                      <ConversationHeaderAction
                        onClick={toggleMute}
                        icon={selectedMuted ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                        shortLabel={selectedMuted ? 'Unmute' : 'Mute'}
                        fullLabel={selectedMuted ? 'Unmute conversation' : 'Mute conversation'}
                        ariaLabel={selectedMuted ? 'Unmute conversation' : 'Mute conversation'}
                      />
                    )}
                    <ConversationHeaderAction
                      onClick={handleTogglePush}
                      icon={pushEnabled ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                      shortLabel={pushEnabled ? 'Notify off' : 'Notify on'}
                      fullLabel={pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts'}
                      ariaLabel={pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts'}
                    />
                    {selectedTarget.type === 'channel' && selectedChannel?.visibility === 'staff_only' && (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">Staff only</span>
                    )}
                  </div>
                </div>
                {selectedTarget.type === 'channel' && selectedChannel?.description && <p className="mt-2 text-sm text-slate-500">{selectedChannel.description}</p>}
                {sourceRecord && sourceRecordPath && <div className="mt-2.5"><Link to={sourceRecordPath} className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-bold text-blue-800 hover:bg-blue-100"><BookOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate">From {sourceRecord.type === 'submission' ? 'submission' : 'help request'}: {sourceRecord.label}</span></Link></div>}
                {showConversationHeaderPushMessage && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {pushMessage}
                  </div>
                )}
                {!activeThreadRoot && (
                  <div className="mt-2.5 flex min-w-0 items-center gap-1.5 overflow-x-auto sm:mt-3 sm:gap-2">
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

              <div className={`relative min-w-0 min-h-0 flex-1 overflow-hidden ${showThreadPanel ? 'grid lg:grid-cols-[minmax(0,1fr)_380px]' : 'flex'}`}>
                <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <div
                    ref={messageScrollRef}
                    onScroll={handleConversationScroll}
                    className={`min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2 transition duration-200 sm:px-5 sm:py-5 ${loadingTarget || isNavigationPending ? 'opacity-60' : 'opacity-100'}`}
                  >
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
                  {!activeThreadRoot && conversationView === 'messages' && messageWindowMeta?.has_older && (
                    <div className="flex justify-center pb-3">
                      <button
                        type="button"
                        onClick={() => void loadOlderMessages()}
                        disabled={loadingOlder}
                        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm transition hover:border-primary-200 hover:bg-primary-50 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-wait disabled:opacity-60"
                      >
                        <RefreshCw className={`h-4 w-4 ${loadingOlder ? 'animate-spin' : ''}`} />
                        {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
                      </button>
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
                          onCopy={() => void copyMessage(message)}
                          onRetry={() => void retryFailedMessage(message)}
                          onDiscard={() => discardFailedMessage(message)}
                          onRestore={() => restoreFailedMessageText(message)}
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
                          onInspectReaction={(emoji) => setReactionDetails({ messageId: message.id, emoji })}
                          onOpenImage={(attachment, imageAttachments) => {
                            setLightboxAttachments(imageAttachments)
                            setLightboxIndex(Math.max(0, imageAttachments.findIndex((item) => item.id === attachment.id)))
                          }}
                          mentionPatterns={mentionPatterns}
                        />
                      </div>
                    )
                  })}
                  </div>
                  {showScrollToLatest && conversationView === 'messages' && (
                    <button
                      type="button"
                      onClick={scrollToLatestMessage}
                      className="absolute bottom-3 left-1/2 z-20 inline-flex min-h-10 -translate-x-1/2 items-center gap-2 rounded-full border border-primary-100 bg-white px-3.5 py-2 text-xs font-semibold text-primary-700 shadow-lg shadow-slate-900/10 transition hover:-translate-y-0.5 hover:border-primary-200 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2"
                      aria-label={hasUnreadBelow ? 'Jump to new messages' : 'Jump to latest message'}
                    >
                      <ChevronDown className="h-4 w-4" />
                      {hasUnreadBelow ? 'New messages' : 'Jump to latest'}
                    </button>
                  )}
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
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
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
                            onCopy={() => void copyMessage(message)}
                            onRetry={() => void retryFailedMessage(message)}
                            onDiscard={() => discardFailedMessage(message)}
                            onRestore={() => restoreFailedMessageText(message)}
                            onOpenActions={() => setMobileActionsMessageId(message.id)}
                            onPin={() => togglePin(message)}
                            canPin={isStaff}
                            inThreadView
                            replyCount={0}
                            onReply={() => setActiveThreadRootId(activeThreadRoot.id)}
                            onReact={(emoji) => toggleReaction(message, emoji)}
                            onInspectReaction={(emoji) => setReactionDetails({ messageId: message.id, emoji })}
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
        open={Boolean(reactionDetailsMessage && selectedReaction)}
        onClose={() => setReactionDetails(null)}
        title="Who reacted"
        subtitle="See everyone behind each reaction and manage your own."
        size="md"
      >
        {reactionDetailsMessage && selectedReaction && (() => {
          const selectedDisplay = REACTIONS_BY_VALUE.get(selectedReaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
          const SelectedIcon = selectedDisplay.Icon
          return (
            <div>
              <div role="tablist" aria-label="Message reactions" className="flex gap-2 overflow-x-auto pb-4">
                {reactionDetailsMessage.reactions.map((reaction) => {
                  const display = REACTIONS_BY_VALUE.get(reaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
                  const Icon = display.Icon
                  const active = reaction.emoji === selectedReaction.emoji
                  return (
                    <button
                      key={reaction.emoji}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={`${display.label}, ${reaction.count}`}
                      onClick={() => setReactionDetails({ messageId: reactionDetailsMessage.id, emoji: reaction.emoji })}
                      className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl border px-3.5 text-sm font-semibold transition ${
                        active
                          ? 'border-primary-200 bg-primary-50 text-primary-700'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {reaction.count}
                    </button>
                  )
                })}
              </div>
              <div className="flex min-h-12 items-center gap-2 border-b border-slate-200">
                <SelectedIcon className="h-4 w-4 text-primary-600" />
                <p className="flex-1 text-sm font-semibold text-slate-900">{selectedDisplay.label}</p>
                <span className="text-xs font-semibold text-slate-500">{selectedReaction.count}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {selectedReaction.users.map((person) => (
                  <div key={person.id} className="flex min-h-14 items-center gap-3 py-2">
                    {person.avatar_url
                      ? <img src={person.avatar_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                      : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">{person.full_name.slice(0, 1)}</span>}
                    <span className="text-sm font-medium text-slate-800">{person.full_name}</span>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() => void toggleReaction(reactionDetailsMessage, selectedReaction.emoji)}
                className={`mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-sm font-bold transition ${
                  selectedReaction.reacted
                    ? 'border border-primary-200 bg-primary-50 text-primary-700 hover:bg-primary-100'
                    : 'bg-primary-600 text-white hover:bg-primary-700'
                }`}
              >
                <SelectedIcon className="h-4 w-4" />
                {selectedReaction.reacted ? `Remove your ${selectedDisplay.label.toLowerCase()}` : `React with ${selectedDisplay.label.toLowerCase()}`}
              </button>
            </div>
          )
        })()}
      </Modal>
      <Modal
        open={showWorkspaceSwitcher}
        onClose={() => setShowWorkspaceSwitcher(false)}
        title="Switch workspace"
        subtitle="Move between cohorts, communities, channels, and direct messages."
        size="lg"
      >
        <div className="space-y-3">
          {sortedWorkspaceCards.map(({ workspace, channelCount, dmCount, unreadChannelCount, unreadDmCount, unreadCount }) => {
            const active = workspace.id === selectedWorkspaceId

            return (
              <div
                key={workspace.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  selectWorkspace(workspace.id)
                  setShowWorkspaceSwitcher(false)
                }}
                onKeyDown={(event) => {
                  if (event.target !== event.currentTarget) return
                  if (event.key !== 'Enter' && event.key !== ' ') return
                  event.preventDefault()
                  selectWorkspace(workspace.id)
                  setShowWorkspaceSwitcher(false)
                }}
                className={`group flex w-full items-center gap-4 rounded-2xl border px-4 py-4 text-left transition ${
                  active
                    ? 'border-primary-200 bg-primary-50/70 shadow-sm'
                    : unreadCount > 0
                      ? 'border-primary-200 bg-white shadow-sm hover:bg-primary-50/40'
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
                    {unreadCount > 0 && (
                      <span className="inline-flex shrink-0 rounded-full bg-primary-500 px-2 py-0.5 text-[11px] font-semibold text-white">
                        {unreadCount} unread
                      </span>
                    )}
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
                      {dmCount} DM {dmCount === 1 ? 'conversation' : 'conversations'}
                    </span>
                    {unreadChannelCount > 0 && (
                      <span className="inline-flex items-center gap-1 font-semibold text-primary-700">
                        <Hash className="h-3.5 w-3.5" />
                        {unreadChannelCount} unread
                      </span>
                    )}
                    {unreadDmCount > 0 && (
                      <span className="inline-flex items-center gap-1 font-semibold text-primary-700">
                        <MessageCircle className="h-3.5 w-3.5" />
                        {unreadDmCount} unread
                      </span>
                    )}
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
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation()
                        markWorkspaceRead(workspace.id).catch(() => {
                          toast.error('Failed to mark workspace as read')
                        })
                      }}
                      className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-primary-700 ring-1 ring-primary-100 hover:bg-primary-50"
                    >
                      <CheckCheck className="h-3 w-3" />
                      Mark read
                    </button>
                  )}
                </span>
              </div>
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
          {mobileActionsMessage?.body && !mobileActionsMessage.blocked && (
            <button
              type="button"
              onClick={() => {
                void copyMessage(mobileActionsMessage)
                setMobileActionsMessageId(null)
              }}
              className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-slate-200 px-4 py-3 text-left text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Copy className="h-4 w-4" />
              Copy message
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
          {mobileActionsMessage && !mobileActionsMessage.mine && (
            <>
              <button
                type="button"
                onClick={() => {
                  void reportMessage(mobileActionsMessage)
                  setMobileActionsMessageId(null)
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-red-200 px-4 py-3 text-left text-sm font-medium text-red-700 hover:bg-red-50"
              >
                <Flag className="h-4 w-4" />
                Report message
              </button>
              <button
                type="button"
                onClick={() => {
                  void reportUser(mobileActionsMessage)
                  setMobileActionsMessageId(null)
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-red-200 px-4 py-3 text-left text-sm font-medium text-red-700 hover:bg-red-50"
              >
                <Flag className="h-4 w-4" />
                Report {mobileActionsMessage.author.full_name}
              </button>
              {!mobileActionsMessage.blocked && <button
                type="button"
                onClick={() => {
                  void blockMessageAuthor(mobileActionsMessage)
                  setMobileActionsMessageId(null)
                }}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-red-200 px-4 py-3 text-left text-sm font-medium text-red-700 hover:bg-red-50"
              >
                <UserX className="h-4 w-4" />
                Block {mobileActionsMessage.author.full_name}
              </button>}
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

      <Modal
        open={showLinkForm}
        onClose={closeLinkForm}
        title="Add link"
        subtitle="Add display text and the destination URL."
        size="md"
      >
        <form onSubmit={applyLink} className="space-y-4">
          <div>
            <label htmlFor="message-link-text" className="text-sm font-medium text-slate-700">
              Text
            </label>
            <input
              id="message-link-text"
              value={linkText}
              onChange={(event) => setLinkText(event.target.value)}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="Text to show"
              autoFocus
            />
          </div>
          <div>
            <label htmlFor="message-link-href" className="text-sm font-medium text-slate-700">
              Link
            </label>
            <input
              id="message-link-href"
              value={linkHref}
              onChange={(event) => {
                setLinkHref(event.target.value)
                setLinkError('')
              }}
              className={`mt-1 w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 ${
                linkError
                  ? 'border-red-200 focus:ring-red-500'
                  : 'border-slate-200 focus:ring-primary-500'
              }`}
              placeholder="https://example.com"
              aria-invalid={Boolean(linkError)}
              aria-describedby={linkError ? 'message-link-error' : undefined}
            />
            {linkError && (
              <p id="message-link-error" className="mt-1.5 text-xs font-medium text-red-600">
                {linkError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={closeLinkForm}
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!linkHref.trim()}
              className="rounded-xl bg-primary-500 px-4 py-2 text-sm font-medium text-white hover:bg-primary-600 disabled:opacity-50"
            >
              Save link
            </button>
          </div>
        </form>
      </Modal>

      {selectedDmStudent && selectedDm?.cohort_id && <StudentContextDrawer open={showStudentContext} cohortId={selectedDm.cohort_id} studentId={selectedDmStudent.id} source={sourceRecord || undefined} onClose={() => setShowStudentContext(false)} />}

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
      className={`mb-1 w-full min-w-0 overflow-hidden rounded-xl border px-2.5 py-2.5 text-left transition-all duration-200 hover:-translate-y-px sm:rounded-2xl sm:px-3 sm:py-3 ${
        active
          ? 'border-primary-100 bg-primary-50/90 text-primary-800 shadow-sm'
          : 'border-transparent hover:border-slate-200 hover:bg-white hover:shadow-sm'
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          {icon}
          <span className="truncate text-sm font-semibold">{title}</span>
          {muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
        </span>
        {unread > 0 && (
          <span className="shrink-0 rounded-full bg-primary-500 px-2 py-0.5 text-xs font-semibold text-white">
            {unread}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-xs text-slate-500">{subtitle}</p>
    </button>
  )
}

export function FormattedMessage({ body, mentionPatterns = [] }: { body: string; mentionPatterns?: MentionPattern[] }) {
  const blocks = useMemo(() => parseMessageBlocks(body), [body])

  if (!body) return null

  return (
    <div className="mt-0.5 max-w-full space-y-1 overflow-hidden break-words text-sm leading-[1.5] text-slate-700 [overflow-wrap:anywhere]">
      {blocks.map((block, index) => {
        const key = `${index}-${
          block.type === 'code'
            ? block.code.slice(0, 12)
            : block.type === 'paragraph' || block.type === 'blockquote'
              ? block.text.slice(0, 12)
              : 'spacer'
        }`
        if (block.type === 'spacer') {
          return <div key={key} className="h-0.5" aria-hidden="true" />
        }

        if (block.type === 'code') {
          return (
            <div key={key} className="max-w-full overflow-hidden rounded-lg bg-slate-900">
              {block.language && (
                <div className="border-b border-white/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  {block.language}
                </div>
              )}
              <pre className="max-w-full overflow-x-auto px-3 py-2 text-xs leading-5 text-slate-100">
                <code>{block.code}</code>
              </pre>
            </div>
          )
        }

        if (block.type === 'bulletList') {
          return (
            <ul key={key} className="ml-5 list-outside list-disc space-y-1 pr-1 marker:text-slate-400">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`} className="pl-1">{formatInline(item, mentionPatterns)}</li>
              ))}
            </ul>
          )
        }

        if (block.type === 'orderedList') {
          return (
            <ol key={key} className="ml-5 list-outside list-decimal space-y-1 pr-1 marker:font-medium marker:text-slate-500">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`} className="pl-1">{formatInline(item, mentionPatterns)}</li>
              ))}
            </ol>
          )
        }

        if (block.type === 'blockquote') {
          return (
            <blockquote key={key} className="border-l-2 border-slate-300 pl-3 text-slate-600">
              <p className="whitespace-pre-wrap">{formatInline(block.text, mentionPatterns)}</p>
            </blockquote>
          )
        }

        return <p key={key} className="whitespace-pre-wrap">{formatInline(block.text, mentionPatterns)}</p>
      })}
    </div>
  )
}

function formatInline(text: string, mentionPatterns: MentionPattern[]) {
  const nodes: ReactNode[] = []
  const codePattern = /`[^`]+`/g
  const linkPattern = /\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi
  const nestedFormatPattern = /(\*\*[^*]+\*\*|_[^_]+_|~~[^~]+~~|\+\+[^+]+\+\+|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|https?:\/\/|www\.)/i

  const renderNestedInline = (value: string) => (
    nestedFormatPattern.test(value) || findMentionMatches(value, mentionPatterns).length > 0
      ? formatInline(value, mentionPatterns)
      : value
  )

  const appendFormattedText = (chunk: string, keyPrefix: string) => {
    const pieces = chunk.split(/(\*\*[^*]+\*\*|_[^_]+_|~~[^~]+~~|\+\+[^+]+\+\+)/g)

    pieces.forEach((piece, index) => {
      if (!piece) return

      const key = `${keyPrefix}-format-${index}-${piece}`
      if (piece.startsWith('**') && piece.endsWith('**')) {
        nodes.push(<strong key={key}>{renderNestedInline(piece.slice(2, -2))}</strong>)
        return
      }
      if (piece.startsWith('_') && piece.endsWith('_')) {
        nodes.push(<em key={key}>{renderNestedInline(piece.slice(1, -1))}</em>)
        return
      }
      if (piece.startsWith('~~') && piece.endsWith('~~')) {
        nodes.push(<del key={key}>{renderNestedInline(piece.slice(2, -2))}</del>)
        return
      }
      if (piece.startsWith('++') && piece.endsWith('++')) {
        nodes.push(<u key={key}>{renderNestedInline(piece.slice(2, -2))}</u>)
        return
      }

      nodes.push(<span key={key}>{renderTextWithMentions(piece, mentionPatterns)}</span>)
    })
  }

  const appendTextWithLinks = (chunk: string, keyPrefix: string) => {
    let cursor = 0
    let match: RegExpExecArray | null

    linkPattern.lastIndex = 0
    while ((match = linkPattern.exec(chunk)) !== null) {
      if (cursor < match.index) {
        appendFormattedText(chunk.slice(cursor, match.index), `${keyPrefix}-text-${cursor}`)
      }

      if (match[1] !== undefined && match[2] !== undefined) {
        nodes.push(renderLinkNode(
          renderNestedInline(match[1]),
          match[2],
          `${keyPrefix}-markdown-link-${match.index}`,
        ))
      } else {
        const { href, trailing } = splitTrailingUrlPunctuation(match[3])
        nodes.push(renderLinkNode(href, href, `${keyPrefix}-bare-link-${match.index}`))
        if (trailing) nodes.push(<span key={`${keyPrefix}-bare-link-trailing-${match.index}`}>{trailing}</span>)
      }

      cursor = match.index + match[0].length
    }

    if (cursor < chunk.length) {
      appendFormattedText(chunk.slice(cursor), `${keyPrefix}-tail-${cursor}`)
    }
  }

  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = codePattern.exec(text)) !== null) {
    if (cursor < match.index) {
      appendTextWithLinks(text.slice(cursor, match.index), `inline-${cursor}`)
    }

    nodes.push(
      <code key={`inline-code-${match.index}`} className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-800">
        {match[0].slice(1, -1)}
      </code>,
    )
    cursor = match.index + match[0].length
  }

  if (cursor < text.length) {
    appendTextWithLinks(text.slice(cursor), `inline-${cursor}`)
  }

  if (nodes.length === 0) {
    return renderTextWithMentions(text, mentionPatterns)
  }

  return nodes
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
  onCopy,
  onRetry,
  onDiscard,
  onRestore,
  onOpenActions,
  onPin,
  canPin,
  inThreadView,
  replyCount,
  onReply,
  onReact,
  onInspectReaction,
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
  onCopy: () => void
  onRetry: () => void
  onDiscard: () => void
  onRestore: () => void
  onOpenActions: () => void
  onPin: () => void
  canPin: boolean
  inThreadView: boolean
  replyCount: number
  onReply: () => void
  onReact: (emoji: string) => void
  onInspectReaction: (emoji: string) => void
  onOpenImage: (attachment: MessageAttachment, imageAttachments: MessageAttachment[]) => void
  mentionPatterns: MentionPattern[]
}) {
  const imageAttachments = message.attachments.filter((attachment) => attachment.image && attachment.url)

  return (
    <div
      id={`message-${message.id}`}
      className={`message-row group relative flex w-full max-w-full min-w-0 gap-1.5 rounded-xl px-1.5 py-0.5 transition-all duration-200 hover:bg-slate-50/90 sm:gap-3 sm:px-3 ${
        compact ? 'mt-0' : 'mt-1.5'
      } ${message.pinned_at ? 'bg-amber-50/70 ring-1 ring-amber-100' : ''} ${message.pending ? 'opacity-75' : ''} ${
        highlighted ? 'message-row-highlight bg-primary-50 ring-2 ring-primary-200' : ''
      }`}
    >
      <div className="flex w-7 shrink-0 justify-center sm:w-10">
        {compact ? (
          <span className="pt-1 text-[10px] font-medium text-slate-300 transition-colors group-hover:text-slate-400 sm:text-[11px]">
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
        {message.blocked ? (
          <p className="text-sm italic text-slate-500">Message hidden — you blocked this user</p>
        ) : editing ? (
          <MessageEditSurface
            value={editBody}
            onChange={setEditBody}
            onSave={onSaveEdit}
            onCancel={onCancelEdit}
          />
        ) : (
          <FormattedMessage body={message.body} mentionPatterns={mentionPatterns} />
        )}
        {message.failed && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="status">
            <span className="min-w-0 flex-1">{message.failureError || 'This message was not sent.'}</span>
            {message.retrySend ? (
              <button type="button" onClick={onRetry} className="min-h-11 rounded-xl bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700">
                Retry
              </button>
            ) : (
              <button type="button" onClick={onRestore} className="min-h-11 rounded-xl bg-red-600 px-3 py-1.5 font-semibold text-white hover:bg-red-700">
                {message.body ? 'Restore text' : 'Reattach files'}
              </button>
            )}
            <button type="button" onClick={onDiscard} className="min-h-11 rounded-xl px-3 py-1.5 font-semibold text-red-700 hover:bg-red-100">
              Discard
            </button>
          </div>
        )}
        {!message.blocked && message.attachments.length > 0 && (
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
            className="mt-1 inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-medium text-slate-500"
            title={readReceiptTitle(message.read_receipts)}
            aria-label={`Seen by ${readReceiptTitle(message.read_receipts)}`}
          >
            <CheckCheck className="h-3 w-3 shrink-0 text-green-600" />
            <span className="truncate">Seen by {readReceiptLabel(message.read_receipts)}</span>
          </div>
        )}
        {!message.blocked && (message.reactions.length > 0 || (!inThreadView && replyCount > 0)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {message.reactions.map((reaction) => {
            const reactionDisplay = REACTIONS_BY_VALUE.get(reaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
            const ReactionIcon = reactionDisplay.Icon
            return (
              <div key={reaction.emoji} className="group/reaction relative">
                <button
                  type="button"
                  onClick={() => onInspectReaction(reaction.emoji)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs ${reaction?.reacted ? 'border-primary-200 bg-primary-50 text-primary-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  aria-label={`${reactionDisplay.label}: ${reaction?.count || 0}. Show who reacted.`}
                >
                  <ReactionIcon className="h-3.5 w-3.5" />
                  {reaction?.count || ''}
                </button>
                {reaction && reaction.users.length > 0 && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-lg group-hover/reaction:block">
                    <div className="font-medium">{reactionDisplay.label}</div>
                    <div className="mt-1 whitespace-nowrap">{reaction.users.map((user) => user.full_name).join(', ')}</div>
                  </div>
                )}
              </div>
            )
          })}
          {!inThreadView && replyCount > 0 && (
            <button type="button" onClick={onReply} className="min-h-9 rounded-lg px-2.5 py-1 text-xs font-bold text-primary-700 hover:bg-primary-50">
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </button>
          )}
        </div>
        )}
      </div>
      {!message.pending && !message.failed && <div className="ml-auto flex shrink-0 items-start gap-1 sm:hidden">
        <button
          type="button"
          onClick={onOpenActions}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-white hover:text-slate-700 sm:hidden"
          aria-label="Open message actions"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>}
      {!message.pending && !message.failed && <div className="absolute right-2 top-1 z-10 hidden items-center gap-0.5 rounded-xl border border-slate-200 bg-white px-1.5 py-1 shadow-lg opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 sm:flex">
        {!message.blocked && REACTIONS.map(({ value, label, Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => onReact(value)}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            aria-label={`React with ${label}`}
            title={label}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
        {!message.blocked && <button type="button" onClick={onReply} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label={inThreadView ? 'Reply in thread' : 'Reply'}>
          <MessageCircle className="h-4 w-4" />
        </button>}
        {!message.blocked && message.body && (
          <button type="button" onClick={onCopy} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Copy message">
            <Copy className="h-4 w-4" />
          </button>
        )}
        {canPin && (
          <button type="button" onClick={onPin} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Pin message">
            <Pin className="h-4 w-4" />
          </button>
        )}
        {message.mine && (
          <>
            <button type="button" onClick={onStartEdit} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Edit message">
              <Edit3 className="h-4 w-4" />
            </button>
            <button type="button" onClick={onDelete} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-red-600" aria-label="Delete message">
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
        <button type="button" onClick={onOpenActions} className="rounded-lg p-1.5 text-slate-300 hover:bg-slate-100 hover:text-slate-600" aria-label="More message actions">
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </div>}
    </div>
  )
}

export function MessageEditSurface({
  value,
  onChange,
  onSave,
  onCancel,
}: {
  value: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const normalizedValue = normalizeMessageMarkdown(value)
  const characterCount = messageCharacterCount(normalizedValue)
  const canSave = normalizedValue.length > 0 && characterCount <= MESSAGE_BODY_LIMIT

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const maxHeight = Math.max(192, Math.min(window.innerHeight * 0.5, 448))
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 112), maxHeight)}px`
  }, [value])

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-primary-200 bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)] ring-4 ring-primary-50/80">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && canSave) {
            event.preventDefault()
            onSave()
          }
        }}
        rows={4}
        autoFocus
        aria-label="Edit message"
        className="block min-h-28 max-h-[50dvh] w-full resize-y overflow-y-auto border-0 bg-slate-50/70 px-4 py-3 text-base leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:bg-white sm:text-sm"
      />
      <div className="flex flex-col gap-3 border-t border-slate-200/80 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-xs font-medium ${characterCount > MESSAGE_BODY_LIMIT ? 'text-red-600' : 'text-slate-400'}`}>
          {characterCount > MESSAGE_BODY_LIMIT
            ? `${characterCount.toLocaleString()} / ${MESSAGE_BODY_LIMIT.toLocaleString()} characters`
            : 'The editor grows as you type. Press Ctrl/Command + Enter to save.'}
        </p>
        <div className="flex shrink-0 justify-end gap-2">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900">
            Cancel
          </button>
          <button type="button" onClick={onSave} disabled={!canSave} className="min-h-11 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white shadow-sm transition-colors hover:bg-primary-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400">
            Save changes
          </button>
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
      className="inline-flex h-11 w-11 items-center justify-center gap-1.5 rounded-full border border-slate-200 bg-white text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 sm:h-auto sm:w-auto sm:gap-2 sm:px-3 sm:py-2.5 sm:text-sm"
      aria-label={ariaLabel}
    >
      {icon}
      <span className="sr-only">{shortLabel}</span>
      <span className="hidden sm:inline">{fullLabel}</span>
    </button>
  )
}
