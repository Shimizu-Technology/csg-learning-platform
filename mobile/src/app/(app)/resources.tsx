import { themedAlert as Alert } from '@/lib/alerts';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowLeft, ExternalLink, FolderOpen, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { openExternalPage } from '@/lib/external-links';
import { learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useCohort } from '@/providers/cohort-provider';

export default function ResourcesScreen() {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { selectedCohortId, selectedCohort } = useCohort();
  const [filter, setFilter] = useState('');
  const query = useQuery({
    queryKey: learningKeys.resources(user?.id || 0),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ resources: demoDashboard.resources }) : api.resources(signal),
    enabled: Boolean(user),
  });
  const resources = useMemo(() => (query.data?.resources || []).filter((resource) => (!selectedCohortId || resource.cohort_id === selectedCohortId) && `${resource.title} ${resource.category} ${resource.description || ''}`.toLowerCase().includes(filter.trim().toLowerCase())), [filter, query.data?.resources, selectedCohortId]);
  const grouped = useMemo(() => Object.entries(resources.reduce<Record<string, typeof resources>>((groups, resource) => {
    const category = resource.cohort_name ? `${resource.cohort_name} · ${resource.category || 'General'}` : resource.category || 'General';
    groups[category] = [...(groups[category] || []), resource];
    return groups;
  }, {})), [resources]);

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable><View><Text style={styles.headerKicker}>LEARNING LIBRARY</Text><Text style={styles.headerTitle}>Resources</Text></View></View>{query.isPending && !query.data ? <LoadingState label="Loading resources" /> : query.error && !query.data ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
    {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved resources. Pull to reconnect.</Text></View>}
    <Text style={styles.title}>Everything useful, close at hand.</Text><Text style={styles.subtitle}>{selectedCohort ? `${selectedCohort.name} · ` : ''}Open class references and starter materials without hunting through old messages.</Text>
    <View style={styles.search}><Search color={c.text.muted} size={18} /><TextInput keyboardAppearance={scheme} accessibilityLabel="Search resources" value={filter} onChangeText={setFilter} placeholder="Search resources" placeholderTextColor={c.text.body} style={styles.input} /></View>
    {grouped.map(([category, items]) => <View key={category} style={styles.section}><Text style={styles.category}>{category.toUpperCase()}</Text><View style={styles.stack}>{(items || []).map((resource) => <LearningCard key={resource.id} onPress={() => void openExternalPage(resource.url).catch((error) => Alert.alert('Could not open resource', (error as Error).message))} label={`Open ${resource.title}`}><View style={styles.row}><View style={styles.icon}><FolderOpen color={c.text.body} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>{resource.title}</Text>{resource.description && <Text style={styles.resourceCopy}>{resource.description}</Text>}</View><ExternalLink color={c.text.muted} size={18} /></View></LearningCard>)}</View></View>)}
    {!resources.length && <View style={styles.empty}><FolderOpen color={c.text.body} size={30} /><Text style={styles.emptyTitle}>{filter ? 'No matching resources' : 'No resources yet'}</Text><Text style={styles.emptyCopy}>{filter ? 'Try a different search.' : 'Shared class links will appear here.'}</Text></View>}
  </ScrollView>}</SafeAreaView>;
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, headerKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, headerTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 80, gap: 15 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 28, lineHeight: 35, letterSpacing: -0.8 }, subtitle: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: -7 }, search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: c.text.strong, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, section: { gap: 9, marginTop: 8 }, category: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.3 }, stack: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, resourceTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, resourceCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 3 }, empty: { alignItems: 'center', paddingVertical: 70 }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 17, marginTop: 13 }, emptyCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: c.status.warning.bg, justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 },
}));
