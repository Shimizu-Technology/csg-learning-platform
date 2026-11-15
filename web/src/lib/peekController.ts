/**
 * Timing for peek cards (L-0.5, design spec §4.5 and §6): one card at a time.
 *
 * - Hovering or keyboard-focusing a record link opens its card after 300ms.
 * - Moving from the link into the card keeps it open; leaving either closes it
 *   after 150ms.
 * - While a card is open, the next link opens its card immediately.
 * - Escape closes it at once.
 *
 * The controller only tracks which trigger is open; triggers own their data.
 */
export const PEEK_OPEN_DELAY_MS = 300
export const PEEK_CLOSE_DELAY_MS = 150

export type PeekSource = 'pointer' | 'focus'

export interface PeekSnapshot {
  /** The trigger whose card is showing. */
  openKey: string | null
  source: PeekSource | null
}

type Timer = ReturnType<typeof setTimeout>

export class PeekController {
  private snapshot: PeekSnapshot = { openKey: null, source: null }
  private listeners = new Set<() => void>()
  private openTimer: Timer | null = null
  private pendingKey: string | null = null
  private closeTimer: Timer | null = null
  /** A trigger whose card was just dismissed: its focus doesn't reopen it until focus leaves. */
  private suppressedKey: string | null = null
  private readonly openDelay: number
  private readonly closeDelay: number

  constructor({ openDelay = PEEK_OPEN_DELAY_MS, closeDelay = PEEK_CLOSE_DELAY_MS } = {}) {
    this.openDelay = openDelay
    this.closeDelay = closeDelay
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.snapshot

  /** Pointer or focus arrived on a trigger. */
  enter(key: string, source: PeekSource) {
    if (source === 'focus' && this.suppressedKey === key) return
    if (this.snapshot.openKey === key) {
      this.cancelClose()
      return
    }
    if (this.snapshot.openKey) {
      // One is already open: switch straight to this one.
      this.clearOpenTimer()
      this.show(key, source)
      return
    }
    if (this.pendingKey === key) return
    this.clearOpenTimer()
    this.pendingKey = key
    this.openTimer = setTimeout(() => {
      this.openTimer = null
      this.pendingKey = null
      this.show(key, source)
    }, this.openDelay)
  }

  /** Pointer or focus left a trigger (and didn't go into its card). */
  leave(key: string, source?: PeekSource) {
    if (source === 'focus' && this.suppressedKey === key) this.suppressedKey = null
    if (this.pendingKey === key) this.clearOpenTimer()
    if (this.snapshot.openKey === key) this.scheduleClose()
  }

  /** The pointer or focus is in the open card. */
  enterCard() {
    this.cancelClose()
  }

  leaveCard() {
    if (this.snapshot.openKey) this.scheduleClose()
  }

  /** A click navigates: drop any pending open for this trigger. */
  cancel(key: string) {
    if (this.pendingKey === key) this.clearOpenTimer()
  }

  /** Close at once (Escape, navigation, scroll). `suppressFocus` keeps the trigger's focus from reopening it. */
  close(options: { suppressFocus?: boolean } = {}) {
    const key = this.snapshot.openKey ?? this.pendingKey
    this.clearOpenTimer()
    this.cancelClose()
    if (options.suppressFocus && key) this.suppressedKey = key
    if (this.snapshot.openKey) this.set({ openKey: null, source: null })
  }

  isPending(key: string) {
    return this.pendingKey === key
  }

  private show(key: string, source: PeekSource) {
    this.cancelClose()
    this.set({ openKey: key, source })
  }

  private scheduleClose() {
    this.cancelClose()
    this.closeTimer = setTimeout(() => {
      this.closeTimer = null
      this.set({ openKey: null, source: null })
    }, this.closeDelay)
  }

  private cancelClose() {
    if (this.closeTimer) clearTimeout(this.closeTimer)
    this.closeTimer = null
  }

  private clearOpenTimer() {
    if (this.openTimer) clearTimeout(this.openTimer)
    this.openTimer = null
    this.pendingKey = null
  }

  private set(next: PeekSnapshot) {
    if (next.openKey === this.snapshot.openKey && next.source === this.snapshot.source) return
    this.snapshot = next
    this.listeners.forEach((listener) => listener())
  }
}

/** The page's one controller: only one peek card is ever open. */
export const peekController = new PeekController()
