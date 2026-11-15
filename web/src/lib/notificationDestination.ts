import { toWebPath } from './recordDestination'
import { safeInternalReturnPath } from './routes'
import type { NotificationEntry } from '../types/api'

/** Keep producer-supplied context/anchors and reject external or malformed destinations. */
export function notificationDestination(item: NotificationEntry) {
  if (item.target_available === false) return null
  const canonical = toWebPath(item.destination)
  if (canonical) return canonical
  const supplied = item.destination_path ?? item.path
  if ([...supplied].some((char) => char.charCodeAt(0) <= 32)) return null
  const path = safeInternalReturnPath(supplied, '')
  if (!path || [...path].some((char) => char.charCodeAt(0) <= 32)) return null
  const url = new URL(path, 'https://csg.invalid')
  if (item.notifiable.type === 'Message' && !url.searchParams.has('message_id') && !url.searchParams.has('messageId') && !url.hash) {
    url.searchParams.set('message_id', String(item.notifiable.id))
  }
  return `${url.pathname}${url.search}${url.hash}`
}
