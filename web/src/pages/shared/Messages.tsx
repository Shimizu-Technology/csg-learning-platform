import { ConversationSummaryFreshness } from '../../lib/conversationSummaryFreshness'
import { readReturnContext, type ReturnContext } from '../../lib/navigationContext'
import { conversationAttentionCount, subscribeUnreadRefresh } from '../../lib/unread'
import { useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useTransition, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TiptapLink from '@tiptap/extension-link'
import UnderlineExtension from '@tiptap/extension-underline'
import { Extension, type Editor } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@tiptap/pm/state'
import { closeHistory } from '@tiptap/pm/history'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
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
  MonitorSmartphone,
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
import { MessageAuthorContext } from '../../components/shared/MessageAuthorContext'
import { useMessageLongPress } from '../../lib/useMessageLongPress'
import { isMessageTypingEvent, subscribeToUserMessages, type RealtimeSubscription } from '../../lib/realtime'
import { isVisiblePage, shouldPollMessages } from '../../lib/backgroundActivity'
import { browserPushEnabled, disablePushNotifications, enablePushNotifications, pushConfigurationHint, pushSupported } from '../../lib/pushNotifications'
import { formatFileSize, uploadToS3 } from '../../lib/uploadToS3'
import { editorJsonToMarkdown, normalizeMessageMarkdown, parseMessageBlocks, type MessageListBlock } from '../../lib/messageFormat'
import { fencedCodeInsertion, isInsideMarkdownFence, isMultiLinePaste, looksLikeCode, normalizePastedCode } from '../../lib/codePaste'
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
import { useCohortContext } from '../../contexts/CohortContext'
import { useToast } from '../../contexts/ToastContext'
import { MessagesLoadingShell } from '../../components/shared/MessagesLoadingShell'
import { Avatar } from '../../components/ui/Avatar'
import { AnchorButton, Button, IconButton } from '../../components/ui/Button'
import { TabButton, TextButton } from '../../components/ui/Choice'
import { CountBadge, RowButton } from '../../components/ui/RowButton'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/shared/Modal'
import { helpRequestPath, submissionPath } from '../../lib/routes'
import { firstUnreadMessageId, latestVisibleReadReceipts, recentConversations } from '../../lib/messagingPresentation'
import { initialScopedWorkspaceId, resolveTargetWorkspaceSync, shouldKeepMessageTarget, workspaceIdForCohort } from '../../lib/cohortScope'
import type {
  MessageDestination,
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
type TargetLoadOptions = { aroundMessageId?: number; highlightedMessageId?: number; threadRootId?: number; anchorOffset?: number; background?: boolean }
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
type ConversationViewSnapshot = { messages: LocalMessage[]; pinnedMessages: LocalMessage[]; meta: MessageWindowMeta | null }
const MAX_CACHED_CONVERSATIONS = 12
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

export function conversationPath(target: Target, messageId?: number) {
  const path = target.type === 'channel' ? `/messages/${target.id}` : `/messages/dm/${target.id}`
  return messageId ? `${path}?message_id=${messageId}` : path
}

function cacheConversationView(cache: Map<string, ConversationViewSnapshot>, target: Target, snapshot: ConversationViewSnapshot) {
  const key = targetKey(target)
  cache.delete(key)
  cache.set(key, snapshot)
  if (cache.size > MAX_CACHED_CONVERSATIONS) cache.delete(cache.keys().next().value!)
}

export function cachedWindowIsContiguous(snapshot: ConversationViewSnapshot, incoming: ChannelMessage[], meta: MessageWindowMeta | null) {
  return incoming.length > 0 && (!meta?.has_older || Boolean(snapshot.meta?.newest_message_id && incoming.some((message) => message.id === snapshot.meta?.newest_message_id)))
}

export function restoreFailedSends(snapshot: ConversationViewSnapshot, failures: LocalMessage[]): ConversationViewSnapshot {
  const failedClientIds = new Set(failures.map((message) => message.client_message_id).filter(Boolean))
  return {
    ...snapshot,
    messages: sortChronologicalMessages([
      ...snapshot.messages.filter((message) => !message.client_message_id || !failedClientIds.has(message.client_message_id)),
      ...failures,
    ]),
  }
}

function targetMatches(left: Target | null, right: Target) {
  return left?.type === right.type && left.id === right.id
}

/**
 * Message ids that arrived while a conversation was open (a realtime message
 * or the learner's own send). Only these get the enter animation: the initial
 * history, cached views, older/newer pagination, and conversation switches are
 * never recorded, so they render in place without motion.
 */
export interface MessageArrivals {
  conversationKey: string | null
  ids: ReadonlySet<number>
}

export function createMessageArrivals(conversationKey: string | null = null): MessageArrivals {
  return { conversationKey, ids: new Set() }
}

export function recordMessageArrival(arrivals: MessageArrivals, conversationKey: string, messageId: number): MessageArrivals {
  const ids = new Set(arrivals.conversationKey === conversationKey ? arrivals.ids : [])
  ids.add(messageId)
  return { conversationKey, ids }
}

export function forgetMessageArrival(arrivals: MessageArrivals, messageId: number): MessageArrivals {
  if (!arrivals.ids.has(messageId)) return arrivals
  const ids = new Set(arrivals.ids)
  ids.delete(messageId)
  return { conversationKey: arrivals.conversationKey, ids }
}

export function messageShouldAnimateEntry(arrivals: MessageArrivals, conversationKey: string | null, messageId: number) {
  return conversationKey !== null && arrivals.conversationKey === conversationKey && arrivals.ids.has(messageId)
}

function messageBelongsToTarget(message: ChannelMessage, target: Target) {
  return target.type === 'channel' ? message.channel_id === target.id : message.direct_conversation_id === target.id
}

function scrollStorageKey(userId: number, target: Target) {
  return `csg-message-scroll:${userId}:${targetKey(target)}`
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

function positionMessageAnchor(pane: HTMLDivElement, row: HTMLElement, offset?: number) {
  row.scrollIntoView({ block: 'center', behavior: 'auto' })
  if (offset !== undefined) pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - offset
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

function formatInboxTime(value: string) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
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
  const mostRecent = recentConversations(channels, directConversations)[0]
  if (mostRecent) return { type: mostRecent.type, id: mostRecent.summary.id }

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
            ? 'border border-info-200 bg-info-50 text-info-800'
            : 'bg-info-100 text-info-800'
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
      className="font-medium text-ruby-700 underline decoration-ruby-300 underline-offset-2 transition-colors hover:text-ruby-800 hover:decoration-ruby-600"
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
  wide = false,
  onClick,
  onPointerDown,
}: {
  label: string
  shortcut?: string
  active?: boolean
  children: ReactNode
  className?: string
  toggle?: boolean
  /** A text button (for example "@ mention") instead of a square icon button. */
  wide?: boolean
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
  const accessibleLabel = shortcut ? `${label} (${shortcut})` : label
  // The custom tooltip replaces the native title, so it is cleared here.
  const shared = {
    ref: buttonRef,
    onClick,
    onPointerDown,
    onMouseEnter: showTooltip,
    onMouseLeave: hideTooltip,
    onFocus: showTooltip,
    onBlur: hideTooltip,
    title: undefined,
    'aria-describedby': tooltipPosition ? tooltipId : undefined,
    'aria-pressed': toggle ? active : undefined,
    'data-active': active ? 'true' : undefined,
  }
  const stateClass = active ? 'bg-slate-100! text-ink!' : ''

  return (
    <>
      {wide ? (
        <Button {...shared} variant="quiet" size="sm" aria-label={accessibleLabel} className={`shrink-0 px-2.5 ${stateClass} ${className}`}>
          {children}
        </Button>
      ) : (
        <IconButton {...shared} label={accessibleLabel} size="sm" className={`${stateClass} ${className}`}>
          {children}
        </IconButton>
      )}
      {tooltipPosition && typeof document !== 'undefined' && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-slate-950 px-2.5 py-1.5 text-xs font-semibold text-white shadow-overlay"
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

function selectionInCodeBlock(state: EditorState) {
  return state.selection.$from.parent.type.name === 'codeBlock'
}

/** Inserts pasted text as one code block, keeping its indentation, as its own undo step. */
function insertPastedCodeBlock(view: EditorView, text: string) {
  const { schema } = view.state
  const codeBlockType = schema.nodes.codeBlock
  if (!codeBlockType) return false
  let tr = closeHistory(view.state.tr)
  tr = tr.replaceSelectionWith(codeBlockType.create(null, schema.text(text)))
  // Leave an empty paragraph after a trailing code block so typing can continue below it.
  if (tr.doc.lastChild?.type === codeBlockType) {
    tr = tr.insert(tr.doc.content.size, schema.nodes.paragraph.create())
    tr = tr.setSelection(TextSelection.atEnd(tr.doc))
  }
  view.dispatch(tr.scrollIntoView())
  return true
}

interface PasteNotice {
  mode: 'code' | 'text'
  text: string
  doc: ProseMirrorNode
}

export function Messages() {
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
  const composerHelpId = useId()
  const [pasteNotice, setPasteNotice] = useState<PasteNotice | null>(null)
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
  const [conversationView, setConversationView] = useState<'messages' | 'pins'>('messages')
  const [activeThreadRootId, setActiveThreadRootId] = useState<number | null>(null)
  const [isDesktop, setIsDesktop] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth >= 1024))
  const [mobilePane, setMobilePane] = useState<'list' | 'conversation' | 'thread'>(selectedTarget ? 'conversation' : 'list')
  const [editing, setEditing] = useState<ChannelMessage | null>(null)
  const [authorContext, setAuthorContext] = useState<ChannelMessage['author'] | null>(null)
  const authorContextRef = useRef(authorContext)
  useLayoutEffect(() => { authorContextRef.current = authorContext }, [authorContext])
  const [showComposerTools, setShowComposerTools] = useState(false)
  const [showConversationOptions, setShowConversationOptions] = useState(false)
  const [showInboxSearch, setShowInboxSearch] = useState(false)
  const [showInboxActions, setShowInboxActions] = useState(false)
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
  const composerFormRef = useRef<HTMLFormElement | null>(null)
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
  const composerSelectionRef = useRef<{ from: number; to: number } | null>(null)
  const activeDraftKeyRef = useRef<string | null>(null)
  const draftSaveTimerRef = useRef<number | null>(null)
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
    // Create the editor after commit so concurrent rendering cannot outlive
    // Tiptap's pre-mount destruction timer. Deep links restore drafts immediately.
    immediatelyRender: false,
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
      attributes: (state: EditorState) => {
        // Phones must not "correct" code: no autocorrect, capitalization, or spellcheck in code blocks.
        const inCode = selectionInCodeBlock(state)
        return {
          class: 'message-composer px-3 py-2.5 text-base leading-6 text-slate-800 outline-none sm:py-3 sm:text-sm',
          'aria-label': 'Write a message',
          'aria-describedby': composerHelpId,
          autocapitalize: inCode ? 'off' : 'sentences',
          autocorrect: inCode ? 'off' : 'on',
          spellcheck: inCode ? 'false' : 'true',
        }
      },
      handlePaste: (view, event) => {
        const files = Array.from(event.clipboardData?.files || [])
        if (files.length > 0) {
          addFiles(files)
          return false
        }
        const raw = event.clipboardData?.getData('text/plain') || ''
        if (!raw) return false
        const text = normalizePastedCode(raw)
        if (selectionInCodeBlock(view.state)) {
          // Inside a code block, always paste verbatim (no HTML parsing).
          view.dispatch(view.state.tr.insertText(text).scrollIntoView())
          return true
        }
        if (looksLikeCode(text) && insertPastedCodeBlock(view, text)) {
          setPasteNotice({ mode: 'code', text, doc: view.state.doc })
          return true
        }
        if (isMultiLinePaste(text)) {
          // Give the default paste its own undo step, then record the document
          // right after ProseMirror applies it (synchronously, after this handler).
          view.dispatch(closeHistory(view.state.tr))
          queueMicrotask(() => setPasteNotice({ mode: 'text', text, doc: view.state.doc }))
        }
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
    if (!editor || editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr)
  }, [editor, mentionPatterns])

  useEffect(() => {
    if (!editor || editor.isDestroyed || !user || !selectedTarget || typeof window === 'undefined') return

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
      if (res.data?.channel) setChannels((prev) => prev.map((channel) => channel.id === target.id ? summaryFreshness.reconcile('channel', channel, res.data!.channel, started) : channel))
      summaryFreshness.completeRequest(started)
    } else {
      const res = await api.markDirectConversationRead(target.id, messageId)
      if (res.error && readCursorRef.current.get(key) === message) { if (previous) readCursorRef.current.set(key, previous); else readCursorRef.current.delete(key) }
      if (res.data?.direct_conversation) setDirectConversations((prev) => prev.map((conversation) => conversation.id === target.id ? summaryFreshness.reconcile('dm', conversation, res.data!.direct_conversation, started) : conversation))
      summaryFreshness.completeRequest(started)
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

    shouldStickToBottomRef.current = !isHistoricalWindow(optimisticMessage.parent_message_id)
    messageArrivalsRef.current = recordMessageArrival(messageArrivalsRef.current, targetKey(selectedTarget), tempId)
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
          const queued = queueHistoricalSend(message)
          setMessages((prev) => sortChronologicalMessages([...prev.filter((item) => item.id !== tempId && item.id !== message.id && item.client_message_id !== clientMessageId), ...(queued ? [] : [message])]))
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
  const showPageIntro = isDesktop && !selectedTarget
  const showConversationHeaderPushMessage = Boolean(pushMessage) && Boolean(selectedTarget)
  const displayedMessages = conversationView === 'pins' && !activeThreadRoot ? selectedPinnedMessages : conversationMessages
  const selectedConversationKey = selectedTarget ? targetKey(selectedTarget) : null
  const forgetEnteredMessage = (messageId: number) => {
    messageArrivalsRef.current = forgetMessageArrival(messageArrivalsRef.current, messageId)
  }
  const composerCharacterCount = messageCharacterCount(normalizeMessageMarkdown(body))
  const composerOverLimit = composerCharacterCount > MESSAGE_BODY_LIMIT
  const renderComposer = (placement: 'main' | 'thread') => {
    const inThreadPanel = placement === 'thread'

    return (
      <form
        ref={composerFormRef}
        onSubmit={handleSend}
        className={`${inThreadPanel ? 'shrink-0 border-t border-slate-200 bg-white p-3' : 'shrink-0 border-t border-slate-200 bg-white px-2.5 pb-[calc(var(--composer-safe-bottom,env(safe-area-inset-bottom,0px))+0.625rem)] pt-2.5 sm:px-4 sm:pb-[calc(var(--composer-safe-bottom,env(safe-area-inset-bottom,0px))+0.75rem)] sm:pt-3'}`}
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
          <div className="mb-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
            {error}
          </div>
        )}
        {activeThreadRoot && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="min-w-0 truncate">
              {inThreadPanel ? 'Replying in thread' : `Replying in thread to ${activeThreadRoot.author.full_name}: ${preview(activeThreadRoot.body)}`}
            </span>
            <IconButton label="Close thread reply" size="sm" onClick={() => setActiveThreadRootId(null)} className="-my-1.5 -mr-2">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((attachment) => (
              <div key={`${attachment.filename}-${attachment.byte_size}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <File className="h-4 w-4 shrink-0" />
                <span className="truncate">{attachment.filename}</span>
                <span className="shrink-0 tabular-nums">{attachment.progress > 0 ? `${attachment.progress}%` : formatFileSize(attachment.byte_size)}</span>
                <IconButton
                  label={`Remove ${attachment.filename}`}
                  size="sm"
                  onClick={() => setPendingAttachments((prev) => prev.filter((item) => item.file !== attachment.file))}
                  className="-my-2 -mr-2"
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        <div
          className="relative min-w-0 overflow-visible rounded-xl border border-line-strong bg-surface-raised shadow-raised transition-[border-color,box-shadow] duration-200 focus-within:border-focus focus-within:ring-2 focus-within:ring-focus/25 sm:rounded-2xl"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          <div className={`messages-toolbar-scroll ${showComposerTools ? 'flex' : 'hidden sm:flex'} items-center gap-1 overflow-x-auto border-b border-slate-100 px-1.5 py-1 text-slate-500 sm:gap-1.5 sm:px-2 sm:py-1.5`} role="toolbar" aria-label="Message formatting">
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
            <ComposerToolbarButton label="Mention" shortcut="@" wide onPointerDown={(event) => event.preventDefault()} onClick={() => runToolbarCommand(() => insertIntoComposer('@'))}>
              @ mention
            </ComposerToolbarButton>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
          </div>
          {/* Phones: Send sits beside the editor so the composer stays short above the keyboard. */}
          <div className="flex items-end gap-1.5 p-1.5 sm:block sm:p-2" onKeyDownCapture={handleComposerKeyDown}>
            <IconButton label="Composer options" aria-expanded={showComposerTools} onClick={() => setShowComposerTools(!showComposerTools)} className="shrink-0 sm:hidden"><Plus className="h-5 w-5" /></IconButton>
            <div className="min-w-0 flex-1">
            <div className="min-h-0 min-w-0 rounded-lg bg-slate-50/70 sm:rounded-xl">
              <EditorContent editor={editor} />
            </div>
            {pasteNotice && editor && editor.state.doc.eq(pasteNotice.doc) && (
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-raised px-2.5 py-1.5 text-xs text-ink-secondary" role="status">
                <span>{pasteNotice.mode === 'code' ? 'Pasted as code so the indentation stays.' : 'Pasted as text.'}</span>
                <span className="flex items-center gap-1">
                  <TextButton
                    className="px-2 text-xs sm:min-h-9"
                    onClick={() => {
                      const notice = pasteNotice
                      setPasteNotice(null)
                      if (!editor || !editor.state.doc.eq(notice.doc)) return
                      // Only replace the paste if undo actually removed it; otherwise we'd duplicate it.
                      if (!editor.commands.undo()) return
                      if (notice.mode === 'code') {
                        editor.chain().focus().insertContent(notice.text.split('\n').map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))).run()
                      } else {
                        insertPastedCodeBlock(editor.view, notice.text)
                        editor.commands.focus()
                      }
                      // Offer the opposite choice so the learner can switch back.
                      setPasteNotice({ mode: notice.mode === 'code' ? 'text' : 'code', text: notice.text, doc: editor.state.doc })
                    }}
                  >
                    {pasteNotice.mode === 'code' ? 'Paste as text instead' : 'Paste as code instead'}
                  </TextButton>
                  <Button variant="quiet" size="sm" onClick={() => setPasteNotice(null)} className="sm:min-h-9" aria-label="Dismiss paste options">OK</Button>
                </span>
              </div>
            )}
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={sending || composerOverLimit || (!body.trim() && pendingAttachments.length === 0)}
              className="h-11 w-11 shrink-0 px-0 sm:hidden"
              aria-label={sending ? 'Sending message' : 'Send message'}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <div className={`${composerOverLimit || composerCharacterCount >= 4_500 ? 'flex' : 'hidden sm:flex'} items-center justify-between gap-3 border-t border-line px-2.5 py-1.5 sm:px-3 sm:py-2.5`}>
            <div id={composerHelpId} className={`min-w-0 text-xs tabular-nums ${composerOverLimit ? 'font-semibold text-danger-700' : 'text-ink-muted'}`} aria-live="polite">
              {composerOverLimit || composerCharacterCount >= 4_500
                ? `${composerCharacterCount.toLocaleString()} / ${MESSAGE_BODY_LIMIT.toLocaleString()} characters`
                : <span className="hidden sm:inline">Press ⌘/Ctrl + Enter to send</span>}
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={sending || composerOverLimit || (!body.trim() && pendingAttachments.length === 0)}
              className="hidden shrink-0 sm:inline-flex sm:h-9 sm:min-h-9 sm:px-4"
              aria-label={sending ? 'Sending message' : 'Send message'}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
              Send
            </Button>
          </div>
          {mentionSuggestions.length > 0 && (
            <div className={`absolute bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-line bg-surface-raised shadow-overlay ${inThreadPanel ? 'left-2 right-2' : 'left-3 w-72'}`}>
              <div className="border-b border-slate-100 px-3 py-2 text-xs font-semibold text-ink-muted">Mention someone</div>
              {mentionSuggestions.map((mention, index) => (
                <RowButton
                  key={mention.id}
                  selected={index === activeMentionIndex}
                  onClick={() => selectMention(mention)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-sm"
                >
                  {mention.kind === 'channel' ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-info-200 bg-info-50 text-info-800"><Users className="h-4 w-4" aria-hidden="true" /></span>
                  ) : (
                    <Avatar name={mention.label.replace(/^@/, '')} size="sm" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-semibold text-ink">{mention.label}</span>
                    <span className="block truncate text-xs text-ink-muted">{mention.subtitle}</span>
                  </span>
                </RowButton>
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
              {realtimeStatus === 'connected' && <span className="ml-2 font-medium text-success-700">Live</span>}
              {realtimeStatus === 'error' && <span className="ml-2 font-medium text-warning-800">Reconnecting with refresh fallback</span>}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!selectedTarget && (
              <Button variant="secondary" onClick={handleTogglePush}>
                <MonitorSmartphone className="h-4 w-4" />
                {pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts'}
              </Button>
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

      <div className={`${isDesktop ? 'grid overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-raised' : 'flex min-w-0 overflow-hidden border-y border-slate-200 bg-white'} min-h-0 flex-1 ${isDesktop ? (sidebarCollapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[328px_minmax(0,1fr)]') : ''}`}>
        {showListPane && !sidebarCollapsed && (
        <aside className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 ${isDesktop ? 'border-b border-slate-200 lg:border-b-0 lg:border-r' : ''}`}>
          <div className="shrink-0 border-b border-slate-200 bg-white p-2.5 sm:p-3">
            {!isDesktop && <div className="flex min-h-11 min-w-0 items-center gap-1" data-testid="compact-inbox-header">
              <h1 className="shrink-0 text-base font-bold text-ink">Messages</h1>
              <button type="button" aria-label={`Switch workspace: ${selectedWorkspace?.name || 'Choose workspace'}`} aria-haspopup="dialog" onClick={() => setShowWorkspaceSwitcher(true)} className="ml-1 flex min-h-11 min-w-0 flex-1 items-center justify-end gap-1 rounded-xl px-2 text-xs font-semibold text-ink-secondary hover:bg-surface-sunken">
                <span className="truncate">{selectedWorkspace?.name || 'Workspaces'}</span><CountBadge count={totalWorkspaceUnreadCount} label="unread" /><ChevronDown className="h-3.5 w-3.5 shrink-0" />
              </button>
              <IconButton label={showInboxSearch ? 'Close message search' : 'Search messages'} aria-expanded={showInboxSearch} onClick={() => { setShowInboxSearch(!showInboxSearch); setSearchQuery(''); setSearchResults([]) }}><Search className="h-5 w-5" /></IconButton>
              <IconButton label="Inbox options" onClick={() => setShowInboxActions(true)}><MoreHorizontal className="h-5 w-5" /></IconButton>
            </div>}
            {isDesktop && <>
            <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2 sm:mb-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">{selectedWorkspace?.name || 'Workspaces'}</h2>
                <p className="text-xs text-slate-500">{isDesktop ? 'Workspace' : 'Choose a workspace, channel, or direct message'}</p>
              </div>
              <div className="flex items-center gap-1">
                {isAdmin && (
                  <IconButton
                    label="Create workspace"
                    onClick={() => {
                      setShowWorkspaceForm(true)
                      setWorkspaceError('')
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </IconButton>
                )}
                <IconButton label="Refresh messages" onClick={loadLists}>
                  <RefreshCw className="h-4 w-4" />
                </IconButton>
                {isDesktop && (
                  <IconButton label="Collapse conversation list" onClick={() => setSidebarCollapsed(true)}>
                    <PanelLeftClose className="h-4 w-4" />
                  </IconButton>
                )}
              </div>
            </div>
            {workspaces.length > 1 && (
              <RowButton
                onClick={() => setShowWorkspaceSwitcher(true)}
                aria-haspopup="dialog"
                className="group flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2 shadow-raised hover:border-line-strong sm:py-2.5"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-semibold text-slate-700">
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
                  <CountBadge count={totalWorkspaceUnreadCount} label="unread" />
                  <ChevronDown className="h-4 w-4 text-ink-muted transition-colors group-hover:text-ink" aria-hidden="true" />
                </span>
              </RowButton>
            )}
            {selectedWorkspace && (
              <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:mt-3 sm:py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{selectedWorkspace.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedWorkspace.workspace_type === 'community' ? 'Community workspace' : 'Cohort workspace'}
                      {' · '}
                      <span className="tabular-nums">{selectedWorkspace.member_count}</span> {selectedWorkspace.member_count === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                  {isAdmin && workspaceDetail?.can_manage && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setShowWorkspaceMembers(true)
                        setWorkspaceError('')
                      }}
                      className="shrink-0"
                    >
                      {showWorkspaceMembers ? 'Hide members' : 'Manage'}
                    </Button>
                  )}
                </div>
                {selectedWorkspace.description && (
                  <p className="mt-2 line-clamp-2 text-xs text-slate-500">{selectedWorkspace.description}</p>
                )}
              </div>
            )}
            {unreadOtherWorkspaceCards.length > 0 && (
              <div className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-ink-secondary">Unread elsewhere</p>
                  <Button variant="quiet" size="sm" onClick={() => setShowWorkspaceSwitcher(true)} className="-my-2 -mr-2">
                    View all
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unreadOtherWorkspaceCards.slice(0, 3).map(({ workspace, unreadCount }) => (
                    <Button
                      key={workspace.id}
                      variant="secondary"
                      size="sm"
                      onClick={() => selectWorkspace(workspace.id)}
                      className="max-w-full gap-1.5 rounded-full! px-3 text-xs"
                    >
                      <span className="truncate">{workspace.name}</span>
                      <CountBadge count={unreadCount} label="unread" />
                    </Button>
                  ))}
                </div>
              </div>
            )}
            </>}
            {(isDesktop || showInboxSearch) && <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-muted" aria-hidden="true" />
              <input
                autoFocus={!isDesktop}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search messages"
                aria-label="Search messages"
                className="app-control w-full pl-9 text-base sm:text-sm"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-surface-raised p-2 shadow-overlay">
                  {searchResults.map((result) => (
                    <RowButton
                      key={result.id}
                      onClick={() => {
                        selectTarget(
                          result.channel_id ? { type: 'channel', id: result.channel_id } : { type: 'dm', id: result.direct_conversation_id! },
                          { aroundMessageId: result.id, highlightedMessageId: result.id },
                        )
                        setSearchQuery('')
                        setSearchResults([])
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-sm"
                    >
                      <span className="font-semibold text-ink">{result.author.full_name}</span>
                      <span className="ml-2 text-xs tabular-nums text-ink-muted">{formatTime(result.created_at)}</span>
                      <span className="mt-1 block truncate text-xs text-ink-secondary">{preview(result.body)}</span>
                    </RowButton>
                  ))}
                </div>
              )}
            </div>}
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1.5 sm:p-2">
            <div className="mb-2 flex items-center justify-between px-2 pt-2">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <span>Recent</span>
                <span className="tabular-nums">{recent.length}</span>
              </div>
              <IconButton label="Start direct message" onClick={() => setShowDmForm(true)}>
                <UserPlus className="h-4 w-4" />
              </IconButton>
            </div>
            {recent.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">No conversations yet.</div>
            ) : recent.map(({ type, summary }) => (
              <ConversationButton
                key={`${type}:${summary.id}`}
                active={selectedTarget?.type === type && selectedTarget.id === summary.id}
                icon={type === 'channel'
                  ? summary.visibility === 'staff_only' ? <Lock className="h-4 w-4 shrink-0" /> : <Hash className="h-4 w-4 shrink-0" />
                  : <MessageCircle className="h-4 w-4 shrink-0" />}
                title={type === 'channel' ? summary.name : summary.title}
                subtitle={summary.latest_message ? `${summary.latest_message.author_name}: ${preview(summary.latest_message.body)}` : type === 'channel' ? summary.description || 'No messages yet' : 'No messages yet'}
                latestAt={summary.latest_message?.created_at}
                unread={summary.unread_count}
                muted={summary.muted}
                onClick={() => selectTarget({ type, id: summary.id })}
              />
            ))}

            <div className="mb-2 mt-5 flex items-center justify-between px-2">
              <Button
                variant="quiet"
                size="sm"
                onClick={() => setChannelsCollapsed((current) => !current)}
                className="-ml-2 min-w-0 gap-1.5 px-2 text-xs text-ink-muted"
                aria-expanded={!channelsCollapsed}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${channelsCollapsed ? '-rotate-90' : ''}`} aria-hidden="true" />
                <span>Browse channels</span>
                <CountBadge count={channelsUnreadCount} label="unread" />
              </Button>
              {canManageChannels && (
                <IconButton label="Create channel" onClick={() => { setChannelForm((current) => ({ ...current, workspace_id: String(selectedWorkspaceId) })); setShowChannelForm(true); setChannelError('') }}>
                  <Plus className="h-4 w-4" />
                </IconButton>
              )}
            </div>
            {!channelsCollapsed && (
              <div className="px-2 pb-3">
                {visibleChannels.length === 0 ? <p className="px-1 py-2 text-xs text-slate-500">No channels yet.</p> : visibleChannels.map((channel) => (
                  <RowButton
                    key={channel.id}
                    onClick={() => selectTarget({ type: 'channel', id: channel.id })}
                    selected={selectedTarget?.type === 'channel' && selectedTarget.id === channel.id}
                    aria-current={selectedTarget?.type === 'channel' && selectedTarget.id === channel.id ? 'true' : undefined}
                    className={`flex w-full items-center gap-2 rounded-xl px-2 text-sm ${selectedTarget?.type === 'channel' && selectedTarget.id === channel.id ? 'font-semibold' : channel.unread_count > 0 ? 'font-semibold text-ink' : 'text-ink-secondary'}`}
                  >
                    {channel.visibility === 'staff_only' ? <Lock className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Hash className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    {channel.unread_count > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-ruby-600" aria-hidden="true" />}
                    {channel.unread_count > 0 && <span className="sr-only">, unread</span>}
                  </RowButton>
                ))}
              </div>
            )}
          </div>
        </aside>
        )}
        {showCollapsedRail && (
          <aside className="hidden border-r border-slate-200 bg-slate-50 p-2 lg:block">
            <Button variant="quiet" fullWidth onClick={() => setSidebarCollapsed(false)} aria-label="Show conversation list" title="Show conversation list" className="mb-3">
              <PanelLeftOpen className="h-5 w-5" />
            </Button>
            <div className="space-y-2">
              {recent.map(({ type, summary }) => {
                const title = type === 'channel' ? summary.name : summary.title
                return (
                  <RowButton
                    key={`${type}:${summary.id}`}
                    onClick={() => selectTarget({ type, id: summary.id })}
                    title={title}
                    aria-label={summary.unread_count > 0 ? `${title}, unread` : title}
                    selected={selectedTarget?.type === type && selectedTarget.id === summary.id}
                    aria-current={selectedTarget?.type === type && selectedTarget.id === summary.id ? 'true' : undefined}
                    className={`relative flex h-14 w-full flex-col items-center justify-center rounded-xl text-xs font-semibold ${selectedTarget?.type === type && selectedTarget.id === summary.id ? '' : 'text-ink-muted hover:text-ink'}`}
                  >
                    {type === 'channel'
                      ? summary.visibility === 'staff_only' ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />
                      : <MessageCircle className="h-4 w-4" />}
                    <span className="mt-0.5 max-w-12 truncate">{type === 'channel' ? channelInitials(title) : initials(title)}</span>
                    {summary.unread_count > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-ruby-600" aria-hidden="true" />}
                  </RowButton>
                )
              })}
            </div>
          </aside>
        )}

        {showConversationPane && (
        <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
          {selectedTarget && selected ? (
            <>
              <header className="shrink-0 border-b border-line bg-surface-raised px-3 py-1.5 sm:px-4 sm:py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {isDesktop && sidebarCollapsed && (
                      <IconButton label="Show conversation list" size="sm" onClick={() => setSidebarCollapsed(false)}>
                        <PanelLeftOpen className="h-4 w-4" />
                      </IconButton>
                    )}
                    {!isDesktop && (
                      <IconButton label="Back to conversations" className="-ml-1.5" onClick={() => navigate('/messages', { replace: true })}>
                        <ChevronLeft className="h-5 w-5" />
                      </IconButton>
                    )}
                    {selectedTarget.type === 'channel'
                      ? selectedChannel?.visibility === 'staff_only'
                        ? <Lock className="h-5 w-5 shrink-0 text-slate-500" />
                        : <Hash className="h-5 w-5 shrink-0 text-slate-500" />
                      : <MessageCircle className="h-5 w-5 shrink-0 text-slate-500" />}
                    <div className="min-w-0">
                      <h2 className="truncate font-semibold text-slate-900">{selectedLabel}</h2>
                      <p className="hide-with-keyboard text-xs text-ink-muted">{selected.workspace_name}{isNavigationPending && ' · updating'}</p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 sm:justify-end sm:gap-2">
                    {!isDesktop && <IconButton label="Conversation options" onClick={() => setShowConversationOptions(true)}><MoreHorizontal className="h-5 w-5" /></IconButton>}
                    {isDesktop && <>
                    {selectedDmStudent && (
                      <ConversationHeaderAction
                        onClick={() => setAuthorContext(selectedDmStudent)}
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
                        title={selectedMuted ? 'Unmute this conversation' : 'Mute this conversation'}
                        fullLabel={selectedMuted ? 'Unmute conversation' : 'Mute conversation'}
                        ariaLabel={selectedMuted ? 'Unmute conversation' : 'Mute conversation'}
                      />
                    )}
                    <ConversationHeaderAction
                      onClick={handleTogglePush}
                      icon={<MonitorSmartphone className="h-4 w-4" />}
                      shortLabel={pushEnabled ? 'Notify off' : 'Notify on'}
                      title={pushEnabled ? 'Browser alerts are on for this device. Turn them off.' : 'Get browser alerts on this device'}
                      fullLabel={pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts'}
                      ariaLabel={pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts'}
                    />
                    </>}
                    {selectedTarget.type === 'channel' && selectedChannel?.visibility === 'staff_only' && (
                      <Badge icon={<Lock className="h-3 w-3" aria-hidden="true" />}>Staff only</Badge>
                    )}
                  </div>
                </div>
                {selectedTarget.type === 'channel' && selectedChannel?.description && <p className="hide-with-keyboard mt-2 hidden text-sm text-ink-muted lg:block">{selectedChannel.description}</p>}
                {sourceRecord && sourceRecordPath && <div className="hide-with-keyboard mt-2.5"><Link to={sourceRecordPath} className="pressable inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-info-200 bg-info-50 px-3 text-xs font-semibold text-info-800 hover:bg-info-100 sm:min-h-9"><BookOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate">From {sourceRecord.type === 'submission' ? 'submission' : 'help request'}: {sourceRecord.label}</span></Link></div>}
                {showConversationHeaderPushMessage && (
                  <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                    {pushMessage}
                  </div>
                )}
                {isDesktop && !activeThreadRoot && (
                  <div className="hide-with-keyboard -mb-2.5 mt-1.5 flex min-w-0 items-center gap-1 overflow-x-auto sm:-mb-4 sm:mt-2">
                    <TabButton selected={conversationView === 'messages'} onClick={() => setConversationView('messages')}>
                      <MessageCircle className="h-4 w-4" aria-hidden="true" />
                      Conversation
                    </TabButton>
                    <TabButton selected={conversationView === 'pins'} count={selectedPinnedMessages.length} onClick={() => setConversationView('pins')}>
                      <Pin className="h-4 w-4" aria-hidden="true" />
                      Pinned
                    </TabButton>
                  </div>
                )}
              </header>

              <div className={`relative min-w-0 min-h-0 flex-1 overflow-hidden ${showThreadPanel ? 'grid lg:grid-cols-[minmax(0,1fr)_380px]' : 'flex'}`}>
                <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                  <div
                    ref={messageScrollRef}
                    onWheelCapture={beginReadingScroll}
                    onTouchMoveCapture={beginReadingScroll}
                    onPointerDownCapture={beginReadingScroll}
                    onKeyDownCapture={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) beginReadingScroll() }}
                    onScroll={handleConversationScroll}
                    className={`min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2 transition-opacity duration-200 sm:px-5 sm:py-5 ${loadingTarget || isNavigationPending ? 'opacity-60' : 'opacity-100'}`}
                  >
                  {activeThreadRoot && !showThreadPanel && (
                    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-ink-muted">Thread</p>
                          <p className="mt-1 text-sm tabular-nums text-slate-600">
                            {activeThreadRoot.reply_count ?? activeThreadMessages.length - 1} {(activeThreadRoot.reply_count ?? activeThreadMessages.length - 1) === 1 ? 'reply' : 'replies'} under this message
                          </p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            setActiveThreadRootId(null)
                            if (!isDesktop) setMobilePane('conversation')
                          }}
                          className="shrink-0"
                        >
                          <ChevronLeft className="h-4 w-4" />
                          {selectedTarget.type === 'channel' ? 'Back to channel' : 'Back to conversation'}
                        </Button>
                      </div>
                    </div>
                  )}
                  {activeThreadRoot && !isDesktop && renderThreadPaging('older')}
                  {!activeThreadRoot && conversationView === 'pins' && (
                    <div className="mb-4 flex items-center gap-2 rounded-2xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary"><Pin className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                      Pinned messages stay easy to find here for this workspace conversation.
                    </div>
                  )}
                  {!activeThreadRoot && conversationView === 'messages' && messageWindowMeta?.has_older && (
                    <div className="flex justify-center pb-3">
                      <Button
                        variant="secondary"
                        onClick={() => void loadOlderMessages()}
                        disabled={loadingOlder}
                      >
                        <RefreshCw className={`h-4 w-4 ${loadingOlder ? 'animate-spin' : ''}`} />
                        {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
                      </Button>
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
                        {!activeThreadRoot && conversationView === 'messages' && unreadBoundaryId === message.id && (
                          <div data-unread-divider className="my-4 flex items-center gap-3 px-2" role="separator" aria-label="Unread messages">
                            <div className="h-px flex-1 bg-ruby-200" />
                            <span className="text-xs font-semibold text-ruby-700">New messages</span>
                            <div className="h-px flex-1 bg-ruby-200" />
                          </div>
                        )}
                        {showDayDivider && (
                          <div className="relative my-5 flex items-center justify-center">
                            <div className="absolute inset-x-0 top-1/2 border-t border-slate-200" />
                            <span className="relative rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold tabular-nums text-ink-muted">
                              {formatDayDivider(message.created_at)}
                            </span>
                          </div>
                        )}
                        <MessageRow
                          message={message}
                          readReceipts={conversationView === 'pins' && !activeThreadRoot ? undefined : activeThreadRoot ? threadReadReceipts.get(message.id) : rootReadReceipts.get(message.id)}
                          compact={compact}
                          highlighted={highlightedMessageId === message.id}
                          entering={messageShouldAnimateEntry(messageArrivalsRef.current, selectedConversationKey, message.id)}
                          onEntered={() => forgetEnteredMessage(message.id)}
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
                          onOpenAuthor={() => setAuthorContext(message.author)}
                          onOpenActions={() => setMobileActionsMessageId(message.id)}
                          onPin={() => togglePin(message)}
                          canPin={isStaff}
                          inThreadView={Boolean(activeThreadRoot)}
                          replyCount={!activeThreadRoot && !message.parent_message_id ? replyCount : 0}
                          onReply={() => replyToMessage(message)}
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
                  {!activeThreadRoot && conversationView === 'messages' && messageWindowMeta?.has_newer && (
                    <div className="flex justify-center py-3">
                      <Button variant="secondary" onClick={() => void loadNewerMessages()} disabled={loadingNewer}>
                        <RefreshCw className={`h-4 w-4 ${loadingNewer ? 'animate-spin' : ''}`} />
                        {loadingNewer ? 'Loading newer messages…' : 'Load newer messages'}
                      </Button>
                    </div>
                  )}
                  {activeThreadRoot && !isDesktop && renderThreadPaging('newer')}
                  </div>
                  {activeThreadRoot && !isDesktop && renderThreadLatest()}
                  {showScrollToLatest && conversationView === 'messages' && (
                    <div className={`flex shrink-0 justify-center py-2 ${activeThreadRoot && !isDesktop ? '' : 'absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-xl shadow-overlay'}`}>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => void scrollToLatestMessage()}
                        aria-label={hasUnreadBelow ? 'Jump to new messages' : 'Jump to latest message'}
                      >
                        <ChevronDown className="h-4 w-4" />
                        {queuedConversationCount ? `New messages (${queuedConversationCount})` : hasUnreadBelow ? 'New messages' : 'Jump to latest'}
                      </Button>
                    </div>
                  )}
                </div>
                {showThreadPanel && activeThreadRoot && (
                  <aside className="hidden min-h-0 border-l border-slate-200 bg-slate-50/70 lg:flex lg:flex-col">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Thread</p>
                        <p className="mt-0.5 truncate text-xs tabular-nums text-slate-500">
                          {activeThreadRoot.reply_count ?? activeThreadMessages.length - 1} {(activeThreadRoot.reply_count ?? activeThreadMessages.length - 1) === 1 ? 'reply' : 'replies'} in {selectedLabel}
                        </p>
                      </div>
                      <IconButton label="Close thread" size="sm" onClick={() => setActiveThreadRootId(null)} className="-my-1 -mr-2">
                        <X className="h-4 w-4" />
                      </IconButton>
                    </div>
                    <div ref={threadScrollRef} onScroll={handleThreadScroll} onWheelCapture={beginReadingScroll} onTouchMoveCapture={beginReadingScroll} onPointerDownCapture={beginReadingScroll} onKeyDownCapture={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) beginReadingScroll() }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
                      {renderThreadPaging('older')}
                      {activeThreadMessages.map((message, index) => {
                        const previousMessage = activeThreadMessages[index - 1]
                        const compact = shouldCompactMessage(message, previousMessage)

                        return (
                          <MessageRow
                            key={message.id}
                            message={message}
                            readReceipts={threadReadReceipts.get(message.id)}
                            compact={compact}
                            highlighted={highlightedMessageId === message.id}
                            entering={messageShouldAnimateEntry(messageArrivalsRef.current, selectedConversationKey, message.id)}
                            onEntered={() => forgetEnteredMessage(message.id)}
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
                            onOpenAuthor={() => setAuthorContext(message.author)}
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
                      {renderThreadPaging('newer')}
                      {renderThreadLatest()}
                    </div>
                    {renderComposer('thread')}
                  </aside>
                )}
                {(loadingTarget || isNavigationPending) && (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-white/20 px-4 py-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-ink-secondary shadow-raised">
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
                    <TabButton
                      key={reaction.emoji}
                      asTab
                      selected={active}
                      aria-label={`${display.label}, ${reaction.count}`}
                      onClick={() => setReactionDetails({ messageId: reactionDetailsMessage.id, emoji: reaction.emoji })}
                      className="tabular-nums"
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {reaction.count}
                    </TabButton>
                  )
                })}
              </div>
              <div className="flex min-h-12 items-center gap-2 border-b border-slate-200">
                <SelectedIcon className="h-4 w-4 text-ink-secondary" />
                <p className="flex-1 text-sm font-semibold text-slate-900">{selectedDisplay.label}</p>
                <span className="text-xs font-semibold tabular-nums text-slate-500">{selectedReaction.count}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {selectedReaction.users.map((person) => (
                  <div key={person.id} className="flex min-h-14 items-center gap-3 py-2">
                    <Avatar name={person.full_name} src={person.avatar_url} />
                    <span className="min-w-0 truncate text-sm font-medium text-slate-800">{person.full_name}</span>
                  </div>
                ))}
              </div>
              <Button
                variant={selectedReaction.reacted ? 'secondary' : 'primary'}
                size="lg"
                fullWidth
                onClick={() => void toggleReaction(reactionDetailsMessage, selectedReaction.emoji)}
                className="mt-5"
              >
                <SelectedIcon className="h-4 w-4" />
                {selectedReaction.reacted ? `Remove your ${selectedDisplay.label.toLowerCase()}` : `React with ${selectedDisplay.label.toLowerCase()}`}
              </Button>
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
                className={`flex items-stretch gap-2 rounded-2xl border ${active ? 'border-line-strong' : unreadCount > 0 ? 'border-line-strong' : 'border-line'} bg-surface-raised`}
              >
                <RowButton
                  selected={active}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    selectWorkspace(workspace.id)
                    setShowWorkspaceSwitcher(false)
                  }}
                  className="group flex flex-1 items-center gap-4 rounded-2xl px-4 py-4"
                >
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${active ? 'bg-slate-300 text-ink' : 'bg-slate-200 text-ink-secondary'}`} aria-hidden="true">
                    {channelInitials(workspace.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-ink">{workspace.name}</span>
                      <CountBadge count={unreadCount} label="unread" />
                      {active && <Badge icon={<Check className="h-3 w-3" aria-hidden="true" />}>Current</Badge>}
                      <Badge tone={workspace.workspace_type === 'community' ? 'neutral' : 'info'}>{workspace.workspace_type === 'community' ? 'Community' : 'Cohort'}</Badge>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-muted">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        {workspace.member_count} {workspace.member_count === 1 ? 'member' : 'members'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Hash className="h-3.5 w-3.5" aria-hidden="true" />
                        {channelCount} {channelCount === 1 ? 'channel' : 'channels'}
                        {unreadChannelCount > 0 && <span className="font-semibold text-ink">· {unreadChannelCount} unread</span>}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        {dmCount} DM {dmCount === 1 ? 'conversation' : 'conversations'}
                        {unreadDmCount > 0 && <span className="font-semibold text-ink">· {unreadDmCount} unread</span>}
                      </span>
                    </span>
                    {workspace.description && (
                      <span className="mt-2 block line-clamp-2 text-xs leading-5 text-ink-muted">{workspace.description}</span>
                    )}
                  </span>
                </RowButton>
                {unreadCount > 0 && (
                  <div className="flex shrink-0 items-center pr-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        markWorkspaceRead(workspace.id).catch(() => {
                          toast.error('Failed to mark workspace as read')
                        })
                      }}
                    >
                      <CheckCheck className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">Mark read</span>
                      <span className="sr-only">{` ${workspace.name}`}</span>
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Modal>

      {isAdmin && (
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
              <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
                {workspaceError}
              </div>
            )}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Workspace name</label>
              <input
                value={workspaceForm.name}
                onChange={(event) => setWorkspaceForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Workspace name"
                className="app-control w-full"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Description</label>
              <textarea
                value={workspaceForm.description}
                onChange={(event) => setWorkspaceForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="What is this workspace for?"
                rows={3}
                className="app-control w-full resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowWorkspaceForm(false)
                  setWorkspaceError('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={creatingWorkspace || !workspaceForm.name.trim()}
              >
                {creatingWorkspace ? 'Creating…' : 'Create workspace'}
              </Button>
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
              <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
                {workspaceError}
              </div>
            )}
            {isAdmin && workspaceDetail.can_manage && workspaceDetail.workspace_type === 'community' && (
              <form onSubmit={handleAddWorkspaceMember} className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={memberToAddId}
                  onChange={(event) => setMemberToAddId(event.target.value)}
                  className="app-control min-w-0 flex-1"
                >
                  <option value="">Add a member</option>
                  {memberCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.full_name}</option>
                  ))}
                </select>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!memberToAddId}
                >
                  Add member
                </Button>
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
                  {isAdmin && workspaceDetail.can_manage && workspaceDetail.workspace_type === 'community' && member.membership_role !== 'manager' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      onClick={() => handleRemoveWorkspaceMember(member.id)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {canManageChannels && (
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
              <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
                {channelError}
              </div>
            )}
            <select
              value={channelForm.workspace_id}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, workspace_id: event.target.value }))}
              className="app-control w-full"
            >
              {workspaces.filter((workspace) => isAdmin || workspace.workspace_type === 'cohort').map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <input
              value={channelForm.name}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Channel name"
              className="app-control w-full"
            />
            <textarea
              value={channelForm.description}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="What is this channel for?"
              rows={3}
              className="app-control w-full resize-none"
            />
            <select
              value={channelForm.visibility}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, visibility: event.target.value }))}
              className="app-control w-full"
            >
              <option value="cohort">Students and staff</option>
              <option value="staff_only">Staff only</option>
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowChannelForm(false)
                  setChannelError('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={creatingChannel || !channelForm.workspace_id || !channelForm.name.trim()}
              >
                {creatingChannel ? 'Creating…' : 'Create channel'}
              </Button>
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
            <Button
              variant="secondary"
              onClick={() => setMessagePendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!messagePendingDelete) return
                void deleteMessage(messagePendingDelete)
                setMessagePendingDelete(null)
              }}
            >
              Delete message
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
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
        {mobileActionsMessage && (() => {
          const actionMessage = mobileActionsMessage
          const close = () => setMobileActionsMessageId(null)
          const row = 'justify-start text-left'
          return (
            <div className="space-y-2">
              <Button variant="secondary" fullWidth onClick={() => { close(); setAuthorContext(actionMessage.author) }}><UserRound className="h-4 w-4" />{isStaff && actionMessage.author.role === 'student' ? 'View student' : 'View profile'}</Button>
              {!actionMessage.blocked && (
                <div role="group" aria-label="React" className="mb-3 grid grid-cols-4 gap-2">
                  {REACTIONS.map(({ value, label, Icon }) => {
                    const reacted = Boolean(actionMessage.reactions.find((reaction) => reaction.emoji === value)?.reacted)
                    return (
                      <Button
                        key={value}
                        variant="secondary"
                        size="lg"
                        aria-label={reacted ? `Remove your ${label.toLowerCase()} reaction` : `React with ${label.toLowerCase()}`}
                        aria-pressed={reacted}
                        title={label}
                        onClick={() => {
                          void toggleReaction(actionMessage, value)
                          close()
                        }}
                        className={reacted ? 'border-info-200! bg-info-50! text-info-800!' : ''}
                      >
                        <Icon className="h-5 w-5" aria-hidden="true" />
                      </Button>
                    )
                  })}
                </div>
              )}
              {!actionMessage.blocked && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className={row}
                  onClick={() => {
                    replyToMessage(actionMessage)
                    close()
                  }}
                >
                  <MessageCircle className="h-4 w-4" aria-hidden="true" />
                  {activeThreadRootId ? 'Reply in thread' : 'Reply'}
                </Button>
              )}
              {actionMessage.body && !actionMessage.blocked && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className={row}
                  onClick={() => {
                    void copyMessage(actionMessage)
                    close()
                  }}
                >
                  <Copy className="h-4 w-4" aria-hidden="true" />
                  Copy message
                </Button>
              )}
              {isStaff && (
                <Button
                  variant="secondary"
                  size="lg"
                  fullWidth
                  className={row}
                  onClick={() => {
                    void togglePin(actionMessage)
                    close()
                  }}
                >
                  <Pin className="h-4 w-4" aria-hidden="true" />
                  {actionMessage.pinned_at ? 'Unpin message' : 'Pin message'}
                </Button>
              )}
              {actionMessage.mine && (
                <>
                  <Button
                    variant="secondary"
                    size="lg"
                    fullWidth
                    className={row}
                    onClick={() => {
                      setEditing(actionMessage)
                      setEditBody(actionMessage.body)
                      close()
                    }}
                  >
                    <Edit3 className="h-4 w-4" aria-hidden="true" />
                    Edit message
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    className={row}
                    onClick={() => {
                      setMessagePendingDelete(actionMessage)
                      close()
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete message
                  </Button>
                </>
              )}
              {!actionMessage.mine && (
                <>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    className={row}
                    onClick={() => {
                      void reportMessage(actionMessage)
                      close()
                    }}
                  >
                    <Flag className="h-4 w-4" aria-hidden="true" />
                    Report message
                  </Button>
                  <Button
                    variant="danger"
                    size="lg"
                    fullWidth
                    className={row}
                    onClick={() => {
                      void reportUser(actionMessage)
                      close()
                    }}
                  >
                    <Flag className="h-4 w-4" aria-hidden="true" />
                    <span className="min-w-0 truncate">Report {actionMessage.author.full_name}</span>
                  </Button>
                  {!actionMessage.blocked && (
                    <Button
                      variant="danger"
                      size="lg"
                      fullWidth
                      className={row}
                      onClick={() => {
                        void blockMessageAuthor(actionMessage)
                        close()
                      }}
                    >
                      <UserX className="h-4 w-4" aria-hidden="true" />
                      <span className="min-w-0 truncate">Block {actionMessage.author.full_name}</span>
                    </Button>
                  )}
                </>
              )}
            </div>
          )
        })()}
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
            className="app-control w-full"
          >
            {availableUsers.map((availableUser) => (
              <option key={availableUser.id} value={availableUser.id}>
                {availableUser.full_name} - {availableUser.email} ({availableUser.role})
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setShowDmForm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!selectedWorkspaceId || !dmUserId}
            >
              Start direct message
            </Button>
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
              className="app-control mt-1 w-full"
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
              className={`app-control mt-1 w-full ${linkError ? 'border-danger-600' : ''}`}
              placeholder="https://example.com"
              aria-invalid={Boolean(linkError)}
              aria-describedby={linkError ? 'message-link-error' : undefined}
            />
            {linkError && (
              <p id="message-link-error" className="mt-1.5 text-xs font-medium text-danger-700">
                {linkError}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={closeLinkForm}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!linkHref.trim()}
            >
              Save link
            </Button>
          </div>
        </form>
      </Modal>

      {authorContext && <MessageAuthorContext author={authorContext} staff={isStaff} workspaceReturnContext={conversationReturnContext} cohortId={selected?.cohort_id || undefined} source={authorContext.id === selectedDmStudent?.id ? sourceRecord || undefined : undefined} onClose={() => setAuthorContext(null)} />}
      <Modal open={showConversationOptions} onClose={() => setShowConversationOptions(false)} title="Conversation options" size="md">
        <div className="space-y-2">
          {selectedChannel?.description && <p className="text-sm text-ink-secondary [overflow-wrap:anywhere]">{selectedChannel.description}</p>}
          <Button fullWidth variant="secondary" onClick={() => { setActiveThreadRootId(null); if (!isDesktop) setMobilePane('conversation'); setConversationView(conversationView === 'pins' ? 'messages' : 'pins'); setShowConversationOptions(false) }}><Pin className="h-4 w-4" />{conversationView === 'pins' ? 'Back to conversation' : `Pinned messages (${selectedPinnedMessages.length})`}</Button>
          {selectedDmStudent && <Button fullWidth variant="secondary" onClick={() => { setShowConversationOptions(false); setAuthorContext(selectedDmStudent) }}><UserRound className="h-4 w-4" />View student</Button>}
          {selectedTarget && <Button fullWidth variant="secondary" onClick={() => { void toggleMute(); setShowConversationOptions(false) }}><BellOff className="h-4 w-4" />{selectedMuted ? 'Unmute conversation' : 'Mute conversation'}</Button>}
          <Button fullWidth variant="secondary" onClick={() => { void handleTogglePush(); setShowConversationOptions(false) }}><MonitorSmartphone className="h-4 w-4" />{pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts'}</Button>
        </div>
      </Modal>
      <Modal open={showInboxActions} onClose={() => setShowInboxActions(false)} title="Inbox options" size="md">
        <div className="space-y-2">
          <Button fullWidth variant="secondary" onClick={() => { setShowInboxActions(false); setShowDmForm(true) }}><UserPlus className="h-4 w-4" />New direct message</Button>
          <Button fullWidth variant="secondary" onClick={() => { setShowInboxActions(false); void loadLists() }}><RefreshCw className="h-4 w-4" />Refresh messages</Button>
          {isAdmin && <Button fullWidth variant="secondary" onClick={() => { setShowInboxActions(false); setShowWorkspaceForm(true) }}><Plus className="h-4 w-4" />Create workspace</Button>}
          {isAdmin && workspaceDetail?.can_manage && <Button fullWidth variant="secondary" onClick={() => { setShowInboxActions(false); setShowWorkspaceMembers(true) }}><Users className="h-4 w-4" />Manage workspace members</Button>}
        </div>
      </Modal>

      {lightboxAttachment?.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Image preview: ${lightboxAttachment.filename}`}
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
          <IconButton label="Close image preview" onClick={closeLightbox} className="absolute right-4 top-4 surface-inverse bg-white/10! text-white! hover:bg-white/20! active:bg-white/30!">
            <X className="h-5 w-5" />
          </IconButton>
          {lightboxAttachments.length > 1 && (
            <>
              <IconButton label="Previous image" onClick={showPreviousLightboxImage} disabled={lightboxIndex === 0} className="absolute left-4 top-1/2 h-12! w-12! -translate-y-1/2 surface-inverse bg-white/10! text-white! hover:bg-white/20! active:bg-white/30!">
                <ChevronLeft className="h-6 w-6" />
              </IconButton>
              <IconButton label="Next image" onClick={showNextLightboxImage} disabled={lightboxIndex === lightboxAttachments.length - 1} className="absolute right-4 top-1/2 h-12! w-12! -translate-y-1/2 surface-inverse bg-white/10! text-white! hover:bg-white/20! active:bg-white/30!">
                <ChevronRight className="h-6 w-6" />
              </IconButton>
            </>
          )}
          <div className="max-h-full max-w-5xl overflow-hidden rounded-2xl bg-surface-raised shadow-overlay">
            <img src={lightboxAttachment.url} alt={lightboxAttachment.filename} className="max-h-[80vh] w-full object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-sm text-slate-700">
              <div className="min-w-0">
                <div className="truncate font-medium">{lightboxAttachment.filename}</div>
                <div className="tabular-nums text-slate-500">
                  {lightboxAttachments.length > 1 && `${lightboxIndex + 1} of ${lightboxAttachments.length} · `}
                  {formatFileSize(lightboxAttachment.byte_size)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <AnchorButton
                  href={lightboxAttachment.url}
                  target="_blank"
                  rel="noreferrer"
                  size="sm"
                >
                  Open
                </AnchorButton>
                <Button variant="secondary" size="sm" onClick={downloadLightboxAttachment}>
                  <Download className="h-4 w-4" />
                  Download
                </Button>
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
  latestAt,
  unread,
  muted,
  onClick,
}: {
  active: boolean
  icon: ReactNode
  title: string
  subtitle: string
  latestAt?: string
  unread: number
  muted: boolean
  onClick: () => void
}) {
  return (
    <RowButton
      onClick={onClick}
      selected={active}
      aria-current={active ? 'true' : undefined}
      className="mb-1 block w-full overflow-hidden rounded-xl px-2.5 py-1.5 sm:rounded-2xl sm:px-3 sm:py-2"
    >
      <span className="flex min-w-0 items-center justify-between gap-2">
        <span className={`flex min-w-0 flex-1 items-center gap-2 ${unread > 0 || active ? 'text-ink' : 'text-ink-secondary'}`}>
          {icon}
          <span className="truncate text-sm font-semibold">{title}</span>
          {muted && <BellOff className="h-3.5 w-3.5 shrink-0 text-ink-muted" aria-label="Muted" />}
        </span>
        {latestAt && <time dateTime={latestAt} className={`shrink-0 text-xs tabular-nums ${unread > 0 ? 'font-semibold text-ink' : 'font-medium text-ink-muted'}`}>{formatInboxTime(latestAt)}</time>}
        <CountBadge count={unread} label="unread" />
      </span>
      <span className={`mt-1 block truncate text-xs ${unread > 0 ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{subtitle}</span>
    </RowButton>
  )
}

function FormattedMessageList({ block, mentionPatterns, depth = 0 }: { block: MessageListBlock; mentionPatterns: MentionPattern[]; depth?: number }) {
  const items = block.items.map((item, index) => (
    <li key={index} className="pl-1">
      {formatInline(item.text, mentionPatterns)}
      {item.children.map((child, childIndex) => child.type === 'paragraph'
        ? <p key={childIndex} className="whitespace-pre-wrap">{formatInline(child.text, mentionPatterns)}</p>
        : child.type === 'blockquote'
          ? <blockquote key={childIndex} className="border-l-2 border-slate-300 pl-3 text-slate-600"><p className="whitespace-pre-wrap">{formatInline(child.text, mentionPatterns)}</p></blockquote>
        : <FormattedMessageList key={childIndex} block={child} mentionPatterns={mentionPatterns} depth={depth + 1} />)}
    </li>
  ))
  const className = "ml-5 list-outside space-y-1 pr-1 marker:text-slate-400"
  const bulletStyle = depth === 0 ? 'list-disc' : depth === 1 ? 'list-[circle]' : 'list-[square]'
  return block.type === 'bulletList'
    ? <ul className={`${className} ${bulletStyle}`}>{items}</ul>
    : <ol className={`${className} list-decimal marker:font-medium`}>{items}</ol>
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
                <div className="border-b border-white/10 px-3 py-1 text-xs font-semibold text-slate-300">
                  {block.language}
                </div>
              )}
              <pre className="max-w-full overflow-x-auto px-3 py-2 text-xs leading-5 text-slate-100">
                <code>{block.code}</code>
              </pre>
            </div>
          )
        }

        if (block.type === 'bulletList' || block.type === 'orderedList') {
          return <FormattedMessageList key={key} block={block} mentionPatterns={mentionPatterns} />
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
  readReceipts,
  compact,
  highlighted,
  entering = false,
  onEntered,
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
  onOpenAuthor,
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
  readReceipts?: ReadReceipts
  compact: boolean
  highlighted: boolean
  /** True only for a message that arrived while this conversation was open. */
  entering?: boolean
  onEntered?: () => void
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
  onOpenAuthor: () => void
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
  const longPress = useMessageLongPress(onOpenActions, !editing && !message.pending && !message.failed)
  const imageAttachments = message.attachments.filter((attachment) => attachment.image && attachment.url)

  return (
    <div
      {...longPress}
      id={`message-${message.id}`}
      onAnimationEnd={entering && onEntered ? (event) => {
        if (event.target === event.currentTarget && event.animationName === 'message-row-enter') onEntered()
      } : undefined}
      className={`message-row group relative flex w-full max-w-full min-w-0 gap-1.5 rounded-xl px-1.5 py-0.5 transition-[background-color,box-shadow,opacity] duration-200 hover:bg-slate-50/90 sm:gap-3 sm:px-3 ${
        compact ? 'mt-0' : 'mt-1.5'
      } ${entering ? 'message-row-enter' : ''} ${message.pinned_at ? 'bg-surface-sunken ring-1 ring-line' : ''} ${message.pending ? 'opacity-75' : ''} ${
        highlighted ? 'message-row-highlight bg-info-50 ring-2 ring-info-200' : ''
      }`}
    >
      <div className="flex w-11 shrink-0 justify-center">
        {compact ? (
          <span className="hidden whitespace-nowrap pt-1 text-xs font-medium tabular-nums text-ink-muted opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 lg:block">
            {new Date(message.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          </span>
        ) : (
          <button type="button" aria-label={`View ${message.author.full_name}`} onClick={onOpenAuthor} className="flex min-h-11 min-w-11 items-start justify-center rounded-xl pt-1"><Avatar name={message.author.full_name} src={message.author.avatar_url} size="sm" className="sm:h-9 sm:w-9" /></button>
        )}
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        {!compact && (
          <div className={`flex flex-wrap items-center gap-2 ${inThreadView ? 'lg:pr-12' : ''}`}>
            <button type="button" onClick={onOpenAuthor} className="min-h-11 min-w-11 max-w-full rounded-lg text-left text-sm font-semibold text-ink hover:underline [overflow-wrap:anywhere]">{message.author.full_name}</button>
            <span className="text-xs tabular-nums text-ink-muted">{formatTime(message.created_at)}</span>
            {message.edited_at && <span className="text-xs text-ink-muted">Edited</span>}
            {message.pending && <span className="text-xs text-ink-muted">Sending...</span>}
            {message.failed && <span className="text-xs font-medium text-danger-700">Not sent</span>}
            {message.pinned_at && <Badge icon={<Pin className="h-3 w-3" aria-hidden="true" />}>Pinned</Badge>}
          </div>
        )}
        {message.blocked ? (
          <p className="text-sm italic text-ink-muted">Message hidden — you blocked this user</p>
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
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-xs text-danger-700" role="status">
            <span className="min-w-0 flex-1">{message.failureError || 'This message was not sent.'}</span>
            {message.retrySend ? (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                Retry
              </Button>
            ) : (
              <Button variant="secondary" size="sm" onClick={onRestore}>
                {message.body ? 'Restore text' : 'Reattach files'}
              </Button>
            )}
            <Button variant="quiet" size="sm" onClick={onDiscard}>
              Discard
            </Button>
          </div>
        )}
        {!message.blocked && message.attachments.length > 0 && (
          <div className="mt-3 grid max-w-full min-w-0 gap-2 sm:grid-cols-2">
            {message.attachments.map((attachment) => (
              attachment.image && attachment.url ? (
              <RowButton
                key={attachment.id}
                onClick={() => onOpenImage(attachment, imageAttachments)}
                aria-label={`Open image ${attachment.filename}`}
                className="block rounded-xl border border-line bg-surface-raised p-2 text-sm text-ink-secondary hover:border-line-strong"
              >
                <img src={attachment.url} alt="" width={640} height={360} className="mb-2 aspect-video max-h-56 w-full rounded-lg object-cover" />
                <span className="block truncate font-semibold text-ink" title={attachment.filename}>{attachment.filename}</span>
                <span className="block text-xs tabular-nums text-ink-muted">{formatFileSize(attachment.byte_size)}</span>
              </RowButton>
              ) : (
              <a
                key={attachment.id}
                href={attachment.url}
                download={attachment.filename}
                className="pressable flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-line bg-surface-raised p-2 text-sm text-ink-secondary hover:border-line-strong hover:bg-surface-sunken"
              >
                <File className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold text-ink" title={attachment.filename}>{attachment.filename}</span>
                  <span className="block text-xs tabular-nums text-ink-muted">{formatFileSize(attachment.byte_size)}</span>
                </span>
                <Download className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              </a>
              )
            ))}
          </div>
        )}
        {message.mine && readReceipts && readReceipts.count > 0 && (
          <div
            className="mt-1 inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-xs font-medium text-ink-muted"
            title={readReceiptTitle(readReceipts)}
            aria-label={`Seen by ${readReceiptTitle(readReceipts)}`}
          >
            <CheckCheck className="h-3 w-3 shrink-0 text-success-700" />
            <span className="truncate">Seen by {readReceiptLabel(readReceipts)}</span>
          </div>
        )}
        {!message.blocked && (message.reactions.length > 0 || (!inThreadView && replyCount > 0)) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {message.reactions.map((reaction) => {
            const reactionDisplay = REACTIONS_BY_VALUE.get(reaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
            const ReactionIcon = reactionDisplay.Icon
            return (
              <div key={reaction.emoji} className="group/reaction relative">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onInspectReaction(reaction.emoji)}
                  className={`gap-1.5 px-2.5 text-xs tabular-nums shadow-none! ${reaction?.reacted ? 'border-info-200! bg-info-50! text-info-800!' : 'font-medium! text-ink-secondary!'}`}
                  aria-label={`${reactionDisplay.label}: ${reaction?.count || 0}${reaction?.reacted ? ', including you' : ''}. Show who reacted.`}
                >
                  <ReactionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  {reaction?.count || ''}
                </Button>
                {reaction && reaction.users.length > 0 && (
                  <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-slate-900 px-3 py-2 text-xs text-white shadow-overlay group-hover/reaction:block">
                    <div className="font-medium">{reactionDisplay.label}</div>
                    <div className="mt-1 whitespace-nowrap">{reaction.users.map((user) => user.full_name).join(', ')}</div>
                  </div>
                )}
              </div>
            )
          })}
          {!inThreadView && replyCount > 0 && (
            <Button variant="quiet" size="sm" onClick={onReply} className="gap-1.5 px-2.5 text-xs tabular-nums text-ink!">
              <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {replyCount} {replyCount === 1 ? 'reply' : 'replies'}
            </Button>
          )}
        </div>
        )}
      </div>
      {!message.pending && !message.failed && <div className="ml-auto flex shrink-0 items-start gap-1 lg:hidden">
        <IconButton label="Open message actions" onClick={onOpenActions}>
          <MoreHorizontal className="h-5 w-5" />
        </IconButton>
      </div>}
      {!message.pending && !message.failed && <div role="toolbar" aria-label="Message actions" className={`absolute right-2 top-1 z-10 hidden items-center gap-0.5 rounded-xl border border-line bg-surface-raised p-1 shadow-overlay opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 lg:flex ${inThreadView ? '[&>button:not(:last-child)]:hidden' : ''}`}>
        {!message.blocked && REACTIONS.map(({ value, label, Icon }) => (
          <IconButton key={value} size="sm" label={`React with ${label.toLowerCase()}`} onClick={() => onReact(value)}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        ))}
        {!message.blocked && (
          <IconButton size="sm" label={inThreadView ? 'Reply in thread' : 'Reply'} onClick={onReply}>
            <MessageCircle className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        )}
        {!message.blocked && message.body && (
          <IconButton size="sm" label="Copy message" onClick={onCopy}>
            <Copy className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        )}
        {canPin && (
          <IconButton size="sm" label={message.pinned_at ? 'Unpin message' : 'Pin message'} onClick={onPin}>
            <Pin className="h-4 w-4" aria-hidden="true" />
          </IconButton>
        )}
        {message.mine && (
          <>
            <IconButton size="sm" label="Edit message" onClick={onStartEdit}>
              <Edit3 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
            <IconButton size="sm" variant="quiet" label="Delete message" onClick={onDelete} className="hover:bg-danger-50! hover:text-danger-700!">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </IconButton>
          </>
        )}
        <IconButton size="sm" label="More message actions" onClick={onOpenActions}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </IconButton>
      </div>}
    </div>
  )
}

interface EditPasteNotice {
  mode: 'code' | 'text'
  /** The pasted text, normalized. */
  text: string
  /** Where the paste landed and exactly what was inserted there. */
  start: number
  inserted: string
  /** The full value right after the paste; the notice hides once the text changes. */
  after: string
}

/**
 * Replaces a textarea range through the browser's editing command so the
 * change is one native undo step; falls back to setting the value directly.
 * Returns the resulting value.
 */
function replaceTextareaRange(textarea: HTMLTextAreaElement, start: number, end: number, text: string, onChange: (value: string) => void) {
  textarea.focus()
  textarea.setSelectionRange(start, end)
  const expected = textarea.value.slice(0, start) + text + textarea.value.slice(end)
  let applied: boolean
  try {
    applied = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text) && textarea.value === expected
  } catch {
    applied = false
  }
  if (!applied) {
    onChange(expected)
    requestAnimationFrame(() => textarea.setSelectionRange(start + text.length, start + text.length))
  }
  return expected
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
  // Same paste behaviour as the composer: code keeps its indentation in a
  // fenced block, with a one-tap switch between code and text.
  const [pasteNotice, setPasteNotice] = useState<EditPasteNotice | null>(null)
  const [cursorInCode, setCursorInCode] = useState(false)
  const normalizedValue = normalizeMessageMarkdown(value)
  const characterCount = messageCharacterCount(normalizedValue)
  const canSave = normalizedValue.length > 0 && characterCount <= MESSAGE_BODY_LIMIT

  // Editing continues where the message ends, not before its first word.
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return

    textarea.style.height = 'auto'
    const maxHeight = Math.max(192, Math.min(window.innerHeight * 0.5, 448))
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 112), maxHeight)}px`
  }, [value])

  return (
    <div className="mt-2 overflow-hidden rounded-2xl border border-focus bg-surface-raised shadow-raised ring-2 ring-focus/25">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value)
          setCursorInCode(isInsideMarkdownFence(event.target.value, event.target.selectionStart))
        }}
        onSelect={(event) => setCursorInCode(isInsideMarkdownFence(event.currentTarget.value, event.currentTarget.selectionStart))}
        onPaste={(event) => {
          const textarea = event.currentTarget
          if (Array.from(event.clipboardData?.files || []).length > 0) return
          const raw = event.clipboardData?.getData('text/plain') || ''
          if (!raw) return
          const start = textarea.selectionStart
          const end = textarea.selectionEnd
          // Inside an existing fence the browser's verbatim paste is already right.
          if (isInsideMarkdownFence(textarea.value, start)) return
          const text = normalizePastedCode(raw)
          if (looksLikeCode(text)) {
            event.preventDefault()
            const inserted = fencedCodeInsertion(textarea.value, start, end, text)
            const next = replaceTextareaRange(textarea, start, end, inserted, onChange)
            setPasteNotice({ mode: 'code', text, start, inserted, after: next })
          } else if (isMultiLinePaste(text)) {
            // Let the browser paste as usual (keeps native undo); remember where it went.
            const inserted = raw.replace(/\r\n?/g, '\n')
            const after = textarea.value.slice(0, start) + inserted + textarea.value.slice(end)
            setPasteNotice({ mode: 'text', text, start, inserted, after })
          }
        }}
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
        spellCheck={!cursorInCode}
        autoCorrect={cursorInCode ? 'off' : 'on'}
        autoCapitalize={cursorInCode ? 'off' : 'sentences'}
        className="block min-h-28 max-h-[50dvh] w-full resize-y overflow-y-auto border-0 bg-slate-50/70 px-4 py-3 text-base leading-6 text-slate-800 outline-none placeholder:text-slate-400 focus:bg-white sm:text-sm"
      />
      {pasteNotice && pasteNotice.after === value && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-white px-3 py-1.5 text-xs text-ink-secondary" role="status">
          <span>{pasteNotice.mode === 'code' ? 'Pasted as code so the indentation stays.' : 'Pasted as text.'}</span>
          <span className="flex items-center gap-1">
            <TextButton
              className="px-2 text-xs sm:min-h-9"
              onClick={() => {
                const textarea = textareaRef.current
                const notice = pasteNotice
                setPasteNotice(null)
                if (!textarea || textarea.value.slice(notice.start, notice.start + notice.inserted.length) !== notice.inserted) return
                const end = notice.start + notice.inserted.length
                const replacement = notice.mode === 'code' ? notice.text : fencedCodeInsertion(textarea.value, notice.start, end, notice.text)
                const after = replaceTextareaRange(textarea, notice.start, end, replacement, onChange)
                setPasteNotice({ mode: notice.mode === 'code' ? 'text' : 'code', text: notice.text, start: notice.start, inserted: replacement, after })
              }}
            >
              {pasteNotice.mode === 'code' ? 'Paste as text instead' : 'Paste as code instead'}
            </TextButton>
            <Button variant="quiet" size="sm" onClick={() => setPasteNotice(null)} className="sm:min-h-9" aria-label="Dismiss paste options">OK</Button>
          </span>
        </div>
      )}
      <div className="flex flex-col gap-3 border-t border-slate-200/80 bg-white px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className={`text-xs font-medium tabular-nums ${characterCount > MESSAGE_BODY_LIMIT ? 'text-danger-700' : 'text-ink-muted'}`}>
          {characterCount > MESSAGE_BODY_LIMIT
            ? `${characterCount.toLocaleString()} / ${MESSAGE_BODY_LIMIT.toLocaleString()} characters`
            : 'The editor grows as you type. Press Ctrl/Command + Enter to save.'}
        </p>
        <div className="flex shrink-0 justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={!canSave}>
            Save changes
          </Button>
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
  title,
}: {
  onClick: () => void
  icon: ReactNode
  shortLabel: string
  fullLabel: string
  ariaLabel: string
  /** Tooltip; distinguishes look-alike icon buttons on narrow screens. */
  title?: string
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      onClick={onClick}
      className="h-11 w-11 sm:h-auto sm:w-auto"
      aria-label={ariaLabel}
      title={title ?? fullLabel}
    >
      {icon}
      <span className="sr-only">{shortLabel}</span>
      <span className="hidden sm:inline">{fullLabel}</span>
    </Button>
  )
}
