import { Bell, BellOff, BookOpen, ChevronLeft, Hash, Info, Link2, Lock, MonitorSmartphone, PanelLeftOpen, Pin, UserRound, Users } from 'lucide-react';
import { type MouseEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useCohortContext } from '../../../contexts/CohortContext';
import { useStudentExperience } from '../../../lib/studentExperience';
import { Avatar } from '../../../components/ui/Avatar';
import { IconButton } from '../../../components/ui/Button';
import { OverflowMenu } from '../../../components/ui/OverflowMenu';
import { isPlainLeftClick } from '../../../lib/links';
import { backLinkText, originLabel, useBackLink, backLinkOrigin } from '../../../lib/recordOrigin';
import { readReturnContext } from '../../../lib/navigationContext';
import { channelRecordPath, cohortPath, cohortStudentPath, safeInternalReturnPath } from '../../../lib/routes';
import type { ChannelSummary, DirectConversationSummary } from '../../../types/api';
import { directConversationPeer } from './helpers';
import type { Target } from './types';
import type { BrowserAlerts } from './useBrowserAlerts';
import type { ConversationState } from './useConversationState';
import type { ConversationWindow } from './useConversationWindow';
import type { MessageMutations } from './useMessageMutations';
import type { MessageOverlays } from './useMessageOverlays';
import type { MessagesRoute } from './useMessagesRoute';
import type { WorkspaceDirectory } from './useWorkspaceDirectory';

type ConversationHeaderProps = {
  selectedTarget: Target
  selected: ChannelSummary | DirectConversationSummary
  route: Pick<MessagesRoute, 'navigate' | 'sourceRecord' | 'sourceRecordPath'>
  conversation: Pick<ConversationState, 'isDesktop' | 'sidebarCollapsed' | 'setSidebarCollapsed' | 'conversationView' | 'setConversationView' | 'activeThreadRoot' | 'setActiveThreadRootId' | 'setMobilePane' | 'selectedPinnedMessages'>
  directory: Pick<WorkspaceDirectory, 'currentUserId' | 'isStaff' | 'selectedChannel' | 'selectedDm' | 'selectedDmStudent' | 'selectedLabel' | 'selectedMuted' | 'isNavigationPending' | 'toggleMute'>
  alerts: Pick<BrowserAlerts, 'pushEnabled' | 'pushMessage' | 'handleTogglePush'>
  onlineUserIds: ReadonlySet<number>
  conversationReturnContext: ConversationWindow['conversationReturnContext']
  copyConversationLink: MessageMutations['copyConversationLink']
  setAuthorContext: MessageOverlays['setAuthorContext']
  showPushMessage: boolean
}

