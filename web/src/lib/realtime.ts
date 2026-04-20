import { getCurrentAuthToken } from './api'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

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
) {
  const token = await getCurrentAuthToken()
  if (!token) return () => {}

  const socket = new WebSocket(cableUrl(token))
  const identifier = JSON.stringify({ channel: 'ChannelMessagesChannel', channel_id: channelId })

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({ command: 'subscribe', identifier }))
  })

  socket.addEventListener('message', (event) => {
    const payload = JSON.parse(event.data)
    if (!payload.message) return

    onMessage(payload.message)
  })

  return () => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ command: 'unsubscribe', identifier }))
    }
    socket.close()
  }
}
