import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowLeft, ExternalLink, FolderOpen, Search } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { openExternalPage } from '@/lib/external-links';
import { learningKeys } from '@/lib/learning';
import { useSession } from '@/providers/session-provider';

export default function ResourcesScreen() {
  const router = useRouter();
  const { api, user } = useSession();
  const [filter, setFilter] = useState('');
  const query = useQuery({ queryKey: learningKeys.resources(user?.id || 0), queryFn: ({ signal }) => api.resources(signal), enabled: Boolean(user) });
  const resources = useMemo(() => (query.data?.resources || []).filter((resource) => `${resource.title} ${resource.category} ${resource.description || ''}`.toLowerCase().includes(filter.trim().toLowerCase())), [filter, query.data?.resources]);
  const grouped = useMemo(() => Object.entries(resources.reduce<Record<string, typeof resources>>((groups, resource) => {
    const category = resource.cohort_name ? `${resource.cohort_name} · ${resource.category || 'General'}` : resource.category || 'General';
    groups[category] = [...(groups[category] || []), resource];
    return groups;
  }, {})), [resources]);

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View><Text style={styles.headerKicker}>LEARNING LIBRARY</Text><Text style={styles.headerTitle}>Resources</Text></View></View>{query.isPending && !query.data ? <LoadingState label="Loading resources" /> : query.error && !query.data ? <ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /> : <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
    {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved resources. Pull to reconnect.</Text></View>}
    <Text style={styles.title}>Everything useful, close at hand.</Text><Text style={styles.subtitle}>Open class references and starter materials without hunting through old messages.</Text>
    <View style={styles.search}><Search color={palette.quiet} size={18} /><TextInput accessibilityLabel="Search resources" value={filter} onChangeText={setFilter} placeholder="Search resources" placeholderTextColor={palette.quiet} style={styles.input} /></View>
    {grouped.map(([category, items]) => <View key={category} style={styles.section}><Text style={styles.category}>{category.toUpperCase()}</Text><View style={styles.stack}>{(items || []).map((resource) => <LearningCard key={resource.id} onPress={() => void openExternalPage(resource.url).catch((error) => Alert.alert('Could not open resource', (error as Error).message))} label={`Open ${resource.title}`}><View style={styles.row}><View style={styles.icon}><FolderOpen color={palette.rubySoft} size={20} /></View><View style={styles.flex}><Text style={styles.resourceTitle}>{resource.title}</Text>{resource.description && <Text style={styles.resourceCopy}>{resource.description}</Text>}</View><ExternalLink color={palette.quiet} size={18} /></View></LearningCard>)}</View></View>)}
    {!resources.length && <View style={styles.empty}><FolderOpen color={palette.rubySoft} size={30} /><Text style={styles.emptyTitle}>{filter ? 'No matching resources' : 'No resources yet'}</Text><Text style={styles.emptyCopy}>{filter ? 'Try a different search.' : 'Shared class links will appear here.'}</Text></View>}
  </ScrollView>}</SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, headerKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 80, gap: 15 }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 28, lineHeight: 35, letterSpacing: -0.8 }, subtitle: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: -7 }, search: { minHeight: 50, borderRadius: 16, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10 }, input: { flex: 1, color: palette.text, fontFamily: fonts.regular, fontSize: 13, paddingVertical: 12 }, section: { gap: 9, marginTop: 8 }, category: { color: palette.quiet, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.3 }, stack: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'center', gap: 11 }, icon: { width: 42, height: 42, borderRadius: 13, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, resourceTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 14 }, resourceCopy: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, marginTop: 3 }, empty: { alignItems: 'center', paddingVertical: 70 }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 13 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, marginTop: 5 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: '#2A2115', justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: palette.warning, fontFamily: fonts.semibold, fontSize: 10 },
});
