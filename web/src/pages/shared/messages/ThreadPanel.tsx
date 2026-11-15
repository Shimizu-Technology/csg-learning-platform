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
}

export function ThreadPanel({ conversation, feed, selectedLabel, view }: ThreadPanelProps) {
  const { activeThreadRoot, activeThreadMessages, setActiveThreadRootId } = conversation
  const { threadScrollRef, threadReadReceipts, beginReadingScroll, handleThreadScroll } = feed
  const { showThreadPanel, editingThreadRow, messageRowProps, renderThreadPaging, renderThreadLatest, renderComposer } = view
return (<>{showThreadPanel && activeThreadRoot && (
                  <aside className="hidden min-h-0 border-l border-slate-200 bg-slate-50/70 lg:flex lg:flex-col">
                    <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Thread</p>
                        <p className="mt-0.5 truncate text-xs tabular-nums text-slate-500">
                          {activeThreadRoot.reply_count ?? activeThreadMessages.length - 1} {(activeThreadRoot.reply_count ?? activeThreadMessages.length - 1) === 1 ? 'reply' : 'replies'} in {selectedLabel}
                        </p>
                      </div>
                      <IconButton label="Close thread" size="sm" onClick={() => setActiveThreadRootId(null)} className="-my-1 -mr-2">
                        <X className="h-4 w-4" />
                      </IconButton>
                    </div>
                    <div ref={threadScrollRef} onScroll={handleThreadScroll} onWheelCapture={beginReadingScroll} onTouchMoveCapture={beginReadingScroll} onPointerDownCapture={beginReadingScroll} onKeyDownCapture={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) beginReadingScroll() }} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
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
