import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { StaffCurriculumDetailView } from '@/components/staff-curriculum';
import { fonts, palette } from '@/constants/csg-theme';
import { demoStaffCurriculum } from '@/lib/demo-staff';
import { learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function StaffCurriculumScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const [filter, setFilter] = useState('');
  const validId = Number.isInteger(id) && id > 0;
  const query = useQuery({
    queryKey: learningKeys.curriculum(user?.id || 0, id),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ curriculum: demoStaffCurriculum }) : api.curriculum(id, signal),
    enabled: Boolean(user?.is_staff && validId),
  });
  const curriculum = query.data?.curriculum;

  if (!user?.is_staff || !validId) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><BackButton onPress={() => router.back()} /></View><ErrorState title="Curriculum unavailable" message="This staff curriculum link is not available for this account." /></SafeAreaView>;
  if (query.isPending && !curriculum) return <SafeAreaView style={styles.safe}><LoadingState label="Opening curriculum" /></SafeAreaView>;
  if (!curriculum) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><BackButton onPress={() => router.back()} /></View><ErrorState message={query.error ? (query.error as Error).message : 'This curriculum is unavailable.'} retry={() => void query.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><BackButton onPress={() => router.back()} /><View style={styles.flex}><Text style={styles.headerKicker}>CURRICULUM STUDIO</Text><Text numberOfLines={1} style={styles.headerTitle}>{curriculum.name}</Text></View><View style={styles.preview}><Text style={styles.previewText}>READ ONLY</Text></View></View><ScrollView keyboardDismissMode="on-drag" refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
    {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved curriculum. Refresh when your connection returns.</Text></View>}
    <StaffCurriculumDetailView curriculum={curriculum} filter={filter} onFilterChange={setFilter} onOpenLesson={(lessonId) => router.push(`/lesson/${lessonId}`)} />
  </ScrollView></SafeAreaView>;
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onPress} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, headerKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 }, preview: { minHeight: 30, borderRadius: 15, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', paddingHorizontal: 9, justifyContent: 'center', marginRight: 8 }, previewText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6 }, content: { padding: 20, paddingBottom: 90, gap: 14 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: '#2A2115', justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: palette.warning, fontFamily: fonts.semibold, fontSize: 11 },
});
