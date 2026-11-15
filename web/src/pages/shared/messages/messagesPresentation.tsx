import { File, X } from 'lucide-react';
import { Button, IconButton } from '../../../components/ui/Button';
import { formatFileSize } from '../../../lib/uploadToS3';
import { forgetMessageArrival, messageShouldAnimateEntry, preview } from './helpers';
import { MessageComposer } from './MessageComposer';
import type { LocalMessage } from './types';
import type { MessagesController } from './useMessagesController';

/** View-only derivations, shared message-row wiring and composer placement; no additional state. */
export function messagesPresentation({ conversation, directory, feed, realtime, mutations, attachments, overlays, lightbox, alerts }: MessagesController) {
  const {
    selectedTarget,
    selectedConversationKey,
    sidebarCollapsed,
    conversationView,
    setActiveThreadRootId,
    isDesktop,
    mobilePane,
    editing,
    setEditing,
    editingInThreadPanel,
    setEditingInThreadPanel,
    editBody,
    setEditBody,
    rootMessages,
    activeThreadRoot,
    activeThreadMessages,
    selectedPinnedMessages,
  } = conversation
  const { threadWindowMeta, loadingThreadPage, queuedThreadCount, loadThreadPage } = feed
  const { pendingAttachments } = attachments

  const showListPane = isDesktop || mobilePane === 'list'
  const showConversationPane = isDesktop || mobilePane === 'conversation' || mobilePane === 'thread'
  const showCollapsedRail = isDesktop && sidebarCollapsed
  const showThreadPanel = Boolean(isDesktop && activeThreadRoot)
  const conversationMessages = activeThreadRoot && !showThreadPanel ? activeThreadMessages : rootMessages
  const showComposer = Boolean(selectedTarget) && (conversationView === 'messages' || Boolean(activeThreadRoot))
  const showConversationHeaderPushMessage = Boolean(alerts.pushMessage) && Boolean(selectedTarget)
  const displayedMessages = conversationView === 'pins' && !activeThreadRoot ? selectedPinnedMessages : conversationMessages
  // The thread root shows in both the feed and the desktop thread panel: only the row where
  // editing started gets the edit surface (each surface has its own editor).
  const editingInFeed = Boolean(editing && displayedMessages.some((message) => message.id === editing.id))
  const editingInThread = Boolean(showThreadPanel && editing && activeThreadMessages.some((message) => message.id === editing.id))
  const editingFeedRow = (id: number) => editing?.id === id && (!editingInThread || !editingInThreadPanel)
  const editingThreadRow = (id: number) => editing?.id === id && (editingInThreadPanel || !editingInFeed)
  const forgetEnteredMessage = (messageId: number) => {
    feed.messageArrivalsRef.current = forgetMessageArrival(feed.messageArrivalsRef.current, messageId)
  }

  /** The `MessageRow` props a message gets the same way in the feed and the desktop thread panel. */
  const messageRowProps = (message: LocalMessage, inThreadPanel: boolean) => ({
    message,
    highlighted: feed.highlightedMessageId === message.id,
    entering: messageShouldAnimateEntry(feed.messageArrivalsRef.current, selectedConversationKey, message.id),
    onEntered: () => forgetEnteredMessage(message.id),
    editBody,
    onStartEdit: () => {
      setEditing(message)
      setEditingInThreadPanel(inThreadPanel)
      setEditBody(message.body)
    },
    onCancelEdit: () => setEditing(null),
    onSaveEdit: (editedBody: string) => mutations.saveEdit(message, editedBody),
    onDelete: () => overlays.setMessagePendingDelete(message),
    onCopy: () => void mutations.copyMessage(message),
    onCopyLink: () => void mutations.copyMessageLink(message),
    onRetry: () => void mutations.retryFailedMessage(message),
    onDiscard: () => mutations.discardFailedMessage(message),
    onRestore: () => mutations.restoreFailedMessageText(message),
    onOpenAuthor: () => overlays.setAuthorContext(message.author),
    onOpenActions: () => { overlays.actionsFromThreadPanelRef.current = inThreadPanel; overlays.setMobileActionsMessageId(message.id) },
    onPin: () => mutations.togglePin(message),
    canPin: directory.isStaff,
    onReact: (emoji: string) => mutations.toggleReaction(message, emoji),
    onInspectReaction: (emoji: string) => overlays.setReactionDetails({ messageId: message.id, emoji }),
    onOpenImage: lightbox.openLightbox,
    mentionPatterns: directory.mentionPatterns,
  })

  const renderThreadPaging = (direction: 'older' | 'newer') => threadWindowMeta?.[direction === 'older' ? 'has_older' : 'has_newer'] ? <div className="flex justify-center py-3"><Button variant="secondary" disabled={loadingThreadPage} onClick={() => void loadThreadPage(direction)}>Load {direction === 'older' ? 'earlier' : 'newer'} replies</Button></div> : null

  const renderThreadLatest = () => threadWindowMeta?.has_newer || queuedThreadCount ? <div className="flex justify-center py-3"><Button variant="secondary" disabled={loadingThreadPage} onClick={() => void loadThreadPage('latest')}>{queuedThreadCount ? `New replies (${queuedThreadCount})` : 'Jump to latest reply'}</Button></div> : null

  const renderComposer = (placement: 'main' | 'thread') => {
    const inThreadPanel = placement === 'thread'

    return (
      <div
        className={`${inThreadPanel ? 'shrink-0 border-t border-slate-200 bg-white p-3' : 'shrink-0 border-t border-slate-200 bg-white px-2.5 pb-[calc(var(--composer-safe-bottom,env(safe-area-inset-bottom,0px))+0.625rem)] pt-2.5 sm:px-4 sm:pb-[calc(var(--composer-safe-bottom,env(safe-area-inset-bottom,0px))+0.75rem)] sm:pt-3'}`}
      >
        {realtime.typingLabel && (
          <div className="mb-1.5 flex min-h-5 items-center gap-2 px-2 text-xs font-semibold text-slate-500" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-0.5" aria-hidden="true">
              <span className="h-1 w-1 rounded-full bg-slate-400" />
              <span className="h-1 w-1 rounded-full bg-slate-400" />
              <span className="h-1 w-1 rounded-full bg-slate-400" />
            </span>
            {realtime.typingLabel}
          </div>
        )}
        {mutations.error && (
          <div className="mb-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
            {mutations.error}
          </div>
        )}
        {activeThreadRoot && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
            <span className="min-w-0 truncate">
              {inThreadPanel ? 'Replying in thread' : `Replying in thread to ${activeThreadRoot.author.full_name}: ${preview(activeThreadRoot.body)}`}
            </span>
            <IconButton label="Close thread reply" size="sm" onClick={() => setActiveThreadRootId(null)} className="-my-1.5 -mr-2">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {pendingAttachments.map((attachment) => (
              <div key={`${attachment.filename}-${attachment.byte_size}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <File className="h-4 w-4 shrink-0" />
                <span className="truncate">{attachment.filename}</span>
                <span className="shrink-0 tabular-nums">{attachment.progress > 0 ? `${attachment.progress}%` : formatFileSize(attachment.byte_size)}</span>
                <IconButton
                  label={`Remove ${attachment.filename}`}
                  size="sm"
                  onClick={() => attachments.removePendingAttachment(attachment.file)}
                  className="-my-2 -mr-2"
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        <div onDragOver={(event) => event.preventDefault()} onDrop={attachments.handleDrop}>
          <MessageComposer
            key={placement}
            ref={mutations.composerRef}
            draftKey={attachments.composerDraftKey}
            label={inThreadPanel || activeThreadRoot ? 'Reply in thread' : `Message ${directory.selectedLabel}`}
            placeholder={inThreadPanel || activeThreadRoot ? 'Reply in thread' : 'Write a message'}
            mentionableUsers={directory.mentionableUsers}
            mentionPatterns={directory.mentionPatterns}
            includeChannelMentions={selectedTarget?.type === 'channel'}
            workspaceName={directory.selectedWorkspace?.name}
            hasAttachments={pendingAttachments.length > 0}
            sending={mutations.sending}
            inThreadPanel={inThreadPanel}
            onSend={mutations.sendComposerMessage}
            onTyping={realtime.reportComposerTyping}
            onFiles={attachments.addFiles}
            onAttach={() => attachments.fileInputRef.current?.click()}
          />
          <input ref={attachments.fileInputRef} type="file" multiple className="hidden" onChange={(event) => attachments.handleFiles(event.target.files)} />
        </div>
      </div>
    )
  }

  return { showListPane, showConversationPane, showCollapsedRail, showThreadPanel, showComposer, showConversationHeaderPushMessage, displayedMessages, editingFeedRow, editingThreadRow, messageRowProps, renderThreadPaging, renderThreadLatest, renderComposer }
}

export type MessagesView = ReturnType<typeof messagesPresentation>
