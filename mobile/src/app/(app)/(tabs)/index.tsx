import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { PenLine, Search } from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ConversationRow } from '@/components/conversation-row';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoChannels, demoDms } from '@/lib/demo-data';
import { subscribeToUserMessages } from '@/lib/cable';
import type { ChannelSummary, DirectConversationSummary, MessageEvent } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function InboxScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const inboxCacheKey = user ? `csg.inbox.${user.id}` : null;
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [dms, setDms] = useState<DirectConversationSummary[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  const filter = query.trim().toLowerCase();
  const visibleChannels = useMemo(() => channels.filter((item) => `${item.name} ${item.workspace_name} ${item.latest_message?.body || ''}`.toLowerCase().includes(filter)), [channels, filter]);
  const visibleDms = useMemo(() => dms.filter((item) => `${item.title} ${item.workspace_name} ${item.latest_message?.body || ''}`.toLowerCase().includes(filter)), [dms, filter]);
  const unread = [...channels, ...dms].reduce((sum, item) => sum + item.unread_count, 0);
  const open = (kind: 'channel' | 'dm', id: number) => router.push({ pathname: '/conversation/[kind]/[id]', params: { kind, id: String(id) } });

  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}><View><Text style={styles.eyebrow}>CSG CONNECT</Text><Text style={styles.heading}>Messages</Text><Text style={styles.subhead}>{unread ? `${unread} unread across your spaces` : 'You’re all caught up'}</Text></View><Pressable accessibilityLabel="Start a direct message" onPress={() => router.push('/compose')} style={styles.compose}><PenLine color={palette.text} size={21} /></Pressable></View>
      <View style={styles.search}><Search color={palette.quiet} size={18} /><TextInput accessibilityLabel="Filter conversations" value={query} onChangeText={setQuery} placeholder="Find a conversation" placeholderTextColor={palette.quiet} style={styles.input} /><Pressable onPress={() => router.push('/search')}><Text style={styles.searchAll}>Search all</Text></Pressable></View>
      {loading ? <LoadingState /> : error ? <ErrorState message={error} retry={() => void load()} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
          {visibleDms.length > 0 && <View style={styles.section}><Text style={styles.label}>DIRECT</Text>{visibleDms.map((item) => <ConversationRow key={`dm-${item.id}`} kind="dm" item={item} onPress={() => open('dm', item.id)} />)}</View>}
          {visibleChannels.length > 0 && <View style={styles.section}><Text style={styles.label}>CHANNELS</Text>{visibleChannels.map((item) => <ConversationRow key={`channel-${item.id}`} kind="channel" item={item} onPress={() => open('channel', item.id)} />)}</View>}
          {!visibleDms.length && !visibleChannels.length && <EmptyState title="Nothing here yet" copy={filter ? 'Try a different conversation name or message preview.' : 'Your channels and direct messages will appear here.'} />}
        </ScrollView>
      )}
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
  search: { marginHorizontal: 20, minHeight: 48, borderRadius: 16, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 12 },
  searchAll: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11 },
  content: { paddingHorizontal: 20, paddingTop: 26, paddingBottom: 30 },
  section: { marginBottom: 28 },
  label: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.5, marginBottom: 4 },
});
