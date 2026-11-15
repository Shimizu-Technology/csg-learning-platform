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

/**
 * Sends `body` to each recipient in order and reports what happened to each.
 * A rate limit stops the batch: the rest are reported as not sent, so nobody
 * gets a message the sender can't see confirmed. `batchId` makes a retry of
 * the same batch idempotent (the server dedupes on client_message_id).
 */
export async function sendToEach(api: BulkMessageApi, recipients: BulkRecipient[], body: string, batchId: string,
  onProgress?: (results: BulkResult[]) => void): Promise<BulkResult[]> {
  const results: BulkResult[] = []
  let stopped = false
  for (const recipient of recipients.slice(0, MAX_BULK_RECIPIENTS)) {
    if (stopped) {
      results.push({ ...recipient, outcome: { status: 'not_sent' } })
      continue
    }
    const conversation = await api.createDirectConversation({ cohort_id: recipient.cohortId, user_ids: [recipient.userId] })
    let outcome: BulkOutcome
    if (!conversation.data) {
      outcome = failure(conversation)
    } else {
      const sent = await api.createDirectMessage(conversation.data.direct_conversation.id, { body, client_message_id: `bulk-${batchId}-${recipient.userId}` })
      outcome = sent.data ? { status: 'sent', conversationId: conversation.data.direct_conversation.id } : failure(sent)
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
