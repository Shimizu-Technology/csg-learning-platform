import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { Check, ChevronDown, Hash, MessageCircle, PenLine, Search, Users, X } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationRow } from '@/components/conversation-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoChannels, demoDms } from '@/lib/demo-data';
import { subscribeToUserMessages } from '@/lib/cable';
import type { ChannelSummary, DirectConversationSummary, MessageEvent } from '@/lib/types';
import { buildWorkspaceCards } from '@/lib/workspaces';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';

export default function MessagesScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { workspaces, activeWorkspaceId, activeWorkspace, loading: loadingWorkspaces, error: workspaceError, refresh: refreshWorkspaces, selectWorkspace } = useWorkspace();
  const inboxCacheKey = user ? `csg.inbox.${user.id}` : null;
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [dms, setDms] = useState<DirectConversationSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWorkspaces, setShowWorkspaces] = useState(false);

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true); else setLoading(true);
    try {
      if (auth.demo) { setChannels(demoChannels); setDms(demoDms); }
      else {
        const [channelResult, dmResult] = await Promise.all([api.channels(), api.directConversations()]);
        setChannels(channelResult.channels); setDms(dmResult.direct_conversations);
        if (inboxCacheKey) await AsyncStorage.setItem(inboxCacheKey, JSON.stringify({ channels: channelResult.channels, dms: dmResult.direct_conversations }));
      }
      setError(null);
    } catch (requestError) {
      const cached = inboxCacheKey ? await AsyncStorage.getItem(inboxCacheKey) : null;
      if (cached) {
        try { const value = JSON.parse(cached) as { channels: ChannelSummary[]; dms: DirectConversationSummary[] }; setChannels(value.channels); setDms(value.dms); }
        catch { await AsyncStorage.removeItem(inboxCacheKey!); setError((requestError as Error).message); }
      } else setError((requestError as Error).message);
    } finally { setLoading(false); setRefreshing(false); }
  }, [api, auth.demo, inboxCacheKey]);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useFocusEffect(useCallback(() => {
    if (auth.demo || loading || error) return undefined;
    return subscribeToUserMessages(api, (event: MessageEvent) => {
      const channel = event.channel;
      const conversation = event.direct_conversation;
      if (channel) setChannels((current) => [channel, ...current.filter((item) => item.id !== channel.id)]);
      if (conversation) setDms((current) => [conversation, ...current.filter((item) => item.id !== conversation.id)]);
    });
  }, [api, auth.demo, error, loading]));
  const workspaceCards = useMemo(() => buildWorkspaceCards(workspaces, channels, dms), [channels, dms, workspaces]);
  const activeWorkspaceCard = workspaceCards.find((workspace) => workspace.id === activeWorkspaceId) ?? null;
  const filter = query.trim().toLowerCase();
  const workspaceChannels = useMemo(() => channels.filter((item) => item.workspace_id === activeWorkspaceId), [activeWorkspaceId, channels]);
  const workspaceDms = useMemo(() => dms.filter((item) => item.workspace_id === activeWorkspaceId), [activeWorkspaceId, dms]);
  const visibleChannels = useMemo(() => workspaceChannels.filter((item) => `${item.name} ${item.latest_message?.body || ''}`.toLowerCase().includes(filter)), [filter, workspaceChannels]);
  const visibleDms = useMemo(() => workspaceDms.filter((item) => `${item.title} ${item.latest_message?.body || ''}`.toLowerCase().includes(filter)), [filter, workspaceDms]);
  const unread = workspaceCards.reduce((sum, workspace) => sum + workspace.unreadCount, 0);
  const otherUnread = unread - (activeWorkspaceCard?.unreadCount ?? 0);
  const open = (kind: 'channel' | 'dm', id: number) => router.push({ pathname: '/conversation/[kind]/[id]', params: { kind, id: String(id) } });
  const refreshAll = async (pull = false) => { await Promise.all([load(pull), refreshWorkspaces()]); };

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>CSG CONNECT</Text><Text style={styles.heading}>Messages</Text><Text style={styles.subhead}>{unread ? `${unread} unread across your workspaces` : 'You’re all caught up'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Start a direct message" onPress={() => router.push('/compose')} style={styles.compose}><PenLine color={palette.text} size={21} /></Pressable></View>
      {activeWorkspace && (
        <Pressable accessibilityRole="button" accessibilityLabel={`Current workspace: ${activeWorkspace.name}. ${workspaces.length > 1 ? 'Switch workspace' : ''}`} disabled={workspaces.length < 2} onPress={() => setShowWorkspaces(true)} style={styles.workspaceSelector}>
          <View style={styles.workspaceMark}><Text style={styles.workspaceInitials}>{activeWorkspace.name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}</Text></View>
          <View style={styles.workspaceCopy}><View style={styles.workspaceNameRow}><Text numberOfLines={1} style={styles.workspaceName}>{activeWorkspace.name}</Text><Text style={styles.workspaceType}>{activeWorkspace.workspace_type}</Text></View><Text numberOfLines={1} style={styles.workspaceMeta}>{activeWorkspace.member_count} {activeWorkspace.member_count === 1 ? 'member' : 'members'} · {activeWorkspaceCard?.unreadCount ? `${activeWorkspaceCard.unreadCount} unread here` : 'caught up'}{otherUnread > 0 ? ` · ${otherUnread} elsewhere` : ''}</Text></View>
          {workspaces.length > 1 && <ChevronDown color={palette.muted} size={19} />}
        </Pressable>
      )}
      <View style={styles.search}><Search color={palette.quiet} size={18} /><TextInput accessibilityLabel="Filter conversations" value={query} onChangeText={setQuery} placeholder="Find a conversation" placeholderTextColor={palette.quiet} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel="Search all messages" onPress={() => router.push('/search')} style={styles.searchAllButton}><Text style={styles.searchAll}>Search all</Text></Pressable></View>
      {loading || loadingWorkspaces ? <LoadingState /> : error || (workspaceError && !workspaces.length) ? <ErrorState message={error || workspaceError || 'Could not load messages'} retry={() => void refreshAll()} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refreshAll(true)} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
          {visibleDms.length > 0 && <View style={styles.section}><Text style={styles.label}>DIRECT</Text>{visibleDms.map((item) => <ConversationRow key={`dm-${item.id}`} kind="dm" item={item} onPress={() => open('dm', item.id)} />)}</View>}
          {visibleChannels.length > 0 && <View style={styles.section}><Text style={styles.label}>CHANNELS</Text>{visibleChannels.map((item) => <ConversationRow key={`channel-${item.id}`} kind="channel" item={item} onPress={() => open('channel', item.id)} />)}</View>}
          {!activeWorkspace && <EmptyState title="No workspace yet" copy="Your cohort and community workspaces will appear here once you have access." />}
          {activeWorkspace && !visibleDms.length && !visibleChannels.length && <EmptyState title={filter ? 'Nothing found' : `Nothing in ${activeWorkspace.name} yet`} copy={filter ? 'Try a different conversation name or message preview.' : 'Channels and direct messages for this workspace will appear here.'} />}
        </ScrollView>
      )}
      <Modal visible={showWorkspaces} transparent animationType="slide" onRequestClose={() => setShowWorkspaces(false)}>
        <View style={styles.modalRoot}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close workspace switcher" onPress={() => setShowWorkspaces(false)} style={StyleSheet.absoluteFill} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHeader}><View><Text style={styles.sheetTitle}>Switch workspace</Text><Text style={styles.sheetSubtitle}>Your conversations stay separated by cohort and community.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close workspace switcher" onPress={() => setShowWorkspaces(false)} style={styles.closeButton}><X color={palette.muted} size={20} /></Pressable></View>
            <ScrollView contentContainerStyle={styles.workspaceList}>
              {workspaceCards.map((workspace) => {
                const current = workspace.id === activeWorkspaceId;
                return <Pressable key={workspace.id} accessibilityRole="button" accessibilityState={{ selected: current }} onPress={() => { void selectWorkspace(workspace.id); setShowWorkspaces(false); setQuery(''); }} style={[styles.workspaceCard, current && styles.workspaceCardActive]}>
                  <View style={[styles.workspaceMark, current && styles.workspaceMarkActive]}><Text style={styles.workspaceInitials}>{workspace.name.split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}</Text></View>
                  <View style={styles.workspaceCopy}><View style={styles.workspaceNameRow}><Text numberOfLines={1} style={styles.workspaceName}>{workspace.name}</Text>{current && <Check color={palette.rubySoft} size={17} strokeWidth={2.5} />}</View><View style={styles.statRow}><Users color={palette.quiet} size={13} /><Text style={styles.stat}>{workspace.member_count}</Text><Hash color={palette.quiet} size={13} /><Text style={styles.stat}>{workspace.channelCount}</Text><MessageCircle color={palette.quiet} size={13} /><Text style={styles.stat}>{workspace.directMessageCount}</Text>{workspace.unreadCount > 0 && <Text style={styles.unreadPill}>{workspace.unreadCount} unread</Text>}</View></View>
                </Pressable>;
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 20 },
  eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.8 },
  heading: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 34, letterSpacing: -1.2 },
  subhead: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 3 },
  compose: { width: 48, height: 48, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' },
  workspaceSelector: { marginHorizontal: 20, marginBottom: 12, minHeight: 64, borderRadius: 18, backgroundColor: palette.panelRaised, borderWidth: 1, borderColor: palette.line, padding: 10, paddingRight: 14, flexDirection: 'row', alignItems: 'center', gap: 11 },
  workspaceMark: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#252B3A', alignItems: 'center', justifyContent: 'center' },
  workspaceMarkActive: { backgroundColor: '#32161D' },
  workspaceInitials: { color: palette.text, fontFamily: fonts.bold, fontSize: 13 },
  workspaceCopy: { flex: 1, minWidth: 0 },
  workspaceNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  workspaceName: { color: palette.text, fontFamily: fonts.bold, fontSize: 14, flexShrink: 1 },
  workspaceType: { color: palette.rubySoft, backgroundColor: '#2A151B', borderRadius: 8, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontFamily: fonts.semibold, fontSize: 8, textTransform: 'uppercase' },
  workspaceMeta: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 10, marginTop: 3 },
  search: { marginHorizontal: 20, minHeight: 48, borderRadius: 16, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 12 },
  searchAllButton: { minHeight: 44, justifyContent: 'center' },
  searchAll: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 },
  content: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 30 },
  section: { marginBottom: 28 },
  label: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.5, marginBottom: 4 },
  modalRoot: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(2, 4, 8, 0.72)' },
  sheet: { maxHeight: '78%', backgroundColor: palette.panel, borderTopLeftRadius: 28, borderTopRightRadius: 28, borderWidth: 1, borderColor: palette.line, paddingBottom: 28 },
  sheetHandle: { width: 38, height: 4, borderRadius: 2, backgroundColor: palette.line, alignSelf: 'center', marginTop: 10 },
  sheetHeader: { padding: 20, paddingBottom: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  sheetTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 20 },
  sheetSubtitle: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 4, maxWidth: 280 },
  closeButton: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center' },
  workspaceList: { paddingHorizontal: 16, paddingBottom: 20, gap: 9 },
  workspaceCard: { minHeight: 74, borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panelRaised, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  workspaceCardActive: { borderColor: '#6A2A36', backgroundColor: '#201319' },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  stat: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10, marginRight: 5 },
  unreadPill: { color: palette.text, backgroundColor: palette.ruby, borderRadius: 9, overflow: 'hidden', paddingHorizontal: 7, paddingVertical: 3, fontFamily: fonts.bold, fontSize: 9, marginLeft: 'auto' },
});
