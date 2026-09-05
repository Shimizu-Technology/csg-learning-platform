import { describe, expect, it } from 'vitest'
import {
  MESSAGE_BODY_LIMIT,
  composerDestinationKey,
  messageCharacterCount,
  readComposerDraft,
  readFailedSends,
  writeComposerDraft,
  writeFailedSends,
  type StoredFailedSend,
} from './messageComposerState'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

describe('message composer state', () => {
  it('counts Unicode characters instead of UTF-16 code units', () => {
    expect(messageCharacterCount('A👍🏽B')).toBe(4)
    expect(messageCharacterCount('a'.repeat(MESSAGE_BODY_LIMIT))).toBe(MESSAGE_BODY_LIMIT)
  })

  it('keeps main and thread drafts isolated per user and conversation', () => {
    const target = { type: 'channel' as const, id: 42 }
    expect(composerDestinationKey(7, target, null)).toBe('csg-message-draft:7:channel:42:root')
    expect(composerDestinationKey(7, target, 99)).toBe('csg-message-draft:7:channel:42:99')
  })

  it('round trips rich editor drafts and removes an empty draft', () => {
    const storage = new MemoryStorage()
    const key = 'draft'
    const draft = {
      version: 1 as const,
      body: '**hello**',
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello', marks: [{ type: 'bold' }] }] }] },
    }

    writeComposerDraft(key, draft, storage)
    expect(readComposerDraft(key, storage)).toEqual(draft)
    writeComposerDraft(key, null, storage)
    expect(readComposerDraft(key, storage)).toBeNull()
  })

  it('round trips retryable failures and rejects malformed stored data', () => {
    const storage = new MemoryStorage()
    const key = 'failures'
    const failure: StoredFailedSend = {
      version: 1,
      clientMessageId: 'client-1',
      target: { type: 'dm', id: 8 },
      body: 'Try again',
      parentMessageId: null,
      mentionUserIds: [],
      attachments: [],
      attachmentCount: 0,
      createdAt: '2026-09-05T00:00:00.000Z',
      error: 'Offline',
    }

    writeFailedSends(key, [failure], storage)
    expect(readFailedSends(key, storage)).toEqual([failure])
    storage.setItem(key, JSON.stringify([{ version: 1, body: 4 }]))
    expect(readFailedSends(key, storage)).toEqual([])
  })
})
