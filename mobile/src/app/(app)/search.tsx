import { toNativeHref } from '@/lib/record-destination';
import { addRecentSearch, clearRecentSearches, loadRecentSearches } from '@/lib/search-history';
import type { components } from '@/lib/api.generated';
import { brand } from '../../lib/brand';
import { personContext } from '@/lib/person-context';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useRouter, type Href } from 'expo-router';
import { Clock, FolderOpen, Hash, Search as SearchIcon, X } from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Modal, Pressable as RNPressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

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

const searchLabels: Record<string, string> = {
  student: 'Students',
  staff: 'Team',
  cohort: 'Cohorts',
  curriculum: 'Curricula',
  module: 'Modules',
  lesson: 'Lessons',
  submission: 'Submissions',
  help_request: 'Help requests',
  follow_up: 'Follow-up plans',
  channel: 'Channels',
  dm: 'Direct messages',
  announcement: 'Updates',
  recording: 'Recordings',
  resource: 'Resources',
  cohort_file: 'Files & docs',
};

type SearchCategory = 'all' | 'people' | 'files' | 'lessons' | 'messages' | 'recordings';

const CATEGORY_OPTIONS: { value: SearchCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'people', label: 'People' },
  { value: 'files', label: 'Files' },
  { value: 'lessons', label: 'Lessons' },
  { value: 'messages', label: 'Messages' },
  { value: 'recordings', label: 'Recordings' },
];

function groupMatchesCategory(type: string, category: SearchCategory): boolean {
  if (category === 'all') return true;
  if (category === 'files') return type === 'cohort_file' || type === 'resource';
  if (category === 'lessons') return ['lesson', 'module', 'curriculum', 'cohort', 'submission', 'help_request', 'follow_up'].includes(type);
  if (category === 'messages') return ['channel', 'dm', 'announcement'].includes(type);
  if (category === 'recordings') return type === 'recording';
  if (category === 'people') return type === 'student' || type === 'staff';
  return true;
}

type Person = { user: UserSummary; workspaces: WorkspaceSummary[] };

export default function SearchScreen() {
  const { user } = useSession();
  return <SearchScreenContent key={user?.id ?? 0} />;
}

