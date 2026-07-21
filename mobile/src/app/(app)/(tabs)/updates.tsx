import { Bell, Pin } from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoAnnouncements } from '@/lib/demo-data';
import type { Announcement } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function UpdatesScreen() {
  const auth = useCsgAuth();
  const { api } = useSession();
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true); else setLoading(true);
    try {
      if (auth.demo) setItems(demoAnnouncements);
      else {
        const result = await api.announcements();
        setItems(result.announcements);
        if (result.unread_count > 0) {
          void api.markAnnouncementsRead().then(() => {
            const readAt = new Date().toISOString();
            setItems((current) => current.map((item) => ({ ...item, read_at: item.read_at || readAt })));
          }).catch(() => undefined);
        }
      }
      setError(null);
    }
    catch (requestError) { setError((requestError as Error).message); }
    finally { setLoading(false); setRefreshing(false); }
  }, [api, auth.demo]);
  useEffect(() => { const frame = requestAnimationFrame(() => void load()); return () => cancelAnimationFrame(frame); }, [load]);
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <View style={styles.header}><Text style={styles.eyebrow}>WHAT MATTERS NOW</Text><Text style={styles.heading}>Updates</Text><Text style={styles.subhead}>Announcements from your instructors and community.</Text></View>
      {loading ? <LoadingState label="Loading updates" /> : error ? <ErrorState message={error} retry={() => void load()} /> : (
        <ScrollView refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
          {items.map((item) => <View key={item.id} style={[styles.card, !item.read_at && styles.unreadCard]}><View style={styles.meta}><View style={styles.icon}>{item.pinned ? <Pin color={palette.rubySoft} size={15} /> : <Bell color={palette.muted} size={15} />}</View><Text style={styles.scope}>{item.cohort_name || item.audience}</Text>{!item.read_at && <View style={styles.dot} />}</View><Text style={styles.title}>{item.title}</Text><Text style={styles.body}>{item.body}</Text><Text style={styles.byline}>{item.author?.full_name || 'Code School of Guam'} · {formatDate(item.published_at)}</Text></View>)}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(value)) : 'Recently'; }
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 22 },
  eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.8 }, heading: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 34, letterSpacing: -1.2 }, subhead: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, marginTop: 4 },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 14 }, card: { padding: 20, borderRadius: 22, backgroundColor: palette.panel, borderWidth: 1, borderColor: palette.line }, unreadCard: { borderColor: '#5B2630', backgroundColor: '#171319' }, meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 }, icon: { width: 28, height: 28, borderRadius: 10, backgroundColor: palette.panelRaised, alignItems: 'center', justifyContent: 'center' }, scope: { flex: 1, color: palette.muted, fontFamily: fonts.bold, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }, dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.rubySoft }, title: { color: palette.text, fontFamily: fonts.bold, fontSize: 19, letterSpacing: -0.25, lineHeight: 25 }, body: { color: '#BBC0CB', fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, marginTop: 10 }, byline: { color: palette.quiet, fontFamily: fonts.medium, fontSize: 11, marginTop: 18 },
});
