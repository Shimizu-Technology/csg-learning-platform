import { useEffect, useState } from 'react'

const ONLINE_WINDOW_MS = 2 * 60 * 1000
const PRESENCE_TICK_MS = 30 * 1000

export function isRecentlyOnline(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false
  return now - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS
}

export function usePresenceNow(): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const intervalId = globalThis.setInterval(() => setNow(Date.now()), PRESENCE_TICK_MS)
    return () => globalThis.clearInterval(intervalId)
  }, [])

  return now
}
