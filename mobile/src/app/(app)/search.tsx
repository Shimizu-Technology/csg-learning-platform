import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useRouter, type Href } from 'expo-router';
import { Hash, Search as SearchIcon } from 'lucide-react-native';
import { useRef, useState } from 'react';
import { Keyboard, Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { MessageAuthorContext } from '@/components/message-author-context';
import { Button } from '@/components/ui/button';
import { EmptyState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { plainMessageText } from '@/lib/message-format';
import { messageSearchRoute } from '@/lib/message-route';
import type { MessageSearchResult, UserSummary, WorkspaceSummary } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';

type Person = { user: UserSummary; workspaces: WorkspaceSummary[] };

export default function SearchScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { workspaces } = useWorkspace();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<MessageSearchResult[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const [authorContext, setAuthorContext] = useState<UserSummary | null>(null);
  const [workspaceChoice, setWorkspaceChoice] = useState<Person | null>(null);
  const generation = useRef(0);

  const submit = async () => {
    const value = query.trim();
    if (value.length < 2) return;
    const request = ++generation.current;
    Keyboard.dismiss();
    setLoading(true); setSearched(true); setOpenError(null);
    setPeopleError(null); setMessageError(null);
    const findPeople = async () => {
      if (auth.demo) return { people: [] as Person[], incomplete: false };
      if (user?.is_staff) {
        const response = await api.users({ role: 'student', include_enrollments: true, people_search: true });
        return { people: response.users.filter((candidate) => candidate.enrollments?.length).map((candidate) => ({ user: candidate, workspaces: [] })), incomplete: false };
      }
      // Students use the workspace-authorized lookup, including both block directions.
      const responses = await Promise.allSettled(workspaces.map(async (workspace) => ({ workspace, users: (await api.availableUsers(workspace.id)).users })));
      const byId = new Map<number, Person>();
      for (const response of responses) if (response.status === 'fulfilled') for (const candidate of response.value.users) {
        if (candidate.id === user?.id) continue;
        const person = byId.get(candidate.id) || { user: candidate, workspaces: [] };
        person.workspaces.push(response.value.workspace);
        byId.set(candidate.id, person);
      }
      return { people: [...byId.values()], incomplete: responses.some((response) => response.status === 'rejected') };
    };
    const [messages, members] = await Promise.allSettled([auth.demo ? Promise.resolve({ results: [] as MessageSearchResult[] }) : api.search(value), findPeople()]);
    if (generation.current !== request) return;
    if (messages.status === 'fulfilled') setResults(messages.value.results);
    else { setResults([]); setMessageError('Messages are unavailable. Try again.'); }
    if (members.status === 'fulfilled') {
      const filter = value.toLocaleLowerCase();
      setPeople(members.value.people.filter((person) => `${person.user.full_name} ${person.user.email}`.toLocaleLowerCase().includes(filter)));
      if (members.value.incomplete) setPeopleError('Some workspace members are unavailable. Try again.');
    } else { setPeople([]); setPeopleError('People are unavailable. Try again.'); }
    setLoading(false);
  };

  const openDm = async (person: Person, workspace: WorkspaceSummary) => {
    if (opening) return;
    const request = generation.current;
    setOpening(true); setOpenError(null);
    try {
      const response = await api.createDm(workspace.id, [person.user.id]);
      if (request !== generation.current) return;
      setWorkspaceChoice(null);
      router.push({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(response.direct_conversation.id) } });
    } catch (error) { if (request === generation.current) setOpenError((error as Error).message); }
    finally { setOpening(false); }
  };
  const openPerson = (person: Person) => {
    Keyboard.dismiss(); setOpenError(null);
    if (user?.is_staff) setAuthorContext(person.user);
    else if (person.workspaces.length === 1) void openDm(person, person.workspaces[0]);
    else setWorkspaceChoice(person);
  };

  return (
    <View style={styles.safe}>
      <View style={styles.search}><SearchIcon color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search people and messages" autoFocus returnKeyType="search" value={query} onChangeText={(value) => { generation.current += 1; setQuery(value); setLoading(false); setSearched(false); setResults([]); setPeople([]); }} onSubmitEditing={() => void submit()} placeholder="Search people and messages" placeholderTextColor={c.text.body} style={styles.input} /><Pressable accessibilityRole="button" accessibilityLabel="Search" disabled={query.trim().length < 2} onPress={() => void submit()} style={styles.dismiss}><Text style={styles.dismissText}>Search</Text></Pressable></View>
      {loading ? <LoadingState label="Searching people and messages" /> : <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
        {openError && <Text accessibilityRole="alert" style={styles.error}>{openError}</Text>}
        {searched ? <>
          <Text accessibilityRole="header" style={styles.heading}>People</Text>
          {peopleError && <View><Text style={styles.error}>{peopleError}</Text><Button variant="secondary" onPress={() => void submit()}>Retry people</Button></View>}
          {people.map((person) => <Pressable key={person.user.id} accessibilityRole="button" accessibilityLabel={`Open ${person.user.full_name}`} disabled={opening} onPress={() => openPerson(person)} style={styles.person}><Avatar name={person.user.full_name} /><View style={styles.personCopy}><Text style={styles.body}>{person.user.full_name}</Text><Text style={styles.label}>{user?.is_staff ? 'View student' : person.workspaces.map((workspace) => workspace.name).join(' · ')}</Text></View></Pressable>)}
          {!people.length && !peopleError && <Text style={styles.empty}>No matching people you can access.</Text>}
          <Text accessibilityRole="header" style={styles.heading}>Messages</Text>
          {messageError && <View><Text style={styles.error}>{messageError}</Text><Button variant="secondary" onPress={() => void submit()}>Retry messages</Button></View>}
          {results.map((result) => <Pressable key={result.id} accessibilityRole="button" accessibilityLabel={`Open ${result.context.label} at this message`} onPress={() => router.push(messageSearchRoute(result) as Href)} style={styles.result}><View style={styles.meta}><Hash color={c.text.body} size={14} /><Text style={styles.label}>{result.context.label}</Text><Text style={styles.author}>{result.author.full_name}</Text></View><Text numberOfLines={3} style={styles.body}>{plainMessageText(result.body)}</Text></Pressable>)}
          {!results.length && !messageError && <Text style={styles.empty}>No matching messages. Try another word or phrase.</Text>}
        </> : <EmptyState title="Search across CSG" copy="Find people, questions, links, and class notes from the conversations you can access." />}
      </ScrollView>}
      {authorContext && <MessageAuthorContext author={authorContext} onClose={() => setAuthorContext(null)} />}
      <Modal visible={Boolean(workspaceChoice)} transparent animationType="fade" onRequestClose={() => setWorkspaceChoice(null)}><View style={styles.overlay}><View style={styles.sheet}><ScrollView contentContainerStyle={styles.choices}><Text accessibilityRole="header" style={styles.heading}>Choose a workspace</Text>{openError && <Text style={styles.error}>{openError}</Text>}{workspaceChoice?.workspaces.map((workspace) => <Button key={workspace.id} disabled={opening} variant="secondary" onPress={() => void openDm(workspaceChoice, workspace)}>{workspace.name}</Button>)}<Button variant="secondary" onPress={() => setWorkspaceChoice(null)}>Cancel</Button></ScrollView></View></View></Modal>
    </View>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  search: { margin: 12, minHeight: 48, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 16 },
  dismiss: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  dismissText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  list: { paddingHorizontal: 16, paddingBottom: 30 },
  heading: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginVertical: 12 },
  person: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  personCopy: { flex: 1, gap: 4 },
  empty: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, paddingVertical: 8 },
  error: { color: c.status.danger.fg, fontFamily: fonts.medium, fontSize: 14, paddingVertical: 8 },
  result: { minHeight: 68, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  label: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, flexShrink: 1 },
  author: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12 },
  body: { color: c.text.strong, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
  sheet: { maxHeight: '80%', backgroundColor: c.surface.raised, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  choices: { padding: 20, paddingBottom: 36, gap: 12 },
}));
