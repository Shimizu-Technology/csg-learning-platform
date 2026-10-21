import { Button } from '@/components/ui/button';
import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useRouter } from 'expo-router';
import { Check, Search, UserRoundPlus } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Keyboard, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Avatar } from '@/components/avatar';
import { EmptyState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { demoDms, demoPeople } from '@/lib/demo-data';
import { conversationHasParticipants } from '@/lib/message-compose';
import type { UserSummary } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';

export default function ComposeScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user: sessionUser } = useSession();
  const { workspaces, activeWorkspaceId: workspaceId, loading: loadingWorkspaces, selectWorkspace } = useWorkspace();
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [query, setQuery] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(Boolean(workspaceId));
  const [creating, setCreating] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    const show = Keyboard.addListener('keyboardWillShow', (event) => setKeyboardHeight(event.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardWillHide', () => setKeyboardHeight(0));
    return () => { show.remove(); hide.remove(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const frame = requestAnimationFrame(() => {
      if (!workspaceId) { setLoadingUsers(false); setUsers([]); return; }
      setLoadingUsers(true);
      void (async () => {
        try {
          const available = auth.demo ? demoPeople : (await api.availableUsers(workspaceId)).users;
          if (!cancelled) setUsers(available.filter((candidate) => candidate.id !== sessionUser?.id));
        } catch (error) {
          if (!cancelled) Alert.alert('Couldn’t load members', (error as Error).message);
        } finally {
          if (!cancelled) setLoadingUsers(false);
        }
      })();
    });
    return () => { cancelled = true; cancelAnimationFrame(frame); };
  }, [api, auth.demo, sessionUser?.id, workspaceId]);

  const visible = useMemo(() => {
    const filter = query.trim().toLowerCase();
    return users.filter((user) => `${user.full_name} ${user.email}`.toLowerCase().includes(filter));
  }, [query, users]);

  const start = async () => {
    if (!workspaceId || !selected.length || creating) return;
    setCreating(true);
    try {
      if (auth.demo) {
        if (!sessionUser) throw new Error('Your sample account is still loading. Please try again.');
        const participantIds = [sessionUser.id, ...selected];
        const existing = demoDms.find((dm) => dm.workspace_id === workspaceId && conversationHasParticipants(dm.users, participantIds));
        if (!existing) throw new Error('That sample conversation is not available yet. Choose a different set of people.');
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
    <View style={[styles.safe, keyboardHeight > 0 && { paddingBottom: keyboardHeight }]}>
      <Pressable onPress={Keyboard.dismiss} style={[styles.intro, keyboardHeight > 0 && styles.introCompact]}>
        {keyboardHeight === 0 && <View style={styles.icon}><UserRoundPlus color={c.text.body} size={22} /></View>}
        <Text style={[styles.title, keyboardHeight > 0 && styles.titleCompact]}>Who do you want to message?</Text>
        {keyboardHeight === 0 && <Text style={styles.copy}>Choose one or more people from your Code School workspace.</Text>}
      </Pressable>
      {workspaces.length > 1 && (
        <ScrollView horizontal style={styles.workspaceStrip} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.workspaces} keyboardShouldPersistTaps="handled">
          {workspaces.map((workspace) => <Pressable key={workspace.id} accessibilityRole="button" accessibilityState={{ selected: workspace.id === workspaceId }} onPress={() => { Keyboard.dismiss(); if (workspace.id !== workspaceId) { setSelected([]); void selectWorkspace(workspace.id); } }} style={[styles.workspace, workspace.id === workspaceId && styles.workspaceActive]}><Text numberOfLines={1} style={[styles.workspaceText, workspace.id === workspaceId && styles.workspaceTextActive]}>{workspace.name}</Text></Pressable>)}
        </ScrollView>
      )}
      <View style={styles.search}><Search color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search workspace members" value={query} onChangeText={setQuery} onFocus={() => setSearchFocused(true)} onBlur={() => setSearchFocused(false)} onSubmitEditing={Keyboard.dismiss} returnKeyType="done" placeholder="Search members" placeholderTextColor={c.text.body} style={styles.input} />{searchFocused && <Pressable accessibilityRole="button" accessibilityLabel="Done searching" onPress={Keyboard.dismiss} style={styles.dismiss}><Text style={styles.dismissText}>Done</Text></Pressable>}</View>
      {loading ? <LoadingState label="Loading members" /> : (
        <ScrollView style={styles.memberScroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          {visible.map((user) => {
            const active = selected.includes(user.id);
            return <Pressable key={user.id} accessibilityRole="checkbox" accessibilityLabel={`Select ${user.full_name}`} accessibilityState={{ checked: active }} onPress={() => { Keyboard.dismiss(); setSelected((current) => active ? current.filter((id) => id !== user.id) : [...current, user.id]); }} style={styles.person}><Avatar name={user.full_name} /><View style={{ flex: 1 }}><Text style={styles.name}>{user.full_name}</Text><Text style={styles.email}>{user.email}</Text></View><View style={[styles.check, active && styles.checkActive]}>{active && <Check color={c.text.strong} size={16} strokeWidth={3} />}</View></Pressable>;
          })}
          {!visible.length && <EmptyState title="No members found" copy={workspaces.length ? 'Try a name or email from this workspace.' : 'Join a workspace before starting a conversation.'} />}
        </ScrollView>
      )}
      {(keyboardHeight === 0 || selected.length > 0) && <View style={styles.footer}><Button variant="primary" accessibilityRole="button" disabled={!selected.length || creating} onPress={() => void start()} style={[styles.start, (!selected.length || creating) && styles.disabled]}><Text style={styles.startText}>{creating ? 'Starting…' : selected.length > 1 ? `Start group message (${selected.length})` : 'Start message'}</Text></Button></View>}
    </View>
  );
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  intro: { padding: 20, alignItems: 'center' },
  introCompact: { paddingVertical: 12 },
  icon: { width: 48, height: 48, borderRadius: 16, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 20 },
  titleCompact: { fontSize: 16 },
  copy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 300, marginTop: 5 },
  workspaces: { paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
  workspaceStrip: { flexGrow: 0, maxHeight: 56 },
  workspace: { maxWidth: 180, height: 44, borderRadius: 13, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, justifyContent: 'center', paddingHorizontal: 14 },
  workspaceActive: { borderColor: c.selection.indicator, backgroundColor: c.selection.bg, borderWidth: 2 },
  workspaceText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 },
  workspaceTextActive: { color: c.text.strong, fontFamily: fonts.extraBold },
  search: { marginHorizontal: 20, minHeight: 48, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 14 },
  dismiss: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  dismissText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 },
  memberScroll: { flex: 1, minHeight: 0 },
  list: { padding: 20, paddingBottom: 24 },
  person: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle },
  name: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 14 },
  email: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 2 },
  check: { width: 26, height: 26, borderRadius: 9, borderWidth: 1, borderColor: c.border.subtle, alignItems: 'center', justifyContent: 'center' },
  checkActive: { backgroundColor: c.selection.bg, borderColor: c.action.primary },
  footer: { padding: 16, backgroundColor: c.surface.raised, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
  start: { minHeight: 50, borderRadius: 16,  alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
  startText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 },
}));
