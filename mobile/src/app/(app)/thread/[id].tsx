import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Send } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MessageBubble } from '@/components/message-bubble';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { subscribeToMessages } from '@/lib/cable';
import { resolveMentionUserIds } from '@/lib/mentions';
import { mergeMessageEvent, sortMessages } from '@/lib/message-state';
import type { Message, MessageEvent, UserSummary } from '@/lib/types';
import { useSession } from '@/providers/session-provider';

export default function ThreadScreen() {
  const params = useLocalSearchParams<{ id: string; kind: string; conversationId: string; workspaceId: string }>();
  const rootId = Number(params.id);
  const kind = params.kind === 'dm' ? 'dm' : 'channel';
  const conversationId = Number(params.conversationId);
  const workspaceId = Number(params.workspaceId);
  const router = useRouter();
  const { api } = useSession();
  const listRef = useRef<FlatList<Message>>(null);
  const [root, setRoot] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[]>([]);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!Number.isInteger(workspaceId) || workspaceId <= 0) throw new Error('This thread link is incomplete. Open it again from the conversation.');
      const [result, workspace] = await Promise.all([api.messageThread(rootId), api.workspace(workspaceId)]);
      setRoot(result.root_message);
      setReplies(result.replies);
      setUsers(workspace.workspace.members);
      setError(null);
    } catch (requestError) { setError((requestError as Error).message); }
    finally { setLoading(false); }
  }, [api, rootId, workspaceId]);

  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  useEffect(() => loading || error ? undefined : subscribeToMessages(api, kind, conversationId, (event: MessageEvent) => {
    if (event.message.id === rootId) setRoot(event.event === 'deleted' ? null : event.message);
    else if (event.message.parent_message_id === rootId) setReplies((current) => mergeMessageEvent(current, event));
  }, () => undefined), [api, conversationId, error, kind, loading, rootId]);

  const visible = useMemo(() => sortMessages(replies), [replies]);
  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setDraft('');
    try {
      const result = await api.sendMessage(kind, conversationId, { body, parent_message_id: rootId, mention_user_ids: resolveMentionUserIds(body, users), send_push: true });
      setReplies((current) => sortMessages([...current.filter((message) => message.id !== result.message.id), result.message]));
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (requestError) { setDraft(body); Alert.alert('Reply not sent', (requestError as Error).message); }
    finally { setSending(false); }
  };

  const toggleReaction = async (message: Message, value: string) => {
    try { const remove = Boolean(message.reactions.find((reaction) => reaction.emoji === value)?.reacted); const result = await api.react(message.id, value, remove); if (message.id === rootId) setRoot(result.message); else setReplies((current) => current.map((item) => item.id === message.id ? result.message : item)); }
    catch (requestError) { Alert.alert('Could not update reaction', (requestError as Error).message); }
  };

  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe}><KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.safe}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View><Text style={styles.title}>Thread</Text><Text style={styles.subtitle}>{replies.length} {replies.length === 1 ? 'reply' : 'replies'}</Text></View></View>
    {loading ? <LoadingState label="Loading thread" /> : error || !root ? <ErrorState message={error || 'This thread is no longer available.'} retry={() => void load()} /> : <>
      <View style={styles.root}><MessageBubble message={root} showAuthor mentionUsers={users} onReact={(message, value) => void toggleReaction(message, value)} /></View>
      <View style={styles.divider}><Text style={styles.dividerText}>REPLIES</Text><View style={styles.line} /></View>
      <FlatList ref={listRef} data={visible} keyExtractor={(message) => String(message.id)} keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list} renderItem={({ item, index }) => <MessageBubble message={item} showAuthor={!visible[index - 1] || visible[index - 1].author.id !== item.author.id} mentionUsers={users} onReact={(message, value) => void toggleReaction(message, value)} />} ListEmptyComponent={<Text style={styles.empty}>Start a focused conversation about this message.</Text>} />
    </>}
    <View style={styles.composer}><TextInput accessibilityLabel="Reply to thread" value={draft} onChangeText={setDraft} placeholder="Reply to thread" placeholderTextColor={palette.quiet} multiline maxLength={10_000} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel="Send reply" disabled={!draft.trim() || sending} onPress={() => void send()} style={[styles.send, (!draft.trim() || sending) && styles.disabled]}><Send color={palette.text} size={19} /></Pressable></View>
  </KeyboardAvoidingView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 17 }, subtitle: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10, marginTop: 2 }, root: { paddingHorizontal: 14, paddingTop: 18 }, divider: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginVertical: 12 }, dividerText: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.2 }, line: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: palette.line }, list: { paddingHorizontal: 14, paddingBottom: 24, flexGrow: 1 }, empty: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: 'center', paddingHorizontal: 40, paddingTop: 50 }, composer: { paddingHorizontal: 14, paddingVertical: 9, flexDirection: 'row', alignItems: 'flex-end', gap: 9, backgroundColor: palette.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line }, input: { flex: 1, minHeight: 46, maxHeight: 120, borderRadius: 17, backgroundColor: palette.ink, borderWidth: 1, borderColor: palette.line, color: palette.text, fontFamily: fonts.regular, fontSize: 14, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 11 }, send: { width: 46, height: 46, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' }, disabled: { opacity: 0.38 },
});
