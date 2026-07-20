import { useRouter } from 'expo-router';
import { Hash, Search as SearchIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { EmptyState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import type { Message } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

type Result = Message & { context: { type: 'channel' | 'direct_conversation'; id: number; label: string } };
export default function SearchScreen() {
  const router = useRouter(); const auth = useCsgAuth(); const { api } = useSession(); const [query, setQuery] = useState(''); const [results, setResults] = useState<Result[]>([]); const [loading, setLoading] = useState(false); const [searched, setSearched] = useState(false);
  const submit = async () => { const value = query.trim(); if (value.length < 2) return; setLoading(true); setSearched(true); try { setResults(auth.demo ? [] : (await api.search(value)).results); } finally { setLoading(false); } };
  return <View style={styles.safe}><View style={styles.search}><SearchIcon color={palette.quiet} size={18} /><TextInput autoFocus returnKeyType="search" value={query} onChangeText={setQuery} onSubmitEditing={() => void submit()} placeholder="Search every message" placeholderTextColor={palette.quiet} style={styles.input} /></View>{loading ? <LoadingState label="Searching messages" /> : <ScrollView contentContainerStyle={styles.list}>{results.map((result) => <Pressable key={result.id} onPress={() => router.replace({ pathname: '/conversation/[kind]/[id]', params: { kind: result.context.type === 'channel' ? 'channel' : 'dm', id: String(result.context.id) } })} style={styles.result}><View style={styles.meta}><Hash color={palette.rubySoft} size={14} /><Text style={styles.label}>{result.context.label}</Text><Text style={styles.author}>{result.author.full_name}</Text></View><Text numberOfLines={3} style={styles.body}>{result.body}</Text></Pressable>)}{searched && !results.length && <EmptyState title="No matching messages" copy={auth.demo ? 'Full message search connects to the live API outside simulator walkthrough mode.' : 'Try another word or a less specific phrase.'} />}{!searched && <EmptyState title="Search across CSG" copy="Find a question, link, decision, or class note from any conversation you can access." />}</ScrollView>}</View>;
}
const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: palette.ink }, search: { margin: 20, minHeight: 50, borderRadius: 16, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 14 }, list: { paddingHorizontal: 20, paddingBottom: 30 }, result: { paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line }, meta: { flexDirection: 'row', alignItems: 'center', gap: 6 }, label: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, flex: 1 }, author: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10 }, body: { color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, marginTop: 8 } });
