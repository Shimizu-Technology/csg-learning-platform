export type RealtimeConnectionStatus = 'connected' | 'disconnected' | 'error'

export function isVisiblePage(visibilityState: DocumentVisibilityState): boolean {
  return visibilityState === 'visible'
}

export function shouldPollMessages(
  visibilityState: DocumentVisibilityState,
  realtimeStatus: RealtimeConnectionStatus,
): boolean {
  return isVisiblePage(visibilityState) && realtimeStatus !== 'connected'
}