function SearchScreenContent() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { workspaces } = useWorkspace();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SearchCategory>('all');
  const [recentQueries, setRecentQueries] = useState<string[]>([]);
  const [partial, setPartial] = useState(false);
  const [recordError, setRecordError] = useState<string | null>(null);
  const [records, setRecords] = useState<components['schemas']['SearchResponse']['groups']>([]);
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
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const userId = user?.id ?? 0;

  useEffect(() => {
    mountedRef.current = true;
    void loadRecentSearches(userId).then((items) => {
      if (mountedRef.current) setRecentQueries(items);
    });
    return () => {
      mountedRef.current = false;
      generation.current += 1;
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [userId]);

  const rememberQuery = useCallback((term: string) => {
    const clean = term.trim();
    if (clean.length < 2) return;
    void addRecentSearch(userId, clean).then((next) => {
      if (mountedRef.current && next !== null) setRecentQueries(next);
    });
  }, [userId]);

  const clearRecent = () => {
    setRecentQueries([]);
    void clearRecentSearches(userId);
  };

  const runSearch = useCallback(async (rawQuery: string, options: { dismissKeyboard?: boolean; persistRecent?: boolean } = {}) => {
    const value = rawQuery.trim();
    if (value.length < 2) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const request = ++generation.current;
    if (options.dismissKeyboard) Keyboard.dismiss();
    if (options.persistRecent) rememberQuery(value);
    setLoading(true); setSearched(true); setOpenError(null);
    setPeopleError(null); setMessageError(null); setRecordError(null); setPartial(false);
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
    const [messages, members, found] = await Promise.allSettled([
      auth.demo ? Promise.resolve({ results: [] as MessageSearchResult[] }) : api.search(value),
      findPeople(),
      auth.demo ? Promise.resolve({ groups: [], partial: false }) : api.searchEverything(value),
    ]);
    if (!mountedRef.current || generation.current !== request) return;
    setPartial(found.status === 'fulfilled' && Boolean(found.value.partial));
    setRecords(found.status === 'fulfilled' ? found.value.groups : []);
    if (found.status === 'rejected') setRecordError('Learning search is unavailable. Try again.');
    if (messages.status === 'fulfilled') setResults(messages.value.results);
    else { setResults([]); setMessageError('Messages are unavailable. Try again.'); }
    if (members.status === 'fulfilled') {
      const filter = value.toLocaleLowerCase();
      setPeople(members.value.people.filter((person) => person.user.full_name.toLocaleLowerCase().includes(filter)));
      if (members.value.incomplete) setPeopleError('Some members are unavailable. Try again.');
    } else { setPeople([]); setPeopleError('People are unavailable. Try again.'); }
    setLoading(false);
  }, [api, auth.demo, rememberQuery, user?.id, user?.is_staff, workspaces]);

  const submit = () => void runSearch(query, { dismissKeyboard: true, persistRecent: true });

  const handleQueryChange = (value: string) => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    generation.current += 1;
    setQuery(value);
    setLoading(false);
    setSearched(false);
    setResults([]);
    setPeople([]);
    setRecords([]);
    setPartial(false);
    if (value.trim().length >= 2) {
      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        void runSearch(value, { dismissKeyboard: false, persistRecent: false });
      }, 280);
    }
  };

  useEffect(() => () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, []);

  const visibleRecordGroups = useMemo(
    () => records.filter((group) => group.type !== 'message' && groupMatchesCategory(group.type, category)),
    [category, records],
  );
  const showPeopleSection = category === 'all' || category === 'people';
  const showMessagesSection = category === 'all' || category === 'messages';

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
    rememberQuery(query);
    if (user?.is_staff) setAuthorContext(person.user);
    else if (person.workspaces.length === 1) void openDm(person, person.workspaces[0]);
    else setWorkspaceChoice(person);
  };

  return (
    <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Search</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close search" onPress={() => router.back()} style={styles.close}>
          <X color={c.text.body} size={22} />
        </Pressable>
      </View>
      <View style={styles.search}>
        <SearchIcon color={c.text.muted} size={18} />
        <TextInput
          keyboardAppearance={scheme}
          accessibilityLabel="Search people and messages"
          autoFocus
          returnKeyType="search"
          value={query}
          onChangeText={handleQueryChange}
          onSubmitEditing={submit}
          placeholder="Search files, lessons, people, and messages"
          placeholderTextColor={c.text.body}
          style={styles.input}
        />
        {query.length > 0 && (
          <RNPressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => handleQueryChange('')} style={styles.clearButton}>
            <X color={c.text.muted} size={16} />
          </RNPressable>
        )}
        <Pressable accessibilityRole="button" accessibilityLabel="Search" disabled={query.trim().length < 2} onPress={submit} style={styles.dismiss}>
          <Text style={styles.dismissText}>Search</Text>
        </Pressable>
      </View>
      {searched && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {CATEGORY_OPTIONS.map((option) => {
            const active = category === option.value;
            return (
              <RNPressable
                key={option.value}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setCategory(option.value)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>{option.label}</Text>
              </RNPressable>
            );
          })}
        </ScrollView>
      )}
      {loading ? <LoadingState label={`Searching across ${brand.schoolAbbreviation}`} /> : <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={styles.list}>
        {openError && <Text accessibilityRole="alert" style={styles.error}>{openError}</Text>}
        {searched ? <>
          {showPeopleSection && <>
            <Text accessibilityRole="header" style={styles.heading}>People</Text>
            {peopleError && <View><Text style={styles.error}>{peopleError}</Text><Button variant="secondary" onPress={submit}>Retry people</Button></View>}
            {people.map((person) => <Pressable key={person.user.id} accessibilityRole="button" accessibilityLabel={`Open ${person.user.full_name}, ${personContext(person.user, people.map((item) => item.user), person.workspaces.map((workspace) => workspace.name).join(' · '))}`} disabled={opening} onPress={() => openPerson(person)} style={styles.person}><Avatar name={person.user.full_name} /><View style={styles.personCopy}><Text style={styles.body}>{person.user.full_name}</Text><Text style={styles.label}>{personContext(person.user, people.map((item) => item.user), person.workspaces.map((workspace) => workspace.name).join(' · '))}</Text></View></Pressable>)}
            {!people.length && !peopleError && <Text style={styles.empty}>No matching people you can access.</Text>}
          </>}
          <Text accessibilityLiveRegion="polite" aria-live="polite" style={styles.empty}>{partial ? 'Some results took too long. Showing what we found.' : ''}</Text>
          {recordError && <Text accessibilityRole="alert" style={styles.empty}>{recordError}</Text>}
          {visibleRecordGroups.map(group => <View key={group.type}>
            <Text accessibilityRole="header" style={styles.heading}>{searchLabels[group.type] || 'Search results'}</Text>
            {group.results.map(record => {
              const href = toNativeHref(record.destination);
              return href ? (
                <Pressable key={record.id} accessibilityRole="button" onPress={() => { rememberQuery(query); router.push(href as Href); }} style={styles.result}>
                  <View style={styles.meta}>
                    {group.type === 'cohort_file' && <FolderOpen color={c.text.body} size={14} />}
                    <Text style={styles.label}>{record.title}</Text>
                  </View>
                  <Text numberOfLines={3} style={styles.body}>{record.snippet}</Text>
                </Pressable>
              ) : null;
            })}
          </View>)}
          {category !== 'all' && !visibleRecordGroups.length && !showPeopleSection && !showMessagesSection && (
            <Text style={styles.empty}>No matching items in this category.</Text>
          )}
          {showMessagesSection && <>
            <Text accessibilityRole="header" style={styles.heading}>Messages</Text>
            {messageError && <View><Text style={styles.error}>{messageError}</Text><Button variant="secondary" onPress={submit}>Retry messages</Button></View>}
            {results.map((result) => <Pressable key={result.id} accessibilityRole="button" accessibilityLabel={`Open ${result.context.label} at this message`} onPress={() => { rememberQuery(query); router.push(messageSearchRoute(result) as Href); }} style={styles.result}><View style={styles.meta}><Hash color={c.text.body} size={14} /><Text style={styles.label}>{result.context.label}</Text><Text style={styles.author}>{result.author.full_name}</Text></View><Text numberOfLines={3} style={styles.body}>{plainMessageText(result.body)}</Text></Pressable>)}
            {!results.length && !messageError && <Text style={styles.empty}>No matching messages. Try another word or phrase.</Text>}
          </>}
        </> : (
          <View style={styles.idleWrap}>
            {recentQueries.length > 0 && (
              <View style={styles.recentSection}>
                <View style={styles.recentHeader}>
                  <Text accessibilityRole="header" style={styles.recentTitle}>Recent searches</Text>
                  <RNPressable accessibilityRole="button" onPress={clearRecent} style={styles.recentClear}>
                    <Text style={styles.recentClearText}>Clear</Text>
                  </RNPressable>
                </View>
                <View style={styles.recentList}>
                  {recentQueries.map((term) => (
                    <RNPressable
                      key={term}
                      accessibilityRole="button"
                      accessibilityLabel={`Search for ${term}`}
                      onPress={() => {
                        setQuery(term);
                        void runSearch(term, { dismissKeyboard: true, persistRecent: true });
                      }}
                      style={styles.recentRow}
                    >
                      <Clock color={c.text.muted} size={16} />
                      <Text numberOfLines={1} style={styles.recentText}>{term}</Text>
                    </RNPressable>
                  ))}
                </View>
              </View>
            )}
            <EmptyState title={`Search across ${brand.schoolAbbreviation}`} copy="Find files, docs, lessons, people, recordings, and messages as you type." />
          </View>
        )}
      </ScrollView>}
      {authorContext && <MessageAuthorContext author={authorContext} onClose={() => setAuthorContext(null)} />}
      <Modal visible={Boolean(workspaceChoice)} transparent animationType="slide" onRequestClose={() => setWorkspaceChoice(null)}><View style={styles.overlay}><View style={styles.sheet}><ScrollView contentContainerStyle={styles.choices}><Text accessibilityRole="header" style={styles.heading}>Choose a cohort or community</Text>{openError && <Text style={styles.error}>{openError}</Text>}{workspaceChoice?.workspaces.map((workspace) => <Button key={workspace.id} disabled={opening} variant="secondary" onPress={() => void openDm(workspaceChoice, workspace)}>{workspace.name}</Button>)}<Button variant="secondary" onPress={() => setWorkspaceChoice(null)}>Cancel</Button></ScrollView></View></View></Modal>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  header: { minHeight: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 18 },
  close: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  search: { marginHorizontal: 12, marginTop: 8, marginBottom: 8, minHeight: 48, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 16 },
  clearButton: { minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' },
  dismiss: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
  dismissText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  strip: { flexGrow: 0, flexShrink: 0, marginBottom: 4 },
  chips: { paddingHorizontal: 12, gap: 8, alignItems: 'center' },
  chip: { minHeight: 44, borderRadius: 22, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, justifyContent: 'center' },
  chipActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg },
  chipText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 13 },
  chipTextActive: { color: c.text.strong },
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
  idleWrap: { gap: 16, paddingTop: 8 },
  recentSection: { gap: 8 },
  recentHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recentTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15 },
  recentClear: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  recentClearText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 },
  recentList: { borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, overflow: 'hidden' },
  recentRow: { minHeight: 48, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  recentText: { flex: 1, color: c.text.strong, fontFamily: fonts.medium, fontSize: 14 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
  sheet: { maxHeight: '80%', backgroundColor: c.surface.raised, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  choices: { padding: 20, paddingBottom: 36, gap: 12 },
}));
