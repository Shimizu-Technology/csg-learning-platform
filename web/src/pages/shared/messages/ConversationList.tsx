import { BellRing, ChevronDown, Hash, Lock, MessageCircle, MonitorSmartphone, PanelLeftClose, Plus, RefreshCw, Search, SquarePen, Users, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useBackLink } from '../../../lib/recordOrigin';
import { useCohortContext } from '../../../contexts/CohortContext';
import { useStudentExperience } from '../../../lib/studentExperience';
import { IconButton } from '../../../components/ui/Button';
import { OverflowMenu, type OverflowMenuItem } from '../../../components/ui/OverflowMenu';
import { CountBadge, RowButton } from '../../../components/ui/RowButton';
import { ConversationLink } from './ConversationControls';
import { formatTime, preview } from './helpers';
import type { BrowserAlerts } from './useBrowserAlerts';
import type { ConversationState } from './useConversationState';
import type { MessageSearch } from './useMessageSearch';
import type { WorkspaceDirectory } from './useWorkspaceDirectory';

type ConversationListProps = {
  directory: Pick<WorkspaceDirectory, 'isAdmin' | 'workspaces' | 'workspaceDetail' | 'selectedWorkspaceId' | 'setShowChannelForm' | 'setShowDmForm' | 'setShowWorkspaceForm' | 'setShowWorkspaceSwitcher' | 'setShowWorkspaceMembers' | 'setWorkspaceError' | 'setChannelError' | 'setChannelForm' | 'recent' | 'selectedWorkspace' | 'canManageChannels' | 'totalWorkspaceUnreadCount' | 'loadLists'>
  conversation: Pick<ConversationState, 'selectedTarget' | 'sidebarCollapsed' | 'setSidebarCollapsed' | 'isDesktop' | 'selectTarget'>
  search: MessageSearch
  alerts: BrowserAlerts
  showListPane: boolean
}

/**
 * The inbox (U-4.11): a one-line header (title, workspace, search, new
 * message, ⋯), then one list of conversations. Each channel appears once.
 */
