import { type UploadedMessageAttachment } from '../../../lib/messageComposerState';
import type { ChannelMessage, MessageTypingEvent, MessageWindowMeta, UserSummary } from '../../../types/api';

export type Target = { type: 'channel'; id: number } | { type: 'dm'; id: number }

export type TargetLoadOptions = { aroundMessageId?: number; highlightedMessageId?: number; threadRootId?: number; anchorOffset?: number; background?: boolean }

export type SavedConversationScroll = { distanceFromBottom: number; atBottom: boolean }

export type PendingAttachment = {
  file: File
  s3_key?: string
  filename: string
  content_type: string
  byte_size: number
  progress: number
  uploaded: boolean
}

export type RetrySend = {
  clientMessageId: string
  body: string
  parentMessageId: number | null
  mentionUserIds: number[]
  pendingAttachments: PendingAttachment[]
  uploadedAttachments: UploadedMessageAttachment[]
}

export type LocalMessage = ChannelMessage & { pending?: boolean; failed?: boolean; failureError?: string; retrySend?: RetrySend }

export type ConversationViewSnapshot = { messages: LocalMessage[]; pinnedMessages: LocalMessage[]; meta: MessageWindowMeta | null }

export const MAX_CACHED_CONVERSATIONS = 12

export type MentionSuggestion = {
  id: string
  label: string
  subtitle: string
  kind: 'user' | 'channel'
}

export type MentionPattern = {
  label: string
  normalized: string
  kind: 'user' | 'channel'
}

export type MentionableUser = Pick<UserSummary, 'id' | 'full_name' | 'email' | 'role' | 'cohort_name'>

export type MessageSearchResult = ChannelMessage & {
  context?: {
    type: 'channel' | 'direct_conversation'
    id: number
    label: string
    cohort_id: number | null
  }
}

export type ReadReceipts = NonNullable<ChannelMessage['read_receipts']>

export type TypingUser = MessageTypingEvent['user']
