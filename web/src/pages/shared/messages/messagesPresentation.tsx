import { File, Lock, Upload, X } from 'lucide-react';
import { useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Button, IconButton } from '../../../components/ui/Button';
import { formatFileSize } from '../../../lib/uploadToS3';
import { forgetMessageArrival, messageShouldAnimateEntry, preview } from './helpers';
import { MessageComposer } from './MessageComposer';
import type { LocalMessage } from './types';
import type { MessagesController } from './useMessagesController';

function ComposerDropZone({
  onDrop,
  label,
  children,
}: {
  onDrop: (event: DragEvent<HTMLDivElement>) => void
  label: string
  children: ReactNode
}) {
  const dragDepthRef = useRef(0)
  const [draggingFiles, setDraggingFiles] = useState(false)

  const hasDraggedFiles = (event: DragEvent<HTMLDivElement>) => Array.from(event.dataTransfer?.types || []).includes('Files')

  return (
    <div
      className="relative"
      onDragEnter={(event) => {
        if (!hasDraggedFiles(event)) return
        event.preventDefault()
        dragDepthRef.current += 1
        setDraggingFiles(true)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        if (hasDraggedFiles(event) && !draggingFiles) setDraggingFiles(true)
      }}
      onDragLeave={(event) => {
        if (!hasDraggedFiles(event)) return
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDraggingFiles(false)
      }}
      onDrop={(event) => {
        dragDepthRef.current = 0
        setDraggingFiles(false)
        onDrop(event)
      }}
    >
      {children}
      {draggingFiles && (
        <div
          aria-hidden="true"
          data-composer-dropzone=""
          className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-focus bg-surface-raised/95 text-sm font-semibold text-ink shadow-overlay backdrop-blur-[2px]"
        >
          <Upload className="h-4 w-4 text-primary-ink" />
          <span>{label}</span>
        </div>
      )}
    </div>
  )
}

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
    if (selectedTarget?.type === 'channel' && directory.selectedChannel?.can_post === false) {
      return (
        <div
          role="status"
          className={`${inThreadPanel ? 'shrink-0 border-t border-line bg-surface-sunken px-3 py-3' : 'shrink-0 border-t border-line bg-surface-sunken px-4 pb-[calc(var(--composer-safe-bottom,env(safe-area-inset-bottom,0px))+0.75rem)] pt-3'}`}
        >
          <p className="flex items-center gap-2 text-sm text-ink-secondary">
            <Lock className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
            <span>{directory.selectedChannel.post_disabled_reason || 'Posting is disabled in this conversation.'}</span>
          </p>
        </div>
      )
    }

    return (
      <div
        className={`${inThreadPanel ? 'shrink-0 border-t border-line bg-surface-raised p-3' : 'shrink-0 border-t border-line bg-surface-raised px-2.5 pb-[calc(var(--composer-safe-bottom,env(safe-area-inset-bottom,0px))+0.625rem)] pt-2.5 sm:px-4 sm:pb-[calc(var(--composer-safe-bottom,env(safe-area-inset-bottom,0px))+0.75rem)] sm:pt-3'}`}
      >
        {realtime.typingLabel && (
          <div className="mb-1.5 flex min-h-5 items-center gap-2 px-2 text-xs font-medium text-ink-muted" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-0.5" aria-hidden="true">
              <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink-muted" />
              <span className="typing-dot typing-dot--2 h-1.5 w-1.5 rounded-full bg-ink-muted" />
              <span className="typing-dot typing-dot--3 h-1.5 w-1.5 rounded-full bg-ink-muted" />
            </span>
            {realtime.typingLabel}
          </div>
        )}
        {mutations.error && (
          <div className="mb-2 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-sm text-danger-ink" role="alert">
            {mutations.error}
          </div>
        )}
        {activeThreadRoot && (
          <div className="mb-2 flex items-center justify-between rounded-lg border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
            <span className="min-w-0 truncate">
              {inThreadPanel ? 'Replying in thread' : `Replying in thread to ${activeThreadRoot.author.full_name}: ${preview(activeThreadRoot.body)}`}
            </span>
            <IconButton label="Close thread reply" size="sm" onClick={() => setActiveThreadRootId(null)} className="-my-1.5 -mr-2">
              <X className="h-4 w-4" />
            </IconButton>
          </div>
        )}
        {pendingAttachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2" data-pending-attachments="">
            {pendingAttachments.map((attachment) => (
              attachment.previewUrl ? (
                <div
                  key={`${attachment.filename}-${attachment.byte_size}`}
                  className="group relative flex items-center gap-2.5 rounded-xl border border-line bg-surface-sunken p-1.5 pr-2 text-xs text-ink-secondary"
                >
                  <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded-lg border border-line bg-surface-raised">
                    <img src={attachment.previewUrl} alt={attachment.filename} className="h-full w-full object-cover" />
                    {attachment.progress > 0 && attachment.progress < 100 && (
                      <div className="absolute inset-0 flex items-center justify-center bg-media/60 text-[11px] font-semibold tabular-nums text-on-media">
                        {attachment.progress}%
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 max-w-36">
                    <span className="block truncate font-medium text-ink" title={attachment.filename}>{attachment.filename}</span>
                    <span className="block tabular-nums text-ink-muted">{attachment.progress > 0 ? `${attachment.progress}%` : formatFileSize(attachment.byte_size)}</span>
                  </div>
                  <IconButton
                    label={`Remove ${attachment.filename}`}
                    size="sm"
                    onClick={() => attachments.removePendingAttachment(attachment.file)}
                    className="-mr-1 shrink-0"
                  >
                    <X className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              ) : (
                <div key={`${attachment.filename}-${attachment.byte_size}`} className="inline-flex max-w-full items-center gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-xs text-ink-secondary">
                  <File className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                  <span className="truncate font-medium text-ink">{attachment.filename}</span>
                  <span className="shrink-0 tabular-nums text-ink-muted">{attachment.progress > 0 ? `${attachment.progress}%` : formatFileSize(attachment.byte_size)}</span>
                  <IconButton
                    label={`Remove ${attachment.filename}`}
                    size="sm"
                    onClick={() => attachments.removePendingAttachment(attachment.file)}
                    className="-my-2 -mr-2"
                  >
                    <X className="h-3.5 w-3.5" />
                  </IconButton>
                </div>
              )
            ))}
          </div>
        )}
        <ComposerDropZone
          onDrop={attachments.handleDrop}
          label={inThreadPanel || activeThreadRoot ? 'Drop files to attach to thread' : `Drop files to attach to ${directory.selectedLabel}`}
        >
          <MessageComposer
            key={placement}
            ref={mutations.composerRef}
            draftKey={attachments.composerDraftKey}
            label={inThreadPanel || activeThreadRoot ? 'Reply in thread' : `Message ${directory.selectedLabel}`}
            placeholder={inThreadPanel || activeThreadRoot ? 'Reply in thread' : `Message ${directory.selectedLabel}`}
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
            onEditLastMessage={() => {
              const scope = inThreadPanel || activeThreadRoot ? activeThreadMessages : rootMessages
              const lastEditable = [...scope].reverse().find((item) => item.mine && !item.pending && !item.failed && !item.blocked && item.id > 0)
              if (!lastEditable) return
              setEditing(lastEditable)
              setEditingInThreadPanel(inThreadPanel)
              setEditBody(lastEditable.body)
            }}
          />
          <input ref={attachments.fileInputRef} type="file" multiple className="hidden" onChange={(event) => attachments.handleFiles(event.target.files)} />
        </ComposerDropZone>
      </div>
    )
  }

  return { showListPane, showConversationPane, showCollapsedRail, showThreadPanel, showComposer, showConversationHeaderPushMessage, displayedMessages, editingFeedRow, editingThreadRow, messageRowProps, renderThreadPaging, renderThreadLatest, renderComposer }
}

export type MessagesView = ReturnType<typeof messagesPresentation>
