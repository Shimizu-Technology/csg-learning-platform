import type { ChannelMessage, ChannelSummary, DirectConversationSummary } from '../types/api'

export type RecentConversation =
  | { type: 'channel'; summary: ChannelSummary }
  | { type: 'dm'; summary: DirectConversationSummary }

export function recentConversations(channels: ChannelSummary[], directConversations: DirectConversationSummary[]): RecentConversation[] {
  return [
    ...channels.map((summary) => ({ type: 'channel' as const, summary })),
    ...directConversations.map((summary) => ({ type: 'dm' as const, summary })),
  ].sort((left, right) => {
    const leftTime = left.summary.latest_message?.created_at || ''
    const rightTime = right.summary.latest_message?.created_at || ''
    if (leftTime !== rightTime) return rightTime.localeCompare(leftTime)
    // Empty conversations have a stable order regardless of API array order.
    const leftTitle = left.type === 'channel' ? left.summary.name : left.summary.title
    const rightTitle = right.type === 'channel' ? right.summary.name : right.summary.title
    return leftTitle.localeCompare(rightTitle) || left.summary.id - right.summary.id
  })
}

type ReadReceipts = NonNullable<ChannelMessage['read_receipts']>

// The API gives each outgoing message everyone who has read through it. Place
// each person only at their latest seen position in the loaded conversation.
export function latestVisibleReadReceipts(messages: ChannelMessage[]): Map<number, ReadReceipts> {
  const latest = new Map<number, { messageId: number; user: ReadReceipts['users'][number] }>()
  for (const message of messages) {
    if (!message.mine || message.id <= 0 || message.deleted_at || !message.read_receipts) continue
    for (const user of message.read_receipts.users) {
      latest.set(user.id, { messageId: message.id, user })
    }
  }

  const byMessage = new Map<number, ReadReceipts>()
  for (const { messageId, user } of latest.values()) {
    const receipt = byMessage.get(messageId) || { count: 0, users: [] }
    receipt.users.push(user)
    receipt.count += 1
    byMessage.set(messageId, receipt)
  }
  return byMessage
}

export function firstUnreadMessageId(messages: ChannelMessage[], lastReadAt: string | null, unreadCount: number, lastReadMessageId?: number | null): number | null {
  if (unreadCount <= 0) return null
  const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : -Infinity
  return messages.find((message) => {
    if (message.mine || message.parent_message_id || message.deleted_at) return false
    const messageTime = new Date(message.created_at).getTime()
    return messageTime > lastReadTime || (messageTime === lastReadTime && lastReadMessageId !== undefined && lastReadMessageId !== null && message.id > lastReadMessageId)
  })?.id ?? null
}

export function mergeConversationSummary<T extends ChannelSummary | DirectConversationSummary>(current: T, incoming: T): T {
  const currentReadTime = current.last_read_at || ''
  const incomingReadTime = incoming.last_read_at || ''
  const currentReadIsNewer = currentReadTime > incomingReadTime || (
    currentReadTime === incomingReadTime && (current.last_read_message_id || 0) > (incoming.last_read_message_id || 0)
  )
  const currentLatestTime = current.latest_message?.created_at || ''
  const incomingLatestTime = incoming.latest_message?.created_at || ''
  const currentLatestIsNewer = currentLatestTime > incomingLatestTime || (
    currentLatestTime === incomingLatestTime && (current.latest_message?.id || 0) > (incoming.latest_message?.id || 0)
  )

  return {
    ...current,
    ...incoming,
    ...(currentReadIsNewer ? { last_read_at: current.last_read_at, last_read_message_id: current.last_read_message_id } : {}),
    ...(currentLatestIsNewer ? { latest_message: current.latest_message } : {}),
    ...(currentReadIsNewer || currentLatestIsNewer ? { unread_count: current.unread_count } : {}),
  }
}
