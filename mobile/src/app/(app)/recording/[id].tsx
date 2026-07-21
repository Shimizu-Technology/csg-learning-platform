import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, CalendarDays, ExternalLink, Film, ShieldCheck } from 'lucide-react-native';
import { useCallback, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NativeVideoPlayer } from '@/components/native-video-player';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoRecordings } from '@/lib/demo-learning';
import { openExternalPage } from '@/lib/external-links';
import { learningKeys, safeExternalUrl } from '@/lib/learning';
import type { RecordingItem, VideoProgressInput, WatchProgress } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

type RecordingsPayload = { recordings: RecordingItem[]; s3_recordings: RecordingItem[]; items: RecordingItem[] };

function updateProgress(payload: RecordingsPayload | undefined, itemKey: string, progress: WatchProgress) {
  if (!payload) return payload;
  const update = (item: RecordingItem) => item.item_key === itemKey || (item.source === 'uploaded' && item.id === progress.recording_id) ? { ...item, watch_progress: progress } : item;
  return { ...payload, items: payload.items.map(update), s3_recordings: payload.s3_recordings.map(update), recordings: payload.recordings.map(update) };
}

export default function RecordingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const queryClient = useQueryClient();
  const key = learningKeys.recordings(user?.id ?? 0);
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => auth.demo ? Promise.resolve({ recordings: [], s3_recordings: [], items: demoRecordings }) : api.recordings(signal), enabled: Boolean(user) });
  const item = useMemo(() => query.data?.items.find((recording) => recording.item_key === id || String(recording.id) === id), [id, query.data?.items]);
  const recordingId = item?.source === 'uploaded' && typeof item.id === 'number' ? item.id : null;
  const cohortId = item?.cohort_id ?? null;
  const itemKey = item?.item_key ?? '';

  const fetchStream = useCallback(async () => {
    if (recordingId === null || cohortId === null) throw new Error('This recording is not available for native playback.');
    if (auth.demo) return { stream_url: 'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8', expires_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() };
    return api.recordingStream(cohortId, recordingId);
  }, [api, auth.demo, cohortId, recordingId]);

  const saveProgress = useCallback(async (progress: VideoProgressInput) => {
    if (recordingId === null) return;
    if (auth.demo) return;
    const response = await api.updateWatchProgress(recordingId, progress);
    queryClient.setQueryData<RecordingsPayload>(key, (current) => updateProgress(current, itemKey, response.watch_progress));
  }, [api, auth.demo, itemKey, key, queryClient, recordingId]);

  if (query.isPending && !query.data) return <SafeAreaView style={styles.safe}><LoadingState label="Opening recording" /></SafeAreaView>;
  if (query.error && !query.data) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable></View><ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /></SafeAreaView>;
  if (!item) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable></View><ErrorState message="This recording is no longer available to this account." retry={() => void query.refetch()} /></SafeAreaView>;

  const externalUrl = safeExternalUrl(item.url);
  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable><View style={styles.flex}><Text style={styles.kicker}>CLASS RECORDING</Text><Text numberOfLines={1} style={styles.headerTitle}>{item.cohort_name}</Text></View></View><ScrollView contentContainerStyle={styles.content}>
    <View><Text style={styles.source}>{item.source === 'uploaded' ? 'SECURE CSG VIDEO' : item.source.toUpperCase()}</Text><Text style={styles.title}>{item.title}</Text><View style={styles.meta}><CalendarDays color={palette.quiet} size={14} /><Text style={styles.metaText}>{item.recorded_date || 'Recording date not set'}{item.duration_display ? ` · ${item.duration_display}` : ''}</Text></View></View>
    {item.source === 'uploaded' ? <NativeVideoPlayer fetchStream={fetchStream} initialPosition={item.watch_progress?.last_position_seconds || 0} initialTotalWatched={item.watch_progress?.total_watched_seconds || 0} saveProgress={saveProgress} title={item.title} /> : <View style={styles.externalCard}><View style={styles.externalIcon}><Film color={palette.warning} size={28} /></View><Text style={styles.externalTitle}>{item.source === 'youtube' ? 'Watch on YouTube' : 'Open the original recording'}</Text><Text style={styles.externalCopy}>This legacy recording remains at its original host while Code School migrates class media into secure native playback.</Text><Pressable accessibilityRole="button" accessibilityLabel={`Open ${item.title} externally`} disabled={!externalUrl} onPress={() => externalUrl && void openExternalPage(externalUrl)} style={[styles.externalButton, !externalUrl && styles.disabled]}><ExternalLink color={palette.text} size={17} /><Text style={styles.externalButtonText}>Open recording</Text></Pressable></View>}
    {item.description && <View style={styles.description}><Text style={styles.sectionKicker}>ABOUT THIS CLASS</Text><Text style={styles.descriptionText}>{item.description}</Text></View>}
    <View style={styles.security}><ShieldCheck color={palette.success} size={19} /><View style={styles.flex}><Text style={styles.securityTitle}>Private cohort access</Text><Text style={styles.securityCopy}>Playback links expire automatically. Viewing progress is saved to the same record used by the web learning platform.</Text></View></View>
  </ScrollView></SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, kicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 16, marginTop: 2 }, content: { padding: 20, paddingBottom: 100, gap: 18 }, source: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 9, letterSpacing: 1.2 }, title: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 27, lineHeight: 34, letterSpacing: -0.8, marginTop: 6 }, meta: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 }, metaText: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 10 }, externalCard: { borderRadius: 22, borderWidth: 1, borderColor: '#4A3A21', backgroundColor: '#211B12', alignItems: 'center', padding: 24 }, externalIcon: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#302617', alignItems: 'center', justifyContent: 'center' }, externalTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 17, marginTop: 15 }, externalCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 18, textAlign: 'center', marginTop: 7 }, externalButton: { minHeight: 48, borderRadius: 15, backgroundColor: palette.ruby, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }, externalButtonText: { color: palette.text, fontFamily: fonts.bold, fontSize: 11 }, disabled: { opacity: 0.45 }, description: { borderRadius: 18, borderWidth: 1, borderColor: palette.line, backgroundColor: palette.panel, padding: 16 }, sectionKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1 }, descriptionText: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12, lineHeight: 20, marginTop: 8 }, security: { borderRadius: 17, backgroundColor: '#10231D', padding: 14, flexDirection: 'row', gap: 11 }, securityTitle: { color: palette.success, fontFamily: fonts.bold, fontSize: 11 }, securityCopy: { color: '#86B8A5', fontFamily: fonts.regular, fontSize: 9, lineHeight: 15, marginTop: 3 },
});
