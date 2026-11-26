import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { Check, ChevronDown, Hash, MessageCircle, PenLine, Search, Users, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationRow } from '@/components/conversation-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { fontScaleLimits, fonts } from '@/constants/csg-theme';
import { useInboxQuery } from '@/hooks/use-inbox';
import { subscribeToStaffPresence, subscribeToUserMessages } from '@/lib/cable';
import {
  directConversationPeer,
  isDirectOneToOne,
  isGroupConversation,
  isRecentlyOnline,
  PRESENCE_TICK_MS,
} from '@/lib/chat-helpers';
import { loadConversationDrafts, subscribeDraftChanges } from '@/lib/conversation-storage';
import { messagingKeys, type InboxSnapshot } from '@/lib/messaging-cache';
import { recentConversations } from '@/lib/recent-conversations';
import type { DirectConversationSummary, RealtimeMessageEvent } from '@/lib/types';
import { buildWorkspaceCards } from '@/lib/workspaces';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';

type InboxFilter = 'all' | 'unread' | 'dm' | 'channel';

export default function MessagesScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const { workspaces, activeWorkspaceId, activeWorkspace, loading: loadingWorkspaces, error: workspaceError, refresh: refreshWorkspaces, selectWorkspace } = useWorkspace();
  const userId = user?.id ?? null;
  const isStaff = Boolean(user?.is_staff);
  const inboxKey = useMemo(() => messagingKeys.inbox(userId ?? 0), [userId]);
  const inboxQuery = useInboxQuery();
  const { data: inboxData, error: inboxError, isFetching: inboxFetching, isPending: inboxPending, isStale: inboxStale, refetch: refetchInbox } = inboxQuery;
  const channels = useMemo(() => inboxData?.channels ?? [], [inboxData?.channels]);
  const dms = useMemo(() => inboxData?.dms ?? [], [inboxData?.dms]);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(false);
  const [inboxFilter, setInboxFilter] = useState<InboxFilter>('all');
  const [filterWorkspaceId, setFilterWorkspaceId] = useState<number | null>(activeWorkspaceId);
  if (filterWorkspaceId !== activeWorkspaceId) {
    setFilterWorkspaceId(activeWorkspaceId);
    if (inboxFilter !== 'all') setInboxFilter('all');
  }

  // Live staff presence (2-minute window, 30s tick, scoped by userId + role).
  const presenceScopeKey = !auth.demo && isStaff && userId ? `${userId}:staff` : '';
  const [presenceState, setPresenceState] = useState<{ scopeKey: string; entries: Record<number, string> }>({ scopeKey: presenceScopeKey, entries: {} });
  if (presenceState.scopeKey !== presenceScopeKey) {
    setPresenceState({ scopeKey: presenceScopeKey, entries: {} });
  }
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  const [draftState, setDraftState] = useState<{ userId: number | null; drafts: Map<string, string> }>({ userId, drafts: new Map() });
  const [draftRevision, setDraftRevision] = useState(0);

  useFocusEffect(useCallback(() => {
    if (inboxData && inboxStale && !inboxFetching) void refetchInbox();
    setDraftRevision((value) => value + 1);
  }, [inboxData, inboxFetching, inboxStale, refetchInbox]));

  useEffect(() => subscribeDraftChanges(() => setDraftRevision((value) => value + 1)), []);

  useFocusEffect(useCallback(() => {
    if (auth.demo || !inboxData) return undefined;
    return subscribeToUserMessages(api, (event: RealtimeMessageEvent) => {
      if (event.event === 'typing') return;
      const channel = event.channel;
      const conversation = event.direct_conversation;
      queryClient.setQueryData<InboxSnapshot>(inboxKey, (current) => ({
        channels: channel ? [channel, ...(current?.channels || []).filter((item) => item.id !== channel.id)] : current?.channels || [],
        dms: conversation ? [conversation, ...(current?.dms || []).filter((item) => item.id !== conversation.id)] : current?.dms || [],
      }));
    });
  }, [api, auth.demo, inboxData, inboxKey, queryClient]));

  useFocusEffect(useCallback(() => {
    if (!presenceScopeKey) return undefined;
    let active = true;
    const scope = presenceScopeKey;
    setPresenceNow(Date.now());
    const unsubscribe = subscribeToStaffPresence(api, (event) => {
      if (!active) return;
      setPresenceState((current) => {
        if (current.scopeKey !== scope) return current;
        return {
          scopeKey: scope,
          entries: { ...current.entries, [event.user_id]: event.last_seen_at },
        };
      });
      setPresenceNow(Date.now());
    });
    const timer = setInterval(() => {
      if (active) setPresenceNow(Date.now());
    }, PRESENCE_TICK_MS);
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, [api, presenceScopeKey]));

  const onlineUserIds = useMemo<ReadonlySet<number>>(() => {
    const online = new Set<number>();
    if (auth.demo) {
      // Demo mode: show the first 1:1 DM partner as active now so visual previews exercise presence UI.
      const firstPeer = dms[0] ? directConversationPeer(dms[0], userId) : null;
      if (firstPeer) online.add(firstPeer.id);
      return online;
    }
    if (!presenceScopeKey || presenceState.scopeKey !== presenceScopeKey) return online;
    for (const [id, lastSeenAt] of Object.entries(presenceState.entries)) {
      if (isRecentlyOnline(lastSeenAt, presenceNow)) online.add(Number(id));
    }
    return online;
  }, [auth.demo, dms, presenceNow, presenceScopeKey, presenceState, userId]);

  const workspaceCards = useMemo(() => buildWorkspaceCards(workspaces, channels, dms), [channels, dms, workspaces]);
  const totalWorkspaceUnread = useMemo(
    () => workspaceCards.reduce((sum, card) => sum + card.unreadCount, 0),
    [workspaceCards],
  );

  const searchFilter = query.trim().toLowerCase();
  const workspaceChannels = useMemo(() => channels.filter((item) => item.workspace_id === activeWorkspaceId), [activeWorkspaceId, channels]);
  const workspaceDms = useMemo(() => dms.filter((item) => item.workspace_id === activeWorkspaceId), [activeWorkspaceId, dms]);
  const workspaceRecent = useMemo(() => recentConversations(workspaceChannels, workspaceDms), [workspaceChannels, workspaceDms]);

  useEffect(() => {
    let active = true;
    if (!userId || auth.demo || workspaceRecent.length === 0) return undefined;
    void loadConversationDrafts(
      userId,
      workspaceRecent.map(({ kind, item }) => ({ kind, id: item.id })),
    ).then((loaded) => {
      if (active) setDraftState({ userId, drafts: loaded });
    });
    return () => { active = false; };
  }, [auth.demo, draftRevision, userId, workspaceRecent]);

  const draftsByKey = useMemo(
    () => (!userId || auth.demo || workspaceRecent.length === 0 || draftState.userId !== userId ? new Map<string, string>() : draftState.drafts),
    [auth.demo, draftState, userId, workspaceRecent.length],
  );

  const unreadConversationCount = useMemo(
    () => workspaceRecent.filter(({ item }) => item.unread_count > 0).length,
    [workspaceRecent],
  );
  const hasDirectChats = useMemo(
    () => workspaceRecent.some(({ kind, item }) => isDirectOneToOne(kind, item, userId)),
    [userId, workspaceRecent],
  );
  const hasGroupChats = useMemo(
    () => workspaceRecent.some(({ kind, item }) => isGroupConversation(kind, item, userId)),
    [userId, workspaceRecent],
  );

  const visibleRecent = useMemo(() => {
    const byPill = workspaceRecent.filter(({ kind, item }) => {
      if (inboxFilter === 'unread') return item.unread_count > 0;
      if (inboxFilter === 'dm') return isDirectOneToOne(kind, item, userId);
      if (inboxFilter === 'channel') return isGroupConversation(kind, item, userId);
      return true;
    });
    if (!searchFilter) return byPill;
    return byPill.filter(({ kind, item }) => {
      const title = kind === 'channel' ? item.name : (item as DirectConversationSummary).title;
      return `${title} ${item.latest_message?.body || ''}`.toLowerCase().includes(searchFilter);
    });
  }, [inboxFilter, searchFilter, userId, workspaceRecent]);

  const showFilters = workspaceRecent.length > 1 && (unreadConversationCount > 0 || inboxFilter !== 'all' || (hasDirectChats && hasGroupChats));
  const filterOptions: { key: InboxFilter; label: string; count?: number }[] = [
    { key: 'all', label: 'All' },
    ...(unreadConversationCount > 0 || inboxFilter === 'unread' ? [{ key: 'unread' as const, label: 'Unread', count: unreadConversationCount || undefined }] : []),
    ...(hasDirectChats && hasGroupChats ? [{ key: 'dm' as const, label: 'Direct' }, { key: 'channel' as const, label: 'Group chats' }] : []),
  ];

  const open = (kind: 'channel' | 'dm', item: typeof channels[number] | typeof dms[number]) => router.push({
    pathname: '/conversation/[kind]/[id]',
    params: { kind, id: String(item.id), title: 'name' in item ? item.name : item.title, workspaceName: item.workspace_name },
  });
  const refreshAll = async () => {
    setRefreshing(true);
    try { await Promise.all([refetchInbox(), refreshWorkspaces()]); }
    finally { setRefreshing(false); }
  };
  const blockingLoad = (!inboxData && inboxPending) || (loadingWorkspaces && !workspaces.length);
  const blockingError = !inboxData && inboxError ? inboxError.message : workspaceError && !workspaces.length ? workspaceError : null;

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header} testID="compact-inbox-header">
        <Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.title} style={styles.heading}>Messages</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Current cohort or community: ${activeWorkspace?.name || 'Cohorts and communities'}${totalWorkspaceUnread > 0 ? `, ${totalWorkspaceUnread} unread` : ''}. Switch cohort or community`}
          onPress={() => setShowWorkspaces(true)}
          style={styles.compactWorkspace}
        >
          <Text maxFontSizeMultiplier={fontScaleLimits.content} numberOfLines={1} style={styles.workspaceName}>{activeWorkspace?.name || 'Cohorts and communities'}</Text>
          {totalWorkspaceUnread > 0 && (
            <View style={styles.headerUnreadPill}>
              <Text allowFontScaling={false} style={styles.headerUnreadText}>{totalWorkspaceUnread > 99 ? '99+' : totalWorkspaceUnread}</Text>
            </View>
          )}
          <ChevronDown color={c.text.body} size={16} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={showSearch ? 'Close search' : 'Search conversations'} accessibilityState={{ expanded: showSearch }} onPress={() => { setShowSearch(!showSearch); setQuery(''); }} style={styles.headerAction}><Search color={c.text.strong} size={20} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Start a direct message" onPress={() => router.push('/compose')} style={styles.headerAction}><PenLine color={c.text.strong} size={20} /></Pressable>
      </View>
      {showSearch && (
        <View style={styles.search}>
          <Search color={c.text.muted} size={18} />
          <TextInput keyboardAppearance={scheme} accessibilityLabel="Filter conversations" autoFocus maxFontSizeMultiplier={fontScaleLimits.content} value={query} onChangeText={setQuery} placeholder="Find a conversation" placeholderTextColor={c.text.muted} style={styles.input} />
          <Button accessibilityRole="button" accessibilityLabel="Search people and messages" onPress={() => router.push('/search')} style={styles.searchAllButton} variant="secondary" label="Search all" textStyle={styles.searchAll} />
        </View>
      )}
      {showFilters && !blockingLoad && !blockingError && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterScroll}
          contentContainerStyle={styles.filterRow}
          accessibilityLabel="Filter conversation list"
        >
          {filterOptions.map((option) => {
            const selected = inboxFilter === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setInboxFilter(option.key)}
                style={[styles.filterPill, selected && styles.filterPillSelected]}
              >
                <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={[styles.filterLabel, selected && styles.filterLabelSelected]}>
                  {option.label}
                </Text>
                {option.count !== undefined && (
                  <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={[styles.filterCount, selected && styles.filterLabelSelected]}>
                    {option.count}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      )}
      {blockingLoad ? <LoadingState /> : blockingError ? <ErrorState message={blockingError} retry={() => void refreshAll()} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
          {visibleRecent.length > 0 && (
            <View style={styles.section}>
              {visibleRecent.map(({ kind, item }) => {
                const peer = kind === 'dm' ? directConversationPeer(item as DirectConversationSummary, userId) : null;
                return (
                  <ConversationRow
                    key={`${kind}-${item.id}`}
                    kind={kind}
                    item={item}
                    currentUserId={userId}
                    draftPreview={draftsByKey.get(`${kind}:${item.id}`) ?? null}
                    online={Boolean(peer && onlineUserIds.has(peer.id))}
                    onPress={() => open(kind, item)}
                  />
                );
              })}
            </View>
          )}
          {!activeWorkspace && <EmptyState title="No cohort or community yet" copy="Your cohort and community conversations will appear here once you have access." />}
          {activeWorkspace && visibleRecent.length === 0 && (
            <View style={styles.emptyWrap}>
              <EmptyState
                title={searchFilter ? 'Nothing found' : inboxFilter === 'unread' ? 'You’re all caught up.' : `Nothing in ${activeWorkspace.name} yet`}
                copy={searchFilter ? 'Try a different conversation name or message preview.' : inboxFilter !== 'all' ? 'Switch back to all conversations to see the full list.' : 'Group chats and direct messages for this cohort or community will appear here.'}
              />
              {inboxFilter !== 'all' && !searchFilter && (
                <Button variant="secondary" label="Show all conversations" onPress={() => setInboxFilter('all')} />
              )}
            </View>
          )}
        </ScrollView>
      )}
      <Modal visible={showWorkspaces} transparent animationType="fade" onRequestClose={() => setShowWorkspaces(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close cohort and community switcher" onPress={() => setShowWorkspaces(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Switch cohort or community</Text><Text style={styles.sheetSubtitle}>Your conversations stay separated by cohort and community.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close cohort and community switcher" onPress={() => setShowWorkspaces(false)} style={styles.closeButton}><X color={c.text.body} size={20} /></Pressable></View>
            <ScrollView contentContainerStyle={styles.workspaceList}>
              {workspaceCards.map((workspace) => {
                const current = workspace.id === activeWorkspaceId;
                return <Pressable key={workspace.id} accessibilityRole="button" accessibilityState={{ selected: current }} onPress={() => { void selectWorkspace(workspace.id); setShowWorkspaces(false); setQuery(''); }} style={[styles.workspaceCard, current && styles.workspaceCardActive]}>
                  <View style={[styles.workspaceMark, current && styles.workspaceMarkActive]}><Text allowFontScaling={false} style={styles.workspaceInitials}>{workspace.name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}</Text></View>
                  <View style={styles.workspaceCopy}><View style={styles.workspaceNameRow}><Text numberOfLines={1} style={styles.workspaceName}>{workspace.name}</Text>{current && <Check color={c.text.body} size={17} strokeWidth={2.5} />}</View><View style={styles.statRow}><Users color={c.text.muted} size={13} /><Text style={styles.stat}>{workspace.member_count}</Text><Hash color={c.text.muted} size={13} /><Text style={styles.stat}>{workspace.channelCount}</Text><MessageCircle color={c.text.muted} size={13} /><Text style={styles.stat}>{workspace.directMessageCount}</Text>{workspace.unreadCount > 0 && <Text style={styles.unreadPill}>{workspace.unreadCount} unread</Text>}</View></View>
                </Pressable>;
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, paddingVertical: 4, gap: 4, minHeight: 54 },
  compactWorkspace: { minHeight: 44, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, paddingHorizontal: 4 },
  headerUnreadPill: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, backgroundColor: c.action.primary, alignItems: 'center', justifyContent: 'center' },
  headerUnreadText: { color: c.text.onAction, fontFamily: fonts.bold, fontSize: 12 },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { fontSize: 20, color: c.text.strong, fontFamily: fonts.extraBold, flexShrink: 0 },
  filterScroll: { flexGrow: 0, flexShrink: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  filterRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 2, paddingBottom: 8 },
  filterPill: { minHeight: 44, minWidth: 52, paddingHorizontal: 15, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderWidth: 1, borderColor: 'transparent' },
  filterPillSelected: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator },
  filterLabel: { color: c.text.muted, fontFamily: fonts.semibold, fontSize: 13 },
  filterLabelSelected: { color: c.action.primary, fontFamily: fonts.bold },
  filterCount: { color: c.text.muted, fontFamily: fonts.semibold, fontSize: 12 },
  workspaceMark: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  workspaceMarkActive: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator, borderWidth: 2 },
  workspaceInitials: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
  workspaceCopy: { flex: 1, minWidth: 0 },
  workspaceNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  workspaceName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14, flexShrink: 1 },
  search: { marginHorizontal: 14, marginBottom: 8, minHeight: 48, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 12 },
  searchAllButton: { minHeight: 44, justifyContent: 'center' },
  searchAll: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  content: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 24 },
  section: { marginBottom: 20 },
  emptyWrap: { alignItems: 'center', gap: 12 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
  sheet: { maxHeight: '78%', backgroundColor: c.surface.raised, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: c.border.subtle, paddingBottom: 28 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: c.border.subtle, alignSelf: 'center', marginTop: 10 },
  sheetHeader: { padding: 20, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  sheetTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 20 },
  sheetSubtitle: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 4, maxWidth: 280 },
  closeButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: c.border.subtle, alignItems: 'center', justifyContent: 'center' },
  workspaceList: { paddingHorizontal: 16, paddingBottom: 20, gap: 9 },
  workspaceCard: { minHeight: 74, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  workspaceCardActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg, borderWidth: 2 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  stat: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12, marginRight: 5 },
  unreadPill: { color: c.text.onAction, backgroundColor: c.action.primary, borderRadius: 9, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontFamily: fonts.bold, fontSize: 12, marginLeft: 'auto' },
}));
