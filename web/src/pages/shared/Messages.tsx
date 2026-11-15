import { Hash, Lock, MessageCircle, PanelLeftOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MessagesLoadingShell } from '../../components/shared/MessagesLoadingShell';
import { Button } from '../../components/ui/Button';
import { isPlainLeftClick } from '../../lib/links';
import { ConversationFeed } from './messages/ConversationFeed';
import { ConversationHeader } from './messages/ConversationHeader';
import { ConversationList } from './messages/ConversationList';
import { channelInitials, conversationPath, initials } from './messages/helpers';
import { MessagesDialogs } from './messages/MessagesDialogs';
import { messagesPresentation } from './messages/messagesPresentation';
import { useMessagesController } from './messages/useMessagesController';

export function Messages() {
  const controller = useMessagesController()
  const { toast, route, conversation, overlays, search, lightbox, directory, alerts, feed, mutations } = controller
  if (directory.loading) return <MessagesLoadingShell />
  const view = messagesPresentation(controller)
  const { selectedTarget, isDesktop, sidebarCollapsed, setSidebarCollapsed, selectTarget } = conversation
  const { recent, selected } = directory
  const { showConversationPane, showCollapsedRail, showThreadPanel, showComposer, renderComposer } = view

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-[1500px] min-w-0 flex-col gap-0 overflow-hidden">
      <div className={`${isDesktop ? 'grid overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-raised' : 'flex min-w-0 overflow-hidden border-y border-line bg-surface-raised'} min-h-0 flex-1 ${isDesktop ? (sidebarCollapsed ? 'lg:grid-cols-[72px_minmax(0,1fr)]' : 'lg:grid-cols-[328px_minmax(0,1fr)]') : ''}`}>
        <ConversationList directory={directory} conversation={conversation} search={search} alerts={alerts} showListPane={view.showListPane} />
        {showCollapsedRail && (
          <aside className="hidden border-r border-line bg-surface-sunken p-2 lg:block">
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
              Pick a chat or start a direct message.
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
