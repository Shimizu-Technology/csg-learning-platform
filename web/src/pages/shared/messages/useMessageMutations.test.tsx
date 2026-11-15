// @vitest-environment jsdom
import { act, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { failedSendsKey, readFailedSends } from '../../../lib/messageComposerState'
import type { ChannelMessage, User } from '../../../types/api'
import type { LocalMessage, Target } from './types'
import { useMessageMutations, type MutationInputs } from './useMessageMutations'

const api = vi.hoisted(() => ({ createDirectMessage: vi.fn(), createMessage: vi.fn() }))
vi.mock('../../../lib/api', () => ({ api }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const user = { id: 1, full_name: 'Staff Person', email: 'staff@example.com', role: 'admin', avatar_url: null, is_staff: true } as unknown as User
const dm: Target = { type: 'dm', id: 5 }
const sourceRecord = { type: 'submission', id: 9, label: 'Week 2 project', returnTo: undefined } as const
const toast = { success: vi.fn(), error: vi.fn() }

const serverMessage = (id: number, clientMessageId: string, body: string): ChannelMessage => ({
  id, channel_id: null, direct_conversation_id: dm.id, parent_message_id: null, client_message_id: clientMessageId, body,
  mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, pinned_by_id: null,
  created_at: '2026-11-15T00:00:00.000Z', updated_at: '2026-11-15T00:00:00.000Z', mine: true,
  attachments: [], reactions: [], author: { id: 1, full_name: 'Staff Person', email: 'staff@example.com', role: 'admin', avatar_url: null },
  source: { type: 'submission', id: 9, title: 'Week 2 project', lesson_id: null, cohort_id: null, learner_path: null },
})

/** Mounts the hook with the page state it needs, the same way the controller wires it. */
async function mountMutations(root: Root) {
  const hook = { current: null as unknown as ReturnType<typeof useMessageMutations>, messages: [] as LocalMessage[] }
  function Probe() {
    const [messages, setMessages] = useState<LocalMessage[]>([])
    const [, setPinnedMessages] = useState<LocalMessage[]>([])
    const selectedTargetRef = useRef<Target | null>(dm)
    const tempMessageIdRef = useRef(0)
    const inputs: MutationInputs = {
      user,
      toast,
      sourceRecord,
      conversation: { selectedTarget: dm, selectedTargetRef, messages, setMessages, setPinnedMessages, activeThreadRoot: null, activeThreadRootId: null, setActiveThreadRootId: vi.fn(), setEditing: vi.fn(), tempMessageIdRef },
      feed: { trackOwnSend: vi.fn(), queueHistoricalSend: () => false },
      attachments: {
        pendingAttachments: [],
        composerDraftKey: 'draft',
        fileInputRef: { current: null },
        clearSubmittedAttachments: vi.fn(),
        rememberOptimisticAttachmentUrls: vi.fn(),
        releaseOptimisticAttachmentUrls: vi.fn(),
        uploadAttachments: async () => [],
      },
      mentionableUsers: [],
      updateLatestForTarget: vi.fn(),
    }
    hook.current = useMessageMutations(inputs)
    hook.messages = messages
    return null
  }
  await act(async () => root.render(<Probe />))
  return hook
}

const storedFailures = () => readFailedSends(failedSendsKey(user.id, dm), window.localStorage)
const sentPayload = (call: number) => api.createDirectMessage.mock.calls[call][1] as { source_type?: string; source_id?: number; client_message_id: string; body: string }

let root: Root
let container: HTMLDivElement

beforeEach(() => {
  window.localStorage.clear()
  api.createDirectMessage.mockReset()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  window.localStorage.clear()
})

describe('useMessageMutations', () => {
  it('keeps a failed send retryable with its source, holds the source while it can retry, and sends it on retry', async () => {
    const hook = await mountMutations(root)
    api.createDirectMessage.mockResolvedValueOnce({ data: null, error: 'Network down' })

    await act(async () => { expect(hook.current.sendComposerMessage({ body: 'About your project', mentionUserIds: [] })).toBe(true) })

    expect(sentPayload(0)).toMatchObject({ body: 'About your project', source_type: 'submission', source_id: 9 })
    const failed = hook.messages.find((message) => message.failed)!
    expect(failed.failureError).toBe('Network down')
    expect(failed.retrySend?.source).toEqual({ type: 'submission', id: 9, title: 'Week 2 project' })
    expect(failed.source).toMatchObject({ type: 'submission', id: 9, title: 'Week 2 project' })
    expect(storedFailures()).toMatchObject([{ clientMessageId: failed.client_message_id, error: 'Network down', source: { type: 'submission', id: 9 } }])

    // While the failed send can still be retried, the next message doesn't repeat the context.
    api.createDirectMessage.mockResolvedValueOnce({ data: { message: serverMessage(70, 'other', 'Follow-up') }, error: null })
    await act(async () => { hook.current.sendComposerMessage({ body: 'Follow-up', mentionUserIds: [] }) })
    expect(sentPayload(1).source_type).toBeUndefined()

    api.createDirectMessage.mockResolvedValueOnce({ data: { message: serverMessage(71, failed.client_message_id!, 'About your project') }, error: null })
    await act(async () => { await hook.current.retryFailedMessage(hook.messages.find((message) => message.id === failed.id)!) })

    expect(sentPayload(2)).toMatchObject({ client_message_id: failed.client_message_id, source_type: 'submission', source_id: 9 })
    expect(storedFailures()).toEqual([])
    expect(hook.messages.some((message) => message.failed)).toBe(false)
    expect(hook.messages.map((message) => message.id)).toContain(71)
  })

  it('records a failed retry again, keeping the source', async () => {
    const hook = await mountMutations(root)
    api.createDirectMessage.mockResolvedValueOnce({ data: null, error: 'Network down' })
    await act(async () => { hook.current.sendComposerMessage({ body: 'About your project', mentionUserIds: [] }) })
    const failed = hook.messages.find((message) => message.failed)!

    api.createDirectMessage.mockResolvedValueOnce({ data: null, error: 'Still down' })
    await act(async () => { await hook.current.retryFailedMessage(failed) })

    const retried = hook.messages.find((message) => message.id === failed.id)!
    expect(retried).toMatchObject({ failed: true, pending: false, failureError: 'Still down' })
    expect(retried.retrySend?.source).toEqual({ type: 'submission', id: 9, title: 'Week 2 project' })
    expect(storedFailures()).toMatchObject([{ clientMessageId: failed.client_message_id, error: 'Still down', source: { type: 'submission', id: 9 } }])
    expect(toast.error).toHaveBeenCalledWith('Still down')
  })

  it('discarding a failed send forgets it and releases the source for the next message', async () => {
    const hook = await mountMutations(root)
    api.createDirectMessage.mockResolvedValueOnce({ data: null, error: 'Network down' })
    await act(async () => { hook.current.sendComposerMessage({ body: 'About your project', mentionUserIds: [] }) })
    const failed = hook.messages.find((message) => message.failed)!

    await act(async () => { hook.current.discardFailedMessage(failed) })

    expect(hook.messages).toEqual([])
    expect(storedFailures()).toEqual([])

    api.createDirectMessage.mockResolvedValueOnce({ data: { message: serverMessage(72, 'next', 'Second try') }, error: null })
    await act(async () => { hook.current.sendComposerMessage({ body: 'Second try', mentionUserIds: [] }) })
    expect(sentPayload(1)).toMatchObject({ body: 'Second try', source_type: 'submission', source_id: 9 })

    // Once a send with the source succeeds, the context has gone out for good.
    api.createDirectMessage.mockResolvedValueOnce({ data: { message: serverMessage(73, 'after', 'Third') }, error: null })
    await act(async () => { hook.current.sendComposerMessage({ body: 'Third', mentionUserIds: [] }) })
    expect(sentPayload(2).source_type).toBeUndefined()
  })

  it('does not send an empty message or one over the limit', async () => {
    const hook = await mountMutations(root)
    await act(async () => {
      expect(hook.current.sendComposerMessage({ body: '', mentionUserIds: [] })).toBe(false)
      expect(hook.current.sendComposerMessage({ body: 'x'.repeat(5_001), mentionUserIds: [] })).toBe(false)
    })
    expect(api.createDirectMessage).not.toHaveBeenCalled()
  })
})
