import { ChevronDown, ChevronLeft, Pin, RefreshCw } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { useMediaQuery } from '../../../lib/useMediaQuery';
import { formatDayDivider, rootMessageIdFor, sameDay, shouldCompactMessage } from './helpers';
import { MessageRow } from './MessageRow';
import { MessageSourceLine } from './MessageSourceLine';
import type { MessagesView } from './messagesPresentation';
import { ThreadPanel } from './ThreadPanel';
import type { Target } from './types';
import type { ConversationState } from './useConversationState';
import type { ConversationWindow } from './useConversationWindow';

type ConversationFeedProps = {
  selectedTarget: Target
  selectedLabel: string
  isStaff: boolean
  isNavigationPending: boolean
  conversation: Pick<ConversationState, 'conversationView' | 'setConversationView' | 'activeThreadRoot' | 'activeThreadMessages' | 'setActiveThreadRootId' | 'isDesktop' | 'setMobilePane' | 'messagesById' | 'threadReplies' | 'unreadBoundaryId'>
  feed: ConversationWindow
  view: MessagesView
}

/** The open conversation's scrolling feed (or pins, or a phone's thread), paging, jump-to-latest and the desktop thread pane. */
export function ConversationFeed({ selectedTarget, selectedLabel, isStaff, isNavigationPending, conversation, feed, view }: ConversationFeedProps) {
  const { conversationView, setConversationView, activeThreadRoot, activeThreadMessages, setActiveThreadRootId, isDesktop, setMobilePane, messagesById, threadReplies, unreadBoundaryId } = conversation
  const { messageScrollRef, messageWindowMeta, loadingOlder, loadingNewer, loadingTarget, hasUnreadBelow, showScrollToLatest, queuedConversationCount, rootReadReceipts, threadReadReceipts, loadOlderMessages, loadNewerMessages, replyToMessage, scrollToLatestMessage, beginReadingScroll, handleConversationScroll } = feed
  const { showThreadPanel, displayedMessages, editingFeedRow, messageRowProps, renderThreadPaging, renderThreadLatest } = view
  const isWideDesktop = useMediaQuery('(min-width: 1280px)')
  const feedIsThreadView = Boolean(activeThreadRoot && !showThreadPanel)
  const threadOverlaysFeed = Boolean(showThreadPanel && activeThreadRoot && !isWideDesktop)

  return (
    <div className={`relative min-w-0 min-h-0 flex-1 overflow-hidden ${showThreadPanel ? 'flex xl:grid xl:grid-cols-[minmax(0,1fr)_380px]' : 'flex'}`}>
      <div
        aria-hidden={threadOverlaysFeed || undefined}
        inert={threadOverlaysFeed}
        className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      >
        <div
          ref={messageScrollRef}
          onWheelCapture={beginReadingScroll}
          onTouchMoveCapture={beginReadingScroll}
          onPointerDownCapture={beginReadingScroll}
          onKeyDownCapture={(event) => { if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) beginReadingScroll() }}
          onScroll={handleConversationScroll}
          className={`min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2 transition-opacity duration-200 sm:px-5 sm:py-5 ${showScrollToLatest && conversationView === 'messages' && !(activeThreadRoot && !isDesktop) ? 'pb-16 sm:pb-16' : ''} ${loadingTarget || isNavigationPending ? 'opacity-60' : 'opacity-100'}`}
        >
        {activeThreadRoot && !showThreadPanel && (
          <div className="mb-4 rounded-lg border border-line bg-surface-sunken px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-ink-muted">Thread</p>
                <p className="mt-1 text-sm tabular-nums text-ink-secondary">
                  {activeThreadRoot.reply_count ?? activeThreadMessages.length - 1} {(activeThreadRoot.reply_count ?? activeThreadMessages.length - 1) === 1 ? 'reply' : 'replies'} under this message
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setActiveThreadRootId(null)
                  if (!isDesktop) setMobilePane('conversation')
                }}
                className="shrink-0"
              >
                <ChevronLeft className="h-4 w-4" />
                {selectedTarget.type === 'channel' ? 'Back to group chat' : 'Back to conversation'}
              </Button>
            </div>
          </div>
        )}
        {activeThreadRoot && !isDesktop && renderThreadPaging('older')}
        {!feedIsThreadView && conversationView === 'pins' && (
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface-sunken px-4 py-2 text-sm text-ink-secondary"><Pin className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1">Pinned messages stay easy to find here.</span>
            <Button variant="quiet" size="sm" onClick={() => setConversationView('messages')} className="-my-1 -mr-2"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Back to conversation</Button>
          </div>
        )}
        {!feedIsThreadView && conversationView === 'messages' && messageWindowMeta?.has_older && (
          <div className="flex justify-center pb-3">
            <Button
              variant="secondary"
              onClick={() => void loadOlderMessages()}
              disabled={loadingOlder}
            >
              <RefreshCw className={`h-4 w-4 ${loadingOlder ? 'animate-spin' : ''}`} />
              {loadingOlder ? 'Loading earlier messages…' : 'Load earlier messages'}
            </Button>
          </div>
        )}
        {displayedMessages.length === 0 ? (
          <div className="flex min-h-full items-center justify-center py-16 text-center text-sm text-ink-muted">
            {feedIsThreadView
              ? 'No replies yet. Start the thread.'
              : conversationView === 'pins'
                ? 'No pinned messages yet.'
                : 'No messages yet. Start the conversation.'}
          </div>
        ) : displayedMessages.map((message, index) => {
          const previousMessage = displayedMessages[index - 1]
          const rootId = rootMessageIdFor(message, messagesById)
          const loadedReplies = threadReplies.get(rootId) || []
          const replyCount = Math.max(message.reply_count ?? 0, loadedReplies.length)
          const compact = shouldCompactMessage(message, previousMessage)
          const showDayDivider = !previousMessage || !sameDay(previousMessage.created_at, message.created_at)

          return (
            <div key={message.id}>
              {!feedIsThreadView && conversationView === 'messages' && unreadBoundaryId === message.id && (
                <div data-unread-divider className="my-4 flex items-center gap-3 px-2" role="separator" aria-label="Unread messages">
                  <div className="h-px flex-1 bg-primary-soft-line" />
                  <span className="text-xs font-semibold text-primary-ink">New messages</span>
                  <div className="h-px flex-1 bg-primary-soft-line" />
                </div>
              )}
              {showDayDivider && (
                <div className="relative my-5 flex items-center justify-center">
                  <div className="absolute inset-x-0 top-1/2 border-t border-line" />
                  <span className="relative rounded-full border border-line bg-surface-raised px-3 py-1 text-xs font-semibold tabular-nums text-ink-muted">
                    {formatDayDivider(message.created_at)}
                  </span>
                </div>
              )}
              {message.source && !message.parent_message_id && <MessageSourceLine source={message.source} staff={isStaff} />}
              <MessageRow
                {...messageRowProps(message, false)}
                readReceipts={conversationView === 'pins' && !feedIsThreadView ? undefined : feedIsThreadView ? threadReadReceipts.get(message.id) : rootReadReceipts.get(message.id)}
                compact={compact}
                editing={editingFeedRow(message.id)}
                inThreadView={feedIsThreadView}
                replyCount={!feedIsThreadView && !message.parent_message_id ? replyCount : 0}
                threadRepliesList={!feedIsThreadView && !message.parent_message_id ? loadedReplies : undefined}
                latestReplyAt={!feedIsThreadView && !message.parent_message_id && !(activeThreadRoot?.id === rootId && feed.threadWindowMeta?.has_newer) ? loadedReplies.at(-1)?.created_at : undefined}
                onReply={() => replyToMessage(message)}
              />
            </div>
          )
        })}
        {!feedIsThreadView && conversationView === 'messages' && messageWindowMeta?.has_newer && (
          <div className="flex justify-center py-3">
            <Button variant="secondary" onClick={() => void loadNewerMessages()} disabled={loadingNewer}>
              <RefreshCw className={`h-4 w-4 ${loadingNewer ? 'animate-spin' : ''}`} />
              {loadingNewer ? 'Loading newer messages…' : 'Load newer messages'}
            </Button>
          </div>
        )}
        {activeThreadRoot && !isDesktop && renderThreadPaging('newer')}
        </div>
        {activeThreadRoot && !isDesktop && renderThreadLatest()}
        {showScrollToLatest && conversationView === 'messages' && (
          <div data-jump-latest="" className={`flex shrink-0 justify-center py-2 ${activeThreadRoot && !isDesktop ? '' : 'absolute bottom-3 right-3 z-20 rounded-xl py-0 shadow-overlay sm:right-5'}`}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void scrollToLatestMessage()}
              aria-label={hasUnreadBelow ? 'Jump to new messages' : 'Jump to latest message'}
            >
              <ChevronDown className="h-4 w-4" />
              {queuedConversationCount ? `New messages (${queuedConversationCount})` : hasUnreadBelow ? 'New messages' : 'Jump to latest'}
            </Button>
          </div>
        )}
      </div>
      {threadOverlaysFeed && (
        <div
          aria-hidden="true"
          onClick={() => setActiveThreadRootId(null)}
          className="absolute inset-0 z-10 bg-scrim/25 xl:hidden"
        />
      )}
      <ThreadPanel conversation={conversation} feed={feed} selectedLabel={selectedLabel} view={view} isOverlay={threadOverlaysFeed} />
      {(loadingTarget || isNavigationPending) && (
        <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-surface-raised/20 px-4 py-6">
          <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-ink-secondary shadow-raised">
            <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            Switching conversation…
          </div>
        </div>
      )}
    </div>
  )
}
