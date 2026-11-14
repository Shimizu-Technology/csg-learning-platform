import { X } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { messageShouldAnimateEntry, shouldCompactMessage } from './helpers';
import { MessageRow } from './MessageRow';
import type { MessagesViewContext } from './messagesPresentation';

export function ThreadPanel({ context }: { context: Pick<MessagesViewContext, 'isStaff' | 'setLightboxAttachments' | 'setLightboxIndex' | 'setReactionDetails' | 'setActiveThreadRootId' | 'editing' | 'setEditing' | 'setEditingInThreadPanel' | 'setAuthorContext' | 'setMobileActionsMessageId' | 'actionsFromThreadPanelRef' | 'setMessagePendingDelete' | 'editBody' | 'setEditBody' | 'highlightedMessageId' | 'threadScrollRef' | 'messageArrivalsRef' | 'selectedLabel' | 'activeThreadRoot' | 'activeThreadMessages' | 'threadReadReceipts' | 'mentionPatterns' | 'renderThreadPaging' | 'renderThreadLatest' | 'beginReadingScroll' | 'handleThreadScroll' | 'retryFailedMessage' | 'discardFailedMessage' | 'restoreFailedMessageText' | 'saveEdit' | 'copyMessage' | 'togglePin' | 'toggleReaction' | 'showThreadPanel' | 'editingThreadRow' | 'selectedConversationKey' | 'forgetEnteredMessage' | 'renderComposer'> }) {
const {
    isStaff,
    setLightboxAttachments,
    setLightboxIndex,
    setReactionDetails,
    setActiveThreadRootId,
    setEditing,
    setEditingInThreadPanel,
    setAuthorContext,
    setMobileActionsMessageId,
    actionsFromThreadPanelRef,
    setMessagePendingDelete,
    editBody,
    setEditBody,
    highlightedMessageId,
    threadScrollRef,
    messageArrivalsRef,
    selectedLabel,
    activeThreadRoot,
    activeThreadMessages,
    threadReadReceipts,
    mentionPatterns,
    renderThreadPaging,
    renderThreadLatest,
    beginReadingScroll,
    handleThreadScroll,
    retryFailedMessage,
    discardFailedMessage,
    restoreFailedMessageText,
    saveEdit,
    copyMessage,
    togglePin,
    toggleReaction,
    showThreadPanel,
    editingThreadRow,
    selectedConversationKey,
    forgetEnteredMessage,
    renderComposer
  } = context
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
                            message={message}
                            readReceipts={threadReadReceipts.get(message.id)}
                            compact={compact}
                            highlighted={highlightedMessageId === message.id}
                            entering={messageShouldAnimateEntry(messageArrivalsRef.current, selectedConversationKey, message.id)}
                            onEntered={() => forgetEnteredMessage(message.id)}
                            editing={editingThreadRow(message.id)}
                            editBody={editBody}
                            onStartEdit={() => {
                              setEditing(message)
                              setEditingInThreadPanel(true)
                              setEditBody(message.body)
                            }}
                            onCancelEdit={() => setEditing(null)}
                            onSaveEdit={(editedBody) => saveEdit(message, editedBody)}
                            onDelete={() => setMessagePendingDelete(message)}
                            onCopy={() => void copyMessage(message)}
                            onRetry={() => void retryFailedMessage(message)}
                            onDiscard={() => discardFailedMessage(message)}
                            onRestore={() => restoreFailedMessageText(message)}
                            onOpenAuthor={() => setAuthorContext(message.author)}
                            onOpenActions={() => { actionsFromThreadPanelRef.current = true; setMobileActionsMessageId(message.id) }}
                            onPin={() => togglePin(message)}
                            canPin={isStaff}
                            inThreadView
                            replyCount={0}
                            onReply={() => setActiveThreadRootId(activeThreadRoot.id)}
                            onReact={(emoji) => toggleReaction(message, emoji)}
                            onInspectReaction={(emoji) => setReactionDetails({ messageId: message.id, emoji })}
                            onOpenImage={(attachment, imageAttachments) => {
                              setLightboxAttachments(imageAttachments)
                              setLightboxIndex(Math.max(0, imageAttachments.findIndex((item) => item.id === attachment.id)))
                            }}
                            mentionPatterns={mentionPatterns}
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
