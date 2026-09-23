import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cachedWindowIsContiguous, FormattedMessage, MessageEditSurface, mergeMessageWindow, restoreFailedSends, typingIndicatorLabel } from './Messages'
import type { ChannelMessage } from '../../types/api'

function message(overrides: Partial<ChannelMessage>): ChannelMessage {
  return {
    id: 1,
    channel_id: 2,
    direct_conversation_id: null,
    parent_message_id: null,
    body: 'Message',
    mention_user_ids: [],
    edited_at: null,
    deleted_at: null,
    pinned_at: null,
    pinned_by_id: null,
    created_at: '2026-09-05T00:00:00.000Z',
    updated_at: '2026-09-05T00:00:00.000Z',
    mine: true,
    attachments: [],
    reactions: [],
    author: { id: 4, full_name: 'Student', email: 'student@example.com', role: 'student', avatar_url: null },
    ...overrides,
  }
}

describe('FormattedMessage', () => {
  it('renders mobile-safe semantic lists and formatting', () => {
    const html = renderToStaticMarkup(
      <FormattedMessage body={'- **First** item\n- ++Second++ item\n\n1. One\n2. ~~Two~~'} />,
    )

    expect(html).toContain('<ul')
    expect(html).toContain('<ol')
    expect(html).toContain('<strong>First</strong>')
    expect(html).toContain('<u>Second</u>')
    expect(html).toContain('<del>Two</del>')
    expect(html.match(/<li/g)).toHaveLength(4)
  })

  it('preserves combined marks and formatted link labels after sending', () => {
    const html = renderToStaticMarkup(
      <FormattedMessage body={'_**Bold italic**_ and [++underlined link++](https://example.com)'} />,
    )

    expect(html).toContain('<em><strong>Bold italic</strong></em>')
    expect(html).toContain('<a')
    expect(html).toContain('<u>underlined link</u>')
    expect(html).toContain('href="https://example.com"')
  })
})

describe('MessageEditSurface', () => {
  it('renders a resizable edit area with accessible actions and a valid message', () => {
    const html = renderToStaticMarkup(
      <MessageEditSurface value={'- First\n-'} onChange={() => undefined} onSave={() => undefined} onCancel={() => undefined} />,
    )

    expect(html).toContain('aria-label="Edit message"')
    expect(html).toContain('resize-y')
    expect(html).toContain('Save changes')
    expect(html).not.toContain('disabled=""')
  })

  it('disables saving when the edit only contains empty list markers', () => {
    const html = renderToStaticMarkup(
      <MessageEditSurface value={'1.\n2.'} onChange={() => undefined} onSave={() => undefined} onCancel={() => undefined} />,
    )

    expect(html).toContain('disabled=""')
  })
})

describe('message window reconciliation', () => {
  it('drops cached history when a later server page does not overlap it', () => {
    const meta = { oldest_message_id: 1, newest_message_id: 2, has_older: false, has_newer: false }
    const snapshot = { messages: [message({ id: 1 }), message({ id: 2 })], pinnedMessages: [], meta }
    const incoming = [message({ id: 100 }), message({ id: 101 })]

    expect(cachedWindowIsContiguous(snapshot, incoming, { ...meta, oldest_message_id: 100, newest_message_id: 101, has_older: true })).toBe(false)
    expect(cachedWindowIsContiguous(snapshot, [message({ id: 2 }), ...incoming], { ...meta, has_older: true })).toBe(true)
    expect(cachedWindowIsContiguous(snapshot, incoming, { ...meta, has_older: false })).toBe(true)
  })

  it('replaces a stale pending cached bubble with its stored failed send', () => {
    const pending = { ...message({ id: -1, client_message_id: 'client-1' }), pending: true }
    const failed = { ...pending, pending: false, failed: true }
    const snapshot = { messages: [pending], pinnedMessages: [], meta: null }

    expect(restoreFailedSends(snapshot, [failed]).messages).toEqual([failed])
  })

  it('replaces an optimistic message with its idempotent server response', () => {
    const optimistic = { ...message({ id: -1, client_message_id: 'client-1' }), pending: true }
    const delivered = message({ id: 20, client_message_id: 'client-1' })

    expect(mergeMessageWindow([optimistic], [delivered])).toEqual([delivered])
  })

  it('preserves unmatched pending and failed messages during background refreshes', () => {
    const pending = { ...message({ id: -1, client_message_id: 'client-1' }), pending: true }
    const failed = { ...message({ id: -2, client_message_id: 'client-2' }), failed: true }
    const delivered = message({ id: 20, client_message_id: 'client-3' })

    expect(mergeMessageWindow([pending, failed], [delivered]).map((item) => item.id)).toEqual([-2, -1, 20])
  })

  it('retains previously loaded older history without keeping stale messages in the refreshed window', () => {
    const old = message({ id: 1, created_at: '2026-09-01T00:00:00.000Z' })
    const stale = message({ id: 2, created_at: '2026-09-05T00:02:00.000Z' })
    const latest = message({ id: 3, created_at: '2026-09-05T00:01:00.000Z' })

    expect(mergeMessageWindow([old, stale], [latest], true).map((item) => item.id)).toEqual([1, 3])
    expect(mergeMessageWindow([stale], [latest], false).map((item) => item.id)).toEqual([3])
  })
})

describe('typingIndicatorLabel', () => {
  const typingUser = (id: number, full_name: string) => ({ id, full_name, avatar_url: null })

  it('summarizes one, two, and several people without exposing account details', () => {
    expect(typingIndicatorLabel([])).toBe('')
    expect(typingIndicatorLabel([typingUser(1, 'Ada')])).toBe('Ada is typing…')
    expect(typingIndicatorLabel([typingUser(1, 'Ada'), typingUser(2, 'Grace')])).toBe('Ada and Grace are typing…')
    expect(typingIndicatorLabel([typingUser(1, 'Ada'), typingUser(2, 'Grace'), typingUser(3, 'Linus')])).toBe('Ada, Grace, and 1 more are typing…')
  })
})
