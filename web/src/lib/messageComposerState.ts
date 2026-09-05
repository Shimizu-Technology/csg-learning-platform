import type { JSONContent } from '@tiptap/core'

export const MESSAGE_BODY_LIMIT = 5_000

export type MessageTargetIdentity = {
  type: 'channel' | 'dm'
  id: number
}

export type UploadedMessageAttachment = {
  s3_key: string
  filename: string
  content_type: string
  byte_size: number
}

export type StoredComposerDraft = {
  version: 1
  body: string
  content: JSONContent
}

export type StoredFailedSend = {
  version: 1
  clientMessageId: string
  target: MessageTargetIdentity
  body: string
  parentMessageId: number | null
  mentionUserIds: number[]
  attachments: UploadedMessageAttachment[]
  attachmentCount: number
  createdAt: string
  error: string
}

function storageAvailable(storage?: Storage | null): storage is Storage {
  return Boolean(storage)
}

export function messageCharacterCount(value: string) {
  return Array.from(value).length
}

export function createClientMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `web-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function composerDestinationKey(userId: number, target: MessageTargetIdentity, threadRootId: number | null) {
  return `csg-message-draft:${userId}:${target.type}:${target.id}:${threadRootId ?? 'root'}`
}

export function failedSendsKey(userId: number, target: MessageTargetIdentity) {
  return `csg-message-failures:${userId}:${target.type}:${target.id}`
}

export function clearComposerState(userId: number, storage?: Storage | null) {
  if (!storageAvailable(storage)) return

  try {
    const prefixes = [`csg-message-draft:${userId}:`, `csg-message-failures:${userId}:`]
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index))
    keys.forEach((key) => {
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) storage.removeItem(key)
    })
  } catch {
    // Local storage may be unavailable. Cleanup is best effort.
  }
}

export function clearComposerStateFromWindow(
  userId: number,
  browserWindow?: Pick<Window, 'localStorage'> | null,
) {
  try {
    clearComposerState(userId, browserWindow?.localStorage)
  } catch {
    // Accessing localStorage itself can throw in restricted browser contexts.
  }
}

export function readComposerDraft(key: string, storage?: Storage | null): StoredComposerDraft | null {
  if (!storageAvailable(storage)) return null

  try {
    const parsed = JSON.parse(storage.getItem(key) || '') as Partial<StoredComposerDraft>
    if (
      parsed.version !== 1
      || typeof parsed.body !== 'string'
      || parsed.content?.type !== 'doc'
      || !Array.isArray(parsed.content.content)
    ) return null
    return { version: 1, body: parsed.body, content: parsed.content }
  } catch {
    return null
  }
}

export function writeComposerDraft(key: string, draft: StoredComposerDraft | null, storage?: Storage | null) {
  if (!storageAvailable(storage)) return

  try {
    if (!draft || !draft.body.trim()) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(draft))
  } catch {
    // Local storage may be unavailable or full. Draft persistence is best effort.
  }
}

export function readFailedSends(key: string, storage?: Storage | null): StoredFailedSend[] {
  if (!storageAvailable(storage)) return []

  try {
    const parsed = JSON.parse(storage.getItem(key) || '[]')
    if (!Array.isArray(parsed)) return []

    return parsed.filter((item): item is StoredFailedSend => (
      item?.version === 1
      && typeof item.clientMessageId === 'string'
      && item.clientMessageId.length > 0
      && item.clientMessageId.length <= 100
      && (item.target?.type === 'channel' || item.target?.type === 'dm')
      && Number.isInteger(item.target.id)
      && item.target.id > 0
      && typeof item.body === 'string'
      && messageCharacterCount(item.body) <= MESSAGE_BODY_LIMIT
      && (item.parentMessageId === null || Number.isInteger(item.parentMessageId))
      && Array.isArray(item.mentionUserIds)
      && item.mentionUserIds.every((id: unknown) => Number.isInteger(id))
      && Array.isArray(item.attachments)
      && item.attachments.every((attachment: Partial<UploadedMessageAttachment>) => (
        typeof attachment?.s3_key === 'string'
        && typeof attachment.filename === 'string'
        && typeof attachment.content_type === 'string'
        && typeof attachment.byte_size === 'number'
        && Number.isInteger(attachment.byte_size)
        && attachment.byte_size >= 0
      ))
      && Number.isInteger(item.attachmentCount)
      && item.attachmentCount >= item.attachments.length
      && typeof item.createdAt === 'string'
      && Number.isFinite(Date.parse(item.createdAt))
      && typeof item.error === 'string'
    ))
  } catch {
    return []
  }
}

export function writeFailedSends(key: string, sends: StoredFailedSend[], storage?: Storage | null) {
  if (!storageAvailable(storage)) return

  try {
    if (sends.length === 0) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify(sends.slice(-20)))
  } catch {
    // Local storage may be unavailable or full. Failure persistence is best effort.
  }
}
