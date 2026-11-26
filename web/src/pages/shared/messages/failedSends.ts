import { failedSendsKey, readFailedSends, safeLocalStorage, writeFailedSends, type StoredFailedSend, type StoredMessageSource } from '../../../lib/messageComposerState';
import type { MessageSourceSummary, User } from '../../../types/api';
import { targetMatches } from './helpers';
import type { LocalMessage, Target } from './types';

/** How a source looks on a message that hasn't reached the server yet. */
export function optimisticSource(source: StoredMessageSource): MessageSourceSummary {
  return { type: source.type, id: source.id, title: source.title, lesson_id: null, cohort_id: null, learner_path: null }
}

/**
 * Failed sends saved for this person and conversation, as failed rows that can
 * be retried. Each row takes the next temporary (negative) id.
 */
export function storedFailureMessages(user: User | null, target: Target, tempMessageIdRef: { current: number }): LocalMessage[] {
  const storage = safeLocalStorage()
  if (!user || !storage) return []

  return readFailedSends(failedSendsKey(user.id, target), storage)
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
          source: failure.source,
        } : undefined,
        source: failure.source ? optimisticSource(failure.source) : null,
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

export function saveStoredFailure(user: User | null, target: Target, failure: StoredFailedSend) {
  const storage = safeLocalStorage()
  if (!user || !storage) return
  const key = failedSendsKey(user.id, target)
  const failures = readFailedSends(key, storage).filter((item) => item.clientMessageId !== failure.clientMessageId)
  writeFailedSends(key, [...failures, failure], storage)
}

export function removeStoredFailure(user: User | null, target: Target, clientMessageId: string) {
  const storage = safeLocalStorage()
  if (!user || !storage) return
  const key = failedSendsKey(user.id, target)
  writeFailedSends(
    key,
    readFailedSends(key, storage).filter((item) => item.clientMessageId !== clientMessageId),
    storage,
  )
}
