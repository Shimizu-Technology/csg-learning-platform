import { ChevronDown, Hash, Lock, MessageCircle, MoreHorizontal, PanelLeftClose, Plus, RefreshCw, Search, UserPlus } from 'lucide-react';
import { Button, IconButton } from '../../../components/ui/Button';
import { CountBadge, RowButton } from '../../../components/ui/RowButton';
import { ConversationButton } from './ConversationControls';
import { channelInitials, formatTime, preview } from './helpers';
import type { MessagesViewContext } from './messagesPresentation';

export function ConversationList({ context }: { context: Pick<MessagesViewContext, 'isAdmin' | 'workspaces' | 'workspaceDetail' | 'selectedWorkspaceId' | 'selectedTarget' | 'setShowChannelForm' | 'setShowDmForm' | 'setShowWorkspaceForm' | 'setShowWorkspaceSwitcher' | 'showWorkspaceMembers' | 'setShowWorkspaceMembers' | 'sidebarCollapsed' | 'setSidebarCollapsed' | 'channelsCollapsed' | 'setChannelsCollapsed' | 'isDesktop' | 'showInboxSearch' | 'setShowInboxSearch' | 'setShowInboxActions' | 'searchQuery' | 'setSearchQuery' | 'searchResults' | 'setSearchResults' | 'highlightedMessageId' | 'setWorkspaceError' | 'setChannelError' | 'setChannelForm' | 'selected' | 'visibleChannels' | 'recent' | 'selectedWorkspace' | 'canManageChannels' | 'totalWorkspaceUnreadCount' | 'workspaceSwitcherSubtitle' | 'unreadOtherWorkspaceCards' | 'channelsUnreadCount' | 'loadLists' | 'selectTarget' | 'selectWorkspace' | 'showListPane'> }) {
const {
    isAdmin,
    workspaces,
    workspaceDetail,
    selectedWorkspaceId,
    selectedTarget,
    setShowChannelForm,
    setShowDmForm,
    setShowWorkspaceForm,
    setShowWorkspaceSwitcher,
    showWorkspaceMembers,
    setShowWorkspaceMembers,
    sidebarCollapsed,
    setSidebarCollapsed,
    channelsCollapsed,
    setChannelsCollapsed,
    isDesktop,
    showInboxSearch,
    setShowInboxSearch,
    setShowInboxActions,
    searchQuery,
    setSearchQuery,
    searchResults,
    setSearchResults,
    setWorkspaceError,
    setChannelError,
    setChannelForm,
    visibleChannels,
    recent,
    selectedWorkspace,
    canManageChannels,
    totalWorkspaceUnreadCount,
    workspaceSwitcherSubtitle,
    unreadOtherWorkspaceCards,
    channelsUnreadCount,
    loadLists,
    selectTarget,
    selectWorkspace,
    showListPane
  } = context
return (<>{showListPane && !sidebarCollapsed && (
        <aside className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 ${isDesktop ? 'border-b border-slate-200 lg:border-b-0 lg:border-r' : ''}`}>
          <div className="shrink-0 border-b border-slate-200 bg-white p-2.5 sm:p-3">
            {!isDesktop && <div className="flex min-h-11 min-w-0 items-center gap-1" data-testid="compact-inbox-header">
              <h1 className="shrink-0 text-base font-bold text-ink">Messages</h1>
              <button type="button" aria-label={`Switch workspace: ${selectedWorkspace?.name || 'Choose workspace'}`} aria-haspopup="dialog" onClick={() => setShowWorkspaceSwitcher(true)} className="ml-1 flex min-h-11 min-w-0 flex-1 items-center justify-end gap-1 rounded-xl px-2 text-xs font-semibold text-ink-secondary hover:bg-surface-sunken">
                <span className="truncate">{selectedWorkspace?.name || 'Workspaces'}</span><CountBadge count={totalWorkspaceUnreadCount} label="unread" /><ChevronDown className="h-3.5 w-3.5 shrink-0" />
              </button>
              <IconButton label={showInboxSearch ? 'Close message search' : 'Search messages'} aria-expanded={showInboxSearch} onClick={() => { setShowInboxSearch(!showInboxSearch); setSearchQuery(''); setSearchResults([]) }}><Search className="h-5 w-5" /></IconButton>
              <IconButton label="Inbox options" onClick={() => setShowInboxActions(true)}><MoreHorizontal className="h-5 w-5" /></IconButton>
            </div>}
            {isDesktop && <>
            <div className="mb-2.5 flex min-w-0 items-center justify-between gap-2 sm:mb-3">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-slate-900">{selectedWorkspace?.name || 'Workspaces'}</h2>
                <p className="text-xs text-slate-500">{isDesktop ? 'Workspace' : 'Choose a workspace, channel, or direct message'}</p>
              </div>
              <div className="flex items-center gap-1">
                {isAdmin && (
                  <IconButton
                    label="Create workspace"
                    onClick={() => {
                      setShowWorkspaceForm(true)
                      setWorkspaceError('')
                    }}
                  >
                    <Plus className="h-4 w-4" />
                  </IconButton>
                )}
                <IconButton label="Refresh messages" onClick={loadLists}>
                  <RefreshCw className="h-4 w-4" />
                </IconButton>
                {isDesktop && (
                  <IconButton label="Collapse conversation list" onClick={() => setSidebarCollapsed(true)}>
                    <PanelLeftClose className="h-4 w-4" />
                  </IconButton>
                )}
              </div>
            </div>
            {workspaces.length > 1 && (
              <RowButton
                onClick={() => setShowWorkspaceSwitcher(true)}
                aria-haspopup="dialog"
                className="group flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-surface-raised px-3 py-2 shadow-raised hover:border-line-strong sm:py-2.5"
              >
                <span className="flex min-w-0 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-xs font-semibold text-slate-700">
                    {selectedWorkspace ? channelInitials(selectedWorkspace.name) : 'WS'}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900">{selectedWorkspace?.name || 'Choose workspace'}</span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">
                      {workspaceSwitcherSubtitle}
                    </span>
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <CountBadge count={totalWorkspaceUnreadCount} label="unread" />
                  <ChevronDown className="h-4 w-4 text-ink-muted transition-colors group-hover:text-ink" aria-hidden="true" />
                </span>
              </RowButton>
            )}
            {selectedWorkspace && (
              <div className="mt-2.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 sm:mt-3 sm:py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{selectedWorkspace.name}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {selectedWorkspace.workspace_type === 'community' ? 'Community workspace' : 'Cohort workspace'}
                      {' · '}
                      <span className="tabular-nums">{selectedWorkspace.member_count}</span> {selectedWorkspace.member_count === 1 ? 'member' : 'members'}
                    </p>
                  </div>
                  {isAdmin && workspaceDetail?.can_manage && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setShowWorkspaceMembers(true)
                        setWorkspaceError('')
                      }}
                      className="shrink-0"
                    >
                      {showWorkspaceMembers ? 'Hide members' : 'Manage'}
                    </Button>
                  )}
                </div>
                {selectedWorkspace.description && (
                  <p className="mt-2 line-clamp-2 text-xs text-slate-500">{selectedWorkspace.description}</p>
                )}
              </div>
            )}
            {unreadOtherWorkspaceCards.length > 0 && (
              <div className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-ink-secondary">Unread elsewhere</p>
                  <Button variant="quiet" size="sm" onClick={() => setShowWorkspaceSwitcher(true)} className="-my-2 -mr-2">
                    View all
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {unreadOtherWorkspaceCards.slice(0, 3).map(({ workspace, unreadCount }) => (
                    <Button
                      key={workspace.id}
                      variant="secondary"
                      size="sm"
                      onClick={() => selectWorkspace(workspace.id)}
                      className="max-w-full gap-1.5 rounded-full! px-3 text-xs"
                    >
                      <span className="truncate">{workspace.name}</span>
                      <CountBadge count={unreadCount} label="unread" />
                    </Button>
                  ))}
                </div>
              </div>
            )}
            </>}
            {(isDesktop || showInboxSearch) && <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-muted" aria-hidden="true" />
              <input
                autoFocus={!isDesktop}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search messages"
                aria-label="Search messages"
                className="app-control w-full pl-9 text-base sm:text-sm"
              />
              {searchResults.length > 0 && (
                <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-surface-raised p-2 shadow-overlay">
                  {searchResults.map((result) => (
                    <RowButton
                      key={result.id}
                      onClick={() => {
                        selectTarget(
                          result.channel_id ? { type: 'channel', id: result.channel_id } : { type: 'dm', id: result.direct_conversation_id! },
                          { aroundMessageId: result.id, highlightedMessageId: result.id },
                        )
                        setSearchQuery('')
                        setSearchResults([])
                      }}
                      className="block w-full rounded-lg px-3 py-2 text-sm"
                    >
                      <span className="font-semibold text-ink">{result.author.full_name}</span>
                      <span className="ml-2 text-xs tabular-nums text-ink-muted">{formatTime(result.created_at)}</span>
                      <span className="mt-1 block truncate text-xs text-ink-secondary">{preview(result.body)}</span>
                    </RowButton>
                  ))}
                </div>
              )}
            </div>}
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1.5 sm:p-2">
            <div className="mb-2 flex items-center justify-between px-2 pt-2">
              <div className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink-muted">
                <span>Recent</span>
                <span className="tabular-nums">{recent.length}</span>
              </div>
              <IconButton label="Start direct message" onClick={() => setShowDmForm(true)}>
                <UserPlus className="h-4 w-4" />
              </IconButton>
            </div>
            {recent.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500">No conversations yet.</div>
            ) : recent.map(({ type, summary }) => (
              <ConversationButton
                key={`${type}:${summary.id}`}
                active={selectedTarget?.type === type && selectedTarget.id === summary.id}
                icon={type === 'channel'
                  ? summary.visibility === 'staff_only' ? <Lock className="h-4 w-4 shrink-0" /> : <Hash className="h-4 w-4 shrink-0" />
                  : <MessageCircle className="h-4 w-4 shrink-0" />}
                title={type === 'channel' ? summary.name : summary.title}
                subtitle={summary.latest_message ? `${summary.latest_message.author_name}: ${preview(summary.latest_message.body)}` : type === 'channel' ? summary.description || 'No messages yet' : 'No messages yet'}
                latestAt={summary.latest_message?.created_at}
                unread={summary.unread_count}
                muted={summary.muted}
                onClick={() => selectTarget({ type, id: summary.id })}
              />
            ))}

            <div className="mb-2 mt-5 flex items-center justify-between px-2">
              <Button
                variant="quiet"
                size="sm"
                onClick={() => setChannelsCollapsed((current) => !current)}
                className="-ml-2 min-w-0 gap-1.5 px-2 text-xs text-ink-muted"
                aria-expanded={!channelsCollapsed}
              >
                <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${channelsCollapsed ? '-rotate-90' : ''}`} aria-hidden="true" />
                <span>Browse channels</span>
                <CountBadge count={channelsUnreadCount} label="unread" />
              </Button>
              {canManageChannels && (
                <IconButton label="Create channel" onClick={() => { setChannelForm((current) => ({ ...current, workspace_id: String(selectedWorkspaceId) })); setShowChannelForm(true); setChannelError('') }}>
                  <Plus className="h-4 w-4" />
                </IconButton>
              )}
            </div>
            {!channelsCollapsed && (
              <div className="px-2 pb-3">
                {visibleChannels.length === 0 ? <p className="px-1 py-2 text-xs text-slate-500">No channels yet.</p> : visibleChannels.map((channel) => (
                  <RowButton
                    key={channel.id}
                    onClick={() => selectTarget({ type: 'channel', id: channel.id })}
                    selected={selectedTarget?.type === 'channel' && selectedTarget.id === channel.id}
                    aria-current={selectedTarget?.type === 'channel' && selectedTarget.id === channel.id ? 'true' : undefined}
                    className={`flex w-full items-center gap-2 rounded-xl px-2 text-sm ${selectedTarget?.type === 'channel' && selectedTarget.id === channel.id ? 'font-semibold' : channel.unread_count > 0 ? 'font-semibold text-ink' : 'text-ink-secondary'}`}
                  >
                    {channel.visibility === 'staff_only' ? <Lock className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Hash className="h-4 w-4 shrink-0" aria-hidden="true" />}
                    <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                    {channel.unread_count > 0 && <span className="h-2 w-2 shrink-0 rounded-full bg-ruby-600" aria-hidden="true" />}
                    {channel.unread_count > 0 && <span className="sr-only">, unread</span>}
                  </RowButton>
                ))}
              </div>
            )}
          </div>
        </aside>
        )}</>)
}
