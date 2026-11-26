import { BellRing, ChevronDown, Hash, Lock, MonitorSmartphone, PanelLeftClose, Plus, RefreshCw, Search, SquarePen, Users, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useBackLink } from '../../../lib/recordOrigin';
import { useCohortContext } from '../../../contexts/CohortContext';
import { COMPOSER_DRAFT_EVENT, composerDestinationKey, readComposerDraft, safeLocalStorage } from '../../../lib/messageComposerState';
import { useStudentExperience } from '../../../lib/studentExperience';
import { Avatar } from '../../../components/ui/Avatar';
import { IconButton } from '../../../components/ui/Button';
import { OverflowMenu, type OverflowMenuItem } from '../../../components/ui/OverflowMenu';
import { CountBadge, RowButton } from '../../../components/ui/RowButton';
import { ConversationLink } from './ConversationControls';
import { directConversationPeer, formatTime, preview } from './helpers';
import type { BrowserAlerts } from './useBrowserAlerts';
import type { ConversationState } from './useConversationState';
import type { MessageSearch } from './useMessageSearch';
import type { WorkspaceDirectory } from './useWorkspaceDirectory';

export type InboxFilter = 'all' | 'unread' | 'dm' | 'channel'

type ConversationListProps = {
  directory: Pick<WorkspaceDirectory, 'currentUserId' | 'isAdmin' | 'workspaces' | 'workspaceDetail' | 'selectedWorkspaceId' | 'setShowChannelForm' | 'setShowDmForm' | 'setShowWorkspaceForm' | 'setShowWorkspaceSwitcher' | 'setShowWorkspaceMembers' | 'setWorkspaceError' | 'setChannelError' | 'setChannelForm' | 'recent' | 'selectedWorkspace' | 'canManageChannels' | 'totalWorkspaceUnreadCount' | 'loadLists'>
  conversation: Pick<ConversationState, 'selectedTarget' | 'sidebarCollapsed' | 'setSidebarCollapsed' | 'isDesktop' | 'selectTarget' | 'conversationView' | 'activeThreadRoot'>
  search: MessageSearch
  alerts: BrowserAlerts
  onlineUserIds: ReadonlySet<number>
  filter: InboxFilter
  setFilter: (value: InboxFilter) => void
  filteredRecent: WorkspaceDirectory['recent']
  showListPane: boolean
}

/**
 * The inbox (U-4.11): a one-line header (title, workspace, search, new
 * message, ⋯), compact filter pills when multiple conversations exist, then one
 * list of conversations with avatars, presence dots, and live draft previews.
 */
