// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { cachedWindowIsContiguous, conversationPath, createMessageArrivals, forgetMessageArrival, FormattedMessage, MessageEditSurface, mergeMessageWindow, messageShouldAnimateEntry, recordMessageArrival, restoreFailedSends, typingIndicatorLabel } from './Messages'
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
  it('keeps pasted Python indentation inside a code block', () => {
    const html = renderToStaticMarkup(<FormattedMessage body={'```\nif amount < budget:\n    print("Under budget")\n```'} />)
    expect(html).toContain('<pre')
    expect(html).toContain('    print(&quot;Under budget&quot;)')
  })

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

  it('renders nested list items inside the parent item after sending or reloading', () => {
    const html = renderToStaticMarkup(
      <FormattedMessage body={'- 1\n  - a\n  - b\n  - c\n- 2\n- 3'} />,
    )
    const document = new DOMParser().parseFromString(html, 'text/html')
    const root = document.querySelector('ul')!
    const parents = Array.from(root.children)

    expect(parents.map((item) => item.firstChild?.textContent)).toEqual(['1', '2', '3'])
    expect(Array.from(parents[0].querySelectorAll('ul > li')).map((item) => item.textContent)).toEqual(['a', 'b', 'c'])
    expect(parents[1].querySelector('ul')).toBeNull()
  })

  it('keeps a loose-list child inside its parent after a blank line', () => {
    const html = renderToStaticMarkup(<FormattedMessage body={'- Parent\n\n  - Child\n- Sibling'} />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const root = document.querySelector('ul')!
    expect(root.children).toHaveLength(2)
    expect(root.children[0].querySelector('ul > li')?.textContent).toBe('Child')
    expect(root.children[1].textContent).toBe('Sibling')
  })

  it('keeps paragraphs around child lists in order and preserves ordered root numbering', () => {
    const html = renderToStaticMarkup(<FormattedMessage body={'1. Parent\n  Before\n  - Child\n    Continued\n  After\n2. Next'} />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const root = document.querySelector('ol')!
    expect(root.children).toHaveLength(2)
    const parent = root.children[0]
    expect(Array.from(parent.children).filter((element) => ['P', 'UL'].includes(element.tagName)).map((element) => element.tagName)).toEqual(['P', 'UL', 'P'])
    expect(parent.querySelector('ul > li > p')?.textContent).toBe('Continued')
    expect(parent.children[parent.children.length - 1].textContent).toBe('After')
    expect(root.children[1].textContent).toBe('Next')
  })

  it('renders a quoted list continuation without exposing the Markdown marker', () => {
    const html = renderToStaticMarkup(<FormattedMessage body={'1. Parent\n  > **Quoted** note\n  - Child\n2. Next'} />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('ol > li > blockquote strong')?.textContent).toBe('Quoted')
    expect(document.querySelector('blockquote')?.textContent).toBe('Quoted note')
    expect(document.querySelectorAll('ol > li')).toHaveLength(2)
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

describe('MessageEditSurface paste', () => {
  function mount(initial: string) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const values: string[] = []
    function Harness() {
      const [value, setValue] = useState(initial)
      return <MessageEditSurface value={value} onChange={(next) => { values.push(next); setValue(next) }} onSave={() => undefined} onCancel={() => undefined} />
    }
    act(() => root.render(<Harness />))
    const textarea = container.querySelector('textarea')!
    const paste = (text: string, at = textarea.value.length) => {
      textarea.setSelectionRange(at, at)
      const event = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clipboardData', { value: { files: [], getData: (type: string) => (type === 'text/plain' ? text : '') } })
      act(() => { textarea.dispatchEvent(event) })
      return event
    }
    const cleanup = () => { act(() => root.unmount()); container.remove() }
    return { container, textarea, paste, values, cleanup }
  }

  const PYTHON = 'def total(items):\n    result = 0\n    for item in items:\n        result += item\n    return result'

  it('pastes code as a fenced block that keeps its indentation, like the composer', () => {
    const { container, textarea, paste, cleanup } = mount('Here is my fix:')
    const event = paste(PYTHON)
    expect(event.defaultPrevented).toBe(true)
    expect(textarea.value).toBe(`Here is my fix:\n\`\`\`\n${PYTHON}\n\`\`\`\n`)
    expect(container.textContent).toContain('Pasted as code so the indentation stays.')
    cleanup()
  })

  it('switches a code paste back to text and offers code again', () => {
    const { container, textarea, paste, cleanup } = mount('')
    paste(PYTHON)
    const toText = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Paste as text instead')!
    act(() => toText.click())
    expect(textarea.value).toBe(PYTHON)
    expect(container.textContent).toContain('Pasted as text.')
    const toCode = Array.from(container.querySelectorAll('button')).find((b) => b.textContent === 'Paste as code instead')!
    act(() => toCode.click())
    expect(textarea.value).toBe(`\`\`\`\n${PYTHON}\n\`\`\`\n`)
    cleanup()
  })

  it('leaves prose and pastes inside an existing fence to the browser', () => {
    const { textarea, paste, cleanup } = mount('```\nx = 1\n')
    expect(paste('    y = 2\n    z = 3', textarea.value.length).defaultPrevented).toBe(false)
    const prose = mount('Hi')
    expect(prose.paste('Thanks for the help today.').defaultPrevented).toBe(false)
    prose.cleanup()
    cleanup()
  })

  it('opens with the cursor at the end of the message', () => {
    const { textarea, cleanup } = mount('Here is my fix')
    expect(textarea.selectionStart).toBe('Here is my fix'.length)
    cleanup()
  })

  it('turns autocorrect and spellcheck off while the cursor is in a code block', () => {
    const { textarea, paste, cleanup } = mount('')
    expect(textarea.getAttribute('spellcheck')).toBe('true')
    paste(PYTHON)
    textarea.focus()
    textarea.setSelectionRange(5, 5)
    act(() => { textarea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowDown' })) })
    expect(textarea.getAttribute('spellcheck')).toBe('false')
    expect(textarea.getAttribute('autocorrect')).toBe('off')
    expect(textarea.getAttribute('autocapitalize')).toBe('off')
    cleanup()
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

describe('conversation routes', () => {
  it('keeps channels, DMs, and a highlighted message in routable URLs', () => {
    expect(conversationPath({ type: 'channel', id: 12 })).toBe('/messages/12')
    expect(conversationPath({ type: 'dm', id: 34 })).toBe('/messages/dm/34')
    expect(conversationPath({ type: 'dm', id: 34 }, 90)).toBe('/messages/dm/34?message_id=90')
  })
})

describe('message enter animation', () => {
  it('does not animate history, cached, or paginated messages that were never recorded as arrivals', () => {
    const arrivals = createMessageArrivals('channel:2')
    expect(messageShouldAnimateEntry(arrivals, 'channel:2', 10)).toBe(false)
    expect(messageShouldAnimateEntry(createMessageArrivals(), null, 10)).toBe(false)
  })

  it('animates only messages that arrive while the conversation is open', () => {
    let arrivals = createMessageArrivals()
    arrivals = recordMessageArrival(arrivals, 'channel:2', 11)
    arrivals = recordMessageArrival(arrivals, 'channel:2', -1)
    expect(messageShouldAnimateEntry(arrivals, 'channel:2', 11)).toBe(true)
    expect(messageShouldAnimateEntry(arrivals, 'channel:2', -1)).toBe(true)
    expect(messageShouldAnimateEntry(arrivals, 'channel:2', 10)).toBe(false)
  })

  it('forgets arrivals when the conversation changes so switching back does not replay them', () => {
    let arrivals = recordMessageArrival(createMessageArrivals(), 'channel:2', 11)
    expect(messageShouldAnimateEntry(arrivals, 'dm:8', 11)).toBe(false)
    arrivals = recordMessageArrival(arrivals, 'dm:8', 30)
    expect(messageShouldAnimateEntry(arrivals, 'dm:8', 30)).toBe(true)
    expect(messageShouldAnimateEntry(arrivals, 'channel:2', 11)).toBe(false)
  })

  it('stops animating a message once its enter animation has played', () => {
    const arrivals = recordMessageArrival(createMessageArrivals(), 'channel:2', 11)
    const settled = forgetMessageArrival(arrivals, 11)
    expect(messageShouldAnimateEntry(settled, 'channel:2', 11)).toBe(false)
    expect(forgetMessageArrival(settled, 99)).toBe(settled)
  })
})
