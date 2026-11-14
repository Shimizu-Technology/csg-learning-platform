import { CircleCheck, Heart, SmilePlus, ThumbsUp, type LucideIcon } from 'lucide-react';
import { markdownToPlainText } from '../../../lib/messageFormat';
import { recentConversations } from '../../../lib/messagingPresentation';
import type { ChannelMessage, ChannelSummary, DirectConversationSummary, MessageWindowMeta } from '../../../types/api';
import { MAX_CACHED_CONVERSATIONS, type ConversationViewSnapshot, type LocalMessage, type ReadReceipts, type SavedConversationScroll, type Target, type TypingUser } from './types';

export function targetKey(target: Target) {
  return `${target.type}:${target.id}`
}

export function conversationPath(target: Target, messageId?: number) {
  const path = target.type === 'channel' ? `/messages/${target.id}` : `/messages/dm/${target.id}`
  return messageId ? `${path}?message_id=${messageId}` : path
}

export function cacheConversationView(cache: Map<string, ConversationViewSnapshot>, target: Target, snapshot: ConversationViewSnapshot) {
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

export function targetMatches(left: Target | null, right: Target) {
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

export function messageBelongsToTarget(message: ChannelMessage, target: Target) {
  return target.type === 'channel' ? message.channel_id === target.id : message.direct_conversation_id === target.id
}

export function scrollStorageKey(userId: number, target: Target) {
  return `csg-message-scroll:${userId}:${targetKey(target)}`
}

export function saveConversationScroll(userId: number | undefined, target: Target, element: HTMLDivElement) {
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

export function positionMessageAnchor(pane: HTMLDivElement, row: HTMLElement, offset?: number) {
  row.scrollIntoView({ block: 'center', behavior: 'auto' })
  if (offset !== undefined) pane.scrollTop += row.getBoundingClientRect().top - pane.getBoundingClientRect().top - offset
}

export function readReceiptLabel(readReceipts: ReadReceipts): string {
  if (readReceipts.count === 1) return readReceipts.users[0]?.full_name || '1 person'
  return `${readReceipts.count} people`
}

export function readReceiptTitle(readReceipts: ReadReceipts): string {
  const names = readReceipts.users.map((user) => user.full_name)
  const hiddenCount = readReceipts.count - names.length
  if (hiddenCount > 0) names.push(`${hiddenCount} more`)
  return names.join(', ')
}

export type QuickReaction = {
  value: string
  label: string
  Icon: LucideIcon
}

export const REACTIONS: QuickReaction[] = [
  { value: '\u{1F44D}', label: 'Thumbs up', Icon: ThumbsUp },
  { value: '\u2764\uFE0F', label: 'Love', Icon: Heart },
  { value: '\u2705', label: 'Complete', Icon: CircleCheck },
  { value: '\u{1F64C}', label: 'Celebrate', Icon: SmilePlus },
]

export const REACTIONS_BY_VALUE = new Map(REACTIONS.map((reaction) => [reaction.value, reaction]))

export const CHANNEL_MENTION_ALIASES = [
  { label: '@everyone', subtitle: 'Notify everyone in this channel' },
]

export const COMMON_FILE_EXTENSIONS = new Set([
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

export function formatTime(value: string) {
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function formatInboxTime(value: string) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** One-line plain text for inbox rows, search results and reply context (M-8). */
export function preview(text: string) {
  // An unmatched backtick is literal Markdown, but it reads as noise in a one-line preview.
  const fallback = markdownToPlainText(text || '').replace(/`+/g, '').trim() || (text ? '' : 'Attachment')
  return fallback.length > 80 ? `${fallback.slice(0, 77)}...` : fallback
}

export function latestMessageFrom(message: ChannelMessage) {
  return {
    id: message.id,
    body: message.body || (message.attachments.length === 1 ? 'Attachment' : `${message.attachments.length} attachments`),
    created_at: message.created_at,
    author_name: message.author.full_name,
  }
}

export function sameDay(left: string, right: string) {
  return new Date(left).toDateString() === new Date(right).toDateString()
}

export function closeInTime(left: string, right: string, minutes = 5) {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime()) <= minutes * 60 * 1000
}

export function shouldCompactMessage(message: ChannelMessage, previousMessage?: ChannelMessage) {
  return Boolean(
    previousMessage &&
    previousMessage.author.id === message.author.id &&
    !previousMessage.pinned_at &&
    !message.pinned_at &&
    sameDay(previousMessage.created_at, message.created_at) &&
    closeInTime(previousMessage.created_at, message.created_at),
  )
}

export function formatDayDivider(value: string) {
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

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return parts.slice(0, 2).map((part) => part[0]).join('').toUpperCase()
}

export function channelInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return '#'
  return words.length === 1 ? words[0].slice(0, 2).toUpperCase() : words.slice(0, 2).map((word) => word[0]).join('').toUpperCase()
}

export function rootMessageIdFor(message: ChannelMessage, messagesById: Map<number, ChannelMessage>) {
  let current: ChannelMessage | undefined = message

  while (current?.parent_message_id) {
    current = messagesById.get(current.parent_message_id)
  }

  return current?.id || message.id
}

export function mergeIncomingMessage(existing: LocalMessage, incoming: LocalMessage) {
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

export function sortChronologicalMessages<T extends ChannelMessage>(items: T[]) {
  return [...items].sort((a, b) => {
    const createdDelta = new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    if (createdDelta !== 0) return createdDelta
    return a.id - b.id
  })
}

export function sortPinnedMessages<T extends ChannelMessage>(items: T[]) {
  return [...items].sort((a, b) => {
    const pinnedDelta = new Date(b.pinned_at || b.created_at).getTime() - new Date(a.pinned_at || a.created_at).getTime()
    if (pinnedDelta !== 0) return pinnedDelta
    return b.id - a.id
  })
}

export function latestMessageTime(item: ChannelSummary | DirectConversationSummary) {
  return item.latest_message ? new Date(item.latest_message.created_at).getTime() : 0
}

export function initialMessageTarget(channels: ChannelSummary[], directConversations: DirectConversationSummary[]): Target | null {
  const unreadTargets = [
    ...channels.filter((channel) => channel.unread_count > 0).map((channel) => ({ target: { type: 'channel' as const, id: channel.id }, latestAt: latestMessageTime(channel) })),
    ...directConversations.filter((conversation) => conversation.unread_count > 0).map((conversation) => ({ target: { type: 'dm' as const, id: conversation.id }, latestAt: latestMessageTime(conversation) })),
  ].sort((left, right) => right.latestAt - left.latestAt)

  if (unreadTargets[0]) return unreadTargets[0].target
  const mostRecent = recentConversations(channels, directConversations)[0]
  if (mostRecent) return { type: mostRecent.type, id: mostRecent.summary.id }

  return null
}

export function upsertPinnedMessage(prev: LocalMessage[], incoming: LocalMessage) {
  if (!incoming.pinned_at || incoming.deleted_at) {
    return prev.filter((item) => item.id !== incoming.id)
  }

  const next = prev.some((item) => item.id === incoming.id)
    ? prev.map((item) => item.id === incoming.id ? mergeIncomingMessage(item, incoming) : item)
    : [...prev, incoming]

  return sortPinnedMessages(next)
}

export function typingIndicatorLabel(users: TypingUser[]) {
  const names = users.map((typingUser) => typingUser.full_name)
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return `${names[0]}, ${names[1]}, and ${names.length - 2} more are typing…`
}
