import { File, X } from 'lucide-react';
import { IconButton } from '../../../components/ui/Button';
import { formatFileSize } from '../../../lib/uploadToS3';
import { forgetMessageArrival, preview, targetKey } from './helpers';
import { MessageComposer } from './MessageComposer';
import type { MessagesController } from './useMessagesController';

/** View-only derivations and composer placement; no additional state. */
export function messagesPresentation(controller: MessagesController) {
const {
    selectedTarget,
    sending,
    pushMessage,
    pendingAttachments,
    setPendingAttachments,
    sidebarCollapsed,
    conversationView,
    setActiveThreadRootId,
    isDesktop,
    mobilePane,
    editing,
    editingInThreadPanel,
    error,
    fileInputRef,
    composerRef,
    messageArrivalsRef,
    selectedLabel,
    rootMessages,
    activeThreadRoot,
    typingLabel,
    activeThreadMessages,
    selectedWorkspace,
    selectedPinnedMessages,
    mentionableUsers,
    mentionPatterns,
    composerDraftKey,
    reportComposerTyping,
    sendComposerMessage,
    handleFiles,
    addFiles,
    handleDrop
  } = controller


  const showListPane = isDesktop || mobilePane === 'list'
  const showConversationPane = isDesktop || mobilePane === 'conversation' || mobilePane === 'thread'
  const showCollapsedRail = isDesktop && sidebarCollapsed
  const showThreadPanel = Boolean(isDesktop && activeThreadRoot)
  const conversationMessages = activeThreadRoot && !showThreadPanel ? activeThreadMessages : rootMessages
  const showComposer = Boolean(selectedTarget) && (conversationView === 'messages' || Boolean(activeThreadRoot))
  const showPageIntro = isDesktop && !selectedTarget
  const showConversationHeaderPushMessage = Boolean(pushMessage) && Boolean(selectedTarget)
  const displayedMessages = conversationView === 'pins' && !activeThreadRoot ? selectedPinnedMessages : conversationMessages
  // The thread root shows in both the feed and the desktop thread panel: only the row where
  // editing started gets the edit surface (each surface has its own editor).
  const editingInFeed = Boolean(editing && displayedMessages.some((message) => message.id === editing.id))
  const editingInThread = Boolean(showThreadPanel && editing && activeThreadMessages.some((message) => message.id === editing.id))
  const editingFeedRow = (id: number) => editing?.id === id && (!editingInThread || !editingInThreadPanel)
  const editingThreadRow = (id: number) => editing?.id === id && (editingInThreadPanel || !editingInFeed)
  const selectedConversationKey = selectedTarget ? targetKey(selectedTarget) : null
  const forgetEnteredMessage = (messageId: number) => {
    messageArrivalsRef.current = forgetMessageArrival(messageArrivalsRef.current, messageId)
  }
  const renderComposer = (placement: 'main' | 'thread') => {
    const inThreadPanel = placement === 'thread'

    return (
      <div
        className={`${inThreadPanel ? 'shrink-0 border-t border-slate-200 bg-white p-3' : 'shrink-0 border-t border-slate-200 bg-white px-2.5 pb-[calc(var(--composer-safe-bottom,env(safe-area-inset-bottom,0px))+0.625rem)] pt-2.5 sm:px-4 sm:pb-[calc(var(--composer-safe-bottom,env(safe-area-inset-bottom,0px))+0.75rem)] sm:pt-3'}`}
      >
        {typingLabel && (
          <div className="mb-1.5 flex min-h-5 items-center gap-2 px-2 text-xs font-semibold text-slate-500" role="status" aria-live="polite">
            <span className="inline-flex items-center gap-0.5" aria-hidden="true">
              <span className="h-1 w-1 rounded-full bg-slate-400" />
              <span className="h-1 w-1 rounded-full bg-slate-400" />
              <span className="h-1 w-1 rounded-full bg-slate-400" />
            </span>
            {typingLabel}
          </div>
        )}
        {error && (
          <div className="mb-2 rounded-lg border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
            {error}
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
                  onClick={() => setPendingAttachments((prev) => prev.filter((item) => item.file !== attachment.file))}
                  className="-my-2 -mr-2"
                >
                  <X className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
        )}
        <div onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
          <MessageComposer
            key={placement}
            ref={composerRef}
            draftKey={composerDraftKey}
            label={inThreadPanel || activeThreadRoot ? 'Reply in thread' : `Message ${selectedLabel}`}
            placeholder={inThreadPanel || activeThreadRoot ? 'Reply in thread' : 'Write a message'}
            mentionableUsers={mentionableUsers}
            mentionPatterns={mentionPatterns}
            includeChannelMentions={selectedTarget?.type === 'channel'}
            workspaceName={selectedWorkspace?.name}
            hasAttachments={pendingAttachments.length > 0}
            sending={sending}
            inThreadPanel={inThreadPanel}
            onSend={sendComposerMessage}
            onTyping={reportComposerTyping}
            onFiles={addFiles}
            onAttach={() => fileInputRef.current?.click()}
          />
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(event) => handleFiles(event.target.files)} />
        </div>
      </div>
    )
  }
return { ...controller, showListPane, showConversationPane, showCollapsedRail, showThreadPanel, conversationMessages, showComposer, showPageIntro, showConversationHeaderPushMessage, displayedMessages, editingInFeed, editingInThread, editingFeedRow, editingThreadRow, selectedConversationKey, forgetEnteredMessage, renderComposer }
}
export type MessagesViewContext = ReturnType<typeof messagesPresentation>
