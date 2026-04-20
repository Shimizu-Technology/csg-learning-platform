import { api } from './api'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

type RealtimeStatus = 'connected' | 'disconnected' | 'error'

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
  const tokenResponse = await api.createCableToken()
  const token = tokenResponse.data?.token
  if (!token) {
    onStatus?.('error')
    return () => {}
  }

  const socket = new WebSocket(cableUrl(token))
  const identifier = JSON.stringify({ channel: 'ChannelMessagesChannel', channel_id: channelId })
  let closing = false

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ command: 'subscribe', identifier }))
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
    if (!closing) onStatus?.('disconnected')
  })

  return () => {
    closing = true
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ command: 'unsubscribe', identifier }))
    }
    socket.close()
  }
}
