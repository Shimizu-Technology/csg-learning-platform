import { requestUnreadRefresh } from './unread'

type ConversationType = 'channel' | 'dm'

/** Only a Cable update applied after a request began can override its snapshot. */
export class ConversationSummaryFreshness {
  private counter = 0
  private realtimeVersions = new Map<string, number>()

  startRequest() { return this.counter }

  recordRealtime(type: ConversationType, id: number) {
    this.realtimeVersions.set(`${type}:${id}`, ++this.counter)
  }

  reconcile<T extends { id: number }>(type: ConversationType, current: T | undefined, incoming: T, started: number): T {
    return current && (this.realtimeVersions.get(`${type}:${incoming.id}`) || 0) > started ? current : incoming
  }

  reconcileList<T extends { id: number }>(type: ConversationType, current: T[], incoming: T[], started: number): T[] {
    const previous = new Map(current.map((item) => [item.id, item]))
    const ids = new Set(incoming.map((item) => item.id))
    return [
      ...incoming.map((item) => this.reconcile(type, previous.get(item.id), item, started)),
      // A conversation first seen on Cable must also survive an older list response.
      ...current.filter((item) => !ids.has(item.id) && (this.realtimeVersions.get(`${type}:${item.id}`) || 0) > started),
    ]
  }

  completeRequest(started: number) {
    if (this.counter > started) requestUnreadRefresh()
  }
}
