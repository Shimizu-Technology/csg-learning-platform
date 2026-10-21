import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useRouter, type Href } from 'expo-router';
import { Hash, Search as SearchIcon } from 'lucide-react-native';
import { useState } from 'react';
import { Keyboard, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { plainMessageText } from '@/lib/message-format';
import { messageSearchRoute } from '@/lib/message-route';
import type { MessageSearchResult } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function SearchScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
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
    Keyboard.dismiss();
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
      <View style={styles.search}><SearchIcon color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search every message" autoFocus returnKeyType="search" value={query} onChangeText={setQuery} onSubmitEditing={() => void submit()} placeholder="Search every message" placeholderTextColor={c.text.body} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel="Dismiss keyboard" onPress={Keyboard.dismiss} style={styles.dismiss}><Text style={styles.dismissText}>Done</Text></Pressable></View>
      {loading ? <LoadingState label="Searching messages" /> : error ? <ErrorState message={error} retry={() => void submit()} /> : (
        <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
          {results.map((result) => <Pressable key={result.id} accessibilityRole="button" accessibilityLabel={`Open ${result.context.label} at this message`} onPress={() => router.replace(messageSearchRoute(result) as Href)} style={styles.result}><View style={styles.meta}><Hash color={c.text.body} size={14} /><Text style={styles.label}>{result.context.label}</Text><Text style={styles.author}>{result.author.full_name}</Text></View><Text numberOfLines={3} style={styles.body}>{plainMessageText(result.body)}</Text></Pressable>)}
          {searched && !results.length && <EmptyState title="No matching messages" copy={auth.demo ? 'Full message search connects to the live API outside simulator walkthrough mode.' : 'Try another word or a less specific phrase.'} />}
          {!searched && <EmptyState title="Search across CSG" copy="Find a question, link, decision, or class note from any conversation you can access." />}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  search: { margin: 20, minHeight: 50, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14 },
  dismiss: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  dismissText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  list: { paddingHorizontal: 20, paddingBottom: 30 },
  result: { minHeight: 68, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, flex: 1 },
  author: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12 },
  body: { color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, marginTop: 8 },
}));
