import { api } from './api'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

type RealtimeStatus = 'connected' | 'disconnected' | 'error'
type Unsubscribe = () => void

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
      socket?.send(JSON.stringify({ command: 'subscribe', identifier }))
    })

    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data)
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

  const unsubscribe: Unsubscribe = () => {
    closing = true
    clearReconnect()
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ command: 'unsubscribe', identifier }))
    }
    socket?.close()
  }

  return unsubscribe
}
