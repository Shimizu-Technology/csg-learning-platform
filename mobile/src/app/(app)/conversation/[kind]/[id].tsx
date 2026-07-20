import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Bell, BellOff, Hash, Send, Wifi, WifiOff } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/avatar';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { subscribeToMessages } from '@/lib/cable';
import { demoChannels, demoDms, demoMessages, demoUser } from '@/lib/demo-data';
import type { ChannelSummary, DirectConversationSummary, Message, MessageEvent } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

type ConnectionStatus = 'connecting' | 'connected' | 'offline';

export default function ConversationScreen() {
  const params = useLocalSearchParams<{ kind: string; id: string }>();
  const kind = params.kind === 'dm' ? 'dm' : 'channel';
  const id = Number(params.id);
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const listRef = useRef<FlatList<Message>>(null);
  const [summary, setSummary] = useState<ChannelSummary | DirectConversationSummary | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(auth.demo ? 'connected' : 'connecting');

  const applyEvent = useCallback((payload: MessageEvent) => {
    if ((kind === 'channel' && payload.channel_id !== id) || (kind === 'dm' && payload.direct_conversation_id !== id)) return;
    if (payload.event === 'created' && !payload.message.mine) void api.markRead(kind, id).catch(() => undefined);
    setMessages((current) => payload.event === 'created'
      ? (current.some((message) => message.id === payload.message.id) ? current : [...current, payload.message])
      : current.map((message) => message.id === payload.message.id ? payload.message : message));
  }, [api, id, kind]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (auth.demo) {
        setSummary(kind === 'channel' ? demoChannels.find((item) => item.id === id) || null : demoDms.find((item) => item.id === id) || null);
        setMessages(demoMessages[`${kind}:${id}`] || []);
      } else if (kind === 'channel') {
        const result = await api.channel(id); setSummary(result.channel); setMessages(result.messages); await api.markRead(kind, id);
      } else {
        const result = await api.directConversation(id); setSummary(result.direct_conversation); setMessages(result.messages); await api.markRead(kind, id);
      }
      setError(null);
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setLoading(false); }
  }, [api, auth.demo, id, kind]);

  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  useEffect(() => auth.demo || loading || error ? undefined : subscribeToMessages(api, kind, id, applyEvent, setStatus), [api, applyEvent, auth.demo, error, id, kind, loading]);
  useEffect(() => { if (messages.length) requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true })); }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setDraft(''); setSending(true);
    const optimistic: Message = { id: -Date.now(), channel_id: kind === 'channel' ? id : null, direct_conversation_id: kind === 'dm' ? id : null, parent_message_id: null, body, mention_user_ids: [], edited_at: null, deleted_at: null, pinned_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), mine: true, reactions: [], attachments: [], author: user || demoUser };
    setMessages((current) => [...current, optimistic]);
    if (auth.demo) { setSending(false); return; }
    try {
      const { message } = await api.sendMessage(kind, id, body);
      setMessages((current) => {
        const withoutOptimistic = current.filter((item) => item.id !== optimistic.id);
        return withoutOptimistic.some((item) => item.id === message.id) ? withoutOptimistic : [...withoutOptimistic, message];
      });
    }
    catch (requestError) { setMessages((current) => current.filter((item) => item.id !== optimistic.id)); setDraft(body); Alert.alert('Message not sent', (requestError as Error).message); }
    finally { setSending(false); }
  };

  const toggleMute = async () => {
    if (!summary) return;
    const next = !summary.muted;
    setSummary({ ...summary, muted: next });
    if (!auth.demo) try { await api.updatePreference(kind, id, next); } catch { setSummary({ ...summary, muted: !next }); }
  };
  const title = summary ? ('name' in summary ? summary.name : summary.title) : 'Conversation';
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.iconButton}><ArrowLeft color={palette.text} size={22} /></Pressable>{kind === 'channel' ? <View style={styles.hash}><Hash color={palette.rubySoft} size={18} /></View> : <Avatar name={title} size={38} />}<View style={styles.headerCopy}><Text numberOfLines={1} style={styles.title}>{title}</Text><View style={styles.status}>{status === 'connected' ? <Wifi color={palette.success} size={12} /> : <WifiOff color={palette.warning} size={12} />}<Text style={styles.statusText}>{status === 'connected' ? (summary?.workspace_name || 'Connected') : status === 'connecting' ? 'Connecting' : 'Reconnecting'}</Text></View></View><Pressable accessibilityRole="button" accessibilityLabel={summary?.muted ? 'Unmute conversation' : 'Mute conversation'} onPress={() => void toggleMute()} style={styles.iconButton}>{summary?.muted ? <BellOff color={palette.muted} size={20} /> : <Bell color={palette.muted} size={20} />}</Pressable></View>
        {loading ? <LoadingState label="Loading messages" /> : error ? <ErrorState message={error} retry={() => void load()} /> : (
          <FlatList ref={listRef} data={messages} keyExtractor={(item) => String(item.id)} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list} ListEmptyComponent={<View style={styles.empty}><Text style={styles.emptyTitle}>Start the conversation</Text><Text style={styles.emptyCopy}>Messages sent here stay connected to your Code School workspace.</Text></View>} renderItem={({ item, index }) => <MessageBubble message={item} showAuthor={index === 0 || messages[index - 1]?.author.id !== item.author.id} />} />
        )}
        <View style={styles.composer}><TextInput accessibilityLabel="Message" value={draft} onChangeText={setDraft} placeholder={`Message ${kind === 'channel' ? '#' : ''}${title}`} placeholderTextColor={palette.quiet} multiline maxLength={10_000} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel="Send message" disabled={!draft.trim() || sending} onPress={() => void send()} style={({ pressed }) => [styles.send, (!draft.trim() || sending) && styles.sendDisabled, pressed && { transform: [{ scale: 0.96 }] }]}><Send color={palette.text} size={19} /></Pressable></View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MessageBubble({ message, showAuthor }: { message: Message; showAuthor: boolean }) {
  const deleted = Boolean(message.deleted_at);
  return <View style={[styles.messageRow, message.mine && styles.mineRow]}>{!message.mine && showAuthor && <Avatar name={message.author.full_name} size={30} />} {!message.mine && !showAuthor && <View style={{ width: 30 }} />}<View style={[styles.bubbleWrap, message.mine && styles.mineWrap]}>{showAuthor && !message.mine && <Text style={styles.author}>{message.author.full_name}</Text>}<View style={[styles.bubble, message.mine && styles.mineBubble]}><Text style={[styles.body, deleted && styles.deleted]}>{deleted ? 'Message removed' : message.body}</Text></View><Text style={[styles.time, message.mine && { textAlign: 'right' }]}>{formatTime(message.created_at)}{message.edited_at ? ' · edited' : ''}{message.mine && message.read_receipts?.count ? ` · read by ${message.read_receipts.count}` : ''}</Text></View></View>;
}
function formatTime(value: string) { return new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, iconButton: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, hash: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, headerCopy: { flex: 1 }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 16 }, status: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }, statusText: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10 }, list: { paddingHorizontal: 14, paddingVertical: 20, flexGrow: 1 }, empty: { flex: 1, minHeight: 420, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 50 }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 18 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 }, messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 10, paddingRight: 54 }, mineRow: { justifyContent: 'flex-end', paddingRight: 0, paddingLeft: 54 }, bubbleWrap: { maxWidth: '92%' }, mineWrap: { alignItems: 'flex-end' }, author: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 11, marginBottom: 4, marginLeft: 2 }, bubble: { backgroundColor: palette.panelRaised, borderWidth: 1, borderColor: palette.line, borderRadius: 18, borderTopLeftRadius: 5, paddingHorizontal: 14, paddingVertical: 10 }, mineBubble: { backgroundColor: palette.ruby, borderColor: palette.ruby, borderTopLeftRadius: 18, borderTopRightRadius: 5 }, body: { color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 }, deleted: { color: palette.quiet, fontStyle: 'italic' }, time: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 9, marginTop: 4, marginHorizontal: 2 }, composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 9, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line, backgroundColor: palette.panel }, input: { flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 17, backgroundColor: palette.ink, borderWidth: 1, borderColor: palette.line, color: palette.text, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 11 }, send: { width: 46, height: 46, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' }, sendDisabled: { opacity: 0.38 },
});
