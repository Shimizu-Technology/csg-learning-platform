import { useEffect } from 'react';
import { useStudentExperience } from '../../lib/studentExperience'
import { InstructorMessageAction } from '../../components/student/InstructorMessageAction'
import { Hash, Lock, PanelLeftOpen, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MessagesLoadingShell } from '../../components/shared/MessagesLoadingShell';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { isPlainLeftClick } from '../../lib/links';
import { ConversationFeed } from './messages/ConversationFeed';
import { ConversationHeader } from './messages/ConversationHeader';
import { ConversationList } from './messages/ConversationList';
import { channelInitials, conversationPath, directConversationPeer, initials } from './messages/helpers';
import { MessagesDialogs } from './messages/MessagesDialogs';
import { messagesPresentation } from './messages/messagesPresentation';
import { useMessagesController } from './messages/useMessagesController';

export function Messages() {
  const { v2 } = useStudentExperience()
  const controller = useMessagesController()
  const { toast, route, conversation, overlays, search, lightbox, directory, alerts, feed, realtime, mutations } = controller
  const { selectedTarget, isDesktop, sidebarCollapsed, setSidebarCollapsed, selectTarget, activeThreadRootId, setActiveThreadRootId } = conversation
  const { recent, selected } = directory

  useEffect(() => {
    if (typeof window === 'undefined') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        if (recent.length < 2) return
        const currentIndex = selectedTarget
          ? recent.findIndex((item) => item.type === selectedTarget.type && item.summary.id === selectedTarget.id)
          : -1
        const step = event.key === 'ArrowDown' ? 1 : -1
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + step + recent.length) % recent.length
        const next = recent[nextIndex]
        if (!next) return
        event.preventDefault()
        selectTarget({ type: next.type, id: next.summary.id })
        return
      }
      if (event.key === 'Escape' && isDesktop && activeThreadRootId) {
        const active = document.activeElement as HTMLElement | null
        if (active && (active.closest('[role="dialog"]') || active.closest('[role="menu"]') || active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return
        setActiveThreadRootId(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeThreadRootId, isDesktop, recent, selectTarget, selectedTarget, setActiveThreadRootId])

  if (directory.loading) return <MessagesLoadingShell />
  const view = messagesPresentation(controller)
  const { showConversationPane, showCollapsedRail, showThreadPanel, showComposer, renderComposer } = view

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] min-w-0 flex-col gap-0 overflow-hidden">
      <div className={`${isDesktop ? 'grid overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-raised' : 'flex min-w-0 overflow-hidden border-y border-line bg-surface-raised'} min-h-0 flex-1 ${isDesktop ? (sidebarCollapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[328px_minmax(0,1fr)]') : ''}`}>
        <ConversationList directory={directory} conversation={conversation} search={search} alerts={alerts} onlineUserIds={realtime.onlineUserIds} showListPane={view.showListPane} />
        {showCollapsedRail && (
          <aside className="hidden border-r border-line bg-surface-sunken p-2 lg:block">
            <Button variant="quiet" fullWidth onClick={() => setSidebarCollapsed(false)} aria-label="Show conversation list" title="Show conversation list" className="mb-3">
              <PanelLeftOpen className="h-5 w-5" />
            </Button>
            <div className="space-y-2">
              {recent.map(({ type, summary }) => {
                const title = type === 'channel' ? summary.name : summary.title
                const peer = type === 'dm' ? directConversationPeer(summary, directory.currentUserId) : null
                const peerOnline = Boolean(peer && realtime.onlineUserIds.has(peer.id))
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
                    {type === 'channel' ? (
                      <>
                        {summary.visibility === 'staff_only' ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                        <span className="mt-0.5 max-w-12 truncate">{channelInitials(title)}</span>
                      </>
                    ) : peer ? (
                      <span className="relative inline-flex">
                        <Avatar name={peer.full_name} src={peer.avatar_url} size="sm" />
                        {peerOnline && <span aria-hidden="true" className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success-solid ring-2 ring-surface-sunken" />}
                      </span>
                    ) : (
                      <>
                        <Users className="h-4 w-4" />
                        <span className="mt-0.5 max-w-12 truncate">{initials(title)}</span>
                      </>
                    )}
                    {summary.unread_count > 0 && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-action-primary" aria-hidden="true" />}
                  </Link>
                )
              })}
            </div>
          </aside>
        )}

        {showConversationPane && (
        <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-raised">
          {selectedTarget && selected ? (
            <>
              <ConversationHeader
                selectedTarget={selectedTarget}
                selected={selected}
                route={route}
                conversation={conversation}
                directory={directory}
                alerts={alerts}
                onlineUserIds={realtime.onlineUserIds}
                conversationReturnContext={feed.conversationReturnContext}
                copyConversationLink={mutations.copyConversationLink}
                setAuthorContext={overlays.setAuthorContext}
                showPushMessage={view.showConversationHeaderPushMessage}
              />

              <ConversationFeed selectedTarget={selectedTarget} selectedLabel={directory.selectedLabel} isStaff={directory.isStaff} isNavigationPending={directory.isNavigationPending} conversation={conversation} feed={feed} view={view} />

              {showComposer && !showThreadPanel && renderComposer('main')}
            </>
          ) : (
            <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-ink-muted">
              {v2 && !directory.isStaff ? <div className="space-y-4"><p>Choose a conversation or message your course instructor.</p><InstructorMessageAction /></div> : 'Pick a chat or start a direct message.'}
            </div>
          )}
        </section>
        )}
      </div>
      <MessagesDialogs toast={toast} sourceRecord={route.sourceRecord} conversation={conversation} directory={directory} feed={feed} overlays={overlays} lightbox={lightbox} mutations={mutations} />
    </div>
  )
}
export { applyComposerList,applyComposerListShortcut } from '../../components/shared/MarkdownEditor';
export { recipientLabel,WorkspaceMemberIdentity } from './messages/ConversationControls';
export { FormattedMessage } from './messages/FormattedMessage';
export { cachedWindowIsContiguous,conversationPath,createMessageArrivals,forgetMessageArrival,mergeMessageWindow,messageShouldAnimateEntry,recordMessageArrival,restoreFailedSends,typingIndicatorLabel,type MessageArrivals } from './messages/helpers';
export { MessageComposer,type MessageComposerHandle,type MessageComposerSend } from './messages/MessageComposer';
export { MessageEditSurface } from './messages/MessageEditSurface';
