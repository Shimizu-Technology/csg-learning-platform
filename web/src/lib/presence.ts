import { useEffect, useState } from 'react'

const ONLINE_WINDOW_MS = 2 * 60 * 1000
const RECENTLY_ACTIVE_WINDOW_MS = 15 * 60 * 1000
const PRESENCE_TICK_MS = 30 * 1000

export type PresenceStatus = 'online' | 'recently-active' | 'offline'

export function isRecentlyOnline(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  return presenceStatus(lastSeenAt, now) === 'online'
}

export function presenceStatus(lastSeenAt: string | null | undefined, now = Date.now()): PresenceStatus {
  if (!lastSeenAt) return 'offline'

  const lastSeenTime = new Date(lastSeenAt).getTime()
  if (Number.isNaN(lastSeenTime)) return 'offline'

  const ageMs = now - lastSeenTime
  if (ageMs < ONLINE_WINDOW_MS) return 'online'
  if (ageMs < RECENTLY_ACTIVE_WINDOW_MS) return 'recently-active'
  return 'offline'
}

export function usePresenceNow(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = globalThis.setInterval(() => setNow(Date.now()), PRESENCE_TICK_MS)
    return () => globalThis.clearInterval(intervalId)
  }, [])

  return now
}
