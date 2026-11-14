import { Bell, BellOff, BookOpen, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Download, Hash, Link2, Lock, MessageCircle, MonitorSmartphone, PanelLeftOpen, Pin, RefreshCw, SmilePlus, UserRound, Users, X } from 'lucide-react';
import { type MouseEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { MessageAuthorContext } from '../../components/shared/MessageAuthorContext';
import { MessagesLoadingShell } from '../../components/shared/MessagesLoadingShell';
import { Modal } from '../../components/shared/Modal';
import { Avatar } from '../../components/ui/Avatar';
import { Badge } from '../../components/ui/Badge';
import { AnchorButton, Button, IconButton } from '../../components/ui/Button';
import { TabButton } from '../../components/ui/Choice';
import { OverflowMenu } from '../../components/ui/OverflowMenu';
import { CountBadge, RowButton } from '../../components/ui/RowButton';
import { isPlainLeftClick } from '../../lib/links';
import { readReturnContext } from '../../lib/navigationContext';
import { cohortPath, cohortStudentPath } from '../../lib/routes';
import { formatFileSize } from '../../lib/uploadToS3';
import { recipientLabel, WorkspaceMemberIdentity } from './messages/ConversationControls';
import { ConversationList } from './messages/ConversationList';
import { channelInitials, conversationPath, formatDayDivider, formatTime, initials, messageShouldAnimateEntry, preview, REACTIONS_BY_VALUE, rootMessageIdFor, sameDay, shouldCompactMessage } from './messages/helpers';
import { MessageActionsSheet } from './messages/MessageActionsSheet';
import { MessageRow } from './messages/MessageRow';
import { MessageSourceLine } from './messages/MessageSourceLine';
import { messagesPresentation } from './messages/messagesPresentation';
import { ThreadPanel } from './messages/ThreadPanel';
import { useMessagesController } from './messages/useMessagesController';

export function Messages() {
const controller = useMessagesController()
const location = useLocation()
if (controller.loading) return <MessagesLoadingShell />
const view = messagesPresentation(controller)
const {
    navigate,
    toast,
    isStaff,
    isAdmin,
    workspaces,
    workspaceDetail,
    availableUsers,
    selectedWorkspaceId,
    selectedTarget,
    messageWindowMeta,
    loadingOlder,
    loadingNewer,
    loadingTarget,
    creatingChannel,
    creatingWorkspace,
    showChannelForm,
    setShowChannelForm,
    showDmForm,
    setShowDmForm,
    showWorkspaceForm,
    setShowWorkspaceForm,
    showWorkspaceSwitcher,
    setShowWorkspaceSwitcher,
    showWorkspaceMembers,
    setShowWorkspaceMembers,
    pushEnabled,
    pushMessage,
    hasUnreadBelow,
    unreadBoundaryId,
    showScrollToLatest,
    lightboxAttachments,
    setLightboxAttachments,
    lightboxIndex,
    setLightboxIndex,
    setReactionDetails,
    sidebarCollapsed,
    setSidebarCollapsed,
    conversationView,
    setConversationView,
    setActiveThreadRootId,
    isDesktop,
    setMobilePane,
    setEditing,
    setEditingInThreadPanel,
    authorContext,
    setAuthorContext,
    setMobileActionsMessageId,
    actionsFromThreadPanelRef,
    messagePendingDelete,
    setMessagePendingDelete,
    editBody,
    setEditBody,
    highlightedMessageId,
    workspaceError,
    setWorkspaceError,
    channelError,
    setChannelError,
    dmUserId,
    setDmUserId,
    memberToAddId,
    setMemberToAddId,
    isNavigationPending,
    workspaceForm,
    setWorkspaceForm,
    channelForm,
    setChannelForm,
    messageScrollRef,
    queuedConversationCount,
    lightboxTouchStartX,
    messageArrivalsRef,
    selectedChannel,
    selectedDmStudent,
    sourceRecord,
    sourceRecordPath,
    conversationReturnContext,
    selected,
    selectedLabel,
    selectedMuted,
    messagesById,
    threadReplies,
    activeThreadRoot,
    mobileActionsMessage,
    reactionDetailsMessage,
    selectedReaction,
    activeThreadMessages,
    rootReadReceipts,
    threadReadReceipts,
    recent,
    selectedWorkspace,
    canManageChannels,
    sortedWorkspaceCards,
    selectedPinnedMessages,
    memberCandidates,
    mentionPatterns,
    lightboxAttachment,
    loadOlderMessages,
    loadNewerMessages,
    replyToMessage,
    renderThreadPaging,
    renderThreadLatest,
    markWorkspaceRead,
    scrollToLatestMessage,
    beginReadingScroll,
    handleConversationScroll,
    selectTarget,
    selectWorkspace,
    showPreviousLightboxImage,
    showNextLightboxImage,
    closeLightbox,
    downloadLightboxAttachment,
    retryFailedMessage,
    discardFailedMessage,
    restoreFailedMessageText,
    handleCreateChannel,
    handleCreateWorkspace,
    handleAddWorkspaceMember,
    handleRemoveWorkspaceMember,
    handleCreateDm,
    handleTogglePush,
    saveEdit,
    deleteMessage,
    copyMessage,
    copyMessageLink,
    copyConversationLink,
    togglePin,
    toggleReaction,
    toggleMute,
    showConversationPane,
    showCollapsedRail,
    showThreadPanel,
    showComposer,
    showConversationHeaderPushMessage,
    displayedMessages,
    editingFeedRow,
    selectedConversationKey,
    forgetEnteredMessage,
    renderComposer
  } = view

  // Names in the conversation header are real links (L-2.8). A plain click keeps
  // the message you were reading, so "Back to conversation" returns to it.
  const headerStudentPath = isStaff && selectedDmStudent && selected?.cohort_id ? cohortStudentPath(selected.cohort_id, selectedDmStudent.id) : null
  const headerCohortPath = isStaff && selected?.cohort_id ? cohortPath(selected.cohort_id) : null
  const openRecordWithReturn = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    const context = readReturnContext(conversationReturnContext())
    // Keep the anchor on this history entry too, so browser Back resolves the same message.
    if (context) navigate(`${location.pathname}${location.search}`, { replace: true, state: context })
    navigate(to, { state: context })
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] min-w-0 flex-col gap-0 overflow-hidden">
      <div className={`${isDesktop ? 'grid overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-raised' : 'flex min-w-0 overflow-hidden border-y border-slate-200 bg-white'} min-h-0 flex-1 ${isDesktop ? (sidebarCollapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[328px_minmax(0,1fr)]') : ''}`}>
        <ConversationList context={view} />
        {showCollapsedRail && (
          <aside className="hidden border-r border-slate-200 bg-slate-50 p-2 lg:block">
            <Button variant="quiet" fullWidth onClick={() => setSidebarCollapsed(false)} aria-label="Show conversation list" title="Show conversation list" className="mb-3">
              <PanelLeftOpen className="h-5 w-5" />
            </Button>
            <div className="space-y-2">
              {recent.map(({ type, summary }) => {
                const title = type === 'channel' ? summary.name : summary.title
                return (
                  <Link
                    key={`${type}:${summary.id}`}
                    to={conversationPath({ type, id: summary.id })}
                    onClick={(event) => { if (!isPlainLeftClick(event)) return; event.preventDefault(); selectTarget({ type, id: summary.id }) }}
                    title={title}
                    aria-label={summary.unread_count > 0 ? `${title}, unread` : title}
                    aria-current={selectedTarget?.type === type && selectedTarget.id === summary.id ? 'page' : undefined}
                    className={`pressable relative flex h-14 w-full flex-col items-center justify-center rounded-xl text-xs font-semibold ${selectedTarget?.type === type && selectedTarget.id === summary.id ? 'nav-selected' : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'}`}
                  >
                    {type === 'channel'
                      ? summary.visibility === 'staff_only' ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />
                      : <MessageCircle className="h-4 w-4" />}
                    <span className="mt-0.5 max-w-12 truncate">{type === 'channel' ? channelInitials(title) : initials(title)}</span>
                    {summary.unread_count > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-ruby-600" aria-hidden="true" />}
                  </Link>
                )
              })}
            </div>
          </aside>
        )}

        {showConversationPane && (
        <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-white">
          {selectedTarget && selected ? (
            <>
              <header className="shrink-0 border-b border-line bg-surface-raised px-1.5 py-1.5 sm:px-3">
                <div className="flex min-h-11 min-w-0 items-center gap-1">
                  {isDesktop && sidebarCollapsed && (
                    <IconButton label="Show conversation list" size="sm" onClick={() => setSidebarCollapsed(false)}>
                      <PanelLeftOpen className="h-4 w-4" />
                    </IconButton>
                  )}
                  {!isDesktop && (
                    <IconButton label="Back to conversations" onClick={() => navigate('/messages', { replace: true })}>
                      <ChevronLeft className="h-5 w-5" />
                    </IconButton>
                  )}
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary" aria-hidden="true">
                    {selectedTarget.type === 'channel'
                      ? selectedChannel?.visibility === 'staff_only' ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />
                      : <MessageCircle className="h-4 w-4" />}
                  </span>
                  <div className="min-w-0 flex-1 pl-1">
                    <h2 className="truncate text-[15px] font-semibold leading-5 text-ink">
                      {headerStudentPath
                        ? <Link to={headerStudentPath} onClick={(event) => openRecordWithReturn(event, headerStudentPath)} className="rounded-sm hover:underline">{selectedLabel}</Link>
                        : selectedLabel}
                    </h2>
                    <p className="hide-with-keyboard truncate text-xs leading-4 text-ink-muted">
                      {headerCohortPath
                        ? <Link to={headerCohortPath} onClick={(event) => openRecordWithReturn(event, headerCohortPath)} className="rounded-sm hover:text-ink hover:underline">{selected.workspace_name}</Link>
                        : selected.workspace_name}
                      {selectedTarget.type === 'channel' && selectedChannel?.visibility === 'staff_only' && ' · Staff only'}
                      {isNavigationPending && ' · updating'}
                    </p>
                  </div>
                  {selectedDmStudent && (
                    <IconButton size="sm" label={`Open ${selectedDmStudent.full_name}'s student context`} onClick={() => setAuthorContext(selectedDmStudent)}>
                      <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />
                    </IconButton>
                  )}
                  <IconButton size="sm" label={selectedMuted ? 'Unmute conversation' : 'Mute conversation'} aria-pressed={selectedMuted} onClick={() => void toggleMute()}>
                    {selectedMuted ? <BellOff className="h-[18px] w-[18px]" aria-hidden="true" /> : <Bell className="h-[18px] w-[18px]" aria-hidden="true" />}
                  </IconButton>
                  <OverflowMenu
                    label="Conversation options"
                    size="sm"
                    items={[
                      { key: 'copy', label: 'Copy link to conversation', icon: <Link2 aria-hidden="true" />, onSelect: () => void copyConversationLink() },
                      {
                        key: 'pins',
                        label: conversationView === 'pins' && !activeThreadRoot ? 'Back to conversation' : `Pinned messages (${selectedPinnedMessages.length})`,
                        icon: <Pin aria-hidden="true" />,
                        onSelect: () => { const showPins = !(conversationView === 'pins' && !activeThreadRoot); setActiveThreadRootId(null); if (!isDesktop) setMobilePane('conversation'); setConversationView(showPins ? 'pins' : 'messages') },
                      },
                      { key: 'alerts', label: pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts', icon: <MonitorSmartphone aria-hidden="true" />, onSelect: () => void handleTogglePush() },
                    ]}
                  />
                </div>
                {selectedTarget.type === 'channel' && selectedChannel?.description && <p className="hide-with-keyboard mt-1 hidden truncate px-1 text-xs text-ink-muted lg:block">{selectedChannel.description}</p>}
                {sourceRecord && sourceRecordPath && <div className="hide-with-keyboard mt-1.5 px-1 pb-0.5"><Link to={sourceRecordPath} className="pressable inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-info-200 bg-info-50 px-3 text-xs font-semibold text-info-800 hover:bg-info-100 sm:min-h-9"><BookOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate">From {sourceRecord.type === 'submission' ? 'submission' : 'help request'}: {sourceRecord.label}</span></Link></div>}
                {showConversationHeaderPushMessage && (
                  <div className="mt-1.5 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
                    {pushMessage}
                  </div>
                )}
              </header>

              <div className={`relative min-w-0 min-h-0 flex-1 overflow-hidden ${showThreadPanel ? 'grid lg:grid-cols-[minmax(0,1fr)_380px]' : 'flex'}`}>
                <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
                    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold text-ink-muted">Thread</p>
                          <p className="mt-1 text-sm tabular-nums text-slate-600">
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
                          {selectedTarget.type === 'channel' ? 'Back to channel' : 'Back to conversation'}
                        </Button>
                      </div>
                    </div>
                  )}
                  {activeThreadRoot && !isDesktop && renderThreadPaging('older')}
                  {!activeThreadRoot && conversationView === 'pins' && (
                    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-surface-sunken px-4 py-2 text-sm text-ink-secondary"><Pin className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
                      <span className="min-w-0 flex-1">Pinned messages stay easy to find here for this workspace conversation.</span>
                      <Button variant="quiet" size="sm" onClick={() => setConversationView('messages')} className="-my-1 -mr-2"><ChevronLeft className="h-4 w-4" aria-hidden="true" />Back to conversation</Button>
                    </div>
                  )}
                  {!activeThreadRoot && conversationView === 'messages' && messageWindowMeta?.has_older && (
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
                    <div className="flex min-h-full items-center justify-center py-16 text-center text-sm text-slate-500">
                      {activeThreadRoot
                        ? 'No replies yet. Start the thread.'
                        : conversationView === 'pins'
                          ? 'No pinned messages yet.'
                          : 'No messages yet. Start the conversation.'}
                    </div>
                  ) : displayedMessages.map((message, index) => {
                    const previousMessage = displayedMessages[index - 1]
                    const rootId = rootMessageIdFor(message, messagesById)
                    const replyCount = threadReplies.get(rootId)?.length || 0
                    const compact = shouldCompactMessage(message, previousMessage)
                    const showDayDivider = !previousMessage || !sameDay(previousMessage.created_at, message.created_at)

                    return (
                      <div key={message.id}>
                        {!activeThreadRoot && conversationView === 'messages' && unreadBoundaryId === message.id && (
                          <div data-unread-divider className="my-4 flex items-center gap-3 px-2" role="separator" aria-label="Unread messages">
                            <div className="h-px flex-1 bg-ruby-200" />
                            <span className="text-xs font-semibold text-ruby-700">New messages</span>
                            <div className="h-px flex-1 bg-ruby-200" />
                          </div>
                        )}
                        {showDayDivider && (
                          <div className="relative my-5 flex items-center justify-center">
                            <div className="absolute inset-x-0 top-1/2 border-t border-slate-200" />
                            <span className="relative rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold tabular-nums text-ink-muted">
                              {formatDayDivider(message.created_at)}
                            </span>
                          </div>
                        )}
                        {message.source && !message.parent_message_id && <MessageSourceLine source={message.source} staff={isStaff} />}
                        <MessageRow
                          message={message}
                          readReceipts={conversationView === 'pins' && !activeThreadRoot ? undefined : activeThreadRoot ? threadReadReceipts.get(message.id) : rootReadReceipts.get(message.id)}
                          compact={compact}
                          highlighted={highlightedMessageId === message.id}
                          entering={messageShouldAnimateEntry(messageArrivalsRef.current, selectedConversationKey, message.id)}
                          onEntered={() => forgetEnteredMessage(message.id)}
                          editing={editingFeedRow(message.id)}
                          editBody={editBody}
                          onStartEdit={() => {
                            setEditing(message)
                            setEditingInThreadPanel(false)
                            setEditBody(message.body)
                          }}
                          onCancelEdit={() => setEditing(null)}
                          onSaveEdit={(editedBody) => saveEdit(message, editedBody)}
                          onDelete={() => setMessagePendingDelete(message)}
                          onCopy={() => void copyMessage(message)}
                          onCopyLink={() => void copyMessageLink(message)}
                          onRetry={() => void retryFailedMessage(message)}
                          onDiscard={() => discardFailedMessage(message)}
                          onRestore={() => restoreFailedMessageText(message)}
                          onOpenAuthor={() => setAuthorContext(message.author)}
                          onOpenActions={() => { actionsFromThreadPanelRef.current = false; setMobileActionsMessageId(message.id) }}
                          onPin={() => togglePin(message)}
                          canPin={isStaff}
                          inThreadView={Boolean(activeThreadRoot)}
                          replyCount={!activeThreadRoot && !message.parent_message_id ? replyCount : 0}
                          onReply={() => replyToMessage(message)}
                          onReact={(emoji) => toggleReaction(message, emoji)}
                          onInspectReaction={(emoji) => setReactionDetails({ messageId: message.id, emoji })}
                          onOpenImage={(attachment, imageAttachments) => {
                            setLightboxAttachments(imageAttachments)
                            setLightboxIndex(Math.max(0, imageAttachments.findIndex((item) => item.id === attachment.id)))
                          }}
                          mentionPatterns={mentionPatterns}
                        />
                      </div>
                    )
                  })}
                  {!activeThreadRoot && conversationView === 'messages' && messageWindowMeta?.has_newer && (
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
                <ThreadPanel context={view} />
                {(loadingTarget || isNavigationPending) && (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-center bg-white/20 px-4 py-6">
                    <div className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-ink-secondary shadow-raised">
                      <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                      Switching conversation…
                    </div>
                  </div>
                )}
              </div>

              {showComposer && !showThreadPanel && renderComposer('main')}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
              Pick a channel or start a direct message.
            </div>
          )}
        </section>
        )}
      </div>
      <Modal
        open={Boolean(reactionDetailsMessage && selectedReaction)}
        onClose={() => setReactionDetails(null)}
        title="Who reacted"
        subtitle="See everyone behind each reaction and manage your own."
        size="md"
      >
        {reactionDetailsMessage && selectedReaction && (() => {
          const selectedDisplay = REACTIONS_BY_VALUE.get(selectedReaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
          const SelectedIcon = selectedDisplay.Icon
          return (
            <div>
              <div role="tablist" aria-label="Message reactions" className="flex gap-2 overflow-x-auto pb-4">
                {reactionDetailsMessage.reactions.map((reaction) => {
                  const display = REACTIONS_BY_VALUE.get(reaction.emoji) || { label: 'Reaction', Icon: SmilePlus }
                  const Icon = display.Icon
                  const active = reaction.emoji === selectedReaction.emoji
                  return (
                    <TabButton
                      key={reaction.emoji}
                      asTab
                      selected={active}
                      aria-label={`${display.label}, ${reaction.count}`}
                      onClick={() => setReactionDetails({ messageId: reactionDetailsMessage.id, emoji: reaction.emoji })}
                      className="tabular-nums"
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                      {reaction.count}
                    </TabButton>
                  )
                })}
              </div>
              <div className="flex min-h-12 items-center gap-2 border-b border-slate-200">
                <SelectedIcon className="h-4 w-4 text-ink-secondary" />
                <p className="flex-1 text-sm font-semibold text-slate-900">{selectedDisplay.label}</p>
                <span className="text-xs font-semibold tabular-nums text-slate-500">{selectedReaction.count}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {selectedReaction.users.map((person) => (
                  <div key={person.id} className="flex min-h-14 items-center gap-3 py-2">
                    <Avatar name={person.full_name} src={person.avatar_url} />
                    <span className="min-w-0 truncate text-sm font-medium text-slate-800">{person.full_name}</span>
                  </div>
                ))}
              </div>
              <Button
                variant={selectedReaction.reacted ? 'secondary' : 'primary'}
                size="lg"
                fullWidth
                onClick={() => void toggleReaction(reactionDetailsMessage, selectedReaction.emoji)}
                className="mt-5"
              >
                <SelectedIcon className="h-4 w-4" />
                {selectedReaction.reacted ? `Remove your ${selectedDisplay.label.toLowerCase()}` : `React with ${selectedDisplay.label.toLowerCase()}`}
              </Button>
            </div>
          )
        })()}
      </Modal>
      <Modal
        open={showWorkspaceSwitcher}
        onClose={() => setShowWorkspaceSwitcher(false)}
        title="Switch workspace"
        subtitle="Move between cohorts, communities, channels, and direct messages."
        size="lg"
      >
        <div className="space-y-3">
          {sortedWorkspaceCards.map(({ workspace, channelCount, dmCount, unreadChannelCount, unreadDmCount, unreadCount }) => {
            const active = workspace.id === selectedWorkspaceId

            return (
              <div
                key={workspace.id}
                className={`flex items-stretch gap-2 rounded-2xl border ${active ? 'border-line-strong' : unreadCount > 0 ? 'border-line-strong' : 'border-line'} bg-surface-raised`}
              >
                <RowButton
                  selected={active}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => {
                    selectWorkspace(workspace.id)
                    setShowWorkspaceSwitcher(false)
                  }}
                  className="group flex flex-1 items-center gap-4 rounded-2xl px-4 py-4"
                >
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-sm font-semibold ${active ? 'bg-slate-300 text-ink' : 'bg-slate-200 text-ink-secondary'}`} aria-hidden="true">
                    {channelInitials(workspace.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold text-ink">{workspace.name}</span>
                      <CountBadge count={unreadCount} label="unread" />
                      {active && <Badge icon={<Check className="h-3 w-3" aria-hidden="true" />}>Current</Badge>}
                      <Badge tone={workspace.workspace_type === 'community' ? 'neutral' : 'info'}>{workspace.workspace_type === 'community' ? 'Community' : 'Cohort'}</Badge>
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-ink-muted">
                      <span className="inline-flex items-center gap-1">
                        <Users className="h-3.5 w-3.5" aria-hidden="true" />
                        {workspace.member_count} {workspace.member_count === 1 ? 'member' : 'members'}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Hash className="h-3.5 w-3.5" aria-hidden="true" />
                        {channelCount} {channelCount === 1 ? 'channel' : 'channels'}
                        {unreadChannelCount > 0 && <span className="font-semibold text-ink">· {unreadChannelCount} unread</span>}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                        {dmCount} DM {dmCount === 1 ? 'conversation' : 'conversations'}
                        {unreadDmCount > 0 && <span className="font-semibold text-ink">· {unreadDmCount} unread</span>}
                      </span>
                    </span>
                    {workspace.description && (
                      <span className="mt-2 block line-clamp-2 text-xs leading-5 text-ink-muted">{workspace.description}</span>
                    )}
                  </span>
                </RowButton>
                {unreadCount > 0 && (
                  <div className="flex shrink-0 items-center pr-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        markWorkspaceRead(workspace.id).catch(() => {
                          toast.error('Failed to mark workspace as read')
                        })
                      }}
                    >
                      <CheckCheck className="h-4 w-4" aria-hidden="true" />
                      <span className="sr-only sm:not-sr-only">Mark read</span>
                      <span className="sr-only">{` ${workspace.name}`}</span>
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </Modal>

      {isAdmin && (
        <Modal
          open={showWorkspaceForm}
          onClose={() => {
            setShowWorkspaceForm(false)
            setWorkspaceError('')
          }}
          title="Create workspace"
          subtitle="Use this for alumni, staff groups, or other shared communities."
          size="lg"
        >
          <form onSubmit={handleCreateWorkspace} className="space-y-4">
            {workspaceError && (
              <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
                {workspaceError}
              </div>
            )}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Workspace name</label>
              <input
                value={workspaceForm.name}
                onChange={(event) => setWorkspaceForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="Workspace name"
                className="app-control w-full"
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">Description</label>
              <textarea
                value={workspaceForm.description}
                onChange={(event) => setWorkspaceForm((prev) => ({ ...prev, description: event.target.value }))}
                placeholder="What is this workspace for?"
                rows={3}
                className="app-control w-full resize-none"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowWorkspaceForm(false)
                  setWorkspaceError('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={creatingWorkspace || !workspaceForm.name.trim()}
              >
                {creatingWorkspace ? 'Creating…' : 'Create workspace'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {workspaceDetail && (
        <Modal
          open={showWorkspaceMembers}
          onClose={() => {
            setShowWorkspaceMembers(false)
            setWorkspaceError('')
          }}
          title={`${workspaceDetail.name} members`}
          subtitle={workspaceDetail.workspace_type === 'community'
            ? 'Manage who can access this workspace.'
            : 'This workspace follows active cohort enrollment.'}
          size="lg"
        >
          <div className="space-y-4">
            {workspaceError && (
              <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
                {workspaceError}
              </div>
            )}
            {isAdmin && workspaceDetail.can_manage && workspaceDetail.workspace_type === 'community' && (
              <form onSubmit={handleAddWorkspaceMember} className="flex flex-col gap-2 sm:flex-row">
                <select
                  value={memberToAddId}
                  onChange={(event) => setMemberToAddId(event.target.value)}
                  className="app-control min-w-0 flex-1"
                >
                  <option value="">Add a member</option>
                  {memberCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.full_name} ({candidate.email || candidate.role})</option>
                  ))}
                </select>
                <Button
                  variant="primary"
                  type="submit"
                  disabled={!memberToAddId}
                >
                  Add member
                </Button>
              </form>
            )}
            <div className="space-y-2">
              {workspaceDetail.members.length === 0 ? (
                <p className="text-sm text-slate-500">No members listed yet.</p>
              ) : workspaceDetail.members.map((member) => (
                <div key={member.id} className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50/60 px-4 py-3">
                  <div className="min-w-0">
                    <WorkspaceMemberIdentity member={member} isStaff={isStaff} />
                    <p className="truncate text-xs text-slate-500">
                      {member.role}
                      {member.membership_role && ` · ${member.membership_role}`}
                    </p>
                  </div>
                  {isAdmin && workspaceDetail.can_manage && workspaceDetail.workspace_type === 'community' && member.membership_role !== 'manager' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      aria-label={`Remove ${member.full_name}, ${member.email || member.role}`}
                      onClick={() => handleRemoveWorkspaceMember(member.id)}
                    >
                      Remove
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}

      {canManageChannels && (
        <Modal
          open={showChannelForm}
          onClose={() => {
            setShowChannelForm(false)
            setChannelError('')
          }}
          title="Create channel"
          subtitle="Add a shared space inside this workspace."
          size="lg"
        >
          <form onSubmit={handleCreateChannel} className="space-y-4">
            {channelError && (
              <div className="rounded-xl border border-danger-200 bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">
                {channelError}
              </div>
            )}
            <select
              value={channelForm.workspace_id}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, workspace_id: event.target.value }))}
              className="app-control w-full"
            >
              {workspaces.filter((workspace) => isAdmin || workspace.workspace_type === 'cohort').map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </select>
            <input
              value={channelForm.name}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, name: event.target.value }))}
              placeholder="Channel name"
              className="app-control w-full"
            />
            <textarea
              value={channelForm.description}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="What is this channel for?"
              rows={3}
              className="app-control w-full resize-none"
            />
            <select
              value={channelForm.visibility}
              onChange={(event) => setChannelForm((prev) => ({ ...prev, visibility: event.target.value }))}
              className="app-control w-full"
            >
              <option value="cohort">Students and staff</option>
              <option value="staff_only">Staff only</option>
            </select>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setShowChannelForm(false)
                  setChannelError('')
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                type="submit"
                disabled={creatingChannel || !channelForm.workspace_id || !channelForm.name.trim()}
              >
                {creatingChannel ? 'Creating…' : 'Create channel'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      <Modal
        open={Boolean(messagePendingDelete)}
        onClose={() => setMessagePendingDelete(null)}
        title="Delete message?"
        subtitle="This removes the message for everyone in the conversation."
        size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => setMessagePendingDelete(null)}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (!messagePendingDelete) return
                void deleteMessage(messagePendingDelete)
                setMessagePendingDelete(null)
              }}
            >
              Delete message
            </Button>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
            This action cannot be undone.
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {messagePendingDelete ? preview(messagePendingDelete.body) || 'Attachment-only message' : ''}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(mobileActionsMessage)}
        onClose={() => setMobileActionsMessageId(null)}
        title="Message actions"
        subtitle={mobileActionsMessage ? `${mobileActionsMessage.author.full_name} · ${formatTime(mobileActionsMessage.created_at)}` : undefined}
        size="md"
      >
        <MessageActionsSheet context={view} />
      </Modal>

      <Modal
        open={showDmForm}
        onClose={() => setShowDmForm(false)}
        title="Start direct message"
        subtitle="Pick someone in this workspace."
        size="md"
      >
        <form onSubmit={handleCreateDm} className="space-y-4">
          <select
            value={dmUserId}
            onChange={(event) => setDmUserId(event.target.value)}
            className="app-control w-full"
          >
            {availableUsers.map((availableUser) => (
              <option key={availableUser.id} value={availableUser.id}>
                {recipientLabel(availableUser, availableUsers, selectedWorkspace?.name)}
              </option>
            ))}
          </select>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => setShowDmForm(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              type="submit"
              disabled={!selectedWorkspaceId || !dmUserId}
            >
              Start direct message
            </Button>
          </div>
        </form>
      </Modal>

      {authorContext && <MessageAuthorContext author={authorContext} staff={isStaff} workspaceReturnContext={conversationReturnContext} cohortId={selected?.cohort_id || undefined} source={authorContext.id === selectedDmStudent?.id ? sourceRecord || undefined : undefined} onClose={() => setAuthorContext(null)} />}
      {lightboxAttachment?.url && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Image preview: ${lightboxAttachment.filename}`}
          onTouchStart={(event) => {
            lightboxTouchStartX.current = event.touches[0]?.clientX ?? null
          }}
          onTouchEnd={(event) => {
            if (lightboxTouchStartX.current === null) return
            const endX = event.changedTouches[0]?.clientX
            if (endX === undefined) {
              lightboxTouchStartX.current = null
              return
            }
            const delta = endX - lightboxTouchStartX.current
            lightboxTouchStartX.current = null
            if (Math.abs(delta) < 60) return
            if (delta < 0) showNextLightboxImage()
            else showPreviousLightboxImage()
          }}
        >
          <IconButton label="Close image preview" onClick={closeLightbox} className="absolute right-4 top-4 surface-inverse bg-white/10! text-white! hover:bg-white/20! active:bg-white/30!">
            <X className="h-5 w-5" />
          </IconButton>
          {lightboxAttachments.length > 1 && (
            <>
              <IconButton label="Previous image" onClick={showPreviousLightboxImage} disabled={lightboxIndex === 0} className="absolute left-4 top-1/2 h-12! w-12! -translate-y-1/2 surface-inverse bg-white/10! text-white! hover:bg-white/20! active:bg-white/30!">
                <ChevronLeft className="h-6 w-6" />
              </IconButton>
              <IconButton label="Next image" onClick={showNextLightboxImage} disabled={lightboxIndex === lightboxAttachments.length - 1} className="absolute right-4 top-1/2 h-12! w-12! -translate-y-1/2 surface-inverse bg-white/10! text-white! hover:bg-white/20! active:bg-white/30!">
                <ChevronRight className="h-6 w-6" />
              </IconButton>
            </>
          )}
          <div className="max-h-full max-w-5xl overflow-hidden rounded-2xl bg-surface-raised shadow-overlay">
            <img src={lightboxAttachment.url} alt={lightboxAttachment.filename} className="max-h-[80vh] w-full object-contain" />
            <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3 text-sm text-slate-700">
              <div className="min-w-0">
                <div className="truncate font-medium">{lightboxAttachment.filename}</div>
                <div className="tabular-nums text-slate-500">
                  {lightboxAttachments.length > 1 && `${lightboxIndex + 1} of ${lightboxAttachments.length} · `}
                  {formatFileSize(lightboxAttachment.byte_size)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <AnchorButton
                  href={lightboxAttachment.url}
                  target="_blank"
                  rel="noreferrer"
                  size="sm"
                >
                  Open
                </AnchorButton>
                <Button variant="secondary" size="sm" onClick={downloadLightboxAttachment}>
                  <Download className="h-4 w-4" />
                  Download
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
export { applyComposerList,applyComposerListShortcut } from '../../components/shared/MarkdownEditor';
export { recipientLabel,WorkspaceMemberIdentity } from './messages/ConversationControls';
export { FormattedMessage } from './messages/FormattedMessage';
export { cachedWindowIsContiguous,conversationPath,createMessageArrivals,forgetMessageArrival,mergeMessageWindow,messageShouldAnimateEntry,recordMessageArrival,restoreFailedSends,typingIndicatorLabel,type MessageArrivals } from './messages/helpers';
export { MessageComposer,type MessageComposerHandle,type MessageComposerSend } from './messages/MessageComposer';
export { MessageEditSurface } from './messages/MessageEditSurface';
