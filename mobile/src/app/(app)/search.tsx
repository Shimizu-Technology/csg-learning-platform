import { useRouter, type Href } from 'expo-router';
import { Hash, Search as SearchIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { messageSearchRoute } from '@/lib/message-route';
import type { MessageSearchResult } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function SearchScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api } = useSession();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const value = query.trim();
    if (value.length < 2) return;
    setLoading(true);
    setSearched(true);
    setError(null);
    try {
      setResults(auth.demo ? [] : (await api.search(value)).results);
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.safe}>
      <View style={styles.search}><SearchIcon color={palette.quiet} size={18} /><TextInput accessibilityLabel="Search every message" autoFocus returnKeyType="search" value={query} onChangeText={setQuery} onSubmitEditing={() => void submit()} placeholder="Search every message" placeholderTextColor={palette.quiet} style={styles.input} /></View>
      {loading ? <LoadingState label="Searching messages" /> : error ? <ErrorState message={error} retry={() => void submit()} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
          {results.map((result) => <Pressable key={result.id} accessibilityRole="button" accessibilityLabel={`Open ${result.context.label} at this message`} onPress={() => router.replace(messageSearchRoute(result) as Href)} style={styles.result}><View style={styles.meta}><Hash color={palette.rubySoft} size={14} /><Text style={styles.label}>{result.context.label}</Text><Text style={styles.author}>{result.author.full_name}</Text></View><Text numberOfLines={3} style={styles.body}>{result.body}</Text></Pressable>)}
          {searched && !results.length && <EmptyState title="No matching messages" copy={auth.demo ? 'Full message search connects to the live API outside simulator walkthrough mode.' : 'Try another word or a less specific phrase.'} />}
          {!searched && <EmptyState title="Search across CSG" copy="Find a question, link, decision, or class note from any conversation you can access." />}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink },
  search: { margin: 20, minHeight: 50, borderRadius: 16, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 14 },
  list: { paddingHorizontal: 20, paddingBottom: 30 },
  result: { minHeight: 68, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, flex: 1 },
  author: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10 },
  body: { color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, marginTop: 8 },
});
