// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './api'
import { isMessageTypingEvent, subscribeToStaffPresence, subscribeToUserMessages } from './realtime'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.OPEN
  sent: string[] = []
  listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  url: string

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  addEventListener(type: string, callback: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), callback])
  }

  send(value: string) {
    this.sent.push(value)
  }

  close() {
    this.readyState = 3
  }

  emit(type: string, event = {} as MessageEvent) {
    this.listeners.get(type)?.forEach((callback) => callback(event))
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  FakeWebSocket.instances = []
})

describe('message realtime subscription', () => {
  it('performs a typing action over the subscribed Action Cable socket', async () => {
    vi.spyOn(api, 'createCableToken').mockResolvedValue({ data: { token: 'test-token', expires_in: 300 }, error: null })
    vi.stubGlobal('WebSocket', FakeWebSocket)

    const subscription = await subscribeToUserMessages(() => undefined)
    const socket = FakeWebSocket.instances[0]
    socket.emit('open')

    expect(subscription.perform('typing', { target_type: 'channel', target_id: 4, active: true })).toBe(true)
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
      { command: 'subscribe', identifier: JSON.stringify({ channel: 'UserMessagesChannel' }) },
      {
        command: 'message',
        identifier: JSON.stringify({ channel: 'UserMessagesChannel' }),
        data: JSON.stringify({ action: 'typing', target_type: 'channel', target_id: 4, active: true }),
      },
    ])

    subscription()
    expect(subscription.perform('typing', { target_type: 'channel', target_id: 4, active: false })).toBe(false)
  })

  it('accepts only complete typing payloads', () => {
    expect(isMessageTypingEvent({
      event: 'typing', channel_id: 4, direct_conversation_id: null, thread_root_id: null, active: true,
      user: { id: 2, full_name: 'Ada', avatar_url: null },
    })).toBe(true)
    expect(isMessageTypingEvent({ event: 'typing', active: true, user: { id: 2 } })).toBe(false)
    expect(isMessageTypingEvent({
      event: 'typing', channel_id: 4, direct_conversation_id: null, thread_root_id: null, active: true,
      user: { id: 2, full_name: 'Ada' },
    })).toBe(false)
    expect(isMessageTypingEvent({
      event: 'typing', channel_id: 4, direct_conversation_id: null, thread_root_id: null, active: true,
      user: { id: 2, full_name: 'Ada', avatar_url: 4 },
    })).toBe(false)
    expect(isMessageTypingEvent({ event: 'created' })).toBe(false)
  })
})

describe('staff presence subscription', () => {
  it('keeps the PresenceChannel identifier and passes the unchanged payload through', async () => {
    vi.spyOn(api, 'createCableToken').mockResolvedValue({ data: { token: 'test-token', expires_in: 300 }, error: null })
    vi.stubGlobal('WebSocket', FakeWebSocket)
    const received: unknown[] = []

    await subscribeToStaffPresence((event) => received.push(event))
    const socket = FakeWebSocket.instances[0]
    socket.emit('open')
    const identifier = JSON.stringify({ channel: 'PresenceChannel' })
    expect(socket.sent.map((value) => JSON.parse(value))).toEqual([{ command: 'subscribe', identifier }])

    const event = { event: 'presence.updated', user_id: 5, last_seen_at: '2026-11-15T09:30:00.000Z' }
    socket.emit('message', { data: JSON.stringify({ identifier, message: event }) } as MessageEvent)
    socket.emit('message', { data: JSON.stringify({ identifier, message: { event: 'presence.updated', user_id: 'x' } }) } as MessageEvent)

    expect(received).toEqual([event])
  })
})