export function ConversationList({ directory, conversation, search, alerts, showListPane }: ConversationListProps) {
  const experience = useStudentExperience()
  const { selectedCohortId } = useCohortContext()
  const v2 = experience.v2 && (!directory.selectedWorkspace?.cohort_id || directory.selectedWorkspace.cohort_id === selectedCohortId)
  const back = useBackLink({ returnTo: '/dashboard', returnLabel: 'Today' }, { legacyInbox: v2 })
  const hasOrigin = !back.fallback
  const { isAdmin, workspaces, workspaceDetail, selectedWorkspaceId, setShowChannelForm, setShowDmForm, setShowWorkspaceForm, setShowWorkspaceSwitcher, setShowWorkspaceMembers, setWorkspaceError, setChannelError, setChannelForm, recent, selectedWorkspace, canManageChannels, totalWorkspaceUnreadCount, loadLists } = directory
  const { selectedTarget, sidebarCollapsed, setSidebarCollapsed, isDesktop, selectTarget } = conversation
  const { showInboxSearch, setShowInboxSearch, searchQuery, setSearchQuery, searchResults, setSearchResults, searchStatus } = search
  const { pushEnabled, pushMessage, handleTogglePush } = alerts
  if (!showListPane || sidebarCollapsed) return null

  const closeSearch = () => {
    setShowInboxSearch(false)
    setSearchQuery('')
    setSearchResults([])
  }
  const inboxActions: OverflowMenuItem[] = [
    ...(canManageChannels ? [{ key: 'channel', label: 'Create group chat', icon: <Plus aria-hidden="true" />, onSelect: () => { setChannelForm((current) => ({ ...current, workspace_id: String(selectedWorkspaceId) })); setShowChannelForm(true); setChannelError('') } }] : []),
    ...(isAdmin ? [{ key: 'workspace', label: 'Create community', icon: <Plus aria-hidden="true" />, onSelect: () => { setShowWorkspaceForm(true); setWorkspaceError('') } }] : []),
    ...(isAdmin && workspaceDetail?.can_manage ? [{ key: 'members', label: 'Manage members', icon: <Users aria-hidden="true" />, onSelect: () => { setShowWorkspaceMembers(true); setWorkspaceError('') } }] : []),
    { key: 'refresh', label: 'Refresh messages', icon: <RefreshCw aria-hidden="true" />, onSelect: () => void loadLists() },
    { key: 'alerts', label: pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts', icon: pushEnabled ? <BellRing aria-hidden="true" /> : <MonitorSmartphone aria-hidden="true" />, onSelect: () => void handleTogglePush() },
    ...(isDesktop ? [{ key: 'collapse', label: 'Collapse conversation list', icon: <PanelLeftClose aria-hidden="true" />, onSelect: () => setSidebarCollapsed(true) }] : []),
  ]
  const workspaceName = selectedWorkspace?.name || 'Cohorts and communities'

  return (
    <aside aria-label="Conversations" className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface-raised ${isDesktop ? 'border-r border-line' : ''}`}>
      {v2 && hasOrigin && <Link to={back.to} className="app-link inline-flex min-h-11 items-center px-3">{back.label}</Link>}
      <div className="shrink-0 border-b border-line bg-surface-raised px-2 py-1.5 sm:px-2.5">
        <div className="flex min-h-11 min-w-0 items-center gap-0.5" data-testid="inbox-header">
          <h1 className="shrink-0 pl-1.5 pr-1 text-base font-bold text-ink">Messages</h1>
          {workspaces.length > 1 ? (
            <button
              type="button"
              aria-label={`Switch cohort or community: ${workspaceName}${totalWorkspaceUnreadCount > 0 ? `, ${totalWorkspaceUnreadCount} unread` : ''}`}
              aria-haspopup="dialog"
              onClick={() => setShowWorkspaceSwitcher(true)}
              className="pressable flex min-h-11 min-w-0 flex-1 items-center justify-end gap-1 rounded-xl px-1.5 text-xs font-semibold text-ink-secondary hover:bg-surface-sunken hover:text-ink lg:min-h-9"
            >
              <span className="truncate">{workspaceName}</span>
              <CountBadge count={totalWorkspaceUnreadCount} />
              <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            </button>
          ) : (
            <span className="min-w-0 flex-1 truncate px-1.5 text-right text-xs font-semibold text-ink-muted">{selectedWorkspace?.name}</span>
          )}
          <IconButton size="sm" label={showInboxSearch ? 'Close message search' : 'Search messages'} aria-expanded={showInboxSearch} onClick={() => (showInboxSearch ? closeSearch() : setShowInboxSearch(true))}>
            {showInboxSearch ? <X className="h-[18px] w-[18px]" aria-hidden="true" /> : <Search className="h-[18px] w-[18px]" aria-hidden="true" />}
          </IconButton>
          <IconButton size="sm" label="New direct message" onClick={() => setShowDmForm(true)}>
            <SquarePen className="h-[18px] w-[18px]" aria-hidden="true" />
          </IconButton>
          <OverflowMenu label="Inbox options" size="sm" items={inboxActions} />
        </div>
        {showInboxSearch && (
          <div className="relative pb-1 pt-1">
            <Search className="pointer-events-none absolute left-3 top-[1.125rem] h-4 w-4 text-ink-muted" aria-hidden="true" />
            <input
              autoFocus
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') closeSearch() }}
              placeholder="Search messages"
              aria-label="Search messages"
              className="app-control w-full pl-9 text-base sm:text-sm"
            />
            {searchQuery.trim().length > 0 && searchResults.length === 0 && (
              <div role="status" className="absolute z-20 mt-2 w-full rounded-xl border border-line bg-surface-raised px-4 py-3 text-sm text-ink-secondary shadow-overlay">
                {searchQuery.trim().length < 2
                  ? 'Type at least 2 letters to search.'
                  : searchStatus === 'error'
                    ? 'Search isn’t working right now. Check your connection and try again.'
                    : searchStatus === 'done'
                      ? `No messages match “${searchQuery.trim()}”.`
                      : 'Searching messages…'}
              </div>
            )}
            {searchResults.length > 0 && (
              <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-surface-raised p-2 shadow-overlay" aria-busy={searchStatus === 'loading'}>
                {searchResults.map((result) => (
                  <RowButton
                    key={result.id}
                    onClick={() => {
                      selectTarget(
                        result.channel_id ? { type: 'channel', id: result.channel_id } : { type: 'dm', id: result.direct_conversation_id! },
                        { aroundMessageId: result.id, highlightedMessageId: result.id },
                      )
                      closeSearch()
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
          </div>
        )}
        {pushMessage && !selectedTarget && <p className="px-1.5 pb-1 text-xs text-ink-secondary" role="status">{pushMessage}</p>}
      </div>

      <nav aria-label={`${workspaceName} conversations`} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1.5">
        {recent.length === 0 ? (
          <div className="px-3 py-4 text-sm text-ink-muted">No conversations yet.</div>
        ) : recent.map(({ type, summary }) => (
          <ConversationLink
            key={`${type}:${summary.id}`}
            target={{ type, id: summary.id }}
            active={selectedTarget?.type === type && selectedTarget.id === summary.id}
            icon={type === 'channel'
              ? summary.visibility === 'staff_only' ? <Lock className="h-4 w-4 shrink-0" aria-hidden="true" /> : <Hash className="h-4 w-4 shrink-0" aria-hidden="true" />
              : <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />}
            title={type === 'channel' ? summary.name : summary.title}
            subtitle={summary.latest_message ? `${summary.latest_message.author_name}: ${preview(summary.latest_message.body)}` : type === 'channel' ? summary.description || 'No messages yet' : 'No messages yet'}
            latestAt={summary.latest_message?.created_at}
            unread={summary.unread_count}
            muted={summary.muted}
            onSelect={() => selectTarget({ type, id: summary.id })}
          />
        ))}
      </nav>
    </aside>
  )
}