export function ConversationList({ directory, conversation, search, alerts, onlineUserIds, filter, setFilter, filteredRecent, showListPane }: ConversationListProps) {
  const experience = useStudentExperience()
  const { selectedCohortId } = useCohortContext()
  const v2 = experience.v2 && (!directory.selectedWorkspace?.cohort_id || directory.selectedWorkspace.cohort_id === selectedCohortId)
  const back = useBackLink({ returnTo: '/dashboard', returnLabel: 'Today' }, { legacyInbox: v2 })
  const hasOrigin = !back.fallback
  const { currentUserId, isAdmin, workspaces, workspaceDetail, selectedWorkspaceId, setShowChannelForm, setShowDmForm, setShowWorkspaceForm, setShowWorkspaceSwitcher, setShowWorkspaceMembers, setWorkspaceError, setChannelError, setChannelForm, recent, selectedWorkspace, canManageChannels, totalWorkspaceUnreadCount, loadLists } = directory
  const { selectedTarget, sidebarCollapsed, setSidebarCollapsed, isDesktop, selectTarget, conversationView, activeThreadRoot } = conversation
  const { showInboxSearch, setShowInboxSearch, searchQuery, setSearchQuery, searchResults, clearSearchResults, searchStatus } = search
  const { pushEnabled, pushMessage, handleTogglePush } = alerts
  const [draftRevision, setDraftRevision] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const refresh = () => setDraftRevision((value) => value + 1)
    window.addEventListener(COMPOSER_DRAFT_EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(COMPOSER_DRAFT_EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const draftsByKey = useMemo(() => {
    const map = new Map<string, string>()
    if (!showListPane || sidebarCollapsed || !currentUserId) return map
    const storage = safeLocalStorage()
    if (!storage) return map
    // Reading draftRevision ties this snapshot to live draft change events.
    void draftRevision
    for (const item of recent) {
      const key = composerDestinationKey(currentUserId, { type: item.type, id: item.summary.id }, null)
      const draft = readComposerDraft(key, storage)
      if (draft?.body.trim()) map.set(`${item.type}:${item.summary.id}`, preview(draft.body))
    }
    return map
  }, [currentUserId, draftRevision, recent, showListPane, sidebarCollapsed])

  const unreadConversationCount = useMemo(
    () => recent.filter((item) => item.summary.unread_count > 0).length,
    [recent],
  )
  const hasGroupChats = useMemo(
    () => recent.some((item) => item.type === 'channel' || directConversationPeer(item.summary, currentUserId) === null),
    [currentUserId, recent],
  )
  const hasDirectChats = useMemo(
    () => recent.some((item) => item.type === 'dm' && directConversationPeer(item.summary, currentUserId) !== null),
    [currentUserId, recent],
  )

  if (!showListPane || sidebarCollapsed) return null

  const closeSearch = () => {
    setShowInboxSearch(false)
    setSearchQuery('')
    clearSearchResults()
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
  const showFilters = recent.length > 1 && (unreadConversationCount > 0 || filter !== 'all' || (hasGroupChats && hasDirectChats))
  const filterOptions: { key: InboxFilter; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    ...(unreadConversationCount > 0 || filter === 'unread' ? [{ key: 'unread' as const, label: 'Unread', count: unreadConversationCount || undefined }] : []),
    ...(hasDirectChats && hasGroupChats ? [{ key: 'dm' as const, label: 'Direct' }, { key: 'channel' as const, label: 'Group chats' }] : []),
  ]

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
              <div className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-line bg-surface-raised p-2 shadow-overlay">
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
        {showFilters && (
          <div role="group" aria-label="Filter conversations" className="messages-toolbar-scroll flex items-center gap-1 overflow-x-auto px-1 pb-1 pt-1">
            {filterOptions.map((option) => {
              const selected = filter === option.key
              return (
                <button
                  key={option.key}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setFilter(option.key)}
                  className={`pressable inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus sm:min-h-8 sm:px-2.5 ${
                    selected
                      ? 'bg-primary-soft text-primary-ink ring-1 ring-inset ring-primary-soft-line'
                      : 'text-ink-muted hover:bg-surface-sunken hover:text-ink'
                  }`}
                >
                  <span>{option.label}</span>
                  {option.count !== undefined && (
                    <span className="tabular-nums opacity-85">{option.count}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
        {pushMessage && !selectedTarget && <p className="px-1.5 pb-1 text-xs text-ink-secondary" role="status">{pushMessage}</p>}
      </div>

      <nav aria-label={`${workspaceName} conversations`} className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-1.5">
        {filteredRecent.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-ink-muted">
            <p>{filter === 'unread' ? 'You’re all caught up.' : 'No conversations yet.'}</p>
            {filter !== 'all' && (
              <button
                type="button"
                onClick={() => setFilter('all')}
                className="mt-2 inline-flex min-h-9 items-center rounded-xl px-3 text-xs font-semibold text-primary-ink hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                Show all conversations
              </button>
            )}
          </div>
        ) : filteredRecent.map(({ type, summary }) => {
          const isSelected = selectedTarget?.type === type && selectedTarget.id === summary.id
          const peer = type === 'dm' ? directConversationPeer(summary, currentUserId) : null
          const peerOnline = Boolean(peer && onlineUserIds.has(peer.id))
          const leading = type === 'channel' ? (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken text-ink-secondary ring-1 ring-inset ring-line" aria-hidden="true">
              {summary.visibility === 'staff_only' ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
            </span>
          ) : peer ? (
            <span className="relative inline-flex">
              <Avatar name={peer.full_name} src={peer.avatar_url} size="md" />
              {peerOnline && (
                <span
                  aria-hidden="true"
                  className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success-solid ring-2 ring-surface-raised"
                />
              )}
            </span>
          ) : (
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-sunken text-ink-secondary ring-1 ring-inset ring-line" aria-hidden="true">
              <Users className="h-4 w-4" />
            </span>
          )

          const latest = summary.latest_message
          const isOwnLatest = Boolean(latest && currentUserId != null && latest.author_id === currentUserId)
          const latestAuthorPrefix = latest
            ? isOwnLatest
              ? 'You: '
              : type === 'channel' || !peer
                ? `${latest.author_name}: `
                : ''
            : ''
          const subtitle = latest
            ? `${latestAuthorPrefix}${preview(latest.body)}`
            : type === 'channel'
              ? summary.description || 'No messages yet'
              : 'No messages yet'
          const rootComposerVisible = isSelected && isDesktop && conversationView === 'messages' && !activeThreadRoot

          return (
            <ConversationLink
              key={`${type}:${summary.id}`}
              target={{ type, id: summary.id }}
              active={isSelected}
              icon={leading}
              title={type === 'channel' ? summary.name : summary.title}
              subtitle={subtitle}
              draftPreview={!rootComposerVisible ? draftsByKey.get(`${type}:${summary.id}`) : null}
              latestAt={latest?.created_at}
              unread={summary.unread_count}
              muted={summary.muted}
              onSelect={() => selectTarget({ type, id: summary.id })}
            />
          )
        })}
      </nav>
    </aside>
  )
}
