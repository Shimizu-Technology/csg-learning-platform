import type { NotificationEntry } from '../types/api'

/** Keep producer-supplied context/anchors and reject external or malformed destinations. */
export function notificationDestination(item: NotificationEntry) {
  const path = item.destination_path ?? item.path
  if (item.target_available === false || !path.startsWith('/') || path.startsWith('//') || path.includes('\\') || [...path].some((char) => char.charCodeAt(0) <= 32)) return null
  const url = new URL(path, 'https://csg.invalid')
  if (item.notifiable.type === 'Message' && !url.searchParams.has('message_id') && !url.searchParams.has('messageId') && !url.hash) {
    url.searchParams.set('message_id', String(item.notifiable.id))
  }
  return `${url.pathname}${url.search}${url.hash}`
}
