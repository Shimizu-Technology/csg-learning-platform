// @vitest-environment jsdom
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationSummaryFreshness } from '../../../lib/conversationSummaryFreshness'
import type { ChannelMessage, ChannelSummary, DirectConversationSummary, MessageWindowMeta, User } from '../../../types/api'
import { useConversationState } from './useConversationState'
import { useConversationWindow } from './useConversationWindow'

const api = vi.hoisted(() => ({ getChannel: vi.fn(), getMessageThread: vi.fn(), markChannelRead: vi.fn() }))
vi.mock('../../../lib/api', () => ({ api }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const user = { id: 1, full_name: 'Student', email: 'student@example.com', role: 'student', avatar_url: null } as unknown as User
const channel = { id: 2, workspace_id: 1, cohort_id: 1, name: 'General', unread_count: 0, last_read_at: null, last_read_message_id: null, latest_message: null, muted: false } as unknown as ChannelSummary
const toast = { error: vi.fn() }

const message = (id: number, extra: Partial<ChannelMessage> = {}): ChannelMessage => ({
  id, channel_id: 2, direct_conversation_id: null, parent_message_id: null, body: `Message ${id}`,
  mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, pinned_by_id: null,
  created_at: new Date(Date.UTC(2026, 10, 15, 0, id)).toISOString(), updated_at: new Date(Date.UTC(2026, 10, 15, 0, id)).toISOString(),
  mine: false, attachments: [], reactions: [], author: { id: 4, full_name: 'Classmate', email: 'classmate@example.com', role: 'student', avatar_url: null },
  ...extra,
})
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => message(from + index))
const page = (messages: ChannelMessage[], meta: MessageWindowMeta) => ({ data: { channel, messages, pinned_messages: [], meta }, error: null })

/** Mounts the window over real conversation state, opened on channel 2 by the route. */
async function mountWindow(root: Root) {
  const hook = {} as { conversation: ReturnType<typeof useConversationState>; feed: ReturnType<typeof useConversationWindow> }
  function Probe() {
    const conversation = useConversationState({ channelId: '2', dmId: undefined, navigate: vi.fn(), setSourceContextHidden: vi.fn() })
    const [, setChannels] = useState<ChannelSummary[]>([channel])
    const [, setDirectConversations] = useState<DirectConversationSummary[]>([])
    const summaryFreshness = useRef(new ConversationSummaryFreshness()).current
    const authorContextRef = useRef(null)
    hook.conversation = conversation
    hook.feed = useConversationWindow({
      user,
      toast,
      route: { channelId: '2', dmId: undefined, locationSearch: '', routedMessageId: null, routedThreadId: null, routedAnchorOffset: undefined, routedDestinationKey: 'null:null:undefined' },
      conversation,
      directory: { loading: false, summaryFreshness, setChannels, setDirectConversations, updateTargetSummaryFromEvent: vi.fn() },
      authorContextRef,
      readingPaused: false,
      releaseOptimisticAttachmentUrls: vi.fn(),
    })
    return null
  }
  await act(async () => root.render(<Probe />))
  await vi.waitFor(() => expect(hook.feed.loadingTarget).toBe(false))
  return hook
}

const ids = (messages: ChannelMessage[]) => messages.map((item) => item.id)

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  window.localStorage.clear()
  Object.values(api).forEach((mock) => mock.mockReset())
  toast.error.mockReset()
  window.matchMedia = vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })) as unknown as typeof window.matchMedia
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0)) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => window.clearTimeout(id)) as typeof window.cancelAnimationFrame
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.localStorage.clear()
})

describe('useConversationWindow paging', () => {
  it('opens the routed conversation and pages older messages in front of the window', async () => {
    api.getChannel.mockResolvedValueOnce(page(range(51, 60), { oldest_message_id: 51, newest_message_id: 60, has_older: true, has_newer: false }))
    const hook = await mountWindow(root)

    expect(api.getChannel).toHaveBeenCalledWith(2, { around_message_id: undefined })
    expect(ids(hook.conversation.messages)).toEqual(ids(range(51, 60)))
    expect(hook.feed.messageWindowMeta).toMatchObject({ oldest_message_id: 51, has_older: true })

    api.getChannel.mockResolvedValueOnce(page(range(41, 51), { oldest_message_id: 41, newest_message_id: 51, has_older: false, has_newer: true }))
    await act(async () => { await hook.feed.loadOlderMessages() })

    expect(api.getChannel).toHaveBeenLastCalledWith(2, { before_message_id: 51 })
    // Overlap is merged once; the newer edge and has_newer stay as the window had them.
    expect(ids(hook.conversation.messages)).toEqual(ids(range(41, 60)))
    expect(hook.feed.messageWindowMeta).toEqual({ oldest_message_id: 41, newest_message_id: 60, has_older: false, has_newer: false })
    expect(hook.feed.loadingOlder).toBe(false)
  })

  it('pages newer messages after a historical window, without duplicating a message already shown', async () => {
    api.getChannel.mockResolvedValueOnce(page(range(11, 20), { oldest_message_id: 11, newest_message_id: 20, has_older: true, has_newer: true }))
    const hook = await mountWindow(root)

    api.getChannel.mockResolvedValueOnce(page([message(20), ...range(21, 25)], { oldest_message_id: 20, newest_message_id: 25, has_older: true, has_newer: false }))
    await act(async () => { await hook.feed.loadNewerMessages() })

    expect(api.getChannel).toHaveBeenLastCalledWith(2, { after_message_id: 20 })
    expect(ids(hook.conversation.messages)).toEqual(ids(range(11, 25)))
    expect(hook.feed.messageWindowMeta).toEqual({ oldest_message_id: 11, newest_message_id: 25, has_older: true, has_newer: false })
    expect(hook.feed.loadingNewer).toBe(false)
  })

  it('keeps the window and says so when a page fails to load', async () => {
    api.getChannel.mockResolvedValueOnce(page(range(51, 60), { oldest_message_id: 51, newest_message_id: 60, has_older: true, has_newer: false }))
    const hook = await mountWindow(root)

    api.getChannel.mockResolvedValueOnce({ data: null, error: 'Server error' })
    await act(async () => { await hook.feed.loadOlderMessages() })

    expect(toast.error).toHaveBeenCalledWith('Server error')
    expect(ids(hook.conversation.messages)).toEqual(ids(range(51, 60)))
    expect(hook.feed.messageWindowMeta).toMatchObject({ oldest_message_id: 51, has_older: true })
    expect(hook.feed.loadingOlder).toBe(false)
  })

  it('does not page past the start of the conversation', async () => {
    api.getChannel.mockResolvedValueOnce(page(range(1, 10), { oldest_message_id: 1, newest_message_id: 10, has_older: false, has_newer: false }))
    const hook = await mountWindow(root)

    await act(async () => { await hook.feed.loadOlderMessages() })

    expect(api.getChannel).toHaveBeenCalledTimes(1)
  })
})
