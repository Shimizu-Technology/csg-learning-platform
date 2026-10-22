import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { Check, ChevronDown, Hash, MessageCircle, PenLine, Search, Users, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Modal, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationRow } from '@/components/conversation-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { useInboxQuery } from '@/hooks/use-inbox';
import { messagingKeys, type InboxSnapshot } from '@/lib/messaging-cache';
import { recentConversations } from '@/lib/recent-conversations';
import { subscribeToUserMessages } from '@/lib/cable';
import type { RealtimeMessageEvent } from '@/lib/types';
import { buildWorkspaceCards } from '@/lib/workspaces';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';

export default function MessagesScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const { workspaces, activeWorkspaceId, activeWorkspace, loading: loadingWorkspaces, error: workspaceError, refresh: refreshWorkspaces, selectWorkspace } = useWorkspace();
  const inboxKey = useMemo(() => messagingKeys.inbox(user?.id ?? 0), [user?.id]);
  const inboxQuery = useInboxQuery();
  const { data: inboxData, error: inboxError, isFetching: inboxFetching, isPending: inboxPending, isStale: inboxStale, refetch: refetchInbox } = inboxQuery;
  const channels = useMemo(() => inboxData?.channels ?? [], [inboxData?.channels]);
  const dms = useMemo(() => inboxData?.dms ?? [], [inboxData?.dms]);
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [showWorkspaces, setShowWorkspaces] = useState(false);

  useFocusEffect(useCallback(() => {
    if (inboxData && inboxStale && !inboxFetching) void refetchInbox();
  }, [inboxData, inboxFetching, inboxStale, refetchInbox]));
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
  const workspaceCards = useMemo(() => buildWorkspaceCards(workspaces, channels, dms), [channels, dms, workspaces]);

  const filter = query.trim().toLowerCase();
  const workspaceChannels = useMemo(() => channels.filter((item) => item.workspace_id === activeWorkspaceId), [activeWorkspaceId, channels]);
  const workspaceDms = useMemo(() => dms.filter((item) => item.workspace_id === activeWorkspaceId), [activeWorkspaceId, dms]);
  const visibleChannels = useMemo(() => workspaceChannels.filter((item) => `${item.name} ${item.latest_message?.body || ''}`.toLowerCase().includes(filter)), [filter, workspaceChannels]);
  const visibleDms = useMemo(() => workspaceDms.filter((item) => `${item.title} ${item.latest_message?.body || ''}`.toLowerCase().includes(filter)), [filter, workspaceDms]);
  const recent = useMemo(() => recentConversations(visibleChannels, visibleDms), [visibleChannels, visibleDms]);


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
        <Pressable accessibilityRole="button" accessibilityLabel={`Current workspace: ${activeWorkspace?.name || 'Workspaces'}. Switch workspace`} onPress={() => setShowWorkspaces(true)} style={styles.compactWorkspace}>
          <Text maxFontSizeMultiplier={fontScaleLimits.content} numberOfLines={1} style={styles.workspaceName}>{activeWorkspace?.name || 'Workspaces'}</Text><ChevronDown color={c.text.body} size={16} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={showSearch ? 'Close search' : 'Search conversations'} accessibilityState={{ expanded: showSearch }} onPress={() => { setShowSearch(!showSearch); setQuery(''); }} style={styles.headerAction}><Search color={c.text.strong} size={20} /></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Start a direct message" onPress={() => router.push('/compose')} style={styles.headerAction}><PenLine color={c.text.strong} size={20} /></Pressable>
      </View>
      {showSearch && <View style={styles.search}><Search color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Filter conversations" autoFocus maxFontSizeMultiplier={fontScaleLimits.content} value={query} onChangeText={setQuery} placeholder="Find a conversation" placeholderTextColor={c.text.body} style={styles.input} /><Button accessibilityRole="button" accessibilityLabel="Search people and messages" onPress={() => router.push('/search')} style={styles.searchAllButton} variant="secondary" label="Search all" textStyle={styles.searchAll} /></View>}
      {blockingLoad ? <LoadingState /> : blockingError ? <ErrorState message={blockingError} retry={() => void refreshAll()} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
          {recent.length > 0 && <View style={styles.section}><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.label}>RECENT</Text>{recent.map(({ kind, item }) => <ConversationRow key={`${kind}-${item.id}`} kind={kind} item={item} onPress={() => open(kind, item)} />)}</View>}
          {!activeWorkspace && <EmptyState title="No workspace yet" copy="Your cohort and community workspaces will appear here once you have access." />}
          {activeWorkspace && !visibleDms.length && !visibleChannels.length && <EmptyState title={filter ? 'Nothing found' : `Nothing in ${activeWorkspace.name} yet`} copy={filter ? 'Try a different conversation name or message preview.' : 'Channels and direct messages for this workspace will appear here.'} />}
        </ScrollView>
      )}
      <Modal visible={showWorkspaces} transparent animationType="fade" onRequestClose={() => setShowWorkspaces(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close workspace switcher" onPress={() => setShowWorkspaces(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Switch workspace</Text><Text style={styles.sheetSubtitle}>Your conversations stay separated by cohort and community.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close workspace switcher" onPress={() => setShowWorkspaces(false)} style={styles.closeButton}><X color={c.text.body} size={20} /></Pressable></View>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 4, gap: 4, minHeight: 56 },
  compactWorkspace: { minHeight: 44, flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, paddingHorizontal: 4 },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { ...typography.label, color: c.text.body, fontFamily: fonts.bold, letterSpacing: 1.8 },
  heading: { fontSize: 18, color: c.text.strong, fontFamily: fonts.extraBold, flexShrink: 0 },
  subhead: { ...typography.support, color: c.text.body, fontFamily: fonts.regular, marginTop: 3 },
  compose: { flexShrink: 0, width: 48, height: 48, borderRadius: 16, backgroundColor: c.selection.bg, alignItems: 'center', justifyContent: 'center' },
  workspaceSelector: { marginHorizontal: 20, marginBottom: 12, minHeight: 64, borderRadius: 18, backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.subtle, padding: 10, paddingRight: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  workspaceMark: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  workspaceMarkActive: { backgroundColor: c.selection.bg, borderColor: c.selection.indicator, borderWidth: 2 },
  workspaceInitials: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
  workspaceCopy: { flex: 1, minWidth: 0 },
  workspaceNameRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 7 },
  workspaceName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14, flexShrink: 1 },
  workspaceType: { color: c.text.body, backgroundColor: c.surface.sunken, borderRadius: 8, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontFamily: fonts.semibold, fontSize: 12, textTransform: 'uppercase' },
  workspaceMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 3 },
  search: { marginHorizontal: 20, minHeight: 48, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 12 },
  searchAllButton: { minHeight: 44, justifyContent: 'center' },
  searchAll: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  content: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 20 },
  section: { marginBottom: 28 },
  label: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.5, marginBottom: 4 },
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
  unreadPill: { color: c.text.strong, backgroundColor: c.selection.bg, borderRadius: 9, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontFamily: fonts.bold, fontSize: 12, marginLeft: 'auto' },
}));
