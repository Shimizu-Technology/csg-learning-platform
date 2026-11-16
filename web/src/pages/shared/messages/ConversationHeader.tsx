import { Bell, BellOff, BookOpen, ChevronLeft, Hash, Link2, Lock, MessageCircle, MonitorSmartphone, PanelLeftOpen, Pin, UserRound } from 'lucide-react';
import { type MouseEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { IconButton } from '../../../components/ui/Button';
import { OverflowMenu } from '../../../components/ui/OverflowMenu';
import { isPlainLeftClick } from '../../../lib/links';
import { readReturnContext } from '../../../lib/navigationContext';
import { cohortPath, cohortStudentPath } from '../../../lib/routes';
import type { ChannelSummary, DirectConversationSummary } from '../../../types/api';
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
  directory: Pick<WorkspaceDirectory, 'isStaff' | 'selectedChannel' | 'selectedDmStudent' | 'selectedLabel' | 'selectedMuted' | 'isNavigationPending' | 'toggleMute'>
  alerts: Pick<BrowserAlerts, 'pushEnabled' | 'pushMessage' | 'handleTogglePush'>
  conversationReturnContext: ConversationWindow['conversationReturnContext']
  copyConversationLink: MessageMutations['copyConversationLink']
  setAuthorContext: MessageOverlays['setAuthorContext']
  showPushMessage: boolean
}

/** The open conversation's title row, record links, mute and options, source context and alert status. */
export function ConversationHeader({ selectedTarget, selected, route, conversation, directory, alerts, conversationReturnContext, copyConversationLink, setAuthorContext, showPushMessage }: ConversationHeaderProps) {
  const location = useLocation()
  const { navigate, sourceRecord, sourceRecordPath } = route
  const { isDesktop, sidebarCollapsed, setSidebarCollapsed, conversationView, setConversationView, activeThreadRoot, setActiveThreadRootId, setMobilePane, selectedPinnedMessages } = conversation
  const { isStaff, selectedChannel, selectedDmStudent, selectedLabel, selectedMuted, isNavigationPending, toggleMute } = directory
  const { pushEnabled, pushMessage, handleTogglePush } = alerts

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
      {sourceRecord && sourceRecordPath && <div className="hide-with-keyboard mt-1.5 px-1 pb-0.5"><Link to={sourceRecordPath} className="pressable inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-info-line bg-info-soft px-3 text-xs font-semibold text-info-ink hover:bg-info-soft sm:min-h-9"><BookOpen className="h-3.5 w-3.5 shrink-0" /><span className="truncate">From {sourceRecord.type === 'submission' ? 'submission' : sourceRecord.type === 'intervention' ? 'follow-up plan' : 'help request'}: {sourceRecord.label}</span></Link></div>}
      {showPushMessage && (
        <div className="mt-1.5 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-sm text-ink-secondary">
          {pushMessage}
        </div>
      )}
    </header>
  )
}
