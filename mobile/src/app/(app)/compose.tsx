import { useRouter } from 'expo-router';
import { Check, Search, UserRoundPlus } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { EmptyState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoChannels, demoDms } from '@/lib/demo-data';
import type { UserSummary } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

interface WorkspaceOption { id: number; name: string }

const demoPeople: UserSummary[] = [
  { id: 18, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', avatar_url: null, is_admin: false, is_staff: false },
  { id: 19, full_name: 'Noah Cruz', email: 'noah@example.com', role: 'student', avatar_url: null, is_admin: false, is_staff: false },
  { id: 20, full_name: 'Kai Perez', email: 'kai@example.com', role: 'student', avatar_url: null, is_admin: false, is_staff: false },
];

export default function ComposeScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api } = useSession();
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([]);
  const [workspaceId, setWorkspaceId] = useState<number | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [loadingWorkspaces, setLoadingWorkspaces] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const channels = auth.demo ? demoChannels : (await api.channels()).channels;
        const unique = Array.from(new Map(channels.map((channel) => [channel.workspace_id, { id: channel.workspace_id, name: channel.workspace_name }])).values());
        if (!cancelled) {
          setWorkspaces(unique);
          setWorkspaceId(unique[0]?.id ?? null);
          if (!unique.length) setLoadingUsers(false);
        }
      } catch (error) {
        if (!cancelled) Alert.alert('Couldn’t load workspaces', (error as Error).message);
      } finally {
        if (!cancelled) setLoadingWorkspaces(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api, auth.demo]);

  useEffect(() => {
    if (!workspaceId) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const available = auth.demo ? demoPeople : (await api.availableUsers(workspaceId)).users;
        if (!cancelled) setUsers(available);
      } catch (error) {
        if (!cancelled) Alert.alert('Couldn’t load members', (error as Error).message);
      } finally {
        if (!cancelled) setLoadingUsers(false);
      }
    })();
    return () => { cancelled = true; };
  }, [api, auth.demo, workspaceId]);

  const visible = useMemo(() => {
    const filter = query.trim().toLowerCase();
    return users.filter((user) => `${user.full_name} ${user.email}`.toLowerCase().includes(filter));
  }, [query, users]);

  const start = async () => {
    if (!workspaceId || !selected.length || creating) return;
    setCreating(true);
    try {
      if (auth.demo) {
        const existing = demoDms.find((dm) => dm.users.some((member) => selected.includes(member.id))) || demoDms[0];
        router.replace({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(existing.id) } });
      } else {
        const result = await api.createDm(workspaceId, selected);
        router.replace({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(result.direct_conversation.id) } });
      }
    } catch (error) {
      Alert.alert('Couldn’t start conversation', (error as Error).message);
    } finally {
      setCreating(false);
    }
  };

  const loading = loadingWorkspaces || loadingUsers;
  return (
    <View style={styles.safe}>
      <View style={styles.intro}>
        <View style={styles.icon}><UserRoundPlus color={palette.rubySoft} size={22} /></View>
        <Text style={styles.title}>Who do you want to message?</Text>
        <Text style={styles.copy}>Choose one or more people from your Code School workspace.</Text>
      </View>
      {workspaces.length > 1 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workspaces}>
          {workspaces.map((workspace) => <Pressable key={workspace.id} accessibilityRole="button" accessibilityState={{ selected: workspace.id === workspaceId }} onPress={() => { if (workspace.id !== workspaceId) { setLoadingUsers(true); setSelected([]); setWorkspaceId(workspace.id); } }} style={[styles.workspace, workspace.id === workspaceId && styles.workspaceActive]}><Text numberOfLines={1} style={[styles.workspaceText, workspace.id === workspaceId && styles.workspaceTextActive]}>{workspace.name}</Text></Pressable>)}
        </ScrollView>
      )}
      <View style={styles.search}><Search color={palette.quiet} size={18} /><TextInput accessibilityLabel="Search workspace members" autoFocus value={query} onChangeText={setQuery} placeholder="Search members" placeholderTextColor={palette.quiet} style={styles.input} /></View>
      {loading ? <LoadingState label="Loading members" /> : (
        <ScrollView contentContainerStyle={styles.list}>
          {visible.map((user) => {
            const active = selected.includes(user.id);
            return <Pressable key={user.id} accessibilityRole="checkbox" accessibilityState={{ checked: active }} onPress={() => setSelected((current) => active ? current.filter((id) => id !== user.id) : [...current, user.id])} style={styles.person}><Avatar name={user.full_name} /><View style={{ flex: 1 }}><Text style={styles.name}>{user.full_name}</Text><Text style={styles.email}>{user.email}</Text></View><View style={[styles.check, active && styles.checkActive]}>{active && <Check color="white" size={16} strokeWidth={3} />}</View></Pressable>;
          })}
          {!visible.length && <EmptyState title="No members found" copy={workspaces.length ? 'Try a name or email from this workspace.' : 'Join a workspace before starting a conversation.'} />}
        </ScrollView>
      )}
      <View style={styles.footer}><Pressable accessibilityRole="button" disabled={!selected.length || creating} onPress={() => void start()} style={[styles.start, (!selected.length || creating) && styles.disabled]}><Text style={styles.startText}>{creating ? 'Starting…' : selected.length > 1 ? `Start group message (${selected.length})` : 'Start message'}</Text></Pressable></View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink },
  intro: { padding: 20, alignItems: 'center' },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { color: palette.text, fontFamily: fonts.bold, fontSize: 20 },
  copy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 300, marginTop: 5 },
  workspaces: { paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
  workspace: { maxWidth: 180, height: 44, borderRadius: 13, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, justifyContent: 'center', paddingHorizontal: 14 },
  workspaceActive: { borderColor: '#5B2630', backgroundColor: '#2A151B' },
  workspaceText: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 12 },
  workspaceTextActive: { color: palette.rubySoft },
  search: { marginHorizontal: 20, minHeight: 48, borderRadius: 16, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 14 },
  list: { padding: 20, paddingBottom: 100 },
  person: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line },
  name: { color: palette.text, fontFamily: fonts.semibold, fontSize: 14 },
  email: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 11, marginTop: 2 },
  check: { width: 26, height: 26, borderRadius: 9, borderWidth: 1, borderColor: palette.line, alignItems: 'center', justifyContent: 'center' },
  checkActive: { backgroundColor: palette.ruby, borderColor: palette.ruby },
  footer: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 16, backgroundColor: palette.panel, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.line },
  start: { minHeight: 50, borderRadius: 16, backgroundColor: palette.ruby, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  startText: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 },
});
