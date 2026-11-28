import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { shouldCompactMessage } from './helpers';
import { MessageRow } from './MessageRow';
import type { MessagesView } from './messagesPresentation';
import type { ConversationState } from './useConversationState';
import type { ConversationWindow } from './useConversationWindow';

type ThreadPanelProps = {
  conversation: Pick<ConversationState, 'activeThreadRoot' | 'activeThreadMessages' | 'setActiveThreadRootId'>
  feed: Pick<ConversationWindow, 'threadScrollRef' | 'threadReadReceipts' | 'beginReadingScroll' | 'handleThreadScroll'>
  selectedLabel: string
  view: Pick<MessagesView, 'showThreadPanel' | 'editingThreadRow' | 'messageRowProps' | 'renderThreadPaging' | 'renderThreadLatest' | 'renderComposer'>
  isOverlay?: boolean
}

export function ThreadPanel({ conversation, feed, selectedLabel, view, isOverlay = false }: ThreadPanelProps) {
  const { activeThreadRoot, activeThreadMessages, setActiveThreadRootId } = conversation
  const { threadScrollRef, threadReadReceipts, beginReadingScroll, handleThreadScroll } = feed
  const { showThreadPanel, editingThreadRow, messageRowProps, renderThreadPaging, renderThreadLatest, renderComposer } = view
  const asideRef = useRef<HTMLElement | null>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const isOpen = Boolean(showThreadPanel && activeThreadRoot)
  const activeRootId = activeThreadRoot?.id ?? null

  useEffect(() => {
    if (!isOpen || !isOverlay) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    previousFocusRef.current = opener && !asideRef.current?.contains(opener) ? opener : null
    asideRef.current?.focus({ preventScroll: true })
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const otherOverlay = Array.from(document.querySelectorAll('[role="dialog"], [role="alertdialog"], [role="menu"]'))
        .some((node) => node !== asideRef.current && !asideRef.current?.contains(node))
      if (otherOverlay) return
      event.preventDefault()
      setActiveThreadRootId(null)
    }
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('keydown', onEscape)
      const target = previousFocusRef.current
      previousFocusRef.current = null
      if (target && target.isConnected) target.focus({ preventScroll: true })
    }
  }, [isOpen, isOverlay, activeRootId, setActiveThreadRootId])

return (<>{showThreadPanel && activeThreadRoot && (
                  <aside
                    ref={asideRef}
                    role={isOverlay ? 'dialog' : undefined}
                    aria-modal={isOverlay || undefined}
                    aria-label={isOverlay ? `Thread in ${selectedLabel}` : undefined}
                    tabIndex={isOverlay ? -1 : undefined}
                    onKeyDown={(event) => {
                      if (!isOverlay || event.defaultPrevented) return
                      if (event.key === 'Escape') {
                        event.preventDefault()
                        event.stopPropagation()
                        setActiveThreadRootId(null)
                        return
                      }
                      if (event.key === 'Tab') {
                        const focusables = Array.from(
                          event.currentTarget.querySelectorAll<HTMLElement>(
                            'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
                          ),
                        ).filter((el) => el.getClientRects().length > 0 || el.offsetParent !== null)
                        if (focusables.length === 0) {
                          event.preventDefault()
                          event.currentTarget.focus({ preventScroll: true })
                          return
                        }
                        const first = focusables[0]
                        const last = focusables[focusables.length - 1]
                        if (event.shiftKey) {
                          if (document.activeElement === first || document.activeElement === event.currentTarget) {
                            event.preventDefault()
                            last.focus()
                          }
                        } else if (document.activeElement === last) {
                          event.preventDefault()
                          first.focus()
                        }
                      }
                    }}
                    className="hidden min-h-0 min-w-0 overflow-hidden border-l border-line bg-surface-raised focus:outline-none lg:absolute lg:inset-y-0 lg:right-0 lg:z-20 lg:flex lg:w-[min(380px,calc(100%-2rem))] lg:flex-col lg:shadow-overlay xl:static xl:z-auto xl:w-auto xl:bg-surface-sunken/70 xl:shadow-none"
                  >
                    <div className="flex items-start justify-between gap-3 border-b border-line bg-surface-raised px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-ink">Thread</p>
                        <p className="mt-0.5 truncate text-xs tabular-nums text-ink-muted">
                          {activeThreadRoot.reply_count ?? activeThreadMessages.length - 1} {(activeThreadRoot.reply_count ?? activeThreadMessages.length - 1) === 1 ? 'reply' : 'replies'} in {selectedLabel}
                        </p>
                      </div>
                      <IconButton label="Close thread" size="sm" onClick={() => setActiveThreadRootId(null)} className="-my-1 -mr-2">
                        <X className="h-4 w-4" />
                      </IconButton>
                    </div>
                    <div ref={threadScrollRef} onScroll={handleThreadScroll} onWheelCapture={beginReadingScroll} onTouchMoveCapture={beginReadingScroll} onPointerDownCapture={beginReadingScroll} onKeyDownCapture={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) beginReadingScroll() }} className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4">
                      {renderThreadPaging('older')}
                      {activeThreadMessages.map((message, index) => {
                        const previousMessage = activeThreadMessages[index - 1]
                        const compact = shouldCompactMessage(message, previousMessage)

                        return (
                          <MessageRow
                            key={message.id}
                            {...messageRowProps(message, true)}
                            readReceipts={threadReadReceipts.get(message.id)}
                            compact={compact}
                            editing={editingThreadRow(message.id)}
                            inThreadView
                            replyCount={0}
                            onReply={() => setActiveThreadRootId(activeThreadRoot.id)}
                          />
                        )
                      })}
                      {renderThreadPaging('newer')}
                      {renderThreadLatest()}
                    </div>
                    {renderComposer('thread')}
                  </aside>
                )}</>)
}
