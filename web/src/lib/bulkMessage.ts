import type { ApiResponse } from './api'

/**
 * "Message selected students" (T-3). One message goes to each student as their
 * own direct conversation, sent one at a time through the same endpoints as
 * "Message Alex". The server checks every send exactly as it would a single
 * one: cohort access, who staff may message, blocks, whether the conversation
 * can take posts, community terms and the per-person message rate limit
 * (#252). There is no bulk endpoint, so selecting students adds no new way to
 * send more than someone could by hand.
 */

/** Two requests per student (open the conversation, send) keeps one batch well inside the 120-a-minute message limit. */
export const MAX_BULK_RECIPIENTS = 25

export interface BulkRecipient {
  userId: number
  name: string
  cohortId: number
}

export type BulkOutcome =
  | { status: 'sent'; conversationId: number }
  | { status: 'blocked' | 'failed'; error: string }
  | { status: 'rate_limited' | 'not_sent' }

export interface BulkResult extends BulkRecipient {
  outcome: BulkOutcome
}

export interface BulkMessageApi {
  createDirectConversation: (data: { cohort_id: number; user_ids: number[] }) => Promise<ApiResponse<{ direct_conversation: { id: number } }>>
  createDirectMessage: (conversationId: number, data: { body: string; client_message_id: string }) => Promise<ApiResponse<unknown>>
}

export interface DuplicateRecipient {
  userId: number
  name: string
  /** How many selected cohorts this student appears in. */
  cohortCount: number
}

/**
 * One message per person. A student selected in two cohorts would otherwise
 * get the same note twice (almost never what staff mean), so keep the first
 * row selected for each student and report who was merged. Order is kept.
 */
export function dedupeRecipients(recipients: BulkRecipient[]): { recipients: BulkRecipient[]; duplicates: DuplicateRecipient[] } {
  const firstByUser = new Map<number, BulkRecipient>()
  const counts = new Map<number, number>()
  for (const recipient of recipients) {
    counts.set(recipient.userId, (counts.get(recipient.userId) ?? 0) + 1)
    if (!firstByUser.has(recipient.userId)) firstByUser.set(recipient.userId, recipient)
  }
  const duplicates = [...firstByUser.values()]
    .filter((recipient) => (counts.get(recipient.userId) ?? 0) > 1)
    .map((recipient) => ({ userId: recipient.userId, name: recipient.name, cohortCount: counts.get(recipient.userId)! }))
  return { recipients: [...firstByUser.values()], duplicates }
}

/** The selection key for one row: a student in one cohort ("7:3"). */
export function recipientKey(recipient: Pick<BulkRecipient, 'userId' | 'cohortId'>): string {
  return `${recipient.userId}:${recipient.cohortId}`
}

/**
 * The selection keys a batch reached: every selected row whose student got the
 * message, including the rows merged by dedupeRecipients (one message reaches
 * the student in every selected cohort). Anyone failed, blocked, paused by a
 * rate limit, not tried after the pause, or past the MAX_BULK_RECIPIENTS cap
 * is left out, so they stay selected for the next batch.
 */
export function sentRecipientKeys(selected: BulkRecipient[], results: BulkResult[]): string[] {
  const reached = new Set(results.filter((result) => result.outcome.status === 'sent').map((result) => result.userId))
  return selected.filter((recipient) => reached.has(recipient.userId)).map(recipientKey)
}

/** Where one merged student's single message stands: before sending, or that student's own outcome. */
export type DuplicateNoteState = 'pending' | 'sent' | 'not_sent'

/** "Ana is in 2 selected cohorts; one message sent." */
export function duplicateNote(duplicate: DuplicateRecipient, state: DuplicateNoteState): string {
  const outcome = state === 'sent' ? 'one message sent' : state === 'pending' ? 'one message will be sent' : 'the message was not sent'
  return `${duplicate.name} is in ${duplicate.cohortCount} selected cohorts; ${outcome}.`
}

/**
 * A merged student's note state from their own result. While a batch is
 * sending, anyone not reached yet is still pending; once it finishes, a
 * student with no result (past the MAX_BULK_RECIPIENTS cap) was not sent.
 */
export function duplicateNoteState(userId: number, results: BulkResult[], sending: boolean): DuplicateNoteState {
  const result = results.find((item) => item.userId === userId)
  if (!result) return sending ? 'pending' : 'not_sent'
  return result.outcome.status === 'sent' ? 'sent' : 'not_sent'
}

/**
 * The idempotency key for one send. The server treats client_message_id as
 * unique per author across every conversation, so the key names the batch,
 * the direct conversation (which belongs to one cohort workspace) and the
 * student. A retry of the same batch reopens the same conversation and reuses
 * the key; two different conversations can never share one.
 */
export function bulkClientMessageId(batchId: string, conversationId: number, userId: number): string {
  return `bulk-${batchId}-dm${conversationId}-u${userId}`
}

/**
 * Sends `body` to each recipient in order and reports what happened to each.
 * A rate limit stops the batch: the rest are reported as not sent, so nobody
 * gets a message the sender can't see confirmed. `batchId` makes a retry of
 * the same batch idempotent (the server dedupes on client_message_id).
 * Callers should pass recipients through dedupeRecipients first.
 */
export async function sendToEach(api: BulkMessageApi, recipients: BulkRecipient[], body: string, batchId: string,
  onProgress?: (results: BulkResult[]) => void): Promise<BulkResult[]> {
  const results: BulkResult[] = []
  let stopped = false
  for (const recipient of recipients.slice(0, MAX_BULK_RECIPIENTS)) {
    if (stopped) {
      results.push({ ...recipient, outcome: { status: 'not_sent' } })
      onProgress?.([...results])
      continue
    }
    const conversation = await api.createDirectConversation({ cohort_id: recipient.cohortId, user_ids: [recipient.userId] })
    let outcome: BulkOutcome
    if (!conversation.data) {
      outcome = failure(conversation)
    } else {
      const conversationId = conversation.data.direct_conversation.id
      const sent = await api.createDirectMessage(conversationId, { body, client_message_id: bulkClientMessageId(batchId, conversationId, recipient.userId) })
      outcome = sent.data ? { status: 'sent', conversationId } : failure(sent)
    }
    if (outcome.status === 'rate_limited') stopped = true
    results.push({ ...recipient, outcome })
    onProgress?.([...results])
  }
  return results
}

function failure(response: ApiResponse<unknown>): BulkOutcome {
  if (response.status === 429) return { status: 'rate_limited' }
  if (response.status === 403) return { status: 'blocked', error: response.error || 'This student can’t be messaged.' }
  return { status: 'failed', error: response.error || 'Couldn’t send.' }
}

/** "Sent to 4 of 5 students" plus who didn't get it, for the result toast and summary. */
export function summarizeBulk(results: BulkResult[]): { sent: number; total: number; unsent: BulkResult[] } {
  const sent = results.filter((result) => result.outcome.status === 'sent').length
  return { sent, total: results.length, unsent: results.filter((result) => result.outcome.status !== 'sent') }
}
