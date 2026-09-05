import { api } from './api'
import type { MessageTypingEvent } from '../types/api'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

type RealtimeStatus = 'connected' | 'disconnected' | 'error'
export type RealtimeSubscription = (() => void) & {
  perform: (action: string, data?: Record<string, unknown>) => boolean
}

export type PresenceUpdateEvent = {
  event: 'presence.updated'
  user_id: number
  last_seen_at: string
}

export function isMessageTypingEvent(payload: unknown): payload is MessageTypingEvent {
  if (!payload || typeof payload !== 'object') return false
  const event = payload as Partial<MessageTypingEvent>

  return event.event === 'typing'
    && (typeof event.channel_id === 'number' || event.channel_id === null)
    && (typeof event.direct_conversation_id === 'number' || event.direct_conversation_id === null)
    && (typeof event.thread_root_id === 'number' || event.thread_root_id === null)
    && typeof event.active === 'boolean'
    && typeof event.user?.id === 'number'
    && typeof event.user.full_name === 'string'
    && (typeof event.user.avatar_url === 'string' || event.user.avatar_url === null)
}

const RECONNECT_DELAYS = [1000, 2500, 5000, 10000]

function cableUrl(token: string) {
  const base = API_BASE_URL || window.location.origin
  const url = new URL('/cable', base)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.searchParams.set('token', token)
  return url.toString()
}

export async function subscribeToChannelMessages(
  channelId: number,
  onMessage: (payload: unknown) => void,
  onStatus?: (status: RealtimeStatus) => void,
) {
  const identifier = JSON.stringify({ channel: 'ChannelMessagesChannel', channel_id: channelId })
  return subscribe(identifier, onMessage, onStatus)
}

export async function subscribeToDirectMessages(
  directConversationId: number,
  onMessage: (payload: unknown) => void,
  onStatus?: (status: RealtimeStatus) => void,
) {
  const identifier = JSON.stringify({ channel: 'DirectMessagesChannel', direct_conversation_id: directConversationId })
  return subscribe(identifier, onMessage, onStatus)
}

export async function subscribeToUserMessages(
  onMessage: (payload: unknown) => void,
  onStatus?: (status: RealtimeStatus) => void,
) {
  const identifier = JSON.stringify({ channel: 'UserMessagesChannel' })
  return subscribe(identifier, onMessage, onStatus)
}

export async function subscribeToStaffPresence(
  onMessage: (payload: PresenceUpdateEvent) => void,
  onStatus?: (status: RealtimeStatus) => void,
) {
  const identifier = JSON.stringify({ channel: 'PresenceChannel' })
  return subscribe(identifier, (payload) => {
    if (isPresenceUpdateEvent(payload)) onMessage(payload)
  }, onStatus)
}

function isPresenceUpdateEvent(payload: unknown): payload is PresenceUpdateEvent {
  if (!payload || typeof payload !== 'object') return false

  const event = payload as Partial<PresenceUpdateEvent>
  return event.event === 'presence.updated' &&
    typeof event.user_id === 'number' &&
    typeof event.last_seen_at === 'string'
}

async function subscribe(
  identifier: string,
  onMessage: (payload: unknown) => void,
  onStatus?: (status: RealtimeStatus) => void,
) {
  let closing = false
  let reconnectAttempts = 0
  let socket: WebSocket | null = null
  let reconnectTimer: number | null = null

  const clearReconnect = () => {
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const scheduleReconnect = () => {
    if (closing || reconnectTimer) return

    const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)]
    reconnectAttempts += 1
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null
      connect().catch(() => {
        onStatus?.('error')
        scheduleReconnect()
      })
    }, delay)
  }

  const connect = async () => {
    const tokenResponse = await api.createCableToken()
    const token = tokenResponse.data?.token
    if (!token || closing) {
      onStatus?.('error')
      scheduleReconnect()
      return
    }

    socket = new WebSocket(cableUrl(token))

    socket.addEventListener('open', () => {
      if (closing) {
        socket?.close()
        return
      }
      socket?.send(JSON.stringify({ command: 'subscribe', identifier }))
    })

    socket.addEventListener('message', (event) => {
      let payload: { type?: string; identifier?: string; message?: unknown }
      try {
        payload = JSON.parse(event.data) as typeof payload
      } catch {
        return
      }
      if (payload.type === 'confirm_subscription' && payload.identifier === identifier) {
        reconnectAttempts = 0
        onStatus?.('connected')
        return
      }
      if (payload.type === 'reject_subscription' && payload.identifier === identifier) {
        onStatus?.('error')
        return
      }
      if (!payload.message) return

      onMessage(payload.message)
    })

    socket.addEventListener('error', () => {
      onStatus?.('error')
    })

    socket.addEventListener('close', () => {
      if (closing) return

      onStatus?.('disconnected')
      scheduleReconnect()
    })
  }

  await connect()

  const unsubscribe = (() => {
    closing = true
    clearReconnect()
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ command: 'unsubscribe', identifier }))
      socket.close()
      return
    }
    socket?.close()
  }) as RealtimeSubscription
  unsubscribe.perform = (action, data = {}) => {
    if (closing || socket?.readyState !== WebSocket.OPEN) return false
    socket.send(JSON.stringify({
      command: 'message',
      identifier,
      data: JSON.stringify({ action, ...data }),
    }))
    return true
  }

  return unsubscribe
}
