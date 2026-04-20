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
  let closing = false
  let reconnectAttempts = 0
  let socket: WebSocket | null = null
  let reconnectTimer: number | null = null

  const clearReconnect = () => {
    if (reconnectTimer) window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  const connect = async () => {
    const tokenResponse = await api.createCableToken()
    const token = tokenResponse.data?.token
    if (!token || closing) {
      onStatus?.('error')
      return
    }

    socket = new WebSocket(cableUrl(token))

    socket.addEventListener('open', () => {
      reconnectAttempts = 0
      socket?.send(JSON.stringify({ command: 'subscribe', identifier }))
      onStatus?.('connected')
    })

    socket.addEventListener('message', (event) => {
      const payload = JSON.parse(event.data)
      if (!payload.message) return

      onMessage(payload.message)
    })

    socket.addEventListener('error', () => {
      onStatus?.('error')
    })

    socket.addEventListener('close', () => {
      if (closing) return

      onStatus?.('disconnected')
      const delay = RECONNECT_DELAYS[Math.min(reconnectAttempts, RECONNECT_DELAYS.length - 1)]
      reconnectAttempts += 1
      reconnectTimer = window.setTimeout(() => {
        connect().catch(() => onStatus?.('error'))
      }, delay)
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