/** The open conversation's title row, avatar/presence, pin shortcut, record links, mute and options, source context and alert status. */
export function ConversationHeader({ selectedTarget, selected, route, conversation, directory, alerts, onlineUserIds, conversationReturnContext, copyConversationLink, setAuthorContext, showPushMessage }: ConversationHeaderProps) {
  const experience = useStudentExperience()
  const { selectedCohortId } = useCohortContext()
  const v2 = experience.v2 && (!selected.cohort_id || selected.cohort_id === selectedCohortId)
  const location = useLocation()
  const originBack = useBackLink({ returnTo: '/dashboard', returnLabel: 'Today' }, { legacyInbox: v2 })
  const hasOrigin = !originBack.fallback
  const returnTo = v2 ? hasOrigin ? originBack.to : '' : safeInternalReturnPath(new URLSearchParams(location.search).get('return_to'), '')
  const workspaceId = selected.workspace_id
  const listPath = v2 && workspaceId ? `/messages?workspace_id=${workspaceId}` : '/messages'
  const { navigate, sourceRecord, sourceRecordPath } = route
  const { isDesktop, sidebarCollapsed, setSidebarCollapsed, conversationView, setConversationView, activeThreadRoot, setActiveThreadRootId, setMobilePane, selectedPinnedMessages } = conversation
  const { currentUserId, isStaff, selectedChannel, selectedDm, selectedDmStudent, selectedLabel, selectedMuted, isNavigationPending, toggleMute } = directory
  const { pushEnabled, pushMessage, handleTogglePush } = alerts
  const dmPeer = selectedTarget.type === 'dm' ? directConversationPeer(selectedDm, currentUserId) : null
  const dmPeerOnline = Boolean(dmPeer && onlineUserIds.has(dmPeer.id))
  const showingPins = conversationView === 'pins' && !activeThreadRoot
  const togglePinsView = () => {
    const showPins = !showingPins
    setActiveThreadRootId(null)
    if (!isDesktop) setMobilePane('conversation')
    setConversationView(showPins ? 'pins' : 'messages')
  }

  // Names in the conversation header are real links (L-2.8). A plain click keeps
  // the message you were reading, so "Back to conversation" returns to it.
  const headerStudentPath = isStaff && selectedDmStudent && selected?.cohort_id ? cohortStudentPath(selected.cohort_id, selectedDmStudent.id) : null
  const headerCohortPath = selected?.cohort_id ? isStaff ? cohortPath(selected.cohort_id) : v2 ? `/materials?cohort_id=${selected.cohort_id}` : null : null
  const openRecordWithReturn = (event: MouseEvent<HTMLAnchorElement>, to: string) => {
    if (!isPlainLeftClick(event)) return
    event.preventDefault()
    const context = readReturnContext(conversationReturnContext())
    // Keep the anchor on this history entry too, so browser Back resolves the same message.
    if (context) navigate(`${location.pathname}${location.search}`, { replace: true, state: context })
    navigate(to, { state: context })
  }

  return (
    <header className="shrink-0 border-b border-line bg-surface-raised px-1.5 py-1.5 sm:px-3">
      {returnTo && (!v2 || !isDesktop || sidebarCollapsed) && <Link to={returnTo} className="inline-flex min-h-11 items-center px-3 text-sm underline">{v2 && hasOrigin ? originBack.label : backLinkText(originLabel(returnTo) || 'Back')}</Link>}
      <div className="flex min-h-11 min-w-0 items-center gap-1">
        {isDesktop && sidebarCollapsed && (
          <IconButton label="Show conversation list" size="sm" onClick={() => setSidebarCollapsed(false)}>
            <PanelLeftOpen className="h-4 w-4" />
          </IconButton>
        )}
        {!isDesktop && (
          <IconButton label="Back to conversations" onClick={() => navigate(listPath, v2 ? { replace: true, state: backLinkOrigin(location.state, location.search, { legacyInbox: true }) || undefined } : { replace: true })}>
            <ChevronLeft className="h-5 w-5" />
          </IconButton>
        )}
        {selectedTarget.type === 'channel' ? (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-secondary ring-1 ring-inset ring-line" aria-hidden="true">
            {selectedChannel?.visibility === 'staff_only' ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
          </span>
        ) : dmPeer ? (
          <span className="relative inline-flex shrink-0">
            <Avatar name={dmPeer.full_name} src={dmPeer.avatar_url} size="md" />
            {dmPeerOnline && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full bg-success-solid ring-2 ring-surface-raised"
              />
            )}
          </span>
        ) : (
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-ink-secondary ring-1 ring-inset ring-line" aria-hidden="true">
            <Users className="h-4 w-4" />
          </span>
        )}
        <div className="min-w-0 flex-1 pl-1.5">
          <h2 className="truncate text-[15px] font-semibold leading-5 text-ink">
            {headerStudentPath
              ? <Link to={headerStudentPath} onClick={(event) => openRecordWithReturn(event, headerStudentPath)} className="rounded-sm hover:underline">{selectedLabel}</Link>
              : selectedLabel}
          </h2>
          <p className="hide-with-keyboard truncate text-xs leading-4 text-ink-muted">
            {headerCohortPath
              ? <Link to={headerCohortPath} onClick={(event) => openRecordWithReturn(event, headerCohortPath)} className={`rounded-sm hover:text-ink hover:underline${v2 && !isStaff ? ' inline-flex min-h-11 min-w-11 items-center' : ''}`}>{selected.workspace_name}</Link>
              : selected.workspace_name}
            {dmPeerOnline && <span className="text-success-ink"> · Active now</span>}
            {selectedTarget.type === 'channel' && selectedChannel?.visibility === 'staff_only' && ' · Staff only'}
            {isNavigationPending && ' · updating'}
          </p>
        </div>
        {selectedPinnedMessages.length > 0 && (
          <button
            type="button"
            aria-label={showingPins ? 'Back to conversation' : `View ${selectedPinnedMessages.length} pinned ${selectedPinnedMessages.length === 1 ? 'message' : 'messages'}`}
            aria-pressed={showingPins}
            onClick={togglePinsView}
            className={`pressable inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus lg:min-h-9 ${
              showingPins
                ? 'bg-primary-soft text-primary-ink ring-1 ring-inset ring-primary-soft-line'
                : 'text-ink-secondary hover:bg-surface-sunken hover:text-ink'
            }`}
          >
            <Pin className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{selectedPinnedMessages.length}</span>
          </button>
        )}
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
              label: showingPins ? 'Back to conversation' : `Pinned messages (${selectedPinnedMessages.length})`,
              icon: <Pin aria-hidden="true" />,
              onSelect: togglePinsView,
            },
            { key: 'alerts', label: pushEnabled ? 'Turn off browser alerts' : 'Turn on browser alerts', icon: <MonitorSmartphone aria-hidden="true" />, onSelect: () => void handleTogglePush() },
            // Staff: the channel's page (members, recent activity), L-5.2.
            ...(isStaff && selectedTarget.type === 'channel' ? [{ key: 'details', label: 'Conversation details', icon: <Info aria-hidden="true" />, to: `${channelRecordPath(selectedTarget.id)}?return_to=${encodeURIComponent(`${location.pathname}${location.search}`)}` }] : []),
          ]}
        />
      </div>
      {selectedTarget.type === 'channel' && selectedChannel?.description && <p className="hide-with-keyboard mt-1 hidden truncate px-1 text-xs text-ink-muted lg:block">{selectedChannel.description}</p>}
      {sourceRecord && sourceRecordPath && <div className="hide-with-keyboard mt-1.5 px-1 pb-0.5"><Link to={sourceRecordPath} className="pressable inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-info-line bg-info-soft px-3 text-xs font-semibold text-info-ink hover:bg-info-soft sm:min-h-9"><BookOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate">From {sourceRecord.type === 'submission' ? 'submission' : sourceRecord.type === 'intervention' ? 'follow-up plan' : 'help request'}: {sourceRecord.label}</span></Link></div>}
      {showPushMessage && (
        <div className="mt-1.5 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
          {pushMessage}
        </div>
      )}
    </header>
  )
}
